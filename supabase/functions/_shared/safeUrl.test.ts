import { describe, expect, it } from 'vitest'
import {
  ADDRESS_MESSAGES,
  checkBotAddress,
  checkBotAddressWithDns,
  classifyIpAddress,
} from './safeUrl.ts'
import type { AddressRefusal } from './safeUrl.ts'

function reason(raw: string): AddressRefusal | 'accepte' {
  const verdict = checkBotAddress(raw)
  return verdict.ok ? 'accepte' : verdict.reason
}

describe('adresses acceptées', () => {
  it('accepte un nom de domaine public en https', () => {
    const verdict = checkBotAddress('https://mon-ia.exemple.fr/coup')
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.host).toBe('mon-ia.exemple.fr')
      expect(verdict.address).toBe('https://mon-ia.exemple.fr/coup')
    }
  })

  it('ignore les espaces autour et normalise la casse de l’hôte', () => {
    const verdict = checkBotAddress('  HTTPS://IA.EXEMPLE.FR/JOUE  ')
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.host).toBe('ia.exemple.fr')
  })

  it('accepte le port 443 écrit explicitement, que l’URL normalise', () => {
    expect(reason('https://ia.exemple.fr:443/')).toBe('accepte')
  })

  it('accepte un point final de nom pleinement qualifié', () => {
    const verdict = checkBotAddress('https://ia.exemple.fr./')
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.host).toBe('ia.exemple.fr')
  })
})

describe('adresses refusées', () => {
  it('refuse ce qui n’est pas une URL', () => {
    expect(reason('')).toBe('syntax')
    expect(reason('   ')).toBe('syntax')
    expect(reason('ia.exemple.fr')).toBe('syntax')
    expect(reason('https://1.1.1.1.1/')).toBe('syntax')
  })

  it('refuse tout protocole autre que https, casse comprise', () => {
    expect(reason('http://ia.exemple.fr/')).toBe('protocol')
    expect(reason('HTTP://IA.EXEMPLE.FR/')).toBe('protocol')
    expect(reason('ftp://ia.exemple.fr/')).toBe('protocol')
    expect(reason('file:///etc/passwd')).toBe('protocol')
    expect(reason('javascript:alert(1)')).toBe('protocol')
  })

  it('refuse les identifiants glissés dans l’adresse', () => {
    expect(reason('https://utilisateur@ia.exemple.fr/')).toBe('credentials')
    expect(reason('https://utilisateur:secret@ia.exemple.fr/')).toBe(
      'credentials',
    )
  })

  it('refuse un port inhabituel', () => {
    expect(reason('https://ia.exemple.fr:8443/')).toBe('port')
    expect(reason('https://ia.exemple.fr:22/')).toBe('port')
  })

  it('refuse une adresse IP publique littérale', () => {
    expect(reason('https://93.184.216.34/')).toBe('ip-address')
    expect(reason('https://[2001:db8::1]/')).toBe('ip-address')
  })

  it('refuse le bouclage et les plages privées en écriture pointée', () => {
    expect(reason('https://127.0.0.1/')).toBe('private-network')
    expect(reason('https://10.0.0.7/')).toBe('private-network')
    expect(reason('https://172.16.3.4/')).toBe('private-network')
    expect(reason('https://172.31.255.255/')).toBe('private-network')
    expect(reason('https://192.168.1.1/')).toBe('private-network')
    expect(reason('https://100.64.0.1/')).toBe('private-network')
    expect(reason('https://0.0.0.0/')).toBe('private-network')
  })

  it('refuse les mêmes plages écrites en décimal ou en hexadécimal', () => {
    expect(reason('https://2130706433/')).toBe('private-network')
    expect(reason('https://0x7f000001/')).toBe('private-network')
    expect(reason('https://0177.0.0.1/')).toBe('private-network')
    expect(reason('https://010.0.0.1/')).toBe('ip-address')
  })

  it('refuse le bouclage et les plages privées en IPv6', () => {
    expect(reason('https://[::1]/')).toBe('private-network')
    expect(reason('https://[::]/')).toBe('private-network')
    expect(reason('https://[fd00::1]/')).toBe('private-network')
    expect(reason('https://[fe80::1]/')).toBe('private-network')
  })

  it('refuse une IPv4 privée encapsulée en IPv6', () => {
    expect(reason('https://[::ffff:127.0.0.1]/')).toBe('private-network')
    expect(reason('https://[::ffff:192.168.0.1]/')).toBe('private-network')
  })

  it('refuse l’adresse de métadonnées de l’hébergeur, sous son propre motif', () => {
    expect(reason('https://169.254.169.254/latest/meta-data/')).toBe('metadata')
    expect(reason('https://[::ffff:169.254.169.254]/')).toBe('metadata')
    expect(reason('https://2852039166/')).toBe('metadata')
  })

  it('refuse localhost, les suffixes internes et les noms sans point', () => {
    expect(reason('https://localhost/')).toBe('internal-host')
    expect(reason('https://api.localhost/')).toBe('internal-host')
    expect(reason('https://base.internal/')).toBe('internal-host')
    expect(reason('https://imprimante.local/')).toBe('internal-host')
    expect(reason('https://routeur.home.arpa/')).toBe('internal-host')
    expect(reason('https://supabase/')).toBe('internal-host')
  })

  it('rend un message en français, propre au motif', () => {
    const verdict = checkBotAddress('http://ia.exemple.fr/')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toBe(ADDRESS_MESSAGES.protocol)
    expect(new Set(Object.values(ADDRESS_MESSAGES)).size).toBe(
      Object.keys(ADDRESS_MESSAGES).length,
    )
  })
})

describe('classement d’une adresse IP', () => {
  it('distingue publique, privée et métadonnées', () => {
    expect(classifyIpAddress('93.184.216.34')).toBe('public')
    expect(classifyIpAddress('10.1.2.3')).toBe('private')
    expect(classifyIpAddress('169.254.169.254')).toBe('metadata')
    expect(classifyIpAddress('2001:db8::1')).toBe('public')
  })

  it('rend null sur un nom de domaine', () => {
    expect(classifyIpAddress('ia.exemple.fr')).toBeNull()
    expect(classifyIpAddress('256.1.1.1')).toBeNull()
  })
})

describe('résolution DNS injectée', () => {
  const resolver = (table: Record<string, string[]>) => (host: string) =>
    Promise.resolve(table[host] ?? [])

  it('accepte un nom qui se résout en adresse publique', async () => {
    const verdict = await checkBotAddressWithDns(
      'https://ia.exemple.fr/coup',
      resolver({ 'ia.exemple.fr': ['93.184.216.34'] }),
    )
    expect(verdict.ok).toBe(true)
  })

  it('refuse un nom public qui pointe sur une machine interne', async () => {
    const verdict = await checkBotAddressWithDns(
      'https://ia.exemple.fr/coup',
      resolver({ 'ia.exemple.fr': ['93.184.216.34', '10.0.0.5'] }),
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('private-network')
  })

  it('refuse un nom qui ne se résout pas, ou dont la résolution échoue', async () => {
    const empty = await checkBotAddressWithDns(
      'https://ia.exemple.fr/',
      resolver({}),
    )
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.reason).toBe('resolution')

    const failed = await checkBotAddressWithDns('https://ia.exemple.fr/', () =>
      Promise.reject(new Error('NXDOMAIN')),
    )
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.reason).toBe('resolution')
  })

  it('n’appelle pas le résolveur quand l’écriture est déjà refusée', async () => {
    let calls = 0
    const verdict = await checkBotAddressWithDns('http://ia.exemple.fr/', () => {
      calls += 1
      return Promise.resolve([])
    })
    expect(verdict.ok).toBe(false)
    expect(calls).toBe(0)
  })
})
