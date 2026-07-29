import { describe, expect, it } from 'vitest'
import {
  MATE_THRESHOLD,
  chooseMasterMove,
  searchMasterTopMoves,
  evaluate,
} from './engineSearch'
import { createEnginePosition, loadPosition } from './engineBoard'
import { parseGameRecord } from './moveNotation'
import { chooseMoveForDifficulty } from './minimax'
import { createGamePosition, simulateLegalMove } from './simulation'
import type { GamePosition } from './simulation'
import { boardFromText } from './boardText'
import { createInitialInventory } from './pieces'
import { enumerateLegalMoves } from './legalMoves'
import type { Inventory, PlayerId } from './types'

/**
 * La partie que le maître a perdue avec l'ancienne recherche. Elle sert de
 * non-régression : c'est sur ces positions qu'il doit désormais voir clair.
 */
const LOST_GAME =
  '4Lsr21 4Ss3 3Ir11 3Ir11 4Ss3 3Ir13 3Ir14 3Lr13 4Tr26 4Tr36 4Lr17 4Lsr26 ' +
  '4Sr16 2r12 2r12 2r15 15 4Ls6 15 15 2r15 3L5 -- 12'
const TOKENS = LOST_GAME.split(/\s+/)

function positionAfter(moveCount: number): GamePosition {
  const parsed = parseGameRecord(TOKENS.slice(0, moveCount).join(' '))
  if (!parsed.ok) throw new Error('La partie de référence doit se rejouer.')
  const state = parsed.state
  return {
    board: state.board,
    inventories: state.inventories,
    activePlayer: state.activePlayer,
  }
}

describe('recherche du maître', () => {
  /**
   * Valeurs de jeu établies indépendamment, en remontant la partie perdue avec
   * un solveur exhaustif. La recherche doit les **retrouver**, et les annoncer
   * comme exactes plutôt que comme une estimation.
   */
  it.each([
    [21, 'white', 'loss'],
    [20, 'blue', 'win'],
    [19, 'white', 'loss'],
    [18, 'blue', 'win'],
    [17, 'white', 'loss'],
    [16, 'blue', 'win'],
  ] as const)(
    'résout exactement la position après %i coups (%s est %s)',
    (moveCount, expectedMover, verdict) => {
      const position = positionAfter(moveCount)
      expect(position.activePlayer).toBe(expectedMover)

      const decision = chooseMasterMove(position, { budgetMs: 20_000 })
      expect(decision).not.toBeNull()
      expect(decision!.exact).toBe(true)
      if (verdict === 'win') {
        expect(decision!.score).toBeGreaterThan(MATE_THRESHOLD)
      } else {
        expect(decision!.score).toBeLessThan(-MATE_THRESHOLD)
      }
    },
    30_000,
  )

  it('joue un coup qui gagne immédiatement', () => {
    // Bleu relie déjà sept colonnes sur la ligne du fond : un mono en colonne 8
    // referme la connexion gauche-droite.
    const board = boardFromText(`
      .........
      .........
      .........
      .........
      .........
      .........
      .........
      WWWWWWW..
      BBBBBBBB.
    `)
    const inventories: Record<PlayerId, Inventory> = {
      blue: createInitialInventory(),
      white: createInitialInventory(),
    }
    const position: GamePosition = { board, inventories, activePlayer: 'blue' }

    const decision = chooseMasterMove(position, { budgetMs: 2_000 })
    expect(decision).not.toBeNull()
    expect(decision!.score).toBeGreaterThan(MATE_THRESHOLD)

    const after = simulateLegalMove(position, decision!.move)
    expect(after.result?.winner).toBe('blue')
    expect(after.result?.reason).toBe('connection')
  })

  it('rend le même conseil deux fois quand il est borné aux nœuds', () => {
    const position = positionAfter(9)
    const first = chooseMasterMove(position, { maxNodes: 30_000 })
    const second = chooseMasterMove(position, { maxNodes: 30_000 })

    expect(first).not.toBeNull()
    expect(second!.score).toBe(first!.score)
    expect(second!.depth).toBe(first!.depth)
    expect(second!.nodes).toBe(first!.nodes)
    expect(second!.move.cells).toEqual(first!.move.cells)
    expect(second!.move.shapeId).toBe(first!.move.shapeId)
  })

  it('ne consulte jamais l’horloge quand il est borné aux nœuds', () => {
    let clockReads = 0
    const position = positionAfter(9)
    chooseMasterMove(position, {
      maxNodes: 20_000,
      now: () => {
        clockReads += 1
        return 0
      },
    })
    expect(clockReads).toBe(0)
  })

  it('respecte le budget de temps qu’on lui donne', () => {
    let clock = 0
    // Horloge injectée qui avance d'elle-même : la recherche doit s'arrêter
    // sans dépendre du temps réel de la machine de test.
    const decision = chooseMasterMove(positionAfter(0), {
      budgetMs: 1_000,
      now: () => {
        clock += 25
        return clock
      },
    })
    expect(decision).not.toBeNull()
    expect(decision!.depth).toBeGreaterThanOrEqual(1)
  })

  it('ne rend que des coups légaux, sur toute une partie contre lui-même', () => {
    let position = createGamePosition('blue')
    for (let ply = 0; ply < 30; ply += 1) {
      const legal = enumerateLegalMoves(
        position.board,
        position.inventories[position.activePlayer],
      )
      if (legal.length === 0) break

      const decision = chooseMasterMove(position, { maxNodes: 4_000 })
      expect(decision).not.toBeNull()
      const played = decision!.move
      expect(
        legal.some(
          (move) =>
            move.shapeId === played.shapeId &&
            move.column === played.column &&
            JSON.stringify(move.cells) === JSON.stringify(played.cells),
        ),
      ).toBe(true)

      const transition = simulateLegalMove(position, played)
      if (transition.result) break
      position = transition.position
    }
  })

  it('évalue une position vide comme équilibrée', () => {
    const engine = loadPosition(createEnginePosition(), createGamePosition('blue'))
    expect(evaluate(engine)).toBe(0)
  })

  /**
   * La variante principale sert au livre d'ouverture, qui y récolte des coups
   * sans les rechercher. Elle doit donc être une suite **rejouable par le
   * domaine** : c'est ce qui autorise à écrire ses positions dans le livre.
   */
  it('rend une variante principale rejouable, partant du coup choisi', () => {
    for (const moveCount of [0, 6, 12]) {
      const position = moveCount === 0 ? createGamePosition('blue') : positionAfter(moveCount)
      const search = searchMasterTopMoves(position, { maxNodes: 40_000 })
      expect(search).not.toBeNull()

      const pv = search!.pv
      expect(pv.length).toBeGreaterThan(0)
      expect(pv.length).toBeLessThanOrEqual(Math.max(search!.depth, 1))
      expect(pv[0].cells).toEqual(search!.moves[0].cells)

      let cursor = position
      for (const [index, move] of pv.entries()) {
        const legal = enumerateLegalMoves(cursor.board, cursor.inventories[cursor.activePlayer])
        expect(
          legal.some(
            (candidate) =>
              candidate.cells.length === move.cells.length &&
              candidate.cells.every((cell, i) => cell.x === move.cells[i].x && cell.y === move.cells[i].y),
          ),
        ).toBe(true)
        const transition = simulateLegalMove(cursor, move)
        if (transition.result) {
          expect(index).toBe(pv.length - 1)
          break
        }
        cursor = transition.position
      }
    }
  })

  it('est atteignable par le niveau, sans profondeur transmise', () => {
    const position = positionAfter(18)
    const decision = chooseMoveForDifficulty(position, 'master')
    expect(decision).not.toBeNull()
    // Position gagnée pour bleu : le niveau doit la voir gagnée.
    expect(decision!.score).toBeGreaterThan(MATE_THRESHOLD)
  })
})
