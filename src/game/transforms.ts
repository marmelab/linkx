import { BASE_SHAPES, matrixToPoints } from './pieces'
import type { Orientation, Point, Rotation, ShapeId } from './types'

export function normalizePoints(points: readonly Point[]): Point[] {
  const minX = Math.min(...points.map(({ x }) => x))
  const minY = Math.min(...points.map(({ y }) => y))
  return points
    .map(({ x, y }) => ({ x: x - minX, y: y - minY }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
}

export function pointsKey(points: readonly Point[]): string {
  return normalizePoints(points)
    .map(({ x, y }) => `${x},${y}`)
    .join('|')
}

function rotateOnce(points: readonly Point[]): Point[] {
  return normalizePoints(points.map(({ x, y }) => ({ x: -y, y: x })))
}

function reflect(points: readonly Point[]): Point[] {
  return normalizePoints(points.map(({ x, y }) => ({ x: -x, y })))
}

function applyRotation(points: readonly Point[], rotation: Rotation): Point[] {
  let result = normalizePoints(points)
  for (let turn = 0; turn < rotation; turn += 1) {
    result = rotateOnce(result)
  }
  return result
}

function makeOrientation(
  shapeId: ShapeId,
  rotation: Rotation,
  flipped: boolean,
): Orientation {
  const base = matrixToPoints(BASE_SHAPES[shapeId])
  const cells = applyRotation(flipped ? reflect(base) : base, rotation)
  return {
    cells,
    width: Math.max(...cells.map(({ x }) => x)) + 1,
    height: Math.max(...cells.map(({ y }) => y)) + 1,
    rotation,
    flipped,
  }
}

export function getOrientation(
  shapeId: ShapeId,
  rotation: Rotation,
  flipped: boolean,
): Orientation {
  return makeOrientation(shapeId, rotation, flipped)
}

// Les orientations d'une forme sont déterministes : on les calcule une fois puis
// on les met en cache. L'énumération des coups appelle cette fonction à chaque
// nœud du minimax, où recalculer rotations, miroirs et déduplication coûte cher.
const uniqueOrientationsCache = new Map<ShapeId, Orientation[]>()

function computeUniqueOrientations(shapeId: ShapeId): Orientation[] {
  const orientations: Orientation[] = []
  const seen = new Set<string>()

  for (const flipped of [false, true]) {
    for (const rotation of [0, 1, 2, 3] as const) {
      const orientation = makeOrientation(shapeId, rotation, flipped)
      const key = pointsKey(orientation.cells)
      if (!seen.has(key)) {
        seen.add(key)
        orientations.push(orientation)
      }
    }
  }

  return orientations
}

/**
 * Orientations distinctes d'une forme. Le tableau renvoyé est partagé et mis en
 * cache ; les appelants doivent le traiter en lecture seule.
 */
export function getUniqueOrientations(shapeId: ShapeId): Orientation[] {
  const cached = uniqueOrientationsCache.get(shapeId)
  if (cached) return cached
  const orientations = computeUniqueOrientations(shapeId)
  uniqueOrientationsCache.set(shapeId, orientations)
  return orientations
}
