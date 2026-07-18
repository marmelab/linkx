import { describe, expect, it } from 'vitest'
import { enumerateLegalMoves } from './legalMoves'
import { chooseMinimaxMove } from './minimax'
import { createGamePosition, simulateLegalMove } from './simulation'
import type { GamePosition } from './simulation'
import type { GameResult, PlayerId } from './types'

/**
 * Duel entre deux profondeurs de recherche. Une partie complète à profondeur 3
 * demande plusieurs secondes : la suite entière dure une trentaine de secondes,
 * hors budget de `npm test`. Elle ne s'exécute donc que sur demande :
 *
 * ```bash
 * LINKX_DEPTH_DUEL=1 npx vitest run src/game/depthDuel.test.ts
 * ```
 */
const ENABLED = process.env.LINKX_DEPTH_DUEL === '1'

/** Poses aléatoires d'ouverture : elles écartent les parties d'une même racine. */
const OPENING_PLIES = 8
const OPENINGS = 8

function randomForSeed(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

function openingPosition(seed: number): GamePosition | null {
  const random = randomForSeed(seed)
  let position = createGamePosition('blue')
  for (let ply = 0; ply < OPENING_PLIES; ply += 1) {
    const moves = enumerateLegalMoves(
      position.board,
      position.inventories[position.activePlayer],
    )
    if (moves.length === 0) return null
    const transition = simulateLegalMove(
      position,
      moves[Math.floor(random() * moves.length)],
    )
    if (transition.result) return null
    position = transition.position
  }
  return position
}

function playGame(
  start: GamePosition,
  depths: Record<PlayerId, number>,
): GameResult {
  let position = start
  for (let turn = 0; turn < 60; turn += 1) {
    const decision = chooseMinimaxMove(position, {
      depth: depths[position.activePlayer],
    })
    if (!decision) throw new Error('Le joueur actif devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, decision.move)
    if (transition.result) return transition.result
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

describe.skipIf(!ENABLED)('duel entre profondeurs', () => {
  it(
    'la profondeur 3 gagne plus souvent que la profondeur 2',
    () => {
      let deepWins = 0
      let shallowWins = 0
      let draws = 0

      for (let opening = 1; opening <= OPENINGS; opening += 1) {
        const start = openingPosition(9_000 + opening * 53)
        if (!start) continue
        // Chaque ouverture est jouée deux fois, les couleurs échangées : le
        // trait ne peut pas expliquer à lui seul le résultat.
        for (const deepPlayer of ['blue', 'white'] as PlayerId[]) {
          const result = playGame(start, {
            blue: deepPlayer === 'blue' ? 3 : 2,
            white: deepPlayer === 'white' ? 3 : 2,
          })
          if (result.winner === deepPlayer) deepWins += 1
          else if (result.winner === null) draws += 1
          else shallowWins += 1
        }
      }

      // Mesure de référence sur ces mêmes ouvertures : 11 victoires, 4 défaites
      // et 1 nulle en 30 s. La marge est nette sans être écrasante, l'avantage
      // d'un demi-coup d'anticipation restant modeste devant le bruit de
      // l'heuristique.
      expect(deepWins).toBeGreaterThan(shallowWins)
      expect(deepWins + shallowWins + draws).toBe(OPENINGS * 2)
    },
    120_000,
  )
})
