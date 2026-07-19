import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DIFFICULTY } from '../game/types'
import { readStoredDifficulty, writeStoredDifficulty } from './useStoredDifficulty'

/** Stockage minimal, suffisant pour les deux seules méthodes utilisées. */
function fakeStorage(initial: Record<string, string> = {}) {
  const entries = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    entries,
  }
}

const stub = (storage: unknown) => vi.stubGlobal('localStorage', storage)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('niveau mémorisé', () => {
  it('relit le niveau écrit au choix précédent', () => {
    const storage = fakeStorage()
    stub(storage)

    writeStoredDifficulty('hard')

    expect(readStoredDifficulty()).toBe('hard')
  })

  it('retombe sur le défaut quand rien n’a encore été choisi', () => {
    stub(fakeStorage())

    expect(readStoredDifficulty()).toBe(DEFAULT_DIFFICULTY)
  })

  it('ignore une valeur qui ne désigne aucun niveau', () => {
    stub(fakeStorage({ 'linkx.difficulty': 'impossible' }))

    expect(readStoredDifficulty()).toBe(DEFAULT_DIFFICULTY)
  })

  it('ignore un stockage absent', () => {
    stub(undefined)

    expect(readStoredDifficulty()).toBe(DEFAULT_DIFFICULTY)
    expect(() => writeStoredDifficulty('easy')).not.toThrow()
  })

  it('ignore un stockage qui refuse la lecture comme l’écriture', () => {
    const refuse = () => {
      throw new Error('accès refusé')
    }
    stub({ getItem: refuse, setItem: refuse })

    expect(readStoredDifficulty()).toBe(DEFAULT_DIFFICULTY)
    expect(() => writeStoredDifficulty('easy')).not.toThrow()
  })
})
