import { BOARD_SIZE } from './types.ts'
import type { Board, DropResult, Orientation, Point } from './types.ts'

export function createEmptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  )
}

/**
 * Colonne d'ancrage d'une pièce visée depuis `pointer`. La colonne pointée porte
 * le centre de la forme, jamais son bord gauche, et la pièce reste entièrement
 * sur le plateau : viser près d'un bord la fait buter contre ce bord.
 */
export function aimedColumn(pointer: number, width: number): number {
  const anchor = pointer - Math.floor((width - 1) / 2)
  return Math.min(Math.max(anchor, 0), BOARD_SIZE - width)
}

function cellsAt(
  orientation: Orientation,
  anchorX: number,
  anchorY: number,
): Point[] {
  return orientation.cells.map(({ x, y }) => ({
    x: x + anchorX,
    y: y + anchorY,
  }))
}

function collides(board: Board, cells: readonly Point[]): boolean {
  return cells.some(
    ({ x, y }) =>
      x < 0 ||
      x >= BOARD_SIZE ||
      y >= BOARD_SIZE ||
      (y >= 0 && board[y][x] !== null),
  )
}

function fullySupported(board: Board, cells: readonly Point[]): boolean {
  const ownCells = new Set(cells.map(({ x, y }) => `${x},${y}`))
  return cells.every(
    ({ x, y }) =>
      ownCells.has(`${x},${y + 1}`) ||
      y === BOARD_SIZE - 1 ||
      board[y + 1][x] !== null,
  )
}

export function calculateDrop(
  board: Board,
  orientation: Orientation,
  anchorX: number,
): DropResult {
  if (anchorX < 0 || anchorX + orientation.width > BOARD_SIZE) {
    return {
      valid: false,
      reason: 'horizontal-bounds',
      previewCells: cellsAt(
        orientation,
        anchorX,
        BOARD_SIZE - orientation.height,
      ),
    }
  }

  let anchorY = -orientation.height
  while (!collides(board, cellsAt(orientation, anchorX, anchorY + 1))) {
    anchorY += 1
  }

  const cells = cellsAt(orientation, anchorX, anchorY)
  if (cells.some(({ y }) => y < 0)) {
    return { valid: false, reason: 'overflow', previewCells: cells }
  }

  if (!fullySupported(board, cells)) {
    return { valid: false, reason: 'unsupported', previewCells: cells }
  }

  return { valid: true, cells, anchorY }
}

