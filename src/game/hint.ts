import { chooseMoveForDifficulty } from './minimax'
import type { GamePosition } from './simulation'
import type { Difficulty, GameState, Point, Rotation, ShapeId } from './types'

/**
 * Force employée pour conseiller le joueur au trait.
 *
 * Le conseil ne joue pas au niveau de l'adversaire : un conseil calculé à la
 * force « débutant » proposerait un coup qu'on ne souhaite recommander à
 * personne. Il vise donc toujours la profondeur la plus grande, et c'est le
 * plafond adaptatif de `getAffordableDepth` — le même que celui du tour de
 * l'ordinateur, jamais un second mécanisme — qui la ramène à 2 tant que la
 * position reste large. Le pire cas tombe ainsi sous la seconde : profondeur 2
 * sur une ouverture à 95 coups légaux, profondeur 3 seulement en deçà de 24.
 */
export const HINT_DIFFICULTY: Difficulty = 'hard'

/**
 * Coup recommandé, décrit exactement comme la sélection d'un joueur humain :
 * une forme de sa réserve, son orientation et sa colonne d'ancrage. `cells`
 * porte les cases d'atterrissage calculées par `calculateDrop`, ce qui permet à
 * l'interface de montrer la position sans refaire la chute.
 */
export type Hint = {
  shapeId: ShapeId
  rotation: Rotation
  flipped: boolean
  column: number
  cells: Point[]
}

/**
 * Meilleur coup pour le joueur au trait, ou `null` s'il n'en a aucun.
 *
 * Fonction pure : la position reçue n'est jamais modifiée, la recherche
 * travaillant sur des copies. Deux appels sur une même position rendent donc le
 * même conseil.
 *
 * Départage : à score égal, le premier coup rencontré l'emporte. La recherche
 * ordonne les coups par l'heuristique avec un tri stable, et repart de
 * l'énumération de `legalMoves.ts` — formes dans l'ordre de `SHAPE_IDS`, puis
 * orientations uniques, puis colonnes de gauche à droite. Le conseil est donc
 * déterministe sans qu'aucun hasard ni aucune date n'entre dans le calcul.
 *
 * L'inventaire est respecté par construction : `enumerateLegalMoves` ignore
 * toute forme dont il ne reste aucun exemplaire.
 */
export function chooseHint(position: GamePosition): Hint | null {
  const decision = chooseMoveForDifficulty(position, HINT_DIFFICULTY)
  if (!decision) return null

  const { shapeId, orientation, column, cells } = decision.move
  return {
    shapeId,
    rotation: orientation.rotation,
    flipped: orientation.flipped,
    column,
    cells,
  }
}

/**
 * Vrai lorsque le joueur au trait peut demander un conseil.
 *
 * Le conseil s'adresse à un humain qui doit décider : il n'a pas de sens
 * pendant que l'ordinateur cherche son propre coup, ni une fois la partie
 * terminée.
 */
export function canOfferHint(
  state: Pick<GameState, 'phase' | 'activePlayer' | 'aiPlayer'>,
): boolean {
  return state.phase === 'playing' && state.activePlayer !== state.aiPlayer
}
