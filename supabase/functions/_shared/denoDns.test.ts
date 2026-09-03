import { describe, expect, it } from 'vitest'
import { checkBotAddressResolved, denoDnsResolver } from './denoDns.ts'
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

  it('s’en tient à l’écriture quand la résolution est impossible', async () => {
    const verdict = await checkBotAddressResolved('https://ia.exemple.fr/coup', () =>
      Promise.reject(new Error('résolution DNS indisponible')),
    )
    expect(verdict.ok).toBe(true)
  })

  it('s’en tient à l’écriture quand le runtime n’expose aucun résolveur', async () => {
    const verdict = await checkBotAddressResolved('https://ia.exemple.fr/coup', null)
    expect(verdict.ok).toBe(true)
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
