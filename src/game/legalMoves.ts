import { calculateDrop } from './placement'
import { getUniqueOrientations } from './transforms'
import { BOARD_SIZE, SHAPE_IDS } from './types'
import type { Board, Inventory, Orientation, Point, ShapeId } from './types'

export type LegalMove = {
  shapeId: ShapeId
  orientation: Orientation
  column: number
  cells: Point[]
}

export function enumerateLegalMoves(
  board: Board,
  inventory: Inventory,
): LegalMove[] {
  const moves: LegalMove[] = []

  for (const shapeId of SHAPE_IDS) {
    if (inventory[shapeId] === 0) continue
    for (const orientation of getUniqueOrientations(shapeId)) {
      for (
        let column = 0;
        column <= BOARD_SIZE - orientation.width;
        column += 1
      ) {
        const drop = calculateDrop(board, orientation, column)
        if (drop.valid) {
          moves.push({ shapeId, orientation, column, cells: drop.cells })
        }
      }
    }
  }

  return moves
}

export function hasLegalMove(board: Board, inventory: Inventory): boolean {
  for (const shapeId of SHAPE_IDS) {
    if (inventory[shapeId] === 0) continue
    for (const orientation of getUniqueOrientations(shapeId)) {
      for (
        let column = 0;
        column <= BOARD_SIZE - orientation.width;
        column += 1
      ) {
        if (calculateDrop(board, orientation, column).valid) return true
      }
    }
  }
  return false
}

