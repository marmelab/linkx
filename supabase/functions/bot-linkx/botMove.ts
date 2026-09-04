/**
 * Choix du coup de l'IA de la maison, depuis la notation d'une partie.
 *
 * Aucune règle n'est réécrite ici : la position vient de `parseGameRecord`, le
 * coup de `chooseMoveForDifficulty` au niveau `master` — livre d'ouverture
 * compris —, et le contrôle final rejoue le coup par le même analyseur que
 * l'arbitre. Ce module ne connaît ni HTTP ni signature.
 */
import { chooseMoveForDifficulty } from '../../../src/game/minimax.ts'
import { parseGameRecord, serializeMove } from '../../../src/game/moveNotation.ts'
import type { NotationError } from '../../../src/game/moveNotation.ts'
import type { GamePosition } from '../../../src/game/simulation.ts'
import type { PlayerId } from '../../../src/game/types.ts'

export type BotMoveFailure =
  | { failure: 'notation'; error: NotationError }
  | { failure: 'finished' }
  | { failure: 'wrong-color'; expected: PlayerId }
  | { failure: 'no-move' }
  | { failure: 'self-illegal'; token: string; error: NotationError }

export type BotMoveResult =
  | { ok: true; move: string; activePlayer: PlayerId; exploredNodes: number }
  | ({ ok: false } & BotMoveFailure)

/**
 * `chooseMoveForDifficulty` rend un `LegalMove`, porteur d'une `Orientation` ;
 * la notation attend un `RecordedMove`. La conversion passe par `rotation` et
 * `flipped` de l'orientation, exactement comme `src/game/hint.ts`.
 */
export function chooseBotMove(
  record: string,
  color: PlayerId | null,
  budgetMs: number,
  random: () => number = Math.random,
): BotMoveResult {
  const replayed = parseGameRecord(record)
  if (!replayed.ok) return { ok: false, failure: 'notation', error: replayed.error }

  const state = replayed.state
  if (state.phase !== 'playing') return { ok: false, failure: 'finished' }
  if (color && color !== state.activePlayer) {
    return { ok: false, failure: 'wrong-color', expected: state.activePlayer }
  }

  const position: GamePosition = {
    board: state.board,
    inventories: state.inventories,
    activePlayer: state.activePlayer,
  }
  // Le troisième argument n'est pas décoratif : sans tirage, `budgetMs` est
  // ignoré et la recherche bascule sur un plafond de nœuds (`minimax.ts`).
  const decision = chooseMoveForDifficulty(position, 'master', random, budgetMs)
  if (!decision) return { ok: false, failure: 'no-move' }

  const { shapeId, orientation, column } = decision.move
  const move = serializeMove({
    shapeId,
    rotation: orientation.rotation,
    flipped: orientation.flipped,
    column,
  })

  const verified = parseGameRecord(`${record.trim()} ${move}`.trim())
  if (!verified.ok) {
    return { ok: false, failure: 'self-illegal', token: move, error: verified.error }
  }

  return {
    ok: true,
    move,
    activePlayer: state.activePlayer,
    exploredNodes: decision.exploredNodes,
  }
}
