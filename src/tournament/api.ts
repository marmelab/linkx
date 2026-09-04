/**
 * Tout ce que les écrans du tournoi demandent au réseau, et rien d'autre.
 *
 * Le client n'est créé qu'à l'appel : ce module n'est chargé qu'avec le morceau
 * paresseux du tournoi, si bien que le jeu ne connaît toujours ni compte ni
 * requête. Les lectures nomment leurs colonnes — les droits de `bots` sont
 * accordés colonne par colonne, un `select *` y est refusé.
 */
import { createClient } from '@supabase/supabase-js'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { tournamentConfig } from './config'
import { authRedirectUrl, normalizeAuthCallbackUrl } from './routes'
import type { QueueRow } from './queue'
import type {
  BotHistoryRow,
  BotRow,
  GameEventRow,
  GameRow,
  LeaderboardRow,
  WaveRow,
} from './types'

const BOT_COLUMNS =
  'id, nom, adresse_service, statut, elo, parties_classees, vagues_echouees_consecutives, ia_maison, cree_le'

const GAME_COLUMNS =
  'id, vague_id, ouverture, bot_bleu, bot_blanc, notation, statut, resultat, motif_fin, motif_refus, bot_fautif, nombre_coups, cree_le'

let client: SupabaseClient | null = null

export function tournamentClient(): SupabaseClient {
  if (client) return client
  if (!tournamentConfig) {
    throw new Error('Plateforme de tournoi non configurée.')
  }
  // Flux PKCE : le retour du lien magique arrive en `?code=`, le fragment étant
  // pris par le routage. La normalisation le remet en query string au cas où le
  // service l'aurait accroché au fragment — le client ne lit que la première.
  const normalized = normalizeAuthCallbackUrl(window.location.href)
  if (normalized !== window.location.href) {
    window.history.replaceState(null, '', normalized)
  }
  client = createClient(tournamentConfig.url, tournamentConfig.anonKey, {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  })
  return client
}

function unwrap<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message)
  return (result.data ?? []) as T
}

export async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  return unwrap<LeaderboardRow[]>(
    await tournamentClient()
      .from('classement')
      .select('rang, nom, elo, parties_classees, statut, ecart_derniere_vague')
      .order('rang', { ascending: true }),
  )
}

export async function fetchWaves(limit = 12): Promise<WaveRow[]> {
  return unwrap<WaveRow[]>(
    await tournamentClient()
      .from('vagues')
      .select('id, debut, fin, statut')
      .order('debut', { ascending: false })
      .limit(limit),
  )
}

/**
 * Avancement de la vague en cours. Les parties ne sont lisibles que de leurs
 * deux participants : leur décompte vient donc de `vagues`, où un déclencheur
 * le tient (migration `plateforme_tournoi_avancement_vague`). Une vague sans
 * compteurs lisibles rend `null`, et l'écran affiche alors sa fenêtre sans la
 * part jouée, plutôt qu'un chiffre inventé.
 */
export type WaveProgressRow = { jouees: number; total: number } | null

export async function fetchWaveProgress(waveId: string): Promise<WaveProgressRow> {
  const { data, error } = await tournamentClient()
    .from('vagues')
    .select('parties_jouees, parties_totales')
    .eq('id', waveId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { parties_jouees?: unknown; parties_totales?: unknown }
  if (typeof row.parties_jouees !== 'number' || typeof row.parties_totales !== 'number') {
    return null
  }
  return { jouees: row.parties_jouees, total: row.parties_totales }
}

export async function fetchMyBots(): Promise<BotRow[]> {
  return unwrap<BotRow[]>(
    await tournamentClient()
      .from('bots')
      .select(BOT_COLUMNS)
      .order('cree_le', { ascending: true }),
  )
}

export async function fetchBotHistory(
  botIds: readonly string[],
): Promise<BotHistoryRow[]> {
  if (botIds.length === 0) return []
  return unwrap<BotHistoryRow[]>(
    await tournamentClient()
      .from('historique_elo')
      .select('id, bot_id, vague_id, elo_avant, elo_apres, ecart, victoires, nuls, defaites, cree_le')
      .in('bot_id', botIds)
      .order('cree_le', { ascending: false }),
  )
}

/**
 * Nom des IA désignées par leur identifiant, adversaires compris.
 *
 * `bots` n'est lisible que de son propriétaire : l'adversaire n'y a pas de nom
 * pour nous. La vue `noms_bots` est faite pour cela, et ne porte que ces deux
 * colonnes (migration `plateforme_tournoi_noms_publics`).
 */
export async function fetchBotNames(
  botIds: readonly string[],
): Promise<Map<string, string>> {
  if (botIds.length === 0) return new Map()
  const rows = unwrap<Array<{ id: string; nom: string }>>(
    await tournamentClient()
      .from('noms_bots')
      .select('id, nom')
      .in('id', [...new Set(botIds)]),
  )
  return new Map(rows.map((row) => [row.id, row.nom]))
}

/**
 * Nombre maximal de parties rendues en une lecture. L'écran compare la taille
 * de ce qu'il reçoit à cette borne : atteinte, il **dit** la troncature plutôt
 * que de laisser croire à une vague vide.
 */
export const MY_GAMES_LIMIT = 400

/**
 * `botId` absent ne filtre pas ; `waveId` vaut l'identifiant d'une vague,
 * `null` pour les qualifications — les parties sans vague — et `undefined` pour
 * ne pas filtrer.
 */
export type MyGamesFilter = { botId?: string; waveId?: string | null }

/**
 * Les parties de l'auteur. La politique de `parties` les borne déjà à ses deux
 * participants : le filtre n'est là que pour aller chercher les anciennes,
 * au-delà des quatre cents dernières.
 *
 * Les noms sont résolus par une seconde requête plutôt que par une jointure :
 * ils viennent d'une vue, qui n'a pas de clé étrangère à emprunter. Un seul
 * chemin, donc, et l'adversaire est nommé aussi bien que la sienne — c'est
 * `games.ts` qui bascule ensuite du point de vue de l'auteur.
 */
export async function fetchMyGames(
  filter: MyGamesFilter = {},
): Promise<GameRow[]> {
  let query = tournamentClient().from('parties').select(GAME_COLUMNS)
  if (filter.botId !== undefined) {
    query = query.or(
      `bot_bleu.eq.${filter.botId},bot_blanc.eq.${filter.botId}`,
    )
  }
  if (filter.waveId === null) query = query.is('vague_id', null)
  else if (filter.waveId !== undefined) {
    query = query.eq('vague_id', filter.waveId)
  }

  const rows = unwrap<GameRow[]>(
    (await query
      .order('cree_le', { ascending: false })
      .limit(MY_GAMES_LIMIT)) as unknown as {
      data: GameRow[] | null
      error: { message: string } | null
    },
  )

  const names = await fetchBotNames(
    rows.flatMap((row) => [row.bot_bleu, row.bot_blanc]),
  )
  const named = (botId: string) => {
    const nom = names.get(botId)
    return nom === undefined ? null : { nom }
  }
  return rows.map((row) => ({
    ...row,
    bleu: named(row.bot_bleu),
    blanc: named(row.bot_blanc),
  }))
}

/**
 * Journal d'appel d'une partie, lu par la vue `journal_appels` et non par la
 * table : `erreur` et `reponse_brute` ne sont plus lisibles d'un participant
 * quelconque, mais du seul propriétaire de l'IA appelée (migration
 * `plateforme_tournoi_journal_prive`). La vue rend le reste des deux côtés, et
 * `erreur` à `null` sur les appels de l'adversaire.
 */
export async function fetchGameEvents(gameId: string): Promise<GameEventRow[]> {
  return unwrap<GameEventRow[]>(
    await tournamentClient()
      .from('journal_appels')
      .select('id, partie_id, rang_coup, bot_id, latence_ms, statut_http, coup, erreur')
      .eq('partie_id', gameId)
      .order('rang_coup', { ascending: true }),
  )
}

/**
 * L'utilisateur connecté est-il administrateur ?
 *
 * On le demande à la base plutôt qu'à une fonction : la politique de
 * `administrateurs` ne rend une ligne qu'à un administrateur, si bien que la
 * réponse **est** le droit. Un utilisateur ordinaire reçoit une liste vide, pas
 * un refus, et n'apprend rien de plus.
 *
 * Une panne se **propage** au lieu de se déguiser en « pas administrateur » :
 * répondre `false` à une lecture qui n'a pas abouti escamoterait les commandes
 * sans un mot, et l'administrateur croirait avoir perdu ses droits. C'est à
 * l'écran de dire qu'il n'a pas pu savoir.
 */
export async function isAdministrator(): Promise<boolean> {
  const { data, error } = await tournamentClient()
    .from('administrateurs')
    .select('utilisateur_id')
    .limit(1)
  if (error) throw new Error(error.message)
  return (data ?? []).length > 0
}

/**
 * Parties encore à arbitrer, telles quelles : l'écran d'administration les
 * découpe lui-même (`queue.ts`). Une vague en cours en compte quelques dizaines,
 * la borne est donc large et son dépassement sans conséquence — le total affiché
 * serait seulement tronqué.
 *
 * Réservé de fait aux administrateurs : la politique de `parties` n'ouvre la
 * table entière qu'à eux, un auteur ordinaire ne lirait que les siennes.
 */
export const QUEUE_LIMIT = 500

export async function fetchQueue(): Promise<QueueRow[]> {
  return unwrap<QueueRow[]>(
    await tournamentClient()
      .from('parties')
      .select('statut, vague_id, modifie_le')
      .neq('statut', 'terminee')
      .order('modifie_le', { ascending: true })
      .limit(QUEUE_LIMIT),
  )
}

/**
 * IA qui attendent leur qualification, c'est-à-dire tout le travail que
 * l'ordonnanceur a devant lui hors de la fenêtre du jeudi. Sans ce chiffre, un
 * réveil qui ne fait rien ne se distingue pas d'un réveil en panne.
 *
 * Réservé de fait aux administrateurs : la politique de `bots` n'ouvre la table
 * entière qu'à eux, un auteur ordinaire ne compterait que les siennes.
 */
export async function countAwaitingQualification(): Promise<number> {
  const { count, error } = await tournamentClient()
    .from('bots')
    .select('id', { count: 'exact', head: true })
    .eq('statut', 'en_attente')
  if (error) throw new Error(error.message)
  return count ?? 0
}

/* Authentification ------------------------------------------------------- */

export async function currentSession(): Promise<Session | null> {
  const { data } = await tournamentClient().auth.getSession()
  return data.session
}

export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await tournamentClient().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: authRedirectUrl(
        window.location.origin,
        window.location.pathname,
      ),
    },
  })
  if (error) throw new Error(error.message)
}

export async function signOut(): Promise<void> {
  await tournamentClient().auth.signOut()
}

/* Fonctions edge --------------------------------------------------------- */

/**
 * Contrat des fonctions edge (`supabase/functions/`) : corps JSON, réponse JSON
 * portant toujours `ok` et `message`, et `field` sur un refus pour désigner le
 * champ en cause. Un refus n'est pas une panne : il se rend au formulaire, sous
 * le bon champ, et non dans un message général.
 */
export type EdgeReply = {
  ok: boolean
  message?: string
  field?: string
  [key: string]: unknown
}

async function callFunction(name: string, body: unknown): Promise<EdgeReply> {
  if (!tournamentConfig) throw new Error('Plateforme de tournoi non configurée.')
  const session = await currentSession()
  const response = await fetch(`${tournamentConfig.url}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: tournamentConfig.anonKey,
      authorization: `Bearer ${session?.access_token ?? tournamentConfig.anonKey}`,
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => null)) as EdgeReply | null
  if (payload && typeof payload.ok === 'boolean') return payload
  return {
    ok: false,
    message: `Le service a répondu ${response.status} sans message lisible.`,
  }
}

export type RegisterReply = EdgeReply & {
  secret?: string
  warning?: string
  bot?: { id?: string; nom?: string }
}

export function registerBot(name: string, url: string): Promise<RegisterReply> {
  return callFunction('register-bot', { name, url })
}

export type ProbeReply = EdgeReply & {
  result?: string
  latency_ms?: number
  move?: string
  /** L'appel tel qu'il est parti, et ce qui est revenu : de quoi déboguer. */
  url?: string
  headers?: Record<string, string> | null
  request?: string
  status?: number | null
  snippet?: string
  detail?: string | null
}

/**
 * Sonde d'une IA de l'appelant. On désigne l'**IA**, pas son adresse : la
 * plateforme lit l'adresse et le secret en base, et signe l'appel comme
 * l'arbitre le fera. Une sonde qui recevait une simple adresse ne pouvait que
 * signer avec un jeton d'essai, que toute IA conforme rejette.
 */
export function probeBot(botId: string): Promise<ProbeReply> {
  return callFunction('probe-bot', { bot: botId })
}

/**
 * Retrait et réactivation. `statut` est une colonne réservée au service — un
 * déclencheur refuse toute écriture cliente (migration
 * `plateforme_tournoi_colonnes_reservees`) —, l'action passe donc par
 * `supabase/functions/update-bot`, qui seule arbitre les transitions permises :
 * une IA se retire tant qu'elle vit, se réactive depuis le sommeil, et ne
 * revient pas d'un retrait.
 */
export function setBotStatus(
  botId: string,
  status: 'retiree' | 'en_attente',
): Promise<EdgeReply> {
  return callFunction('update-bot', { bot: botId, status })
}

/**
 * Déclenchement à la main d'un réveil de cron, réservé aux administrateurs.
 *
 * Les deux fonctions rendent **le compte rendu du cron**, tel quel : c'est ce
 * que l'administrateur vient chercher. `force` ouvre la fenêtre du jeudi hors
 * du jeudi, et n'est honoré que d'un administrateur ; sans lui, le
 * déclenchement se comporte exactement comme un réveil ordinaire.
 */
export type CronFunction = 'scheduler' | 'referee-tick'

export function runCron(name: CronFunction, force: boolean): Promise<EdgeReply> {
  return callFunction(name, { force })
}
