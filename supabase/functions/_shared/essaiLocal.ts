/**
 * Points d'entrée d'essai — pour la passe d'intégration locale, et pour elle
 * seule.
 *
 * Une vague ne s'ouvre que le jeudi de 0 h à 12 h (`waveWindow.ts`) et une IA ne
 * peut être appelée qu'en `https`, sur un nom d'hôte public (`safeUrl.ts`). Ces
 * deux règles sont justes, et **rien ici ne les affaiblit** : elles rendent
 * simplement l'ensemble inéprouvable en local, où il n'y a ni jeudi à commande
 * ni nom public. Ce module ouvre donc deux entrées, chacune :
 *
 *   * **fermée par défaut** — sans la variable d'environnement, aucune des deux
 *     fonctions ci-dessous ne fait quoi que ce soit, et le code appelant reprend
 *     exactement le comportement de production ;
 *   * **réservée à la plateforme** — l'horloge n'est lue que par `scheduler` et
 *     `referee-tick`, qui exigent déjà la clé de service ;
 *   * **bornée** — l'entrée d'adresse n'est pas un contournement du contrôle,
 *     mais une **liste blanche nominative** : seuls les hôtes explicitement
 *     nommés dans la variable sont dérivés, et vers la seule cible qui y est
 *     écrite. Une adresse absente de la liste subit le contrôle entier.
 *
 * Les deux variables ne sont jamais posées sur un projet distant. En local,
 * elles se passent à `supabase functions serve --env-file`.
 */

/** « 1 » autorise `scheduler` et `referee-tick` à lire l'instant de la requête. */
export const CLOCK_ENV = 'TOURNOI_ESSAI_HORLOGE'

/**
 * Objet JSON `{ "hôte déclaré": "adresse réellement appelée" }`. L'adresse
 * stockée et contrôlée reste celle que son auteur a déclarée ; seule la cible
 * de l'appel sortant change.
 */
export const ADDRESS_ENV = 'TOURNOI_ESSAI_ADRESSES'

/** `Deno.env` peut lever faute de permission : l'absence vaut « fermé ». */
function readEnv(name: string): string {
  try {
    return Deno.env.get(name) ?? ''
  } catch {
    return ''
  }
}

let addressBook: ReadonlyMap<string, string> | null = null

function essaiAddresses(): ReadonlyMap<string, string> {
  if (addressBook) return addressBook
  const raw = readEnv(ADDRESS_ENV).trim()
  const entries = new Map<string, string>()
  if (raw !== '') {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      for (const [host, target] of Object.entries(parsed)) {
        if (typeof target === 'string' && target !== '') {
          entries.set(host.toLowerCase(), target)
        }
      }
      console.warn(
        `${ADDRESS_ENV} posée : ${entries.size} adresse(s) d’essai dérivée(s) vers un service local.`,
      )
    } catch {
      console.error(`${ADDRESS_ENV} illisible : aucune adresse d’essai retenue.`)
    }
  }
  addressBook = entries
  return entries
}

/**
 * Cible réelle d'un hôte d'essai, ou `null` — c'est-à-dire, hors essai, toujours
 * `null`. L'appelant garde alors l'adresse déclarée.
 */
export function essaiTarget(host: string): string | null {
  return essaiAddresses().get(host.toLowerCase()) ?? null
}

/**
 * Instant que la requête impose, ou `null`. Réservé aux deux fonctions
 * d'ordonnancement, qui ont déjà exigé la clé de service : c'est la plateforme
 * qui se donne un jeudi, personne d'autre.
 */
export function essaiInstant(body: unknown): Date | null {
  if (readEnv(CLOCK_ENV) !== '1') return null
  const asked = (body as { maintenant?: unknown } | null)?.maintenant
  if (typeof asked !== 'string') return null
  const instant = new Date(asked)
  if (Number.isNaN(instant.getTime())) return null
  console.warn(`${CLOCK_ENV} posée : horloge d’essai au ${instant.toISOString()}.`)
  return instant
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
