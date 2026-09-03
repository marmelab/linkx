/**
 * Contrôle de l'adresse d'une IA avant tout appel : la plateforme ne doit pas
 * devenir un relais vers son propre réseau interne (histoire 14).
 *
 * Le module reste pur. La résolution DNS, qui seule peut démasquer un nom
 * public pointant sur une adresse privée, est **injectée** par l'appelant :
 * l'edge runtime n'expose pas forcément `Deno.resolveDns`.
 */

export type MotifAdresse =
  | 'syntaxe'
  | 'protocole'
  | 'identifiants'
  | 'port'
  | 'adresse-ip'
  | 'reseau-prive'
  | 'hote-interne'
  | 'metadonnees'
  | 'resolution'

export type VerdictAdresse =
  | { ok: true; adresse: string; hote: string }
  | { ok: false; motif: MotifAdresse; message: string }

export type ResolveurDns = (hote: string) => Promise<readonly string[]>

export const MESSAGES_ADRESSE: Record<MotifAdresse, string> = {
  syntaxe: 'Cette adresse n’est pas une URL valide.',
  protocole: 'L’adresse doit être en https.',
  identifiants: 'L’adresse ne doit pas contenir d’identifiants de connexion.',
  port: 'L’adresse doit utiliser le port https par défaut.',
  'adresse-ip': 'L’adresse doit désigner un nom de domaine, pas une adresse IP.',
  'reseau-prive': 'Cette adresse désigne un réseau privé.',
  'hote-interne': 'Cette adresse désigne une machine interne.',
  metadonnees:
    'Cette adresse désigne le service de métadonnées de l’hébergeur.',
  resolution: 'Cette adresse ne se résout en aucune machine joignable.',
}

/** Suffixes réservés aux réseaux locaux : jamais joignables depuis l'extérieur. */
const SUFFIXES_INTERNES = [
  '.local',
  '.localhost',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
]

const ADRESSE_METADONNEES = '169.254.169.254'

export type ClasseIp = 'publique' | 'privee' | 'metadonnees'

function refus(motif: MotifAdresse): VerdictAdresse {
  return { ok: false, motif, message: MESSAGES_ADRESSE[motif] }
}

function lireIpv4(texte: string): [number, number, number, number] | null {
  const parts = texte.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const valeur = Number(part)
    if (valeur > 255) return null
    octets.push(valeur)
  }
  return [octets[0], octets[1], octets[2], octets[3]]
}

function classerIpv4(octets: [number, number, number, number]): ClasseIp {
  const [a, b, c] = octets
  if (texteIpv4(octets) === ADRESSE_METADONNEES) return 'metadonnees'
  const prive =
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  return prive ? 'privee' : 'publique'
}

function texteIpv4(octets: readonly number[]): string {
  return octets.join('.')
}

/** Développe un `::` et rend les huit groupes de seize bits, ou `null`. */
function lireIpv6(texte: string): number[] | null {
  const nu = texte.startsWith('[') && texte.endsWith(']')
    ? texte.slice(1, -1)
    : texte
  if (!nu.includes(':')) return null

  const moities = nu.split('::')
  if (moities.length > 2) return null

  const lire = (morceau: string): number[] | null => {
    if (morceau === '') return []
    const groupes: number[] = []
    const jetons = morceau.split(':')
    for (let i = 0; i < jetons.length; i += 1) {
      const jeton = jetons[i]
      if (i === jetons.length - 1 && jeton.includes('.')) {
        const octets = lireIpv4(jeton)
        if (!octets) return null
        groupes.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(jeton)) return null
      groupes.push(Number.parseInt(jeton, 16))
    }
    return groupes
  }

  const gauche = lire(moities[0])
  const droite = moities.length === 2 ? lire(moities[1]) : []
  if (!gauche || !droite) return null

  if (moities.length === 1) return gauche.length === 8 ? gauche : null
  const combles = 8 - gauche.length - droite.length
  if (combles < 1) return null
  return [...gauche, ...new Array<number>(combles).fill(0), ...droite]
}

function classerIpv6(groupes: readonly number[]): ClasseIp {
  const mappee =
    groupes.slice(0, 5).every((groupe) => groupe === 0) && groupes[5] === 0xffff
  if (mappee) {
    return classerIpv4([
      groupes[6] >> 8,
      groupes[6] & 0xff,
      groupes[7] >> 8,
      groupes[7] & 0xff,
    ])
  }
  const nulle = groupes.every((groupe) => groupe === 0)
  const bouclage =
    groupes.slice(0, 7).every((groupe) => groupe === 0) && groupes[7] === 1
  const unique = (groupes[0] & 0xfe00) === 0xfc00
  const lienLocal = (groupes[0] & 0xffc0) === 0xfe80
  const multicast = (groupes[0] & 0xff00) === 0xff00
  return nulle || bouclage || unique || lienLocal || multicast
    ? 'privee'
    : 'publique'
}

/** Classe une adresse IP littérale, ou rend `null` si le texte n'en est pas une. */
export function classerAdresseIp(texte: string): ClasseIp | null {
  const octets = lireIpv4(texte)
  if (octets) return classerIpv4(octets)
  const groupes = lireIpv6(texte)
  if (groupes) return classerIpv6(groupes)
  return null
}

function refusPourIp(classe: ClasseIp): VerdictAdresse {
  if (classe === 'metadonnees') return refus('metadonnees')
  if (classe === 'privee') return refus('reseau-prive')
  return refus('adresse-ip')
}

/**
 * Vérifie l'écriture de l'adresse. Le port doit rester celui de https par
 * défaut : un port explicite est le déguisement le plus simple d'un service
 * interne exposé sur la même machine qu'un service public.
 */
export function verifierAdresseIa(brut: string): VerdictAdresse {
  const texte = brut.trim()
  if (texte === '') return refus('syntaxe')

  let url: URL
  try {
    url = new URL(texte)
  } catch {
    return refus('syntaxe')
  }

  if (url.protocol !== 'https:') return refus('protocole')
  if (url.username !== '' || url.password !== '') return refus('identifiants')
  if (url.port !== '') return refus('port')

  const hote = url.hostname.replace(/\.$/, '').toLowerCase()
  if (hote === '') return refus('syntaxe')

  const classe = classerAdresseIp(hote)
  if (classe) return refusPourIp(classe)

  if (hote === 'localhost') return refus('hote-interne')
  if (SUFFIXES_INTERNES.some((suffixe) => hote.endsWith(suffixe))) {
    return refus('hote-interne')
  }
  // Un nom sans point ne peut désigner qu'une machine du réseau de la plateforme.
  if (!hote.includes('.')) return refus('hote-interne')

  return { ok: true, adresse: url.toString(), hote }
}

/**
 * Même contrôle, prolongé par la résolution DNS : un nom public qui pointe sur
 * une adresse privée est refusé au même titre qu'une IP privée littérale.
 */
export async function verifierAdresseIaAvecDns(
  brut: string,
  resoudre: ResolveurDns,
): Promise<VerdictAdresse> {
  const verdict = verifierAdresseIa(brut)
  if (!verdict.ok) return verdict

  let adresses: readonly string[]
  try {
    adresses = await resoudre(verdict.hote)
  } catch {
    return refus('resolution')
  }
  if (adresses.length === 0) return refus('resolution')

  for (const adresse of adresses) {
    const classe = classerAdresseIp(adresse.trim())
    if (classe === null) return refus('resolution')
    if (classe !== 'publique') return refusPourIp(classe)
  }
  return verdict
}
