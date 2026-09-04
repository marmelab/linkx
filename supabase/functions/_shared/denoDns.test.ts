import { describe, expect, it } from 'vitest'
import { checkBotAddressResolved, denoDnsResolver, resolveWithDeno } from './denoDns.ts'
import type { DnsResolver } from './safeUrl.ts'

const resolver =
  (table: Record<string, string[]>): DnsResolver =>
  (host: string) =>
    Promise.resolve(table[host] ?? [])

describe('contrôle d’adresse avec résolution', () => {
  it('accepte un nom qui se résout en adresse publique', async () => {
    const verdict = await checkBotAddressResolved(
      'https://ia.exemple.fr/coup',
      resolver({ 'ia.exemple.fr': ['93.184.216.34'] }),
    )
    expect(verdict.ok).toBe(true)
  })

  it('refuse un nom public résolu vers une plage privée', async () => {
    const verdict = await checkBotAddressResolved(
      'https://ia.exemple.fr/coup',
      resolver({ 'ia.exemple.fr': ['10.0.0.5'] }),
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('private-network')
  })

  it('refuse un nom qui ne se résout en rien', async () => {
    const verdict = await checkBotAddressResolved(
      'https://ia.exemple.fr/coup',
      resolver({}),
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('resolution')
  })

  it('refuse quand la résolution est impossible', async () => {
    const verdict = await checkBotAddressResolved('https://ia.exemple.fr/coup', () =>
      Promise.reject(new Error('résolution DNS indisponible')),
    )
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('resolution-unavailable')
  })

  it('refuse quand le runtime n’expose aucun résolveur', async () => {
    const verdict = await checkBotAddressResolved('https://ia.exemple.fr/coup', null)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('resolution-unavailable')
  })

  it('refuse l’écriture avant même de résoudre', async () => {
    let calls = 0
    const verdict = await checkBotAddressResolved('http://ia.exemple.fr/', () => {
      calls += 1
      return Promise.resolve([])
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('protocol')
    expect(calls).toBe(0)
  })
})

describe('résolveur du runtime', () => {
  it('rend null hors de Deno', () => {
    expect(denoDnsResolver()).toBeNull()
  })
})

/**
 * `resolveWithDeno` s'éprouve en posant un faux `Deno` global : c'est la seule
 * façon de vérifier ce que le module fait des deux familles d'enregistrements
 * sans dépendre d'un vrai DNS.
 */
describe('résolution des deux familles', () => {
  class NotFound extends Error {}

  function withFakeDeno(
    answers: Partial<Record<'A' | 'AAAA', string[] | Error>>,
  ): () => void {
    const previous = (globalThis as Record<string, unknown>).Deno
    ;(globalThis as Record<string, unknown>).Deno = {
      errors: { NotFound },
      resolveDns: (_host: string, kind: 'A' | 'AAAA') => {
        const answer = answers[kind]
        if (answer instanceof Error) return Promise.reject(answer)
        return Promise.resolve(answer ?? [])
      },
    }
    return () => {
      ;(globalThis as Record<string, unknown>).Deno = previous
    }
  }

  it('réunit les deux familles', async () => {
    const restore = withFakeDeno({ A: ['93.184.216.34'], AAAA: ['2606:2800::1'] })
    try {
      expect(await resolveWithDeno('ia.exemple.fr')).toEqual([
        '93.184.216.34',
        '2606:2800::1',
      ])
    } finally {
      restore()
    }
  })

  it('accepte une famille absente : c’est une réponse, pas une panne', async () => {
    const restore = withFakeDeno({
      A: ['93.184.216.34'],
      AAAA: new NotFound('pas d’AAAA'),
    })
    try {
      expect(await resolveWithDeno('ia.exemple.fr')).toEqual(['93.184.216.34'])
    } finally {
      restore()
    }
  })

  /**
   * Le cas qui comptait : un `A` public masquait un `AAAA` jamais lu, et l'hôte
   * passait alors que son adresse IPv6 pointait sur le réseau interne.
   */
  it('lève quand une famille ne répond pas, même si l’autre répond', async () => {
    const restore = withFakeDeno({
      A: ['93.184.216.34'],
      AAAA: new Error('délai dépassé'),
    })
    try {
      await expect(resolveWithDeno('ia.exemple.fr')).rejects.toThrow(
        /résolution AAAA indisponible/,
      )
    } finally {
      restore()
    }
  })

  it('refuse l’adresse quand la résolution lève', async () => {
    const restore = withFakeDeno({
      A: new Error('permission refusée'),
      AAAA: ['2606:2800::1'],
    })
    try {
      const verdict = await checkBotAddressResolved(
        'https://ia.exemple.fr/coup',
        resolveWithDeno,
      )
      expect(verdict.ok).toBe(false)
      if (!verdict.ok) expect(verdict.reason).toBe('resolution-unavailable')
    } finally {
      restore()
    }
  })
})
