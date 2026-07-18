import { describe, expect, it } from 'vitest'
import { boardFromText, boardToText, rowsFromBoardText } from './boardText'
import { hasWinningConnection } from './connectivity'
import { getConnectionScore } from './evaluation'
import { enumerateLegalMoves } from './legalMoves'
import { createInitialInventory } from './pieces'
import { createEmptyBoard } from './placement'
import type { Board, Rotation, ShapeId } from './types'

type PlayedMove = readonly [
  shapeId: ShapeId,
  rotation: Rotation,
  flipped: boolean,
  column: number,
]

function playLegalMoves(moves: readonly PlayedMove[]): Board {
  const board = createEmptyBoard()
  const inventories = {
    blue: createInitialInventory(),
    white: createInitialInventory(),
  }

  moves.forEach(([shapeId, rotation, flipped, column], index) => {
    const player = index % 2 === 0 ? 'blue' : 'white'
    const move = enumerateLegalMoves(board, inventories[player]).find(
      (candidate) =>
        candidate.shapeId === shapeId &&
        candidate.orientation.rotation === rotation &&
        candidate.orientation.flipped === flipped &&
        candidate.column === column,
    )
    if (!move) throw new Error(`Le coup ${index + 1} n’est pas légal.`)

    for (const { x, y } of move.cells) {
      board[y][x] = {
        player,
        pieceId: `random-game-${index + 1}`,
        shapeId,
      }
    }
    inventories[player][shapeId] = (inventories[player][shapeId] - 1) as 0 | 1
    if (hasWinningConnection(board, player)) {
      throw new Error(`La partie était déjà gagnée après le coup ${index + 1}.`)
    }
  })

  return board
}

describe('évaluation d’une grille', () => {
  it('vaut 9 sur une grille vide pour les deux joueurs', () => {
    const board = boardFromText(`
      .........
      .........
      .........
      .........
      .........
      .........
      .........
      .........
      .........
    `)

    expect(getConnectionScore(board, 'blue')).toBe(9)
    expect(getConnectionScore(board, 'white')).toBe(9)
  })

  it.each([
    [
      'horizontale',
      `
        .........
        .........
        .........
        .........
        .........
        BBBBBBBBB
        .........
        .........
        .........
      `,
    ],
    [
      'verticale',
      `
        ......B..
        ......B..
        ......B..
        ......B..
        ......B..
        ......B..
        ......B..
        ......B..
        ......B..
      `,
    ],
    [
      'diagonale',
      `
        B........
        .B.......
        ..B......
        ...B.....
        ....B....
        .....B...
        ......B..
        .......B.
        ........B
      `,
    ],
  ])('vaut 0 pour une liaison gagnante %s', (_name, source) => {
    expect(getConnectionScore(boardFromText(source), 'blue')).toBe(0)
  })

  it('assemble plusieurs zones avec le nombre minimal de cases libres', () => {
    const board = boardFromText(`
      .........
      .........
      .........
      .........
      .........
      .........
      .........
      ....BB...
      BBB....BB
    `)

    expect(getConnectionScore(board, 'blue')).toBe(2)
  })

  it('retient le meilleur des axes horizontal et vertical', () => {
    const board = boardFromText(`
      .........
      ....B....
      ....B....
      ....B....
      ....B....
      ....B....
      ....B....
      ....B....
      ....B....
    `)

    expect(getConnectionScore(board, 'blue')).toBe(1)
  })

  it('traite les cases adverses comme infranchissables', () => {
    const board = boardFromText(`
      WWWWWWWWW
      WWWWWWWWW
      WWWWWWWWW
      WWWWWWWWW
      WWWWWWWWW
      WWWWWWWWW
      WWWWWWWWW
      WWWWWWWWW
      WWWWWWWWW
    `)

    expect(getConnectionScore(board, 'blue')).toBe(Number.POSITIVE_INFINITY)
    expect(getConnectionScore(board, 'white')).toBe(0)
  })

  it.each([
    {
      name: 'graine 2',
      source: `
        .........
        .........
        .....W...
        ...W.W...
        ..BB.W...
        .BBBBBB..
        .WWBBWW.B
        .WWWBBW.B
        .WWBBBW.B
      `,
      moves: [
        ['domino', 1, false, 5],
        ['bar3', 1, false, 6],
        ['domino', 0, false, 3],
        ['s', 1, true, 1],
        ['s', 0, true, 3],
        ['mono', 0, false, 5],
        ['bar3', 0, false, 4],
        ['bar3', 1, false, 5],
        ['bar3', 1, false, 8],
        ['smallL', 0, false, 1],
        ['s', 1, true, 1],
        ['mono', 0, false, 3],
      ] satisfies PlayedMove[],
      scores: { blue: 2, white: 4 },
    },
    {
      name: 'graine 9',
      source: `
        .........
        .........
        ...B.....
        ..BB.....
        ..WB.....
        B.WWW..W.
        B.BWWW.W.
        B.BWWB.WW
        W.BBBB.WB
      `,
      moves: [
        ['domino', 1, false, 5],
        ['mono', 0, false, 7],
        ['largeL', 2, true, 2],
        ['mono', 0, false, 0],
        ['bar3', 1, false, 0],
        ['bar3', 1, false, 3],
        ['mono', 0, false, 8],
        ['largeL', 3, false, 7],
        ['mono', 0, false, 2],
        ['domino', 1, false, 2],
        ['t', 1, false, 2],
        ['t', 3, false, 4],
      ] satisfies PlayedMove[],
      scores: { blue: 4, white: 3 },
    },
  ])('évalue une position réelle issue d’une partie aléatoire ($name)', ({
    source,
    moves,
    scores,
  }) => {
    const board = boardFromText(source)

    expect(boardToText(playLegalMoves(moves))).toBe(
      rowsFromBoardText(source).join('\n'),
    )
    expect(getConnectionScore(board, 'blue')).toBe(scores.blue)
    expect(getConnectionScore(board, 'white')).toBe(scores.white)
  })
})
