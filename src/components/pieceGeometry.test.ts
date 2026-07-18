import { describe, expect, it } from 'vitest'
import { getJoinedCellBounds } from './pieceGeometry'

function occupied(cells: readonly [number, number][]) {
  const keys = new Set(cells.map(([x, y]) => `${x},${y}`))
  return (x: number, y: number) => keys.has(`${x},${y}`)
}

describe('silhouettes continues du plateau', () => {
  it('étend le carré central du T dans ses trois raccords', () => {
    const isOccupied = occupied([[0, 0], [1, 0], [2, 0], [1, 1]])
    const center = getJoinedCellBounds(1, 0, isOccupied)

    expect(center.left).toBeLessThan(1)
    expect(center.right).toBeGreaterThan(2)
    expect(center.bottom).toBeGreaterThan(1)
  })

  it('fait se chevaucher les deux carrés centraux du S avec leurs voisins', () => {
    const isOccupied = occupied([[1, 0], [0, 1], [1, 1], [0, 2]])
    const centerLeft = getJoinedCellBounds(0, 1, isOccupied)
    const centerRight = getJoinedCellBounds(1, 1, isOccupied)

    expect(centerLeft.right).toBeGreaterThan(1)
    expect(centerLeft.bottom).toBeGreaterThan(2)
    expect(centerRight.left).toBeLessThan(1)
    expect(centerRight.top).toBeLessThan(1)
  })
})
