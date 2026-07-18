import { describe, expect, it } from 'vitest'
import { createGameStateFromSearch } from './queryState'

const EMPTY_ROWS = Array.from({ length: 9 }, () => '.........')

function searchFor(rows: string[], turn?: string): string {
  const params = new URLSearchParams({ board: rows.join('/') })
  if (turn) params.set('turn', turn)
  return `?${params}`
}

describe('chargement d’une position par query string', () => {
  it('ignore une URL sans grille', () => {
    expect(createGameStateFromSearch('?turn=white')).toBeNull()
  })

  it('charge directement une partie avec le joueur demandé', () => {
    const rows = [...EMPTY_ROWS]
    rows[8] = '..BB...W.'
    const state = createGameStateFromSearch(searchFor(rows, 'white'))

    expect(state?.phase).toBe('playing')
    expect(state?.activePlayer).toBe('white')
    expect(state?.board[8][2]?.player).toBe('blue')
    expect(state?.board[8][7]?.player).toBe('white')
  })

  it('ouvre directement le panneau final et le chemin gagnant', () => {
    const rows = [...EMPTY_ROWS]
    rows[8] = 'BBBBBBBBB'
    const state = createGameStateFromSearch(searchFor(rows))

    expect(state?.phase).toBe('finished')
    expect(state?.result).toEqual({ winner: 'blue', reason: 'connection' })
  })

  it('refuse un joueur inconnu ou deux vainqueurs simultanés', () => {
    expect(() =>
      createGameStateFromSearch(searchFor(EMPTY_ROWS, 'green')),
    ).toThrow(/Joueur actif/)

    const rows = [...EMPTY_ROWS]
    rows[0] = 'BBBBBBBBB'
    rows[8] = 'WWWWWWWWW'
    expect(() => createGameStateFromSearch(searchFor(rows))).toThrow(
      /deux joueurs victorieux/,
    )
  })
})
