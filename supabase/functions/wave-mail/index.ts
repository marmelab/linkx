/**
 * Courriel hebdomadaire de fin de vague (histoire 15) : transport.
 *
 * La fonction ne compose rien elle-même. Elle lit la vague, le classement et
 * les bilans, les remet à `_shared/waveMailDelivery.ts`, et lui injecte deux
 * choses : un expéditeur Resend et une réservation en base. Tout ce qui décide
 * du contenu ou de l'ordre des envois vit dans `_shared/`, où il se teste sans
 * réseau.
 *
 * **Appelée par un cron, pas par un navigateur.** D'où `verify_jwt = false`
 * dans `config.toml` et le contrôle explicite ci-dessous : le porteur doit
 * présenter la clé de service. `verify_jwt` seul ne suffirait pas, la clé
 * publique étant elle aussi un jeton valide.
 *
 * **Aucune adresse électronique n'est journalisée ni rendue** : le compte rendu
 * ne nomme les destinataires que par leur identifiant.
 */
import { TOURNAMENT_PATHS } from '../../../src/tournament/routes.ts'
import { fromPlatform } from '../_shared/platformAuth.ts'
import { UNIQUE_VIOLATION, createRest } from '../_shared/rest.ts'
import type { Rest } from '../_shared/rest.ts'
import { sendWaveMails } from '../_shared/waveMailDelivery.ts'
import type {
  ClaimOutcome,
  MailMessage,
  Recipient,
  SendOutcome,
} from '../_shared/waveMailDelivery.ts'
import type {
  BotReport,
  BotStatus,
  RankingRow,
  RenderedMail,
  TechnicalReason,
} from '../_shared/waveMail.ts'
import type { NotationErrorReason } from '../../../src/game/moveNotation.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/**
 * Les chemins viennent du routeur lui-même, jamais d'une copie : un courriel
 * qui enverrait sur des pages introuvables serait pire que pas de courriel, et
 * une liste recopiée ici se serait périmée à la première route renommée.
 *
 * Le `#` n'est pas décoratif : le routeur est en **mode hash**, GitHub Pages
 * servant des fichiers statiques. `…/linkx/classement` rendrait une 404 ;
 * `…/linkx/#/classement` retombe toujours sur `index.html`.
 */
const RANKING_PATH = `#${TOURNAMENT_PATHS.leaderboard}`
const GAMES_PATH = `#${TOURNAMENT_PATHS.games}`
const MY_BOTS_PATH = `#${TOURNAMENT_PATHS.bots}`

/**
 * File des bilans à envoyer. `envoye_le` y est la marque d'envoi, et la
 * contrainte d'unicité (vague, destinataire) la garantie de non-doublon : c'est
 * elle qui départage deux invocations simultanées, pas cette fonction.
 *
 * Tant que la table n'existe pas — le dépôt doit rester utilisable sans elle —,
 * la réservation se déclare indisponible et la garantie retombe sur la clé
 * d'idempotence de Resend, valable vingt-quatre heures. Le compte rendu le dit,
 * en rendant `garantie: 'fournisseur-24h'` au lieu de `garantie: 'base'`.
 */
const CLAIM_TABLE = 'courriels_vague'

/** `max_rows` de l'API de données : au-delà, la lecture se pagine. */
const PAGE_SIZE = 1000

const TECHNICAL_REASONS: readonly TechnicalReason[] = [
  'timeout',
  'illegal',
  'unreachable',
  'unreadable-reply',
]

type Wave = { id: string; debut: string; fin: string; statut: string }

type BotRow = {
  id: string
  proprietaire: string
  nom: string
  statut: BotStatus
  elo: number
  parties_classees: number
  modifie_le: string
}

type RankRow = { rang: number; nom: string; elo: number; statut: BotStatus }

type HistoryRow = {
  bot_id: string
  ecart: number
  victoires: number
  nuls: number
  defaites: number
}

type FaultRow = {
  bot_fautif: string
  motif_fin: TechnicalReason
  motif_refus: NotationErrorReason | null
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function baseUrl(site: string): string {
  return site.endsWith('/') ? site : `${site}/`
}

/** Lecture paginée : `rest.select` rend au plus `max_rows` lignes d'un coup. */
async function selectAll<T>(rest: Rest, query: string): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await rest.select<T>(`${query}&limit=${PAGE_SIZE}&offset=${offset}`)
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

/** Dernière vague close, à défaut d'identifiant explicite. */
async function loadWave(rest: Rest, waveId: string | null): Promise<Wave | null> {
  const filter = waveId
    ? `id=eq.${encodeURIComponent(waveId)}`
    : 'statut=eq.terminee&order=fin.desc'
  const [wave] = await rest.select<Wave>(
    `vagues?select=id,debut,fin,statut&${filter}&limit=1`,
  )
  return wave ?? null
}

/**
 * Adresses des auteurs. `auth.users` n'est pas exposée par l'API de données :
 * elle se lit par l'API d'administration, avec la clé de service.
 */
async function loadEmails(
  supabaseUrl: string,
  serviceKey: string,
): Promise<Map<string, string>> {
  const emails = new Map<string, string>()
  const perPage = 200
  for (let page = 1; ; page += 1) {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=${perPage}`,
      { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } },
    )
    if (!response.ok) throw new Error(`annuaire illisible (${response.status})`)
    const body = (await response.json()) as {
      users?: Array<{ id?: unknown; email?: unknown }>
    }
    const users = body.users ?? []
    for (const user of users) {
      if (typeof user.id === 'string' && typeof user.email === 'string' && user.email) {
        emails.set(user.id, user.email)
      }
    }
    if (users.length < perPage) return emails
  }
}

function tallyFaults(faults: readonly FaultRow[]) {
  const technical = new Map<string, Partial<Record<TechnicalReason, number>>>()
  const refusals = new Map<string, Partial<Record<NotationErrorReason, number>>>()
  for (const fault of faults) {
    if (!TECHNICAL_REASONS.includes(fault.motif_fin)) continue
    const perBot = technical.get(fault.bot_fautif) ?? {}
    perBot[fault.motif_fin] = (perBot[fault.motif_fin] ?? 0) + 1
    technical.set(fault.bot_fautif, perBot)
    if (fault.motif_fin === 'illegal' && fault.motif_refus) {
      const perRefusal = refusals.get(fault.bot_fautif) ?? {}
      perRefusal[fault.motif_refus] = (perRefusal[fault.motif_refus] ?? 0) + 1
      refusals.set(fault.bot_fautif, perRefusal)
    }
  }
  return { technical, refusals }
}

/**
 * Écart d'une IA **sur cette vague**, et non son dernier écart connu : une IA
 * qui n'a pas joué n'a pas bougé, et une IA jamais classée n'a pas d'écart.
 */
function waveDelta(
  bot: Pick<BotRow, 'id' | 'parties_classees'>,
  history: ReadonlyMap<string, HistoryRow>,
): number | null {
  const played = history.get(bot.id)
  if (played) return played.ecart
  return bot.parties_classees > 0 ? 0 : null
}

/**
 * Classement complet du courriel. Le rang et l'ordre viennent de la vue
 * `classement`, seule source du sujet ; la vue ne portant pas l'identifiant des
 * IA, l'écart se rattache par le nom, que la base tient unique à la casse près.
 */
function buildRanking(
  bots: readonly BotRow[],
  ranking: readonly RankRow[],
  history: ReadonlyMap<string, HistoryRow>,
): RankingRow[] {
  const botByName = new Map(bots.map((bot) => [bot.nom.toLowerCase(), bot]))
  return ranking.map((row) => {
    const bot = botByName.get(row.nom.toLowerCase())
    return {
      rank: row.rang,
      name: row.nom,
      elo: row.elo,
      delta: bot ? waveDelta(bot, history) : null,
      status: row.statut,
    }
  })
}

/**
 * Rassemble le bilan personnel de chaque auteur. Une IA dont l'auteur n'a plus
 * d'adresse connue est ignorée : le courriel ne part qu'à un destinataire réel.
 */
function buildRecipients(
  bots: readonly BotRow[],
  ranking: readonly RankRow[],
  history: ReadonlyMap<string, HistoryRow>,
  faults: readonly FaultRow[],
  emails: ReadonlyMap<string, string>,
  waveStart: string,
): Recipient[] {
  const rankByName = new Map(ranking.map((row) => [row.nom.toLowerCase(), row]))
  const { technical, refusals } = tallyFaults(faults)

  const byOwner = new Map<string, BotReport[]>()
  for (const bot of bots) {
    if (!emails.has(bot.proprietaire)) continue
    const played = history.get(bot.id)
    const report: BotReport = {
      name: bot.nom,
      status: bot.statut,
      rank: rankByName.get(bot.nom.toLowerCase())?.rang ?? null,
      elo: bot.elo,
      delta: waveDelta(bot, history),
      wins: played?.victoires ?? 0,
      draws: played?.nuls ?? 0,
      losses: played?.defaites ?? 0,
      technical: technical.get(bot.id) ?? {},
      refusals: refusals.get(bot.id),
      // `modifie_le` est touché par le déclencheur à chaque changement de
      // statut : dans la fenêtre de la vague, la mise en sommeil est récente.
      fellAsleep: bot.statut === 'sommeil' && bot.modifie_le >= waveStart,
    }
    const owned = byOwner.get(bot.proprietaire) ?? []
    owned.push(report)
    byOwner.set(bot.proprietaire, owned)
  }

  const recipients: Recipient[] = []
  for (const [owner, owned] of byOwner) {
    const email = emails.get(owner)
    if (!email) continue
    owned.sort((left, right) => left.name.localeCompare(right.name, 'fr'))
    recipients.push({ id: owner, email, bots: owned })
  }
  recipients.sort((left, right) => left.id.localeCompare(right.id))
  return recipients
}

/** Expéditeur Resend. La clé d'idempotence est ce qui interdit le doublon. */
function resendSender(apiKey: string, from: string) {
  return async (message: MailMessage): Promise<SendOutcome> => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        // Vingt-quatre heures de mémoire côté fournisseur : un cron qui se
        // répète dans la journée ne double aucun message.
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    })
    const body = (await response.json().catch(() => null)) as
      | { id?: unknown; message?: unknown }
      | null
    if (!response.ok) {
      const detail = typeof body?.message === 'string' ? body.message : ''
      return {
        ok: false,
        error: `Resend ${response.status}${detail ? ` : ${detail}` : ''}`,
      }
    }
    return { ok: true, id: typeof body?.id === 'string' ? body.id : null }
  }
}

function errorStatus(error: unknown): { status: number; code: string | null } {
  const failure = error as { status?: unknown; code?: unknown }
  return {
    status: typeof failure?.status === 'number' ? failure.status : 0,
    code: typeof failure?.code === 'string' ? failure.code : null,
  }
}

/**
 * Réservation d'un destinataire pour une vague, sur la file `courriels_vague`.
 *
 * Trois cas, parce que la file peut avoir été garnie à la clôture de la vague
 * ou pas du tout. Poser `envoye_le` **sous condition qu'il soit nul** est
 * l'opération atomique qui réserve : la base ne l'accorde qu'une fois, et deux
 * invocations simultanées ne peuvent pas la gagner toutes les deux. Sans ligne
 * en attente, on en crée une, et c'est alors la contrainte d'unicité qui
 * tranche. Le message composé y est conservé : c'est ce que `contenu` veut dire.
 */
function claimFactory(rest: Rest, waveId: string) {
  let tableMissing = false
  const filter = (recipientId: string) =>
    `vague_id=eq.${encodeURIComponent(waveId)}` +
    `&destinataire=eq.${encodeURIComponent(recipientId)}`

  const claim = async (
    recipientId: string,
    mail: RenderedMail,
  ): Promise<ClaimOutcome> => {
    if (tableMissing) return 'unavailable'
    try {
      const taken = await rest.update<{ id: number }>(
        CLAIM_TABLE,
        `${filter(recipientId)}&envoye_le=is.null`,
        { envoye_le: new Date().toISOString() },
        'id',
      )
      if (taken.length > 0) return 'claimed'

      const existing = await rest.select<{ id: number }>(
        `${CLAIM_TABLE}?select=id&${filter(recipientId)}&limit=1`,
      )
      if (existing.length > 0) return 'already-sent'

      await rest.insert(CLAIM_TABLE, [{
        vague_id: waveId,
        destinataire: recipientId,
        contenu: { objet: mail.subject, texte: mail.text, html: mail.html },
        envoye_le: new Date().toISOString(),
      }])
      return 'claimed'
    } catch (error) {
      const { status, code } = errorStatus(error)
      // Une autre invocation a gagné la course entre la lecture et l'insertion.
      if (code === UNIQUE_VIOLATION) return 'already-sent'
      if (status === 404 || (code ?? '').startsWith('PGRST20')) {
        tableMissing = true
        return 'unavailable'
      }
      throw error
    }
  }

  /**
   * Rend la réservation : la ligne retourne « à envoyer ». On ne la supprime
   * pas — elle peut avoir été garnie à la clôture, et son `contenu` se perdrait.
   */
  const release = async (recipientId: string): Promise<void> => {
    if (tableMissing) return
    await rest.update(CLAIM_TABLE, filter(recipientId), { envoye_le: null })
  }

  return { claim, release }
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Utiliser POST.' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, message: 'Service mal configuré.' }, 500)
  }

  if (!fromPlatform(request, serviceKey)) {
    return json({ ok: false, message: 'Réservé à la plateforme.' }, 401)
  }

  const payload = (await request.json().catch(() => ({}))) as {
    vague_id?: unknown
    dry_run?: unknown
  }
  const waveId = typeof payload.vague_id === 'string' ? payload.vague_id : null
  const dryRun = payload.dry_run === true

  const rest = createRest({ url: supabaseUrl, serviceKey })

  let wave: Wave | null
  let bots: BotRow[]
  let ranking: RankRow[]
  let history: HistoryRow[]
  let faults: FaultRow[]
  let emails: Map<string, string>
  try {
    wave = await loadWave(rest, waveId)
    if (!wave) return json({ ok: false, message: 'Aucune vague close à annoncer.' }, 404)
    const vague = encodeURIComponent(wave.id)
    ;[bots, ranking, history, faults, emails] = await Promise.all([
      selectAll<BotRow>(
        rest,
        'bots?select=id,proprietaire,nom,statut,elo,parties_classees,modifie_le' +
          '&statut=neq.retiree&order=nom.asc',
      ),
      selectAll<RankRow>(rest, 'classement?select=rang,nom,elo,statut&order=rang.asc'),
      selectAll<HistoryRow>(
        rest,
        `historique_elo?select=bot_id,ecart,victoires,nuls,defaites&vague_id=eq.${vague}`,
      ),
      selectAll<FaultRow>(
        rest,
        'parties?select=bot_fautif,motif_fin,motif_refus' +
          `&vague_id=eq.${vague}&statut=eq.terminee&bot_fautif=not.is.null`,
      ),
      loadEmails(supabaseUrl, serviceKey),
    ])
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`wave-mail : préparation impossible — ${detail}`)
    return json({ ok: false, message: `Préparation impossible : ${detail}` }, 503)
  }

  const site = baseUrl(Deno.env.get('WAVE_MAIL_SITE_URL') ?? 'https://example.invalid/')
  const historyByBot = new Map(history.map((row) => [row.bot_id, row]))
  const input = {
    waveId: wave.id,
    waveEnd: new Date(wave.fin),
    ranking: buildRanking(bots, ranking, historyByBot),
    recipients: buildRecipients(bots, ranking, historyByBot, faults, emails, wave.debut),
    links: {
      ranking: `${site}${RANKING_PATH}`,
      games: `${site}${GAMES_PATH}`,
      myBots: `${site}${MY_BOTS_PATH}`,
    },
  }

  const apiKey = Deno.env.get('RESEND_API_KEY') ?? ''
  const from = Deno.env.get('WAVE_MAIL_FROM') ?? ''
  if (dryRun || !apiKey || !from) {
    // Sans compte Resend, le dépôt reste utilisable : on compose tout, on
    // n'envoie rien, et le compte rendu dit pourquoi. Aucune réservation n'est
    // prise, pour qu'un envoi ultérieur reste possible.
    const raison = dryRun
      ? 'essai à blanc demandé'
      : apiKey
        ? 'WAVE_MAIL_FROM absent'
        : 'RESEND_API_KEY absent'
    console.warn(
      `wave-mail : aucun envoi (${raison}), ` +
        `${input.recipients.length} destinataire(s) préparé(s).`,
    )
    const rapport = await sendWaveMails(input, {
      send: () => Promise.resolve({ ok: false as const, error: raison }),
      claim: () => Promise.resolve('unavailable' as const),
    })
    return json({ ok: true, envoi: false, raison, rapport })
  }

  const { claim, release } = claimFactory(rest, wave.id)
  const rapport = await sendWaveMails(input, {
    send: resendSender(apiKey, from),
    claim,
    release,
  })
  console.log(
    `wave-mail : vague ${wave.id}, ${rapport.envoyes} envoyé(s), ` +
      `${rapport.ignores} ignoré(s), ${rapport.echecs} en échec, ` +
      `garantie ${rapport.garantie}.`,
  )
  return json({ ok: true, envoi: true, rapport })
})
