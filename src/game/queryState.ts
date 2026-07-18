import { hasWinningConnection } from './connectivity'
import { boardFromText } from './boardText'
import { parseGameRecord } from './moveNotation'
import { createInitialState } from './reducer'
import type { GameState, PlayerId } from './types'

function playerFromQuery(value: string | null): PlayerId {
  if (!value || value === 'blue' || value.toUpperCase() === 'B') return 'blue'
  if (value === 'white' || value.toUpperCase() === 'W') return 'white'
  throw new Error(`Joueur actif inconnu : ${value}`)
}

/**
 * `?moves=` rejoue une notation de partie : le plateau, les réserves, les
 * exemplaires consommés et le joueur actif sont exacts. Le paramètre `turn` ne
 * s'applique qu'à `?board=` ; une notation porte elle-même son premier joueur.
 */
function stateFromMoves(source: string): GameState {
  const parsed = parseGameRecord(source)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.state
}

function stateFromBoard(source: string, turn: string | null): GameState {
  const board = boardFromText(source, { groupOrthogonalComponents: true })
  const activePlayer = playerFromQuery(turn)
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
    firstPlayer: activePlayer,
    activePlayer,
    result: winner ? { winner, reason: 'connection' } : null,
  }
}

export function createGameStateFromSearch(search: string): GameState | null {
  const params = new URLSearchParams(search)
  const moves = params.get('moves')
  if (moves) return stateFromMoves(moves)

  const source = params.get('board')
  if (!source) return null
  return stateFromBoard(source, params.get('turn'))
}
