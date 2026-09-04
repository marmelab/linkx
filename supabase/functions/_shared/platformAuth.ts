/**
 * Qui a le droit d'appeler les fonctions réservées à la plateforme —
 * `scheduler`, `referee-tick` et `wave-mail` — et qui est l'appelant quand une
 * fonction a besoin de le savoir.
 *
 * Deux chemins, et deux seulement.
 *
 * **La clé de service**, que présente `pg_cron`. `verify_jwt` ne vérifie qu'une
 * signature, et le jeton d'un simple visiteur en porte une : c'est bien la clé
 * de service qu'il faut exiger, pas un jeton valide. Et une clé se compare à
 * durée constante — une comparaison qui s'arrête au premier caractère différent
 * laisse la deviner octet par octet.
 *
 * **Une session d'administrateur**, pour qu'un réveil de cron se déclenche aussi
 * à la main. L'identité vient de `/auth/v1/user` et de nulle part ailleurs : le
 * jeton n'est jamais décodé ici, et aucun identifiant du corps de la requête
 * n'est cru. L'appartenance à `administrateurs` se lit ensuite avec la clé de
 * service, la table n'étant lisible que de ses propres membres.
 *
 * **Un authentifié qui n'est pas administrateur est refusé comme un inconnu.**
 * Le message ne distingue pas les deux cas : il n'y a rien à apprendre d'un
 * refus, pas même l'existence de cette table.
 */
import { createRest } from './rest.ts'
import type { FetchLike } from './rest.ts'

/**
 * Comparaison sans fuite de temps : on parcourt toujours la totalité des
 * caractères. Une longueur différente suffit à refuser — la longueur d'une clé
 * n'est pas un secret —, et une clé attendue vide refuse toujours, pour qu'une
 * variable d'environnement absente n'ouvre rien.
 */
export function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length || expected.length === 0) return false
  let difference = 0
  for (let index = 0; index < given.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

/** L'appel présente-t-il la clé de service en jeton porteur ? */
export function fromPlatform(request: Request, serviceKey: string): boolean {
  const bearer = (request.headers.get('authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
  return sameSecret(bearer, serviceKey)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Identité de l'appelant, telle que le service d'authentification la confirme.
 * Le jeton n'est jamais décodé ici : seul `/auth/v1/user` sait s'il est signé,
 * non révoqué et non expiré. Source unique — `register-bot`, `update-bot` et
 * les deux fonctions d'ordonnancement en dépendent toutes.
 */
export async function currentUserId(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
  call: FetchLike = fetch,
): Promise<string | null> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null

  const response = await call(`${supabaseUrl}/auth/v1/user`, {
    headers: { authorization, apikey: anonKey },
  })
  if (!response.ok) return null
  const user = (await response.json()) as { id?: unknown }
  return typeof user.id === 'string' ? user.id : null
}

/** Corps JSON d'une requête, ou `null` : un corps absent ou illisible n'est pas une erreur. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    const text = await request.text()
    return text === '' ? null : JSON.parse(text)
  } catch {
    return null
  }
}

export type PlatformCaller =
  | { kind: 'service' }
  | { kind: 'admin'; userId: string }

export type PlatformCallOptions = {
  supabaseUrl: string
  anonKey: string
  serviceKey: string
  fetch?: FetchLike
}

/**
 * Appartenance à `administrateurs`, lue avec la clé de service — la politique de
 * la table ne rend une ligne qu'à ses propres membres, et l'appelant n'a ici pas
 * encore de droits. Une lecture impossible refuse : échec fermé.
 */
async function isAdministrator(
  userId: string,
  options: PlatformCallOptions,
): Promise<boolean> {
  if (!UUID.test(userId)) return false
  const rest = createRest({
    url: options.supabaseUrl,
    serviceKey: options.serviceKey,
    fetch: options.fetch,
  })
  try {
    const rows = await rest.select<{ utilisateur_id: string }>(
      `administrateurs?select=utilisateur_id&utilisateur_id=eq.${userId}&limit=1`,
    )
    return rows.length > 0
  } catch (error) {
    console.error('administrateurs illisible', error)
    return false
  }
}

/**
 * L'appelant, ou `null` s'il n'a rien à faire ici. La clé de service est testée
 * la première : c'est le cas du cron, et il ne coûte alors aucun appel réseau.
 */
export async function authorizePlatformCall(
  request: Request,
  options: PlatformCallOptions,
): Promise<PlatformCaller | null> {
  if (fromPlatform(request, options.serviceKey)) return { kind: 'service' }

  const userId = await currentUserId(
    request,
    options.supabaseUrl,
    options.anonKey,
    options.fetch,
  )
  if (!userId) return null
  if (!(await isAdministrator(userId, options))) return null
  return { kind: 'admin', userId }
}

/**
 * `force` demandé dans le corps, et **réservé aux administrateurs** : la clé de
 * service seule ne l'obtient pas. Un cron qui sortirait de la fenêtre du jeudi
 * ne serait plus un cron hebdomadaire, et cette option n'a de sens que tenue par
 * quelqu'un qui répond de son emploi.
 */
export function forceAsked(body: unknown, caller: PlatformCaller): boolean {
  if (caller.kind !== 'admin') return false
  return (body as { force?: unknown } | null)?.force === true
}
