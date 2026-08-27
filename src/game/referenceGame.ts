import { parseGameRecord } from './moveNotation'
import type { GamePosition } from './simulation'

/**
 * La partie que le maître a perdue avec l'ancienne recherche.
 *
 * Source **unique** de la partie de référence, partagée par `engineSearch.test.ts`
 * — où elle sert de non-régression : c'est sur ces positions que le moteur doit
 * désormais voir clair — et par `scripts/bench-moteur.ts`, qui y mesure le coût
 * de chaque palier de recherche.
 *
 * Elle doit être **figée**. Une partie rejouée par le moteur lui-même dériverait
 * à chaque modification de l'évaluation, et deux versions du moteur ne se
 * mesureraient plus sur les mêmes positions.
 */
export const REFERENCE_GAME =
  '4Lsr21 4Ss3 3Ir11 3Ir11 4Ss3 3Ir13 3Ir14 3Lr13 4Tr26 4Tr36 4Lr17 4Lsr26 ' +
  '4Sr16 2r12 2r12 2r15 15 4Ls6 15 15 2r15 3L5 -- 12'

const TOKENS = REFERENCE_GAME.split(/\s+/)

/** Nombre d'entrées d'historique de la partie de référence, passe comprise. */
export const REFERENCE_GAME_LENGTH = TOKENS.length

/** La position après `moveCount` entrées de la partie de référence. */
export function referencePositionAfter(moveCount: number): GamePosition {
  const parsed = parseGameRecord(TOKENS.slice(0, moveCount).join(' '))
  if (!parsed.ok) throw new Error('La partie de référence doit se rejouer.')
  const state = parsed.state
  return {
    board: state.board,
    inventories: state.inventories,
    activePlayer: state.activePlayer,
  }
}
