import { getLargestZone, hasWinningConnection } from './connectivity'
import { hasLegalMove } from './legalMoves'
import { createInitialInventory } from './pieces'
import { calculateDrop, createEmptyBoard } from './placement'
import { getOrientation } from './transforms'
import type {
  GameAction,
  GameResult,
  GameState,
  Inventory,
  PlayerId,
  Rotation,
} from './types'

export function otherPlayer(player: PlayerId): PlayerId {
  return player === 'blue' ? 'white' : 'blue'
}

function makeInventories(): Record<PlayerId, Inventory> {
  return { blue: createInitialInventory(), white: createInitialInventory() }
}

export function createInitialState(): GameState {
  return {
    phase: 'setup',
    board: createEmptyBoard(),
    inventories: makeInventories(),
    activePlayer: 'blue',
    selection: null,
    consecutivePasses: 0,
    result: null,
    lastEvent: null,
    nextPieceId: 1,
  }
}

function stalemateResult(state: GameState): GameResult {
  const largestZones = {
    blue: getLargestZone(state.board, 'blue'),
    white: getLargestZone(state.board, 'white'),
  }
  if (largestZones.blue === largestZones.white) {
    return { winner: null, reason: 'draw', largestZones }
  }
  return {
    winner: largestZones.blue > largestZones.white ? 'blue' : 'white',
    reason: 'stalemate',
    largestZones,
  }
}

function advanceAfterPlacement(state: GameState, playerWhoPlaced: PlayerId): GameState {
  const next = otherPlayer(playerWhoPlaced)
  if (hasLegalMove(state.board, state.inventories[next])) {
    return {
      ...state,
      activePlayer: next,
      selection: null,
      consecutivePasses: 0,
    }
  }

  if (hasLegalMove(state.board, state.inventories[playerWhoPlaced])) {
    return {
      ...state,
      activePlayer: playerWhoPlaced,
      consecutivePasses: 1,
      lastEvent: { type: 'forced-pass', player: next },
    }
  }

  return {
    ...state,
    phase: 'finished',
    activePlayer: playerWhoPlaced,
    selection: null,
    consecutivePasses: 2,
    result: stalemateResult(state),
  }
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'RESET_GAME':
      return createInitialState()
    case 'START_GAME': {
      const started = {
        ...createInitialState(),
        phase: 'playing' as const,
        activePlayer: action.firstPlayer,
      }
      return started
    }
    case 'SELECT_SHAPE': {
      if (
        state.phase !== 'playing' ||
        action.player !== state.activePlayer ||
        state.inventories[action.player][action.shapeId] === 0
      ) {
        return state
      }
      if (state.selection?.shapeId === action.shapeId) {
        return {
          ...state,
          selection: {
            ...state.selection,
            rotation: ((state.selection.rotation + 1) % 4) as Rotation,
          },
          lastEvent: null,
        }
      }
      return {
        ...state,
        selection: { shapeId: action.shapeId, rotation: 0, flipped: false },
        lastEvent: null,
      }
    }
    case 'ROTATE_SELECTION':
      if (state.phase !== 'playing' || !state.selection) return state
      return {
        ...state,
        selection: {
          ...state.selection,
          rotation: ((state.selection.rotation + 1) % 4) as Rotation,
        },
        lastEvent: null,
      }
    case 'FLIP_SELECTION':
      if (state.phase !== 'playing' || !state.selection) return state
      return {
        ...state,
        selection: { ...state.selection, flipped: !state.selection.flipped },
        lastEvent: null,
      }
    case 'DROP_SELECTED_SHAPE': {
      if (state.phase !== 'playing' || !state.selection) return state
      const player = state.activePlayer
      const { shapeId, rotation, flipped } = state.selection
      if (state.inventories[player][shapeId] === 0) return state

      const orientation = getOrientation(shapeId, rotation, flipped)
      const drop = calculateDrop(state.board, orientation, action.column)
      if (!drop.valid) {
        return { ...state, lastEvent: { type: 'invalid', reason: drop.reason } }
      }

      const pieceId = `${player}-${state.nextPieceId}`
      const board = state.board.map((row) => [...row])
      for (const { x, y } of drop.cells) {
        board[y][x] = { player, pieceId, shapeId }
      }
      const remaining = (state.inventories[player][shapeId] - 1) as 0 | 1
      const inventories = {
        ...state.inventories,
        [player]: { ...state.inventories[player], [shapeId]: remaining },
      }
      const placed: GameState = {
        ...state,
        board,
        inventories,
        selection:
          remaining > 0 ? state.selection : null,
        consecutivePasses: 0,
        lastEvent: { type: 'placed', player, shapeId },
        nextPieceId: state.nextPieceId + 1,
      }

      if (hasWinningConnection(board, player)) {
        return {
          ...placed,
          phase: 'finished',
          selection: null,
          result: { winner: player, reason: 'connection' },
        }
      }

      return advanceAfterPlacement(placed, player)
    }
  }
}
