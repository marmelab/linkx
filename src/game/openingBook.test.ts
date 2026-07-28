import { describe, expect, it } from 'vitest'
import { enumerateLegalMoves } from './legalMoves'
import { canonicalPosition, lookupOpeningMove } from './openingBook'
import type { OpeningBook } from './openingBook'
import { createGamePosition, simulateLegalMove } from './simulation'
import type { GamePosition } from './simulation'
import { BOARD_SIZE } from './types'
import type { Board } from './types'

const N = BOARD_SIZE
const mirrorIndex = (i: number) => {
  const x = i % N
  return ((i - x) / N) * N + (N - 1 - x)
}
const mirrorBoard = (board: Board): Board => board.map((row) => [...row].reverse())
const cellSet = (cells: { x: number; y: number }[]) =>
  new Set(cells.map(({ x, y }) => y * N + x))

/** Position où c'est à blanc de jouer, après une ouverture de bleu. */
function whiteToMoveAfterOpening(): GamePosition {
  const start = createGamePosition('blue')
  const opening = enumerateLegalMoves(start.board, start.inventories.blue)[0]
  const after = simulateLegalMove(start, opening)
  if (after.result) throw new Error('ouverture inattendue')
  return after.position
}

/** Petit livre : la position pointe vers un unique coup, en repère canonique. */
function bookWith(position: GamePosition, move: { cells: { x: number; y: number }[] }): OpeningBook {
  const { key, mirror } = canonicalPosition(position)
  const cells = move.cells.map(({ x, y }) => y * N + x)
  const stored = (mirror ? cells.map(mirrorIndex) : cells).sort((a, b) => a - b)
  return { [key]: [stored] }
}

describe('livre d’ouverture', () => {
  it('donne la même clé à une position et à son miroir gauche-droite', () => {
    const position = whiteToMoveAfterOpening()
    const mirrored: GamePosition = { ...position, board: mirrorBoard(position.board) }

    expect(canonicalPosition(mirrored).key).toBe(canonicalPosition(position).key)
    expect(canonicalPosition(mirrored).mirror).toBe(!canonicalPosition(position).mirror)
  })

  it('retrouve le coup légal exact stocké dans le livre', () => {
    const position = whiteToMoveAfterOpening()
    const target = enumerateLegalMoves(position.board, position.inventories.white)[3]
    const book = bookWith(position, target)

    const found = lookupOpeningMove(position, undefined, book)
    expect(found).not.toBeNull()
    expect(cellSet(found!.cells)).toEqual(cellSet(target.cells))
  })

  it('renvoie le coup reflété quand la position est interrogée en miroir', () => {
    const position = whiteToMoveAfterOpening()
    const target = enumerateLegalMoves(position.board, position.inventories.white)[3]
    const book = bookWith(position, target)
    const mirrored: GamePosition = { ...position, board: mirrorBoard(position.board) }

    const found = lookupOpeningMove(mirrored, undefined, book)
    expect(found).not.toBeNull()
    const expected = new Set([...cellSet(target.cells)].map(mirrorIndex))
    expect(cellSet(found!.cells)).toEqual(expected)
  })

  it('rend null hors du livre', () => {
    const position = whiteToMoveAfterOpening()
    expect(lookupOpeningMove(position, undefined, {})).toBeNull()
  })

  it('ignore la position au-delà du deuxième coup du joueur au trait', () => {
    // Blanc joue deux fois : la 3ᵉ position blanche est hors du périmètre du livre.
    let position = createGamePosition('white')
    for (let ply = 0; ply < 4; ply += 1) {
      const move = enumerateLegalMoves(
        position.board,
        position.inventories[position.activePlayer],
      )[0]
      const after = simulateLegalMove(position, move)
      if (after.result) throw new Error('partie terminée trop tôt')
      position = after.position
    }
    // position : blanc au trait, deux pièces blanches déjà posées.
    const target = enumerateLegalMoves(position.board, position.inventories.white)[0]
    const book = bookWith(position, target)
    expect(lookupOpeningMove(position, undefined, book)).toBeNull()
  })
})
