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
  if (before.rotation !== after.rotation) return 'rotate'
  if (before.flipped !== after.flipped) return 'flip'
  return null
}
