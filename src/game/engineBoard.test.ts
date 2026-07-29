import { describe, expect, it } from 'vitest'
import { getLargestZone, hasWinningConnection } from './connectivity'
import {
  BLUE,
  WHITE,
  createEnginePosition,
  domainMoveKeys,
  generateLegalMoves,
  generateMoves,
  hasAnyMove,
  applyMove,
  largestZone,
  loadPosition,
  moveCellsKey,
  movePlacedWins,
  otherSide,
  remainingPlies,
  toLegalMove,
  undoMove,
  MAX_MOVES,
} from './engineBoard'
import { enumerateLegalMoves } from './legalMoves'
import { createGamePosition, simulateLegalMove } from './simulation'
import type { GamePosition } from './simulation'
import { BOARD_SIZE } from './types'

function randomForSeed(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

/** Aucune colonne ne contient de vide sous une case occupée. */
function hasHole(position: GamePosition): boolean {
  for (let x = 0; x < BOARD_SIZE; x += 1) {
    let sawEmpty = false
    for (let y = BOARD_SIZE - 1; y >= 0; y -= 1) {
      if (position.board[y][x] === null) sawEmpty = true
      else if (sawEmpty) return true
    }
  }
  return false
}

/**
 * Parcourt des parties aléatoires et compare, à chaque position, la
 * représentation compacte au domaine. C'est ce test qui autorise `engineBoard`
 * à générer les coups par un test de planéité au lieu de simuler la chute : si
 * une règle change, il échoue avant la recherche.
 */
describe('représentation compacte de la recherche', () => {
  it('énumère exactement les mêmes coups que le domaine', () => {
    const random = randomForSeed(20_260_729)
    const engine = createEnginePosition()
    let positionsChecked = 0

    for (let game = 0; game < 60; game += 1) {
      let position = createGamePosition(random() < 0.5 ? 'blue' : 'white')
      for (let ply = 0; ply < 30; ply += 1) {
        expect(hasHole(position)).toBe(false)

        loadPosition(engine, position)
        const fromEngine = generateLegalMoves(engine).map(moveCellsKey).sort()
        expect(fromEngine).toEqual(domainMoveKeys(position))
        positionsChecked += 1

        const moves = enumerateLegalMoves(
          position.board,
          position.inventories[position.activePlayer],
        )
        expect(hasAnyMove(engine, engine.side)).toBe(moves.length > 0)
        if (moves.length === 0) break

        const transition = simulateLegalMove(
          position,
          moves[Math.floor(random() * moves.length)],
        )
        if (transition.result) break
        position = transition.position
      }
    }

    expect(positionsChecked).toBeGreaterThan(500)
  })

  it('détecte la victoire et la plus grande zone comme le domaine', () => {
    const random = randomForSeed(4_242)
    const engine = createEnginePosition()

    for (let game = 0; game < 40; game += 1) {
      let position = createGamePosition('blue')
      for (let ply = 0; ply < 30; ply += 1) {
        loadPosition(engine, position)
        expect(largestZone(engine, BLUE)).toBe(getLargestZone(position.board, 'blue'))
        expect(largestZone(engine, WHITE)).toBe(getLargestZone(position.board, 'white'))

        const moves = enumerateLegalMoves(
          position.board,
          position.inventories[position.activePlayer],
        )
        if (moves.length === 0) break
        const chosen = moves[Math.floor(random() * moves.length)]

        // Le verdict de victoire du moteur compact doit valoir celui du domaine
        // pour *chaque* coup légal, pas seulement pour celui qui est joué.
        const buffer = new Int32Array(MAX_MOVES)
        const count = generateMoves(engine, buffer, 0)
        for (let i = 0; i < count; i += 1) {
          const compact = buffer[i]
          const asLegal = toLegalMove(compact)
          const mover = engine.side
          applyMove(engine, compact)
          const engineWins = movePlacedWins(engine, compact, mover)
          undoMove(engine, compact)

          const domain = simulateLegalMove(position, asLegal)
          expect(engineWins).toBe(
            hasWinningConnection(domain.position.board, position.activePlayer),
          )
        }

        const transition = simulateLegalMove(position, chosen)
        if (transition.result) break
        position = transition.position
      }
    }
  })

  it('restitue exactement la position après poser puis retirer', () => {
    const random = randomForSeed(77)
    const engine = createEnginePosition()
    let position = createGamePosition('blue')

    for (let ply = 0; ply < 12; ply += 1) {
      loadPosition(engine, position)
      const before = {
        board: Array.from(engine.board),
        top: Array.from(engine.top),
        inventory: Array.from(engine.inventory),
        side: engine.side,
        hashA: engine.hashA,
        hashB: engine.hashB,
      }

      const buffer = new Int32Array(MAX_MOVES)
      const count = generateMoves(engine, buffer, 0)
      for (let i = 0; i < count; i += 1) {
        applyMove(engine, buffer[i])
        undoMove(engine, buffer[i])
        expect(Array.from(engine.board)).toEqual(before.board)
        expect(Array.from(engine.top)).toEqual(before.top)
        expect(Array.from(engine.inventory)).toEqual(before.inventory)
        expect(engine.side).toBe(before.side)
        expect(engine.hashA).toBe(before.hashA)
        expect(engine.hashB).toBe(before.hashB)
      }

      const moves = enumerateLegalMoves(
        position.board,
        position.inventories[position.activePlayer],
      )
      if (moves.length === 0) break
      const transition = simulateLegalMove(
        position,
        moves[Math.floor(random() * moves.length)],
      )
      if (transition.result) break
      position = transition.position
    }
  })

  it('passe le trait en posant et compte les demi-coups restants', () => {
    const engine = loadPosition(createEnginePosition(), createGamePosition('blue'))
    expect(engine.side).toBe(BLUE)
    // Deux exemplaires de sept formes pour chacun des deux joueurs.
    expect(remainingPlies(engine)).toBe(28)

    const buffer = new Int32Array(MAX_MOVES)
    const count = generateMoves(engine, buffer, 0)
    expect(count).toBe(95)

    applyMove(engine, buffer[0])
    expect(engine.side).toBe(otherSide(BLUE))
    expect(remainingPlies(engine)).toBe(27)
  })
})
