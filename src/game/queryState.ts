import { hasWinningConnection } from './connectivity.ts'
import { boardFromText } from './boardText.ts'
import { parseGameTimeline } from './moveNotation.ts'
import { createInitialState } from './reducer.ts'
import type { GameState, PlayerId } from './types.ts'

function playerFromQuery(value: string | null): PlayerId {
  if (!value || value === 'blue' || value.toUpperCase() === 'B') return 'blue'
  if (value === 'white' || value.toUpperCase() === 'W') return 'white'
  throw new Error(`Joueur actif inconnu : ${value}`)
}

/**
 * Provenance de l'état chargé, et non le seul état : une notation se déroule
 * coup par coup, une grille non. C'est ici que la distinction est faite, une
 * fois pour toutes ; l'interface ne relit pas la query string pour la retrouver.
 */
export type LoadedGame =
  | { source: 'moves'; states: GameState[] }
  | { source: 'board'; state: GameState }

/** Position à afficher au chargement : la dernière de la notation, ou la grille. */
export function loadedGameState(loaded: LoadedGame): GameState {
  return loaded.source === 'moves'
    ? loaded.states[loaded.states.length - 1]
    : loaded.state
}

/**
 * `?moves=` rejoue une notation de partie : le plateau, les réserves, les
 * exemplaires consommés et le joueur actif sont exacts. Le paramètre `turn` ne
 * s'applique qu'à `?board=` ; une notation porte elle-même son premier joueur.
 */
function statesFromMoves(source: string): GameState[] {
  const parsed = parseGameTimeline(source)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.states
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

export function createGameStateFromSearch(search: string): LoadedGame | null {
  const params = new URLSearchParams(search)
  const moves = params.get('moves')
  if (moves) return { source: 'moves', states: statesFromMoves(moves) }

  const source = params.get('board')
  if (!source) return null
  return { source: 'board', state: stateFromBoard(source, params.get('turn')) }
}
