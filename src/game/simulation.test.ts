import { describe, expect, it } from 'vitest'
import { boardFromText, boardToText } from './boardText.ts'
import { enumerateLegalMoves } from './legalMoves.ts'
import type { LegalMove } from './legalMoves.ts'
import { createInitialInventory } from './pieces.ts'
import { createInitialState, gameReducer } from './reducer.ts'
import { createGamePosition, simulateLegalMove } from './simulation.ts'
import type { GamePosition } from './simulation.ts'
import { getUniqueOrientations } from './transforms.ts'
import { BOARD_SIZE, SHAPE_IDS } from './types.ts'
import type { GameState, Inventory, PlayedCopies, PlayerId } from './types.ts'

const EMPTY_BOARD = `
  .........
  .........
  .........
  .........
  .........
  .........
  .........
  .........
  .........
`

/** Colonnes de hauteurs variées : puits profond, surplombs et colonnes pleines. */
const MIXED_BOARD = `
  .........
  .........
  .........
  .........
  ..B......
  ..BB.....
  ..BB..W..
  WWBB..WW.
  WWBBB.WWW
`

function inventoryOf(counts: Partial<Inventory>): Inventory {
  return {
    mono: 0,
    domino: 0,
    bar3: 0,
    smallL: 0,
    s: 0,
    t: 0,
    largeL: 0,
    ...counts,
  }
}

function positionFromText(
  source: string,
  activePlayer: PlayerId,
  inventories: Record<PlayerId, Inventory>,
): GamePosition {
  return {
    board: boardFromText(source, { groupOrthogonalComponents: true }),
    inventories,
    activePlayer,
  }
}

/** Exemplaires joués déduits de la réserve : 2 → aucun, 1 → le premier, 0 → les deux. */
function playedCopiesFor(inventory: Inventory): PlayedCopies {
  return Object.fromEntries(
    SHAPE_IDS.map((shapeId) => [
      shapeId,
      [inventory[shapeId] < 2, inventory[shapeId] < 1],
    ]),
  ) as PlayedCopies
}

/** La même position vue par le vrai reducer, l'ordinateur tenant le joueur actif. */
function stateFromPosition(position: GamePosition): GameState {
  return {
    ...createInitialState(),
    phase: 'playing',
    mode: 'ai',
    aiPlayer: position.activePlayer,
    board: position.board.map((row) => [...row]),
    inventories: structuredClone(position.inventories),
    playedCopies: {
      blue: playedCopiesFor(position.inventories.blue),
      white: playedCopiesFor(position.inventories.white),
    },
    activePlayer: position.activePlayer,
  }
}

function moveKey(move: {
  shapeId: string
  orientation: { rotation: number; flipped: boolean }
  column: number
}): string {
  return [
    move.shapeId,
    move.orientation.rotation,
    move.orientation.flipped,
    move.column,
  ].join(':')
}

describe('simulation d’une position', () => {
  it('refuse de rejouer une forme dont la réserve est vide', () => {
    const position = positionFromText(EMPTY_BOARD, 'blue', {
      blue: inventoryOf({ mono: 1 }),
      white: createInitialInventory(),
    })
    const [move] = enumerateLegalMoves(position.board, position.inventories.blue)

    const after = simulateLegalMove(position, move).position
    expect(after.inventories.blue.mono).toBe(0)
    expect(enumerateLegalMoves(after.board, after.inventories.blue)).toEqual([])
    expect(() =>
      simulateLegalMove({ ...after, activePlayer: 'blue' }, move),
    ).toThrow(/plus disponible/)
  })

  it('n’altère ni le plateau ni les réserves de la position parente', () => {
    const position = createGamePosition('blue')
    const board = boardToText(position.board)
    const inventories = structuredClone(position.inventories)

    for (const move of enumerateLegalMoves(
      position.board,
      position.inventories.blue,
    )) {
      simulateLegalMove(position, move)
    }

    // Chaque branche repart donc d'une réserve intacte : le retour arrière du
    // Minimax n'a rien à restaurer.
    expect(boardToText(position.board)).toBe(board)
    expect(position.inventories).toEqual(inventories)
  })

  it('propage le décrément de réserve le long d’une ligne de jeu', () => {
    let position = createGamePosition('blue')
    const remaining: number[] = []

    for (const column of [0, 3, 6, 0]) {
      const player = position.activePlayer
      const move = enumerateLegalMoves(
        position.board,
        position.inventories[player],
      ).find(
        (candidate) =>
          candidate.shapeId === 'bar3' &&
          candidate.orientation.rotation === 0 &&
          candidate.column === column,
      )
      expect(move).toBeDefined()
      if (!move) return

      const transition = simulateLegalMove(position, move)
      expect(transition.result).toBeNull()
      position = transition.position
      remaining.push(position.inventories[player].bar3)
    }

    // Bleu, blanc, bleu, blanc : chaque joueur épuise ses deux barres.
    expect(remaining).toEqual([1, 1, 0, 0])
    expect(position.inventories.blue.bar3).toBe(0)
    expect(position.inventories.white.bar3).toBe(0)
    // Les autres formes des deux réserves restent intactes.
    expect(position.inventories.blue.mono).toBe(2)
    expect(position.inventories.white.mono).toBe(2)
    expect(
      enumerateLegalMoves(position.board, position.inventories.blue).some(
        (move) => move.shapeId === 'bar3',
      ),
    ).toBe(false)
  })
})

describe('cohérence entre la simulation et le reducer', () => {
  it.each([
    {
      name: 'réserves partiellement épuisées',
      source: MIXED_BOARD,
      inventories: {
        blue: createInitialInventory(),
        white: inventoryOf({ domino: 1, bar3: 2, s: 2, t: 1, largeL: 2 }),
      },
      nextPlayer: 'blue' as PlayerId,
    },
    {
      // Bleu n'a plus rien à poser : son tour est passé et blanc rejoue.
      name: 'adversaire sans coup légal',
      source: MIXED_BOARD,
      inventories: {
        blue: inventoryOf({}),
        white: inventoryOf({ mono: 1, smallL: 2, largeL: 1 }),
      },
      nextPlayer: 'white' as PlayerId,
    },
  ])('énumère exactement les coups acceptés par le reducer ($name)', ({
    source,
    inventories,
    nextPlayer,
  }) => {
    const position = positionFromText(source, 'white', inventories)
    const state = stateFromPosition(position)
    const moves = enumerateLegalMoves(
      position.board,
      position.inventories.white,
    )
    const movesByKey = new Map<string, LegalMove>(
      moves.map((move) => [moveKey(move), move]),
    )
    expect(moves.length).toBeGreaterThan(0)

    let compared = 0
    for (const shapeId of SHAPE_IDS) {
      for (const orientation of getUniqueOrientations(shapeId)) {
        for (let column = 0; column < BOARD_SIZE; column += 1) {
          const key = moveKey({ shapeId, orientation, column })
          const next = gameReducer(state, {
            type: 'PLAY_AI_MOVE',
            shapeId,
            rotation: orientation.rotation,
            flipped: orientation.flipped,
            column,
          })
          const accepted = next.board !== state.board

          expect([key, accepted]).toEqual([key, movesByKey.has(key)])
          const move = movesByKey.get(key)
          if (!move) continue

          const transition = simulateLegalMove(position, move)
          expect(boardToText(next.board)).toBe(
            boardToText(transition.position.board),
          )
          expect(next.inventories).toEqual(transition.position.inventories)
          expect(next.activePlayer).toBe(transition.position.activePlayer)
          expect(next.result).toEqual(transition.result)
          if (!transition.result) {
            expect(transition.position.activePlayer).toBe(nextPlayer)
          }
          compared += 1
        }
      }
    }

    expect(compared).toBe(moves.length)
  })
})
