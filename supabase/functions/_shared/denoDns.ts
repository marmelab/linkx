/**
 * Côté runtime du contrôle d'adresse : le résolveur DNS que `safeUrl.ts`
 * attend en paramètre (histoire 14).
 *
 * `safeUrl.ts` reste pur pour être testable sous le Vitest du dépôt ; tout ce
 * qui touche à `Deno` vit donc ici, et les fonctions edge n'ont plus qu'à
 * appeler `checkBotAddressResolved`. Le résolveur reste **injectable** pour que
 * ce module se teste lui aussi sans réseau.
 */
import { essaiTarget } from './essaiLocal.ts'
import { checkBotAddress, checkBotAddressWithDns } from './safeUrl.ts'
import type { AddressVerdict, DnsResolver } from './safeUrl.ts'

/**
 * Résolution DNS du runtime. Un nom introuvable rend une liste vide, que
 * `checkBotAddressWithDns` refuse ; une résolution *impossible* — permission
 * refusée, fonction absente — lève, et l'appelant s'en tient alors au contrôle
 * d'écriture plutôt que de refuser toutes les adresses.
 */
export async function resolveWithDeno(host: string): Promise<readonly string[]> {
  const addresses: string[] = []
  let unavailable = false
  for (const kind of ['A', 'AAAA'] as const) {
    try {
      addresses.push(...(await Deno.resolveDns(host, kind)))
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) unavailable = true
    }
  }
  if (addresses.length === 0 && unavailable) {
    throw new Error('résolution DNS indisponible')
  }
  return addresses
}

/** Le résolveur du runtime, ou `null` quand l'edge runtime ne l'expose pas. */
export function denoDnsResolver(): DnsResolver | null {
  if (typeof Deno === 'undefined') return null
  return typeof Deno.resolveDns === 'function' ? resolveWithDeno : null
}

/**
 * Contrôle complet d'une adresse d'IA : l'écriture, puis la résolution quand
 * elle est disponible. Sans résolveur, ou si la résolution elle-même échoue, le
 * seul contrôle d'écriture fait foi — refuser toutes les adresses parce que le
 * runtime ne sait pas résoudre serait pire que ne pas résoudre.
 */
export async function checkBotAddressResolved(
  raw: string,
  resolve: DnsResolver | null = denoDnsResolver(),
): Promise<AddressVerdict> {
  const verdict = checkBotAddress(raw)
  if (!verdict.ok || !resolve) return verdict
  // Hôte d'essai de la passe d'intégration locale : il n'existe dans aucun DNS,
  // et l'appel sera dérivé vers un service local (`essaiLocal.ts`). Hors essai,
  // la liste est vide et ce test ne change rien.
  if (essaiTarget(verdict.host)) return verdict
  let addresses: readonly string[]
  try {
    addresses = await resolve(verdict.host)
  } catch {
    return verdict
  }
  return await checkBotAddressWithDns(raw, () => Promise.resolve(addresses))
}
