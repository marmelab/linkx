/**
 * Ordonnanceur des vagues (histoire 15).
 *
 * Réveillée chaque minute par `pg_cron`, cette fonction ne décide rien
 * elle-même : elle lit, écrit et ordonnance. Ce qui se décide vit dans
 * `_shared/waveWindow.ts` (sommes-nous dans la fenêtre ?), `_shared/wavePlan.ts`
 * (qui joue, qui se qualifie, qui s'endort) et `_shared/gameTick.ts` (comment
 * une partie se clôt), tous trois purs et testés sans base.
 *
 * À chaque réveil, dans l'ordre :
 *
 *   1. clore une vague dont l'heure de fin est passée, les parties encore en
 *      cours devenant des nuls techniques ;
 *   2. qualifier les IA en attente contre l'IA de la maison, et remettre en file
 *      les parties qui n'ont pas bougé ;
 *   3. dans la fenêtre : ouvrir la vague du jeudi si elle ne l'est pas ;
 *   4. clore la vague dès que toutes ses parties sont terminées.
 *
 * **La qualification ne dépend pas de la fenêtre.** L'histoire 14 la veut jouée
 * au moment où son auteur regarde l'écran, pas au prochain jeudi : une IA
 * déclarée un lundi n'a pas à attendre trois jours pour entrer au classement.
 * Elle n'appartient d'ailleurs à aucune vague — `vague_id` nul — et ne compte
 * dans aucun avancement. C'est pourquoi le cron réveille cette fonction tous
 * les jours (migration 20260904120000) et non le seul jeudi.
 *
 * **Une seule vague par jeudi.** L'unicité n'est pas gardée par un « lire puis
 * créer si absent », qui est exactement la faute que soixante réveils
 * concurrents révèlent : elle est portée par l'index unique de `vagues.debut`
 * (migration 20260904100200). `debut` vaut minuit à Paris du jeudi visé, la
 * même valeur pour tous les réveils de la fenêtre ; la deuxième insertion
 * échoue en 23505, et cet échec **est** le verrou. Une vague naît `planifiee` et
 * ne passe `en_cours` qu'une fois ses parties créées, sans quoi un réveil
 * concurrent la clôrait à vide avant qu'aucune rencontre n'existe.
 *
 * **Deux appelants** : `pg_cron`, qui présente la clé de service, et un
 * administrateur connecté, qui déclenche le même réveil à la main et reçoit le
 * même compte rendu (`_shared/platformAuth.ts`). Lui seul peut demander
 * `force`, qui traite l'instant comme s'il tombait dans la fenêtre du jeudi :
 * la vague s'ouvre, avance et se clôt un autre jour. C'est ce qui rend la
 * plateforme éprouvable sans attendre un jeudi, et c'est une capacité réelle,
 * tracée dans le compte rendu et dans le journal de la fonction.
 */
import { moveCountOf, interruptMutation } from '../_shared/gameTick.ts'
import type { StoredGame } from '../_shared/gameTick.ts'
import {
  authorizePlatformCall,
  forceAsked,
  readJsonBody,
} from '../_shared/platformAuth.ts'
import type { GameOutcome, OutcomeReason } from '../_shared/referee.ts'
import { UNIQUE_VIOLATION, RestError, createRest } from '../_shared/rest.ts'
import type { Rest } from '../_shared/rest.ts'
import {
  closeWave,
  gamesToRequeue,
  planWaveOpening,
  qualificationNeeded,
  qualificationVerdict,
} from '../_shared/wavePlan.ts'
import type { BotBefore, BotRow, WaveGameRecord } from '../_shared/wavePlan.ts'
import { WAVE_DURATION_MS, waveWindowAt } from '../_shared/waveWindow.ts'
import type { PlayerId } from '../../../src/game/types.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** Lignes lues d'un coup ; PostgREST plafonne de toute façon les réponses. */
const PAGE_SIZE = 1000
/** Parties écrites par insertion : une vague en compte des centaines. */
const INSERT_CHUNK = 500
/**
 * IA en attente examinées par réveil. Le cron en donne un par minute : vingt
 * qualifications à la minute suffisent largement à l'affluence réelle, et
 * bornent le travail fait **avant** l'ouverture de la vague.
 */
const MAX_QUALIFICATIONS_PER_TICK = 20

type BotDbRow = BotRow & {
  adresse_service: string
  elo: number
  parties_classees: number
  vagues_echouees_consecutives: number
  modifie_le: string
}

type WaveDbRow = {
  id: string
  debut: string
  fin: string
  graine: string
  statut: string
}

type GameDbRow = {
  id: string
  vague_id: string | null
  notation: string
  statut: string
  bot_bleu: string
  bot_blanc: string
  resultat: 'blue' | 'white' | 'draw' | null
  motif_fin: OutcomeReason | null
  bot_fautif: string | null
  nombre_coups: number
  modifie_le: string
  terminee_le: string | null
}

const BOT_COLUMNS =
  'id,nom,statut,proprietaire,ia_maison,adresse_service,elo,parties_classees,' +
  'vagues_echouees_consecutives,modifie_le'

const GAME_COLUMNS =
  'id,vague_id,notation,statut,bot_bleu,bot_blanc,resultat,motif_fin,' +
  'bot_fautif,nombre_coups,modifie_le,terminee_le'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

/** Lecture paginée : une vague de cinquante IA dépasse une page PostgREST. */
async function selectAll<T>(rest: Rest, path: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rest.select<T>(
      `${path}&limit=${PAGE_SIZE}&offset=${offset}`,
    )
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

async function enqueue(rest: Rest, ids: readonly string[]): Promise<void> {
  for (const batch of chunk(ids, INSERT_CHUNK)) {
    await rest.rpc('file_coups_enfiler', { parties: batch, delai_s: 0 })
  }
}

/**
 * Ouvre une vague **à l'instant présent**, ou rend celle qu'un autre réveil
 * vient d'ouvrir. `created` distingue les deux : seul l'ouvreur crée les parties.
 *
 * Une vague commence quand elle est ouverte, et non au jeudi qu'elle vise : le
 * cron du jeudi l'ouvre à minuit, un administrateur peut l'ouvrir un mardi. Le
 * calendrier ne décide plus que du réveil automatique.
 *
 * Deux réveils concurrents ne produisant plus le même `debut`, ce n'est plus lui
 * qui les départage mais l'index d'unicité de la vague **vivante** (migration
 * `plateforme_tournoi_vague_a_la_demande`) : le perdant relit celle qui existe.
 *
 * **La vague naît `planifiee`.** Née `en_cours`, elle serait close à vide par un
 * réveil concurrent : celui-ci ne la crée pas, appelle la clôture, ne voit
 * encore aucune partie et en conclut que tout est fini — les parties de
 * l'ouvreur naissant alors sous une vague déjà close. `planifiee` dit « mes
 * rencontres n'existent pas encore », et la clôture exige `en_cours`.
 */
async function ensureWave(
  rest: Rest,
  now: Date,
): Promise<{ wave: WaveDbRow; created: boolean }> {
  try {
    const [created] = await rest.insert<WaveDbRow>(
      'vagues',
      [{
        debut: now.toISOString(),
        fin: new Date(now.getTime() + WAVE_DURATION_MS).toISOString(),
        graine: crypto.randomUUID(),
        statut: 'planifiee',
      }],
      { returning: 'id,debut,fin,graine,statut' },
    )
    if (created) return { wave: created, created: true }
  } catch (error) {
    if (!(error instanceof RestError) || error.code !== UNIQUE_VIOLATION) throw error
  }

  const [existing] = await rest.select<WaveDbRow>(
    'vagues?statut=in.(planifiee,en_cours)&select=id,debut,fin,graine,statut&limit=1',
  )
  if (!existing) throw new Error('Vague introuvable après un conflit d’unicité.')
  return { wave: existing, created: false }
}

/**
 * Une vague a-t-elle déjà été ouverte depuis cet instant ?
 *
 * C'est ce qui empêche le cron de rouvrir une vague chaque minute de la fenêtre
 * du jeudi une fois la première close. L'index d'unicité n'y suffit plus : il ne
 * borne que les vagues vivantes.
 */
async function waveOpenedSince(rest: Rest, since: Date): Promise<boolean> {
  const [row] = await rest.select<{ id: string }>(
    `vagues?debut=gte.${encodeURIComponent(since.toISOString())}&select=id&limit=1`,
  )
  return row !== undefined
}

/**
 * Crée toutes les parties de la vague, les empile, puis ouvre la vague.
 *
 * **Rejouable de bout en bout.** L'index unique (vague, bleu, blanc, ouverture)
 * absorbe les insertions déjà faites, et les identifiants sont relus de la table
 * plutôt que du retour d'insertion : un ouvreur mort en chemin est repris au
 * réveil suivant sans dédoubler ses parties ni en oublier une à empiler. La
 * vague ne passe `en_cours` qu'à la toute fin, quand ses rencontres existent.
 */
async function createWaveGames(
  rest: Rest,
  wave: WaveDbRow,
  bots: readonly BotRow[],
): Promise<{ games: number; openingsPerPair: number }> {
  const plan = planWaveOpening(bots, wave.graine)
  const rows = plan.games.map((game) => ({
    vague_id: wave.id,
    ouverture: game.opening,
    // La notation part de l'ouverture imposée : une partie stocke toujours son
    // déroulé complet, et le nombre de coups doit s'accorder dès la création.
    notation: game.opening,
    nombre_coups: moveCountOf(game.opening),
    bot_bleu: game.blue,
    bot_blanc: game.white,
    statut: 'en_attente',
  }))

  for (const batch of chunk(rows, INSERT_CHUNK)) {
    await rest.insert('parties', batch, {
      onConflict: 'vague_id,bot_bleu,bot_blanc,ouverture',
      ignoreDuplicates: true,
    })
  }
  const created = await selectAll<{ id: string }>(
    rest,
    `parties?vague_id=eq.${wave.id}&select=id&order=id.asc`,
  )
  const queued = new Set(await rest.rpc<string[]>('file_coups_parties_en_file'))
  await enqueue(rest, created.filter((row) => !queued.has(row.id)).map((row) => row.id))
  await rest.rpc<boolean>('ouvrir_vague', { vague: wave.id })
  return { games: created.length, openingsPerPair: plan.openingsPerPair }
}

/**
 * La liste, tournée d'un cran de fenêtre par minute écoulée : deux réveils
 * consécutifs n'examinent pas les mêmes IA, et toutes passent en autant de
 * minutes qu'il y a de fenêtres.
 */
function rotatedByMinute<T>(items: readonly T[], now: Date): T[] {
  const start =
    (Math.floor(now.getTime() / 60_000) * MAX_QUALIFICATIONS_PER_TICK) %
    items.length
  return [...items.slice(start), ...items.slice(0, start)]
}

/** Dernier message du journal : c'est lui qui dit pourquoi une IA a échoué. */
async function lastJournalMessage(
  rest: Rest,
  partieId: string,
): Promise<string> {
  const [entry] = await rest.select<{ erreur: string | null }>(
    `evenements_partie?partie_id=eq.${partieId}&select=erreur&order=rang_coup.desc&limit=1`,
  )
  return entry?.erreur ?? ''
}

function outcomeOfRow(row: GameDbRow, message: string): GameOutcome {
  const offendingColor: PlayerId | null = row.bot_fautif === null
    ? null
    : row.bot_fautif === row.bot_bleu
      ? 'blue'
      : 'white'
  return {
    winner: row.resultat === 'draw' || row.resultat === null ? null : row.resultat,
    reason: row.motif_fin ?? 'draw',
    offender: row.bot_fautif,
    offendingColor,
    notationReason: null,
    moveNumber: row.nombre_coups,
    message,
  }
}

/**
 * Partie de qualification : une IA en attente joue contre l'IA de la maison et
 * devient active si elle la termine sans faute technique. Le verdict est écrit
 * au rang 0 du journal de la partie, là où son auteur ira le lire.
 *
 * **Budget borné.** Chaque IA en attente coûte au moins une lecture paginée des
 * parties de qualification, et ce travail précède l'ouverture de la vague : sans
 * plafond, quelques milliers de lignes `en_attente` suffiraient à faire expirer
 * chaque réveil avant qu'aucun jeudi ne s'ouvre. Le reste n'est pas perdu, il
 * est reporté au réveil suivant — le cron en donne un par minute —, et le
 * rapport dit combien attendent encore. La fenêtre **tourne** avec la minute :
 * prendre toujours les mêmes vingt premières laisserait une IA coincée en
 * attente occuper sa place indéfiniment, et les suivantes n'auraient jamais
 * leur qualification.
 */
async function runQualifications(
  rest: Rest,
  bots: readonly BotDbRow[],
  now: Date,
): Promise<{
  opened: number
  qualified: number
  refused: number
  waiting?: number
  note?: string
}> {
  const allWaiting = bots.filter((bot) => bot.statut === 'en_attente')
  if (allWaiting.length === 0) return { opened: 0, qualified: 0, refused: 0 }
  const waiting = allWaiting.length <= MAX_QUALIFICATIONS_PER_TICK
    ? allWaiting
    : rotatedByMinute(allWaiting, now).slice(0, MAX_QUALIFICATIONS_PER_TICK)
  const deferred = allWaiting.length - waiting.length

  const house = bots.find((bot) => bot.ia_maison && bot.statut === 'active')
  if (!house) {
    return {
      opened: 0,
      qualified: 0,
      refused: 0,
      waiting: allWaiting.length,
      note: 'IA de la maison absente ou inactive : aucune qualification lancée.',
    }
  }

  let opened = 0
  let qualified = 0
  let refused = 0

  for (const bot of waiting) {
    const attempts = await selectAll<GameDbRow>(
      rest,
      `parties?vague_id=is.null&select=${GAME_COLUMNS}` +
        `&or=(bot_bleu.eq.${bot.id},bot_blanc.eq.${bot.id})&order=cree_le.asc`,
    )

    // Une tentative terminée et non encore jugée décide du sort de l'IA.
    const finished = attempts.filter((attempt) => attempt.statut === 'terminee')
    const last = finished[finished.length - 1]
    if (last) {
      const verdict = qualificationVerdict(
        outcomeOfRow(last, await lastJournalMessage(rest, last.id)),
        bot.id,
      )
      await rest.insert(
        'evenements_partie',
        [{
          partie_id: last.id,
          rang_coup: 0,
          bot_id: bot.id,
          erreur: verdict.message,
        }],
        { onConflict: 'partie_id,rang_coup', ignoreDuplicates: true },
      )
      if (verdict.qualified) {
        await rest.update('bots', `id=eq.${bot.id}&statut=eq.en_attente`, {
          statut: 'active',
        })
        qualified += 1
        continue
      }
      refused += 1
    }

    if (!qualificationNeeded(bot, attempts)) continue

    // L'unicité d'une qualification ouverte est portée par un index partiel
    // (migration 20260904150200), et non par la lecture ci-dessus : deux réveils
    // qui se recouvrent n'en voient chacun aucune et en ouvriraient chacun une,
    // le verdict étant ensuite pris sur celle des deux qui finit la dernière.
    // Le 23505 est donc le cas normal d'une course, pas une panne.
    try {
      const [game] = await rest.insert<{ id: string }>(
        'parties',
        [{
          vague_id: null,
          ouverture: '',
          notation: '',
          nombre_coups: 0,
          bot_bleu: bot.id,
          bot_blanc: house.id,
          statut: 'en_attente',
        }],
        { returning: 'id' },
      )
      if (game) {
        await enqueue(rest, [game.id])
        opened += 1
      }
    } catch (error) {
      if (!(error instanceof RestError) || error.code !== UNIQUE_VIOLATION) throw error
    }
  }

  return deferred === 0
    ? { opened, qualified, refused }
    : {
      opened,
      qualified,
      refused,
      waiting: allWaiting.length,
      note: `${deferred} IA en attente reportées au prochain réveil.`,
    }
}

/**
 * Parties immobiles : leur message a été perdu, la vague les remet en file.
 * Celles dont un message attend encore, elles, ne sont pas immobiles — elles
 * font la queue derrière une IA saturée, et les réempiler dédoublerait la vague
 * entière à chaque réveil.
 */
async function requeueStaleGames(rest: Rest, now: Date): Promise<number> {
  const games = await selectAll<GameDbRow>(
    rest,
    `parties?statut=neq.terminee&select=${GAME_COLUMNS}&order=modifie_le.asc`,
  )
  const queued = new Set(
    await rest.rpc<string[]>('file_coups_parties_en_file'),
  )
  const stale = gamesToRequeue(games, now, queued)
  await enqueue(rest, stale)
  return stale.length
}

/**
 * Midi passé : la vague ne déborde jamais de sa fenêtre. Seules ses propres
 * parties sont closes — une qualification, qui n'appartient à aucune vague et se
 * joue tous les jours, n'a pas à mourir parce qu'un jeudi s'achève.
 */
async function interruptRunningGames(
  rest: Rest,
  wave: WaveDbRow,
  now: Date,
): Promise<number> {
  const games = await selectAll<GameDbRow>(
    rest,
    `parties?statut=neq.terminee&select=${GAME_COLUMNS}&vague_id=eq.${wave.id}`,
  )
  let closed = 0
  for (const game of games) {
    const stored: StoredGame = {
      id: game.id,
      notation: game.notation,
      moveCount: game.nombre_coups,
      blueBot: game.bot_bleu,
      whiteBot: game.bot_blanc,
    }
    const mutation = interruptMutation(stored, now)
    const written = await rest.update(
      'parties',
      `id=eq.${game.id}&statut=neq.terminee`,
      mutation.update,
      'id',
    )
    closed += written.length
  }
  return closed
}

function ratedGamesOf(games: readonly GameDbRow[]): WaveGameRecord[] {
  return games.map((game) => ({
    blue: game.bot_bleu,
    white: game.bot_blanc,
    winner: game.resultat === 'draw' || game.resultat === null
      ? null
      : game.resultat,
    reason: game.motif_fin ?? 'draw',
    offender: game.bot_fautif,
  }))
}

/**
 * Clôture : classement, historique et sommeil. Le classement se calcule ici —
 * c'est du domaine pur — mais il **s'écrit en base**, dans la même transaction
 * que la réclamation de la vague (`clore_vague`, migration 20260904150100).
 * Réclamer d'abord et écrire ensuite, en trois aller-retours, laissait une
 * invocation morte au milieu abandonner une vague close sans aucun Elo appliqué,
 * sans courriel, et sans chemin de reprise — la réclamation étant conditionnelle,
 * plus rien ne réessayait.
 */
async function closeWaveIfDone(
  rest: Rest,
  wave: WaveDbRow,
  bots: readonly BotDbRow[],
  force: boolean,
): Promise<{ closed: boolean; note: string; endormies?: number }> {
  if (wave.statut !== 'en_cours') {
    return { closed: false, note: `vague ${wave.statut}, rien à clore` }
  }

  const games = await selectAll<GameDbRow>(
    rest,
    `parties?vague_id=eq.${wave.id}&select=${GAME_COLUMNS}&order=cree_le.asc,id.asc`,
  )
  const unfinished = games.filter((game) => game.statut !== 'terminee')
  if (unfinished.length > 0 && !force) {
    return { closed: false, note: `${unfinished.length} parties encore en cours` }
  }

  const before: BotBefore[] = bots.map((bot) => ({
    id: bot.id,
    rating: bot.elo,
    ratedGames: bot.parties_classees,
    failureStreak: bot.vagues_echouees_consecutives,
    statut: bot.statut,
  }))
  const closures = closeWave(
    before,
    ratedGamesOf(games.filter((game) => game.statut === 'terminee')),
  )

  const claimed = await rest.rpc<{ reclamee: boolean; classees: number }>(
    'clore_vague',
    {
      vague: wave.id,
      classements: closures.map((closure) => ({
        bot_id: closure.bot,
        elo_avant: closure.eloBefore,
        elo_apres: closure.elo,
        victoires: closure.wins,
        nuls: closure.draws,
        defaites: closure.losses,
        parties_classees: closure.ratedGames,
        vagues_echouees_consecutives: closure.failureStreak,
        endormie: closure.asleep,
      })),
    },
  )
  if (!claimed.reclamee) {
    return { closed: false, note: 'vague déjà close par un autre réveil' }
  }

  return {
    closed: true,
    note: `${claimed.classees} IA classées`,
    endormies: closures.filter((closure) => closure.asleep).length,
  }
}

/**
 * Demande l'envoi des bilans. La composition, les adresses et la garantie de
 * non-doublon appartiennent à `wave-mail` : la clôture ne fait que la réveiller,
 * et un envoi qui échoue ne remet pas en cause une vague déjà classée — la
 * fonction se rappelle, la file `courriels_vague` retenant ce qui est parti.
 */
async function requestWaveMail(
  supabaseUrl: string,
  serviceKey: string,
  waveId: string,
): Promise<string> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/wave-mail`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${serviceKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ vague_id: waveId }),
    })
    return response.ok ? 'demandé' : `refusé (HTTP ${response.status})`
  } catch (error) {
    return `injoignable (${error instanceof Error ? error.message : String(error)})`
  }
}

Deno.serve(async (request: Request): Promise<Response> => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceKey || !supabaseUrl) {
    return json({ ok: false, message: 'Service mal configuré.' }, 500)
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const body = await readJsonBody(request)
  const caller = await authorizePlatformCall(request, {
    supabaseUrl,
    anonKey,
    serviceKey,
  })
  if (!caller) {
    return json({ ok: false, message: 'Réservé à la plateforme.' }, 401)
  }
  const force = forceAsked(body, caller)
  if (caller.kind === 'admin') {
    console.warn(
      `scheduler déclenché à la main par ${caller.userId}${force ? ', force' : ''}.`,
    )
  }

  const rest = createRest({ url: supabaseUrl, serviceKey })
  const now = new Date()
  const window = waveWindowAt(now)
  const report: Record<string, unknown> = {
    ok: true,
    declenchement: caller.kind === 'service' ? 'cron' : 'administrateur',
    force,
    now: now.toISOString(),
    fenetre: window.inWindow ? 'ouverte' : 'fermée',
    prochain_jeudi: window.waveDay,
  }

  const bots = await selectAll<BotDbRow>(rest, `bots?select=${BOT_COLUMNS}&order=id.asc`)

  // Une vague dont l'heure de fin est passée se clôt même hors fenêtre : c'est
  // le seul moyen que la fin de vague ne dépende pas de l'instant du réveil.
  // Une vague restée `planifiee` — ouvreur mort avant la fin de sa création — se
  // clôt aussi : sa fenêtre est passée, plus rien ne s'y créera, et la laisser
  // là la rendrait éternelle.
  const [running] = await rest.select<WaveDbRow>(
    'vagues?statut=in.(planifiee,en_cours)&select=id,debut,fin,graine,statut' +
      '&order=debut.desc&limit=1',
  )
  if (running && Date.parse(running.fin) <= now.getTime()) {
    if (running.statut === 'planifiee') {
      await rest.rpc<boolean>('ouvrir_vague', { vague: running.id })
      running.statut = 'en_cours'
    }
    report.interrompues = await interruptRunningGames(rest, running, now)
    const cloture = await closeWaveIfDone(rest, running, bots, true)
    report.cloture = cloture
    if (cloture.closed) {
      report.courriels = await requestWaveMail(supabaseUrl, serviceKey, running.id)
    }
    return json(report)
  }

  // Avant la fenêtre, et pas seulement dedans : une qualification n'attend pas
  // le jeudi, et une partie immobile n'a pas à attendre non plus.
  report.qualifications = await runQualifications(rest, bots, now)
  report.remises_en_file = await requeueStaleGames(rest, now)

  // Une vague vivante se poursuit : on la reprend là où elle en est, quel que
  // soit le jour. Le calendrier ne décide que de l'ouverture, jamais de la
  // conduite d'une vague déjà ouverte.
  if (running) {
    report.vague_id = running.id
    if (running.statut === 'planifiee') {
      report.ouverture = await createWaveGames(rest, running, bots)
      running.statut = 'en_cours'
    } else {
      report.ouverture = 'déjà ouverte'
    }
    const reprise = await closeWaveIfDone(rest, running, bots, false)
    report.cloture = reprise
    if (reprise.closed) {
      report.courriels = await requestWaveMail(supabaseUrl, serviceKey, running.id)
    }
    return json(report)
  }

  // Aucune vague vivante. Le cron n'en ouvre une que dans la fenêtre du jeudi,
  // et une seule par fenêtre ; `force` en ouvre une **maintenant**, sans
  // attendre le jeudi — c'est tout ce qu'il fait.
  if (!force) {
    if (!window.inWindow || (await waveOpenedSince(rest, window.start))) {
      report.prochaine_vague = window.start.toISOString()
      return json(report)
    }
  }

  const { wave, created } = await ensureWave(rest, now)
  report.vague_id = wave.id
  report.vague_ouverte_le = wave.debut
  // Une vague encore `planifiee` que ce réveil n'a pas créée est celle d'un
  // ouvreur mort en chemin : la création étant rejouable, on la reprend.
  if (created || wave.statut === 'planifiee') {
    report.ouverture = await createWaveGames(rest, wave, bots)
    wave.statut = 'en_cours'
  } else {
    report.ouverture = 'déjà ouverte'
  }

  const cloture = await closeWaveIfDone(rest, wave, bots, false)
  report.cloture = cloture
  if (cloture.closed) {
    report.courriels = await requestWaveMail(supabaseUrl, serviceKey, wave.id)
  }

  return json(report)
})
