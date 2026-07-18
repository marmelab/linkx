import { getLargestZone, hasWinningConnection } from './connectivity'
import { hasLegalMove } from './legalMoves'
import { createInitialInventory, INITIAL_ROTATIONS } from './pieces'
import { calculateDrop, createEmptyBoard } from './placement'
import { getOrientation } from './transforms'
import { DEFAULT_DIFFICULTY } from './types'
import type {
  GameAction,
  GameResult,
  GameState,
  Inventory,
  PlayedCopies,
  PlayerId,
  Rotation,
  Selection,
  ShapeId,
} from './types'

export function otherPlayer(player: PlayerId): PlayerId {
  return player === 'blue' ? 'white' : 'blue'
}

function makeInventories(): Record<PlayerId, Inventory> {
  return { blue: createInitialInventory(), white: createInitialInventory() }
}

function makePlayedCopies(): Record<PlayerId, PlayedCopies> {
  const playerCopies = (): PlayedCopies => ({
    mono: [false, false],
    domino: [false, false],
    bar3: [false, false],
    smallL: [false, false],
    s: [false, false],
    t: [false, false],
    largeL: [false, false],
  })
  return { blue: playerCopies(), white: playerCopies() }
}

export function createInitialState(): GameState {
  return {
    phase: 'setup',
    mode: 'human',
    aiPlayer: null,
    difficulty: DEFAULT_DIFFICULTY,
    firstPlayer: 'blue',
    history: [],
    board: createEmptyBoard(),
    inventories: makeInventories(),
    playedCopies: makePlayedCopies(),
    activePlayer: 'blue',
    selection: null,
    consecutivePasses: 0,
    result: null,
    lastEvent: null,
    nextPieceId: 1,
    lastPlacedPieceId: null,
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
      history: [...state.history, { kind: 'pass' }],
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

/**
 * Pose la pièce décrite par `selection` dans `column` pour le joueur actif, puis
 * résout la fin du coup (victoire, tour passé, blocage). `keepSelection` garde
 * le second exemplaire armé pour un joueur humain ; l'ordinateur, lui, choisit
 * chaque coup depuis zéro et repart donc sans sélection.
 */
function placeSelection(
  state: GameState,
  selection: Selection,
  column: number,
  keepSelection: boolean,
): GameState {
  const player = state.activePlayer
  const { shapeId, rotation, flipped } = selection
  if (state.inventories[player][shapeId] === 0) return state

  const orientation = getOrientation(shapeId, rotation, flipped)
  const drop = calculateDrop(state.board, orientation, column)
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
  const shapeCopies = [...state.playedCopies[player][shapeId]] as [
    boolean,
    boolean,
  ]
  shapeCopies[selection.copy] = true
  const playedCopies = {
    ...state.playedCopies,
    [player]: {
      ...state.playedCopies[player],
      [shapeId]: shapeCopies,
    },
  }
  const nextCopy = shapeCopies.findIndex((played) => !played) as 0 | 1 | -1
  const placed: GameState = {
    ...state,
    board,
    inventories,
    playedCopies,
    history: [
      ...state.history,
      { kind: 'move', shapeId, rotation, flipped, column },
    ],
    selection:
      keepSelection && remaining > 0 && nextCopy !== -1
        ? { ...selection, copy: nextCopy }
        : null,
    consecutivePasses: 0,
    lastEvent: { type: 'placed', player, shapeId },
    nextPieceId: state.nextPieceId + 1,
    lastPlacedPieceId: pieceId,
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

/** Premier exemplaire encore en réserve, pour armer un coup non interactif. */
export function firstAvailableCopy(
  state: GameState,
  player: PlayerId,
  shapeId: ShapeId,
): 0 | 1 | null {
  const copies = state.playedCopies[player][shapeId]
  if (!copies[0]) return 0
  if (!copies[1]) return 1
  return null
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'RESET_GAME':
      return createInitialState()
    case 'START_GAME': {
      const mode = action.mode ?? 'human'
      return {
        ...createInitialState(),
        phase: 'playing' as const,
        mode,
        // Le joueur humain garde toujours les bleus, à gauche de l'écran.
        aiPlayer: mode === 'ai' ? 'white' : null,
        difficulty: action.difficulty ?? DEFAULT_DIFFICULTY,
        firstPlayer: action.firstPlayer,
        activePlayer: action.firstPlayer,
      }
    }
    case 'SELECT_SHAPE': {
      const copy = action.copy ?? 0
      if (
        state.phase !== 'playing' ||
        action.player !== state.activePlayer ||
        state.inventories[action.player][action.shapeId] === 0 ||
        state.playedCopies[action.player][action.shapeId][copy]
      ) {
        return state
      }
      if (
        state.selection?.shapeId === action.shapeId &&
        state.selection.copy === copy
      ) {
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
        selection: {
          shapeId: action.shapeId,
          copy,
          rotation: INITIAL_ROTATIONS[action.shapeId],
          flipped: false,
        },
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
      // L'ordinateur pose via PLAY_AI_MOVE : ses cases ne sont pas cliquables.
      if (state.activePlayer === state.aiPlayer) return state
      return placeSelection(state, state.selection, action.column, true)
    }
    case 'PLAY_AI_MOVE': {
      if (state.phase !== 'playing' || state.activePlayer !== state.aiPlayer) {
        return state
      }
      const copy = firstAvailableCopy(state, state.activePlayer, action.shapeId)
      if (copy === null) return state
      return placeSelection(
        state,
        {
          shapeId: action.shapeId,
          copy,
          rotation: action.rotation,
          flipped: action.flipped,
        },
        action.column,
        false,
      )
    }
  }
}
