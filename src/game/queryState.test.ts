import { describe, expect, it } from 'vitest'
import { boardToText } from './boardText.ts'
import { createGameStateFromSearch, loadedGameState } from './queryState.ts'

const EMPTY_ROWS = Array.from({ length: 9 }, () => '.........')

const ONGOING_RECORD =
  '4Lr32 3Ir12 3Ir12 3Ir13 4Tr24 4Lr38 3Ir15 15 2r13 2r15 15 2r13'

function searchFor(rows: string[], turn?: string): string {
  const params = new URLSearchParams({ board: rows.join('/') })
  if (turn) params.set('turn', turn)
  return `?${params}`
}

function searchForMoves(record: string): string {
  return `?${new URLSearchParams({ moves: record })}`
}

/** Position affichée au chargement, quelle que soit la provenance de l'état. */
function stateFor(search: string) {
  const loaded = createGameStateFromSearch(search)
  return loaded ? loadedGameState(loaded) : null
}

describe('chargement d’une position par query string', () => {
  it('ignore une URL sans grille', () => {
    expect(createGameStateFromSearch('?turn=white')).toBeNull()
  })

  it('charge directement une partie avec le joueur demandé', () => {
    const rows = [...EMPTY_ROWS]
    rows[8] = '..BB...W.'
    const state = stateFor(searchFor(rows, 'white'))

    expect(state?.phase).toBe('playing')
    expect(state?.activePlayer).toBe('white')
    expect(state?.board[8][2]?.player).toBe('blue')
    expect(state?.board[8][7]?.player).toBe('white')
  })

  it('ouvre directement le panneau final et le chemin gagnant', () => {
    const rows = [...EMPTY_ROWS]
    rows[8] = 'BBBBBBBBB'
    const state = stateFor(searchFor(rows))

    expect(state?.phase).toBe('finished')
    expect(state?.result).toEqual({ winner: 'blue', reason: 'connection' })
  })

  it('refuse un joueur inconnu ou deux vainqueurs simultanés', () => {
    expect(() =>
      stateFor(searchFor(EMPTY_ROWS, 'green')),
    ).toThrow(/Joueur actif/)

    const rows = [...EMPTY_ROWS]
    rows[0] = 'BBBBBBBBB'
    rows[8] = 'WWWWWWWWW'
    expect(() => stateFor(searchFor(rows))).toThrow(
      /deux joueurs victorieux/,
    )
  })
})

describe('chargement d’une partie notée par query string', () => {
  it('rejoue la notation, réserves et exemplaires joués compris', () => {
    const state = stateFor(searchForMoves(ONGOING_RECORD))

    expect(state?.phase).toBe('playing')
    expect(state?.activePlayer).toBe('blue')
    expect(boardToText(state!.board)).toContain('.BBBBB.WW')
    // Contrairement à `board`, la notation restaure les réserves consommées.
    expect(state?.inventories.blue.bar3).toBe(0)
    expect(state?.inventories.white.domino).toBe(0)
    expect(state?.playedCopies.blue.bar3).toEqual([true, true])
    expect(state?.history).toHaveLength(12)
  })

  it('ouvre le panneau final sur une partie déjà gagnée', () => {
    const state = stateFor(
      searchForMoves('4Lr32 4Ss3 4Lr32 3Ir12 3Ir13 3Ir14 2r13'),
    )

    expect(state?.phase).toBe('finished')
    expect(state?.result).toEqual({ winner: 'blue', reason: 'connection' })
  })

  it('lit le premier joueur dans la notation elle-même', () => {
    const state = stateFor(searchForMoves('w 11 12'))

    expect(state?.firstPlayer).toBe('white')
    expect(state?.activePlayer).toBe('white')
    expect(state?.board[8][0]?.player).toBe('white')
    expect(state?.board[8][1]?.player).toBe('blue')
  })

  it('signale le coup fautif d’une notation illégale', () => {
    expect(() => stateFor(searchForMoves('11 12 3I1'))).toThrow(
      /Coup 3 .*vide sous elle/,
    )
  })

  it('rend la provenance de l’état, seule à décider de la barre de lecture', () => {
    const noted = createGameStateFromSearch(searchForMoves(ONGOING_RECORD))
    expect(noted?.source).toBe('moves')
    // Une position par entrée d'historique, plus le plateau vide : c'est la
    // suite que déroule la barre de lecture.
    expect(noted?.source === 'moves' && noted.states).toHaveLength(13)

    const rows = [...EMPTY_ROWS]
    rows[8] = '..BB...W.'
    // Une grille ne porte aucune partie : rien à dérouler, donc pas de barre.
    expect(createGameStateFromSearch(searchFor(rows))?.source).toBe('board')
  })

  it('ignore une notation vide et garde le comportement de board', () => {
    expect(createGameStateFromSearch('?moves=')).toBeNull()

    const rows = [...EMPTY_ROWS]
    rows[8] = '..BB...W.'
    expect(
      stateFor(searchFor(rows, 'white'))?.inventories.blue.bar3,
    ).toBe(2)
  })
})
