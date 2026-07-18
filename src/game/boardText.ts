import { createEmptyBoard } from './placement'
import { BOARD_SIZE } from './types'
import type { Board, PlayerId } from './types'

const PLAYER_BY_SYMBOL: Partial<Record<string, PlayerId>> = {
  B: 'blue',
  W: 'white',
}

type BoardTextOptions = {
  groupOrthogonalComponents?: boolean
}

export function rowsFromBoardText(source: string): string[] {
  const compact = source.trim()
  const rows = /^[BW.]{81}$/.test(compact)
    ? Array.from({ length: BOARD_SIZE }, (_, row) =>
        compact.slice(row * BOARD_SIZE, (row + 1) * BOARD_SIZE),
      )
    : compact
        .split(/[/|\n]/)
        .map((row) => row.trim())
        .filter(Boolean)

  if (
    rows.length !== BOARD_SIZE ||
    rows.some((row) => row.length !== BOARD_SIZE)
  ) {
    throw new Error(`Une grille doit mesurer ${BOARD_SIZE} × ${BOARD_SIZE}.`)
  }
  for (const row of rows) {
    const unknown = Array.from(row).find((symbol) => !'.BW'.includes(symbol))
    if (unknown) throw new Error(`Symbole de grille inconnu : ${unknown}`)
  }
  return rows
}

function groupOrthogonalComponents(board: Board): void {
  const visited = new Set<string>()
  let component = 1

  board.forEach((row, y) =>
    row.forEach((cell, x) => {
      const startKey = `${x},${y}`
      if (!cell || visited.has(startKey)) return

      const queue = [{ x, y }]
      visited.add(startKey)
      const pieceId = `fixture-${cell.player}-${component}`
      component += 1

      for (let index = 0; index < queue.length; index += 1) {
        const point = queue[index]
        const current = board[point.y][point.x]
        if (current) current.pieceId = pieceId

        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const nextX = point.x + dx
          const nextY = point.y + dy
          const nextKey = `${nextX},${nextY}`
          if (
            nextX < 0 ||
            nextX >= BOARD_SIZE ||
            nextY < 0 ||
            nextY >= BOARD_SIZE ||
            visited.has(nextKey) ||
            board[nextY][nextX]?.player !== cell.player
          ) {
            continue
          }
          visited.add(nextKey)
          queue.push({ x: nextX, y: nextY })
        }
      }
    }),
  )
}

export function boardFromText(
  source: string,
  options: BoardTextOptions = {},
): Board {
  const rows = rowsFromBoardText(source)
  const board = createEmptyBoard()

  rows.forEach((row, y) => {
    Array.from(row).forEach((symbol, x) => {
      const player = PLAYER_BY_SYMBOL[symbol]
      if (!player) return
      board[y][x] = {
        player,
        pieceId: `fixture-${x}-${y}`,
        shapeId: 'mono',
      }
    })
  })

  if (options.groupOrthogonalComponents) groupOrthogonalComponents(board)
  return board
}

export function boardToText(board: Board): string {
  return board
    .map((row) =>
      row
        .map((cell) => (cell ? (cell.player === 'blue' ? 'B' : 'W') : '.'))
        .join(''),
    )
    .join('\n')
}
