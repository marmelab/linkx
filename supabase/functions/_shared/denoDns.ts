/**
 * Côté runtime du contrôle d'adresse : le résolveur DNS que `safeUrl.ts`
 * attend en paramètre (histoire 14).
 *
 * `safeUrl.ts` reste pur pour être testable sous le Vitest du dépôt ; tout ce
 * qui touche à `Deno` vit donc ici, et les fonctions edge n'ont plus qu'à
 * appeler `checkBotAddressResolved`. Le résolveur reste **injectable** pour que
 * ce module se teste lui aussi sans réseau.
 *
 * **Échec fermé.** Sans résolveur, ou si la résolution lève, l'adresse est
 * refusée. C'est le contraire de ce que ce module faisait : il retombait alors
 * sur le seul contrôle d'écriture, c'est-à-dire sur rien du tout pour qui tient
 * son propre DNS — un nom public bien écrit passait sans qu'on sache jamais
 * vers quelle machine il pointe. **Aucune exception** : il n'existe plus de
 * liste d'hôtes dispensés de résolution, et le refus des réseaux privés vaut
 * pour toute adresse, sans variable d'environnement pour l'entrouvrir.
 *
 * **Limite connue : la résolution n'est pas épinglée.** L'adresse retenue ici
 * n'est pas celle qu'emploiera `botClient.ts` : `fetch` résout à nouveau, et un
 * DNS à durée de vie nulle peut rendre une adresse publique à ce contrôle-ci et
 * une adresse interne à l'appel. Épingler demanderait d'appeler l'IP retenue en
 * forçant l'en-tête `Host` et le nom de serveur TLS ; l'edge runtime n'expose ni
 * `Deno.createHttpClient` ni le `serverName` de `Deno.connectTls`, et `Host` est
 * un en-tête interdit à `fetch`. Il faudrait donc réécrire un client HTTPS à la
 * main, ce qui coûterait plus de sûreté qu'il n'en rendrait. Ce qui borne la
 * fenêtre, à défaut :
 *
 *   * l'adresse est **recontrôlée à chaque appel** (`referee-tick`), et non à la
 *     seule déclaration ;
 *   * `botClient.ts` refuse les redirections, qui seraient le chemin facile ;
 *   * ce que le service répond ne sort plus vers l'adversaire : `erreur` et
 *     `reponse_brute` du journal sont réservées au propriétaire de l'IA appelée
 *     (migration `plateforme_tournoi_journal_prive`).
 */
import {
  ADDRESS_MESSAGES,
  checkBotAddress,
  checkBotAddressWithDns,
} from './safeUrl.ts'
import type { AddressVerdict, DnsResolver } from './safeUrl.ts'

/**
 * Résolution DNS du runtime. Un nom introuvable rend une liste vide, que
 * `checkBotAddressWithDns` refuse ; une résolution *impossible* — permission
 * refusée, fonction absente, délai dépassé — lève, et l'adresse est refusée à
 * son tour.
 *
 * **Les deux familles doivent répondre, ou aucune.** Un `AAAA` en échec pendant
 * qu'un `A` répond ne se rattrape pas par le second : les enregistrements IPv6
 * n'auraient alors jamais été inspectés, et `fetch` préfère justement IPv6. Un
 * hôte dont l'A pointe sur une machine publique et l'AAAA sur `fd00::1` passait
 * ainsi le contrôle pour se faire appeler sur le réseau interne. Une famille
 * absente (`NotFound`) n'est pas un échec : c'est une réponse, et elle dit qu'il
 * n'y a rien de ce côté-là.
 */
export async function resolveWithDeno(host: string): Promise<readonly string[]> {
  const addresses: string[] = []
  for (const kind of ['A', 'AAAA'] as const) {
    try {
      addresses.push(...(await Deno.resolveDns(host, kind)))
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) continue
      throw new Error(`résolution ${kind} indisponible pour ${host}`)
    }
  }
  return addresses
}

/** Le résolveur du runtime, ou `null` quand l'edge runtime ne l'expose pas. */
export function denoDnsResolver(): DnsResolver | null {
  if (typeof Deno === 'undefined') return null
  return typeof Deno.resolveDns === 'function' ? resolveWithDeno : null
}

const UNAVAILABLE: AddressVerdict = {
  ok: false,
  reason: 'resolution-unavailable',
  message: ADDRESS_MESSAGES['resolution-unavailable'],
}

/**
 * Contrôle complet d'une adresse d'IA : l'écriture, puis la résolution. Sans
 * résolveur, l'adresse est refusée — la plateforme n'appelle pas une machine
 * dont elle ne sait rien.
 */
export async function checkBotAddressResolved(
  raw: string,
  resolve: DnsResolver | null = denoDnsResolver(),
): Promise<AddressVerdict> {
  const verdict = checkBotAddress(raw)
  if (!verdict.ok) return verdict
  if (!resolve) return UNAVAILABLE
  return await checkBotAddressWithDns(raw, resolve)
}
