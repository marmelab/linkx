import { describe, expect, it } from 'vitest'
import { formatGap, orderLeaderboard } from './ranking'
import type { LeaderboardRow } from './types'

const row = (
  rang: number,
  nom: string,
  elo: number,
  ecart: number | null = 0,
): LeaderboardRow => ({
  rang,
  nom,
  elo,
  parties_classees: 40,
  statut: 'active',
  ecart_derniere_vague: ecart,
})

describe('ordre du classement', () => {
  it('range par rang croissant, quel que soit l’ordre reçu', () => {
    const rows = [row(3, 'Céline', 1180), row(1, 'Alice', 1320), row(2, 'Bob', 1250)]
    expect(orderLeaderboard(rows).map((entry) => entry.nom)).toEqual([
      'Alice',
      'Bob',
      'Céline',
    ])
  })

  it('départage deux ex æquo par leur nom, sans jamais permuter d’un rendu à l’autre', () => {
    const rows = [row(1, 'Zoé', 1200), row(1, 'Alice', 1200)]
    expect(orderLeaderboard(rows).map((entry) => entry.nom)).toEqual(['Alice', 'Zoé'])
    expect(orderLeaderboard(rows.slice().reverse()).map((entry) => entry.nom)).toEqual([
      'Alice',
      'Zoé',
    ])
  })

  it('ne modifie pas le tableau reçu', () => {
    const rows = [row(2, 'Bob', 1250), row(1, 'Alice', 1320)]
    orderLeaderboard(rows)
    expect(rows[0].nom).toBe('Bob')
  })
})

describe('écart depuis la vague précédente', () => {
  it('écrit son signe', () => {
    expect(formatGap(18)).toBe('+18')
    expect(formatGap(-7)).toBe('−7')
    expect(formatGap(0)).toBe('=')
  })

  it('n’invente rien pour une IA qui n’a joué aucune vague', () => {
    expect(formatGap(null)).toBe('—')
  })
})
