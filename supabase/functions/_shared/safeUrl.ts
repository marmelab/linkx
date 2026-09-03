/**
 * Contrôle de l'adresse d'une IA avant tout appel : la plateforme ne doit pas
 * devenir un relais vers son propre réseau interne (histoire 14).
 *
 * Le module reste pur. La résolution DNS, qui seule peut démasquer un nom
 * public pointant sur une adresse privée, est **injectée** par l'appelant :
 * l'edge runtime n'expose pas forcément `Deno.resolveDns`.
 */

export type AddressRefusal =
  | 'syntax'
  | 'protocol'
  | 'credentials'
  | 'port'
  | 'ip-address'
  | 'private-network'
  | 'internal-host'
  | 'metadata'
  | 'resolution'

export type AddressVerdict =
  | { ok: true; address: string; host: string }
  | { ok: false; reason: AddressRefusal; message: string }

export type DnsResolver = (host: string) => Promise<readonly string[]>

export const ADDRESS_MESSAGES: Record<AddressRefusal, string> = {
  syntax: 'Cette adresse n’est pas une URL valide.',
  protocol: 'L’adresse doit être en https.',
  credentials: 'L’adresse ne doit pas contenir d’identifiants de connexion.',
  port: 'L’adresse doit utiliser le port https par défaut.',
  'ip-address': 'L’adresse doit désigner un nom de domaine, pas une adresse IP.',
  'private-network': 'Cette adresse désigne un réseau privé.',
  'internal-host': 'Cette adresse désigne une machine interne.',
  metadata: 'Cette adresse désigne le service de métadonnées de l’hébergeur.',
  resolution: 'Cette adresse ne se résout en aucune machine joignable.',
}

/** Suffixes réservés aux réseaux locaux : jamais joignables depuis l'extérieur. */
const INTERNAL_SUFFIXES = [
  '.local',
  '.localhost',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
]

const METADATA_ADDRESS = '169.254.169.254'

export type IpClass = 'public' | 'private' | 'metadata'

function refuse(reason: AddressRefusal): AddressVerdict {
  return { ok: false, reason, message: ADDRESS_MESSAGES[reason] }
}

function parseIpv4(text: string): [number, number, number, number] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    const value = Number(part)
    if (value > 255) return null
    octets.push(value)
  }
  return [octets[0], octets[1], octets[2], octets[3]]
}

function classifyIpv4(octets: [number, number, number, number]): IpClass {
  const [a, b, c] = octets
  if (formatIpv4(octets) === METADATA_ADDRESS) return 'metadata'
  const isPrivate =
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
  return isPrivate ? 'private' : 'public'
}

function formatIpv4(octets: readonly number[]): string {
  return octets.join('.')
}

/** Développe un `::` et rend les huit groupes de seize bits, ou `null`. */
function parseIpv6(text: string): number[] | null {
  const bare = text.startsWith('[') && text.endsWith(']')
    ? text.slice(1, -1)
    : text
  if (!bare.includes(':')) return null

  const halves = bare.split('::')
  if (halves.length > 2) return null

  const read = (chunk: string): number[] | null => {
    if (chunk === '') return []
    const groups: number[] = []
    const tokens = chunk.split(':')
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]
      if (i === tokens.length - 1 && token.includes('.')) {
        const octets = parseIpv4(token)
        if (!octets) return null
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3])
        continue
      }
      if (!/^[0-9a-f]{1,4}$/i.test(token)) return null
      groups.push(Number.parseInt(token, 16))
    }
    return groups
  }

  const left = read(halves[0])
  const right = halves.length === 2 ? read(halves[1]) : []
  if (!left || !right) return null

  if (halves.length === 1) return left.length === 8 ? left : null
  const filler = 8 - left.length - right.length
  if (filler < 1) return null
  return [...left, ...new Array<number>(filler).fill(0), ...right]
}

function classifyIpv6(groups: readonly number[]): IpClass {
  const mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  if (mapped) {
    return classifyIpv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ])
  }
  const unspecified = groups.every((group) => group === 0)
  const loopback =
    groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1
  const uniqueLocal = (groups[0] & 0xfe00) === 0xfc00
  const linkLocal = (groups[0] & 0xffc0) === 0xfe80
  const multicast = (groups[0] & 0xff00) === 0xff00
  return unspecified || loopback || uniqueLocal || linkLocal || multicast
    ? 'private'
    : 'public'
}

/** Classe une adresse IP littérale, ou rend `null` si le texte n'en est pas une. */
export function classifyIpAddress(text: string): IpClass | null {
  const octets = parseIpv4(text)
  if (octets) return classifyIpv4(octets)
  const groups = parseIpv6(text)
  if (groups) return classifyIpv6(groups)
  return null
}

function refuseForIp(ipClass: IpClass): AddressVerdict {
  if (ipClass === 'metadata') return refuse('metadata')
  if (ipClass === 'private') return refuse('private-network')
  return refuse('ip-address')
}

/**
 * Vérifie l'écriture de l'adresse. Le port doit rester celui de https par
 * défaut : un port explicite est le déguisement le plus simple d'un service
 * interne exposé sur la même machine qu'un service public.
 */
export function checkBotAddress(raw: string): AddressVerdict {
  const text = raw.trim()
  if (text === '') return refuse('syntax')

  let url: URL
  try {
    url = new URL(text)
  } catch {
    return refuse('syntax')
  }

  if (url.protocol !== 'https:') return refuse('protocol')
  if (url.username !== '' || url.password !== '') return refuse('credentials')
  if (url.port !== '') return refuse('port')

  const host = url.hostname.replace(/\.$/, '').toLowerCase()
  if (host === '') return refuse('syntax')

  const ipClass = classifyIpAddress(host)
  if (ipClass) return refuseForIp(ipClass)

  if (host === 'localhost') return refuse('internal-host')
  if (INTERNAL_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return refuse('internal-host')
  }
  // Un nom sans point ne peut désigner qu'une machine du réseau de la plateforme.
  if (!host.includes('.')) return refuse('internal-host')

  return { ok: true, address: url.toString(), host }
}

/**
 * Même contrôle, prolongé par la résolution DNS : un nom public qui pointe sur
 * une adresse privée est refusé au même titre qu'une IP privée littérale.
 */
export async function checkBotAddressWithDns(
  raw: string,
  resolve: DnsResolver,
): Promise<AddressVerdict> {
  const verdict = checkBotAddress(raw)
  if (!verdict.ok) return verdict

  let addresses: readonly string[]
  try {
    addresses = await resolve(verdict.host)
  } catch {
    return refuse('resolution')
  }
  if (addresses.length === 0) return refuse('resolution')

  for (const address of addresses) {
    const ipClass = classifyIpAddress(address.trim())
    if (ipClass === null) return refuse('resolution')
    if (ipClass !== 'public') return refuseForIp(ipClass)
  }
  return verdict
}
