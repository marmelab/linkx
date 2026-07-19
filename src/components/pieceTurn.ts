import type { Selection } from '../game/types'

export type TurnKind = 'rotate' | 'flip'

/**
 * Le mouvement se déduit de la seule différence entre deux sélections. Changer
 * d'exemplaire n'en est pas un : la pièce est remplacée, pas manipulée, et elle
 * arrive donc telle quelle.
 */
export function getTurnKind(
  before: Selection,
  after: Selection,
): TurnKind | null {
  if (before.shapeId !== after.shapeId || before.copy !== after.copy) return null
  // Un retournement change aussi la rotation, jamais l'inverse : il se
  // reconnaît donc au seul changement de `flipped`, testé en premier.
  if (before.flipped !== after.flipped) return 'flip'
  if (before.rotation !== after.rotation) return 'rotate'
  return null
}
