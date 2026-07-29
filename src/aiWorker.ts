import { chooseMoveForDifficulty } from './game/minimax'
import type { GamePosition } from './game/simulation'
import type { Difficulty, Rotation, ShapeId } from './game/types'

/**
 * Tour de l'ordinateur, hors du fil principal.
 *
 * La recherche du maître se compte en secondes : la laisser sur le fil
 * principal reviendrait à figer l'écran d'autant, et c'est ce plafond — et non
 * l'algorithme — qui limitait sa force. Ici l'attente ne bloque plus rien, donc
 * le budget peut franchir le seuil au-delà duquel le niveau domine vraiment.
 *
 * Le worker ne porte **aucune règle** : il ne fait qu'appeler l'entrée unique du
 * domaine, `chooseMoveForDifficulty`. `App.tsx` garde le même appel en repli, si
 * bien qu'un worker indisponible dégrade la force sans casser la partie.
 *
 * Une `GamePosition` est faite d'objets simples : elle traverse `postMessage`
 * telle quelle, sans sérialisation à écrire ni à maintenir.
 */

export type AiRequest = {
  /** Repris tel quel dans la réponse : `App.tsx` écarte une réponse périmée. */
  id: number
  position: GamePosition
  difficulty: Difficulty
  budgetMs?: number
}

export type AiMove = {
  shapeId: ShapeId
  rotation: Rotation
  flipped: boolean
  column: number
}

export type AiResponse = { id: number; move: AiMove | null }

self.addEventListener('message', (event: MessageEvent<AiRequest>) => {
  const { id, position, difficulty, budgetMs } = event.data
  let move: AiMove | null = null
  try {
    const decision = chooseMoveForDifficulty(position, difficulty, Math.random, budgetMs)
    if (decision) {
      move = {
        shapeId: decision.move.shapeId,
        rotation: decision.move.orientation.rotation,
        flipped: decision.move.orientation.flipped,
        column: decision.move.column,
      }
    }
  } catch (error) {
    // Une recherche qui échoue ne doit pas laisser la partie sans réponse :
    // `App.tsx` retombe alors sur la recherche synchrone.
    console.error('Recherche du coup de l’ordinateur impossible.', error)
  }
  const response: AiResponse = { id, move }
  self.postMessage(response)
})
