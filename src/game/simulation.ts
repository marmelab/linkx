import { getLargestZone, hasWinningConnection } from './connectivity.ts'
import { hasLegalMove } from './legalMoves.ts'
import type { LegalMove } from './legalMoves.ts'
import { createInitialInventory } from './pieces.ts'
import { calculateDrop, createEmptyBoard } from './placement.ts'
import type { Board, GameResult, Inventory, PlayerId } from './types.ts'

export type GamePosition = {
  board: Board
  inventories: Record<PlayerId, Inventory>
  activePlayer: PlayerId
}

export type SimulationTransition = {
  position: GamePosition
  result: GameResult | null
}

export function getOtherPlayer(player: PlayerId): PlayerId {
  return player === 'blue' ? 'white' : 'blue'
}

export function createGamePosition(firstPlayer: PlayerId = 'blue'): GamePosition {
  return {
    board: createEmptyBoard(),
    inventories: {
      blue: createInitialInventory(),
      white: createInitialInventory(),
    },
    activePlayer: firstPlayer,
  }
}

function getStalemateResult(board: Board): GameResult {
  const largestZones = {
    blue: getLargestZone(board, 'blue'),
    white: getLargestZone(board, 'white'),
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

/**
 * Applies a move returned by enumerateLegalMoves and resolves the following
 * forced pass or stalemate. The landing cells are recalculated before writing.
 */
export function simulateLegalMove(
  position: GamePosition,
  move: LegalMove,
): SimulationTransition {
  const player = position.activePlayer
  if (position.inventories[player][move.shapeId] === 0) {
    throw new Error(`La pièce ${move.shapeId} n’est plus disponible.`)
  }

  const drop = calculateDrop(position.board, move.orientation, move.column)
  if (!drop.valid) throw new Error('Le coup simulé n’est plus légal.')

  const board = position.board.map((row) => [...row])
  const occupiedCellCount = board.reduce(
    (total, row) => total + row.filter(Boolean).length,
    0,
  )
  for (const { x, y } of drop.cells) {
    board[y][x] = {
      player,
      pieceId: `simulation-${occupiedCellCount}`,
      shapeId: move.shapeId,
    }
  }

  const inventories = {
    ...position.inventories,
    [player]: {
      ...position.inventories[player],
      [move.shapeId]: (position.inventories[player][move.shapeId] - 1) as 0 | 1,
    },
  }
  const placedPosition = { board, inventories, activePlayer: player }

  if (hasWinningConnection(board, player)) {
    return {
      position: placedPosition,
      result: { winner: player, reason: 'connection' },
    }
  }

  const opponent = getOtherPlayer(player)
  if (hasLegalMove(board, inventories[opponent])) {
    return {
      position: { ...placedPosition, activePlayer: opponent },
      result: null,
    }
  }
  if (hasLegalMove(board, inventories[player])) {
    return { position: placedPosition, result: null }
  }
  return {
    position: placedPosition,
    result: getStalemateResult(board),
  }
}
