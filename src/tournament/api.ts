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

/**
 * Les IA d'un auteur, **filtrées sur lui**.
 *
 * La politique de `bots` ne borne pas cet écran : elle ouvre la table entière à
 * un administrateur (`ou est_administrateur()`), si bien que « Mes IA » lui
 * montrait celles de tout le monde — avec leurs adresses, et des boutons
 * « Retirer » que `update-bot` aurait de toute façon refusés. « Mes parties »
 * suivait, ses identifiants venant d'ici.
 *
 * Une politique dit ce qu'on a le **droit** de lire, jamais ce qu'un écran
 * **demande**. Le filtre est donc écrit ici, où il énonce l'intention.
 */
export async function fetchMyBots(owner: string): Promise<BotRow[]> {
  return unwrap<BotRow[]>(
    await tournamentClient()
      .from('bots')
      .select(BOT_COLUMNS)
      .eq('proprietaire', owner)
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
 * Les parties de l'auteur, **sans les noms**. La politique de `parties` les
 * borne déjà à ses deux participants : le filtre n'est là que pour aller
 * chercher les anciennes, au-delà des quatre cents dernières.
 *
 * Séparée de `fetchMyGames` parce que nommer l'adversaire coûte une seconde
 * requête : qui ne fait que compter des issues — le bilan de vague de « Mes IA »
 * — n'a pas à la payer.
 */
export async function fetchGameRows(
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

  return unwrap<GameRow[]>(
    (await query
      .order('cree_le', { ascending: false })
      .limit(MY_GAMES_LIMIT)) as unknown as {
      data: GameRow[] | null
      error: { message: string } | null
    },
  )
}

/**
 * Les mêmes, chaque camp nommé. Les noms sont résolus par une seconde requête
 * plutôt que par une jointure : ils viennent d'une vue, qui n'a pas de clé
 * étrangère à emprunter. Un seul chemin, donc, et l'adversaire est nommé aussi
 * bien que la sienne — c'est `games.ts` qui bascule ensuite du point de vue de
 * l'auteur.
 */
export async function fetchMyGames(
  filter: MyGamesFilter = {},
): Promise<GameRow[]> {
  const rows = await fetchGameRows(filter)
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
 * Où en sont les qualifications en attente.
 *
 * Une qualification se joue en deux temps : un réveil l'ouvre, l'arbitrage la
 * joue, et c'est le réveil **suivant** qui la valide. Entre les deux, l'IA reste
 * « en qualification » alors que sa partie est finie — sans le distinguer,
 * l'auteur croit à un blocage et l'administrateur ne sait pas qu'il lui reste un
 * clic.
 *
 * Réservé de fait aux administrateurs : les politiques de `bots` et `parties`
 * n'ouvrent ces tables entières qu'à eux.
 */
export type QualificationState = {
  awaiting: number
  /** Parmi elles, celles dont la partie est terminée et n'attend qu'un réveil. */
  played: number
}

export async function fetchQualificationState(): Promise<QualificationState> {
  const bots = unwrap<Array<{ id: string }>>(
    await tournamentClient().from('bots').select('id').eq('statut', 'en_attente'),
  )
  if (bots.length === 0) return { awaiting: 0, played: 0 }

  const games = unwrap<Array<{ bot_bleu: string }>>(
    await tournamentClient()
      .from('parties')
      .select('bot_bleu')
      .is('vague_id', null)
      .eq('statut', 'terminee')
      .in('bot_bleu', bots.map((bot) => bot.id)),
  )
  return {
    awaiting: bots.length,
    played: new Set(games.map((game) => game.bot_bleu)).size,
  }
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
 * Tout ce qu'un auteur change sur son IA : son état, son adresse, ou les deux.
 *
 * Ni `statut` ni `adresse_service` ne s'écrivent depuis le navigateur —
 * `authenticated` n'a aucun droit d'écriture sur `bots` (migration
 * `plateforme_tournoi_ecriture_reservee_bots`) —, l'action passe donc par
 * `supabase/functions/update-bot`, qui seule arbitre ce qui est permis : une IA
 * se retire tant qu'elle vit, se réactive depuis le sommeil, relance une
 * qualification ratée, et ne revient pas d'un retrait. Une adresse corrigée
 * repasse par le contrôle de la déclaration.
 */
export type BotChange = {
  status?: 'retiree' | 'en_attente'
  url?: string
}

export function updateBot(
  botId: string,
  change: BotChange,
): Promise<EdgeReply> {
  return callFunction('update-bot', { bot: botId, ...change })
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
