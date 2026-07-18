import { hasWinningConnection } from './connectivity'
import { boardFromText } from './boardText'
import { createInitialState } from './reducer'
import type { GameState, PlayerId } from './types'

function playerFromQuery(value: string | null): PlayerId {
  if (!value || value === 'blue' || value.toUpperCase() === 'B') return 'blue'
  if (value === 'white' || value.toUpperCase() === 'W') return 'white'
  throw new Error(`Joueur actif inconnu : ${value}`)
}

export function createGameStateFromSearch(search: string): GameState | null {
  const params = new URLSearchParams(search)
  const source = params.get('board')
  if (!source) return null

  const board = boardFromText(source, { groupOrthogonalComponents: true })
  const activePlayer = playerFromQuery(params.get('turn'))
  const blueWins = hasWinningConnection(board, 'blue')
  const whiteWins = hasWinningConnection(board, 'white')
  if (blueWins && whiteWins) {
    throw new Error('La grille chargée contient deux joueurs victorieux.')
  }
  const winner = blueWins ? 'blue' : whiteWins ? 'white' : null

  return {
    ...createInitialState(),
    phase: winner ? 'finished' : 'playing',
    board,
    activePlayer,
    result: winner ? { winner, reason: 'connection' } : null,
  }
}
