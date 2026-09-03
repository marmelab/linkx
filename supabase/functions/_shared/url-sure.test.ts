import { describe, expect, it } from 'vitest'
import {
  MESSAGES_ADRESSE,
  classerAdresseIp,
  verifierAdresseIa,
  verifierAdresseIaAvecDns,
} from './url-sure.ts'
import type { MotifAdresse } from './url-sure.ts'

function motif(brut: string): MotifAdresse | 'accepte' {
  const verdict = verifierAdresseIa(brut)
  return verdict.ok ? 'accepte' : verdict.motif
}

describe('adresses acceptées', () => {
  it('accepte un nom de domaine public en https', () => {
    const verdict = verifierAdresseIa('https://mon-ia.exemple.fr/coup')
    expect(verdict.ok).toBe(true)
    if (verdict.ok) {
      expect(verdict.hote).toBe('mon-ia.exemple.fr')
      expect(verdict.adresse).toBe('https://mon-ia.exemple.fr/coup')
    }
  })

  it('ignore les espaces autour et normalise la casse de l’hôte', () => {
    const verdict = verifierAdresseIa('  HTTPS://IA.EXEMPLE.FR/JOUE  ')
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.hote).toBe('ia.exemple.fr')
  })

  it('accepte le port 443 écrit explicitement, que l’URL normalise', () => {
    expect(motif('https://ia.exemple.fr:443/')).toBe('accepte')
  })

  it('accepte un point final de nom pleinement qualifié', () => {
    const verdict = verifierAdresseIa('https://ia.exemple.fr./')
    expect(verdict.ok).toBe(true)
    if (verdict.ok) expect(verdict.hote).toBe('ia.exemple.fr')
  })
})

describe('adresses refusées', () => {
  it('refuse ce qui n’est pas une URL', () => {
    expect(motif('')).toBe('syntaxe')
    expect(motif('   ')).toBe('syntaxe')
    expect(motif('ia.exemple.fr')).toBe('syntaxe')
    expect(motif('https://1.1.1.1.1/')).toBe('syntaxe')
  })

  it('refuse tout protocole autre que https, casse comprise', () => {
    expect(motif('http://ia.exemple.fr/')).toBe('protocole')
    expect(motif('HTTP://IA.EXEMPLE.FR/')).toBe('protocole')
    expect(motif('ftp://ia.exemple.fr/')).toBe('protocole')
    expect(motif('file:///etc/passwd')).toBe('protocole')
    expect(motif('javascript:alert(1)')).toBe('protocole')
  })

  it('refuse les identifiants glissés dans l’adresse', () => {
    expect(motif('https://utilisateur@ia.exemple.fr/')).toBe('identifiants')
    expect(motif('https://utilisateur:secret@ia.exemple.fr/')).toBe('identifiants')
  })

  it('refuse un port inhabituel', () => {
    expect(motif('https://ia.exemple.fr:8443/')).toBe('port')
    expect(motif('https://ia.exemple.fr:22/')).toBe('port')
  })

  it('refuse une adresse IP publique littérale', () => {
    expect(motif('https://93.184.216.34/')).toBe('adresse-ip')
    expect(motif('https://[2001:db8::1]/')).toBe('adresse-ip')
  })

  it('refuse le bouclage et les plages privées en écriture pointée', () => {
    expect(motif('https://127.0.0.1/')).toBe('reseau-prive')
    expect(motif('https://10.0.0.7/')).toBe('reseau-prive')
    expect(motif('https://172.16.3.4/')).toBe('reseau-prive')
    expect(motif('https://172.31.255.255/')).toBe('reseau-prive')
    expect(motif('https://192.168.1.1/')).toBe('reseau-prive')
    expect(motif('https://100.64.0.1/')).toBe('reseau-prive')
    expect(motif('https://0.0.0.0/')).toBe('reseau-prive')
  })

  it('refuse les mêmes plages écrites en décimal ou en hexadécimal', () => {
    expect(motif('https://2130706433/')).toBe('reseau-prive')
    expect(motif('https://0x7f000001/')).toBe('reseau-prive')
    expect(motif('https://0177.0.0.1/')).toBe('reseau-prive')
    expect(motif('https://010.0.0.1/')).toBe('adresse-ip')
  })

  it('refuse le bouclage et les plages privées en IPv6', () => {
    expect(motif('https://[::1]/')).toBe('reseau-prive')
    expect(motif('https://[::]/')).toBe('reseau-prive')
    expect(motif('https://[fd00::1]/')).toBe('reseau-prive')
    expect(motif('https://[fe80::1]/')).toBe('reseau-prive')
  })

  it('refuse une IPv4 privée encapsulée en IPv6', () => {
    expect(motif('https://[::ffff:127.0.0.1]/')).toBe('reseau-prive')
    expect(motif('https://[::ffff:192.168.0.1]/')).toBe('reseau-prive')
  })

  it('refuse l’adresse de métadonnées de l’hébergeur, sous son propre motif', () => {
    expect(motif('https://169.254.169.254/latest/meta-data/')).toBe('metadonnees')
    expect(motif('https://[::ffff:169.254.169.254]/')).toBe('metadonnees')
    expect(motif('https://2852039166/')).toBe('metadonnees')
  })

  it('refuse localhost, les suffixes internes et les noms sans point', () => {
    expect(motif('https://localhost/')).toBe('hote-interne')
    expect(motif('https://api.localhost/')).toBe('hote-interne')
    expect(motif('https://base.internal/')).toBe('hote-interne')
    expect(motif('https://imprimante.local/')).toBe('hote-interne')
    expect(motif('https://routeur.home.arpa/')).toBe('hote-interne')
    expect(motif('https://supabase/')).toBe('hote-interne')
  })

  it('rend un message en français, propre au motif', () => {
    const verdict = verifierAdresseIa('http://ia.exemple.fr/')
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.message).toBe(MESSAGES_ADRESSE.protocole)
    expect(new Set(Object.values(MESSAGES_ADRESSE)).size).toBe(
      Object.keys(MESSAGES_ADRESSE).length,
    )
  })
})

describe('classement d’une adresse IP', () => {
  it('distingue publique, privée et métadonnées', () => {
    expect(classerAdresseIp('93.184.216.34')).toBe('publique')
    expect(classerAdresseIp('10.1.2.3')).toBe('privee')
    expect(classerAdresseIp('169.254.169.254')).toBe('metadonnees')
    expect(classerAdresseIp('2001:db8::1')).toBe('publique')
  })

  it('rend null sur un nom de domaine', () => {
    expect(classerAdresseIp('ia.exemple.fr')).toBeNull()
    expect(classerAdresseIp('256.1.1.1')).toBeNull()
  })
})

describe('résolution DNS injectée', () => {
  const resoudre = (table: Record<string, string[]>) => (hote: string) =>
    Promise.resolve(table[hote] ?? [])

  it('accepte un nom qui se résout en adresse publique', async () => {
    const verdict = await verifierAdresseIaAvecDns(
      'https://ia.exemple.fr/coup',
      resoudre({ 'ia.exemple.fr': ['93.184.216.34'] }),
    )
    expect(verdict.ok).toBe(true)
  })

  it('refuse un nom public qui pointe sur une machine interne', async () => {
    const verdict = await verifierAdresseIaAvecDns(
      'https://ia.exemple.fr/coup',
      resoudre({ 'ia.exemple.fr': ['93.184.216.34', '10.0.0.5'] }),
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.motif).toBe('reseau-prive')
  })

  it('refuse un nom qui ne se résout pas, ou dont la résolution échoue', async () => {
    const vide = await verifierAdresseIaAvecDns(
      'https://ia.exemple.fr/',
      resoudre({}),
    )
    expect(vide.ok).toBe(false)
    if (!vide.ok) expect(vide.motif).toBe('resolution')

    const panne = await verifierAdresseIaAvecDns('https://ia.exemple.fr/', () =>
      Promise.reject(new Error('NXDOMAIN')),
    )
    expect(panne.ok).toBe(false)
    if (!panne.ok) expect(panne.motif).toBe('resolution')
  })

  it('n’appelle pas le résolveur quand l’écriture est déjà refusée', async () => {
    let appels = 0
    const verdict = await verifierAdresseIaAvecDns('http://ia.exemple.fr/', () => {
      appels += 1
      return Promise.resolve([])
    })
    expect(verdict.ok).toBe(false)
    expect(appels).toBe(0)
  })
})
