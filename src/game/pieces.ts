import type { Inventory, Point, Rotation, ShapeId } from './types'

export const BASE_SHAPES: Record<ShapeId, readonly (readonly number[])[]> = {
  mono: [[1]],
  domino: [[1, 1]],
  bar3: [[1, 1, 1]],
  smallL: [
    [1, 1],
    [1, 0],
  ],
  s: [
    [0, 1],
    [1, 1],
    [1, 0],
  ],
  t: [
    [1, 1, 1],
    [0, 1, 0],
  ],
  largeL: [
    [1, 1, 1],
    [1, 0, 0],
  ],
}

export const SHAPE_LABELS: Record<ShapeId, string> = {
  mono: 'Mono',
  domino: 'Domino',
  bar3: 'Barre 3',
  smallL: 'Petit L',
  s: 'S / Z',
  t: 'T',
  largeL: 'Grand L / J',
}

export const FLIPPABLE_SHAPES: readonly ShapeId[] = ['s', 'largeL']

export const INITIAL_ROTATIONS: Record<ShapeId, Rotation> = {
  mono: 0,
  domino: 0,
  bar3: 0,
  smallL: 0,
  s: 1,
  t: 0,
  largeL: 0,
}

export function matrixToPoints(
  matrix: readonly (readonly number[])[],
): Point[] {
  return matrix.flatMap((row, y) =>
    row.flatMap((filled, x) => (filled ? [{ x, y }] : [])),
  )
}

export function createInitialInventory(): Inventory {
  return {
    mono: 2,
    domino: 2,
    bar3: 2,
    smallL: 2,
    s: 2,
    t: 2,
    largeL: 2,
  }
}
