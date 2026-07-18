import { BOARD_SIZE } from './types'
import type { Board, PlayerId, Point } from './types'

type Component = {
  cells: Point[]
  touchesLeft: boolean
  touchesRight: boolean
  touchesTop: boolean
  touchesBottom: boolean
}

const NEIGHBORS = [-1, 0, 1].flatMap((dy) =>
  [-1, 0, 1]
    .filter((dx) => dx !== 0 || dy !== 0)
    .map((dx) => ({ x: dx, y: dy })),
)

export function getComponents(board: Board, player: PlayerId): Component[] {
  const visited = new Set<string>()
  const components: Component[] = []

  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const key = `${x},${y}`
      if (visited.has(key) || board[y][x]?.player !== player) continue

      const queue: Point[] = [{ x, y }]
      const cells: Point[] = []
      visited.add(key)

      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index]
        cells.push(point)
        for (const offset of NEIGHBORS) {
          const next = { x: point.x + offset.x, y: point.y + offset.y }
          const nextKey = `${next.x},${next.y}`
          if (
            next.x >= 0 &&
            next.x < BOARD_SIZE &&
            next.y >= 0 &&
            next.y < BOARD_SIZE &&
            !visited.has(nextKey) &&
            board[next.y][next.x]?.player === player
          ) {
            visited.add(nextKey)
            queue.push(next)
          }
        }
      }

      components.push({
        cells,
        touchesLeft: cells.some((cell) => cell.x === 0),
        touchesRight: cells.some((cell) => cell.x === BOARD_SIZE - 1),
        touchesTop: cells.some((cell) => cell.y === 0),
        touchesBottom: cells.some((cell) => cell.y === BOARD_SIZE - 1),
      })
    }
  }

  return components
}

export function hasWinningConnection(board: Board, player: PlayerId): boolean {
  return getComponents(board, player).some(
    (component) =>
      (component.touchesLeft && component.touchesRight) ||
      (component.touchesTop && component.touchesBottom),
  )
}

export function getLargestZone(board: Board, player: PlayerId): number {
  return Math.max(0, ...getComponents(board, player).map(({ cells }) => cells.length))
}

