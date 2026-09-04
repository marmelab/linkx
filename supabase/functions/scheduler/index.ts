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
 * échoue en 23505, et cet échec **est** le verrou.
 */
import { essaiInstant, readJsonBody } from '../_shared/essaiLocal.ts'
import { moveCountOf, interruptMutation } from '../_shared/gameTick.ts'
import type { StoredGame } from '../_shared/gameTick.ts'
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
import { waveWindowAt } from '../_shared/waveWindow.ts'
import type { WaveWindow } from '../_shared/waveWindow.ts'
import type { PlayerId } from '../../../src/game/types.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** Lignes lues d'un coup ; PostgREST plafonne de toute façon les réponses. */
const PAGE_SIZE = 1000
/** Parties écrites par insertion : une vague en compte des centaines. */
const INSERT_CHUNK = 500

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

/**
 * Le cron présente la clé de service. `verify_jwt` ne vérifie qu'une signature,
 * et le jeton d'un simple utilisateur en porte une : c'est bien la clé de
 * service qu'il faut exiger, pas un jeton valide.
 */
function fromPlatform(request: Request, serviceKey: string): boolean {
  const header = request.headers.get('authorization') ?? ''
  return header === `Bearer ${serviceKey}`
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
 * Ouvre la vague du jeudi, ou rend celle qu'un autre réveil vient d'ouvrir.
 * `created` distingue les deux : seul l'ouvreur crée les parties.
 */
async function ensureWave(
  rest: Rest,
  window: WaveWindow,
): Promise<{ wave: WaveDbRow; created: boolean }> {
  const debut = window.start.toISOString()
  try {
    const [created] = await rest.insert<WaveDbRow>(
      'vagues',
      [{
        debut,
        fin: window.end.toISOString(),
        graine: crypto.randomUUID(),
        statut: 'en_cours',
      }],
      { returning: 'id,debut,fin,graine,statut' },
    )
    if (created) return { wave: created, created: true }
  } catch (error) {
    if (!(error instanceof RestError) || error.code !== UNIQUE_VIOLATION) throw error
  }

  const [existing] = await rest.select<WaveDbRow>(
    `vagues?debut=eq.${encodeURIComponent(debut)}&select=id,debut,fin,graine,statut&limit=1`,
  )
  if (!existing) throw new Error('Vague introuvable après un conflit d’unicité.')
  return { wave: existing, created: false }
}

/** Crée toutes les parties de la vague et les empile. */
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

  const ids: string[] = []
  for (const batch of chunk(rows, INSERT_CHUNK)) {
    const created = await rest.insert<{ id: string }>('parties', batch, {
      returning: 'id',
    })
    ids.push(...created.map((row) => row.id))
  }
  await enqueue(rest, ids)
  return { games: ids.length, openingsPerPair: plan.openingsPerPair }
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
 */
async function runQualifications(
  rest: Rest,
  bots: readonly BotDbRow[],
): Promise<{ opened: number; qualified: number; refused: number; note?: string }> {
  const waiting = bots.filter((bot) => bot.statut === 'en_attente')
  if (waiting.length === 0) return { opened: 0, qualified: 0, refused: 0 }

  const house = bots.find((bot) => bot.ia_maison && bot.statut === 'active')
  if (!house) {
    return {
      opened: 0,
      qualified: 0,
      refused: 0,
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
  }

  return { opened, qualified, refused }
}

/** Parties immobiles : leur message a été perdu, la vague les remet en file. */
async function requeueStaleGames(rest: Rest, now: Date): Promise<number> {
  const games = await selectAll<GameDbRow>(
    rest,
    `parties?statut=neq.terminee&select=${GAME_COLUMNS}&order=modifie_le.asc`,
  )
  const stale = gamesToRequeue(games, now)
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
 * Clôture : classement, historique et sommeil. Le calcul se fait
 * **avant** de réclamer la vague, et la réclamation est conditionnelle : deux
 * réveils concurrents calculent peut-être tous deux, un seul écrit.
 */
async function closeWaveIfDone(
  rest: Rest,
  wave: WaveDbRow,
  bots: readonly BotDbRow[],
  force: boolean,
): Promise<{ closed: boolean; note: string; endormies?: number }> {
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

  const claimed = await rest.update<{ id: string }>(
    'vagues',
    `id=eq.${wave.id}&statut=eq.en_cours`,
    { statut: 'terminee' },
    'id',
  )
  if (claimed.length === 0) {
    return { closed: false, note: 'vague déjà close par un autre réveil' }
  }

  await rest.insert(
    'historique_elo',
    closures.map((closure) => ({
      bot_id: closure.bot,
      vague_id: wave.id,
      elo_avant: closure.eloBefore,
      elo_apres: closure.elo,
      victoires: closure.wins,
      nuls: closure.draws,
      defaites: closure.losses,
    })),
    { onConflict: 'bot_id,vague_id', ignoreDuplicates: true },
  )

  for (const closure of closures) {
    await rest.update('bots', `id=eq.${closure.bot}`, {
      elo: closure.elo,
      parties_classees: closure.ratedGames,
      vagues_echouees_consecutives: closure.failureStreak,
      // Une IA endormie sort des appariements ; son classement, déjà écrit
      // ci-dessus, ne bougera plus tant qu'elle n'est pas réactivée.
      ...(closure.asleep ? { statut: 'sommeil' } : {}),
    })
  }

  return {
    closed: true,
    note: `${closures.length} IA classées`,
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
  if (!fromPlatform(request, serviceKey)) {
    return json({ ok: false, message: 'Réservé à la plateforme.' }, 401)
  }

  const rest = createRest({ url: supabaseUrl, serviceKey })
  const now = essaiInstant(await readJsonBody(request)) ?? new Date()
  const window = waveWindowAt(now)
  const report: Record<string, unknown> = {
    ok: true,
    now: now.toISOString(),
    fenetre: window.inWindow ? 'ouverte' : 'fermée',
    vague: window.waveDay,
  }

  const bots = await selectAll<BotDbRow>(rest, `bots?select=${BOT_COLUMNS}&order=id.asc`)

  // Une vague dont l'heure de fin est passée se clôt même hors fenêtre : c'est
  // le seul moyen que la fin de vague ne dépende pas de l'instant du réveil.
  const [running] = await rest.select<WaveDbRow>(
    'vagues?statut=eq.en_cours&select=id,debut,fin,graine,statut&order=debut.desc&limit=1',
  )
  if (running && Date.parse(running.fin) <= now.getTime()) {
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
  report.qualifications = await runQualifications(rest, bots)
  report.remises_en_file = await requeueStaleGames(rest, now)

  if (!window.inWindow) {
    report.prochaine_vague = window.start.toISOString()
    return json(report)
  }

  const { wave, created } = await ensureWave(rest, window)
  report.vague_id = wave.id
  report.ouverture = created
    ? await createWaveGames(rest, wave, bots)
    : 'déjà ouverte'

  const cloture = await closeWaveIfDone(rest, wave, bots, false)
  report.cloture = cloture
  if (cloture.closed) {
    report.courriels = await requestWaveMail(supabaseUrl, serviceKey, wave.id)
  }

  return json(report)
})
