import { describe, expect, it } from 'vitest'
import { getTurnKind } from './pieceTurn'
import type { Selection } from '../game/types'

const base: Selection = { shapeId: 'largeL', copy: 0, rotation: 0, flipped: false }

describe('mouvement de la pièce sélectionnée', () => {
  it('anime une rotation', () => {
    expect(getTurnKind(base, { ...base, rotation: 1 })).toBe('rotate')
  })

  it('anime un retournement', () => {
    expect(getTurnKind(base, { ...base, flipped: true })).toBe('flip')
  })

  // Un retournement inverse aussi la rotation ; seule une rotation seule tourne.
  it('anime un retournement qui a changé la rotation', () => {
    const turned = { ...base, rotation: 1 } as const
    expect(getTurnKind(turned, { ...turned, rotation: 3, flipped: true })).toBe('flip')
  })

  // Prendre une autre pièce n'est pas un mouvement : rien à faire tourner, la
  // silhouette d'arrivée n'a aucune parenté avec celle qu'elle remplace.
  it('n’anime pas un changement de forme', () => {
    expect(getTurnKind(base, { ...base, shapeId: 's', rotation: 1 })).toBeNull()
  })

  it('n’anime pas un changement d’exemplaire', () => {
    expect(getTurnKind(base, { ...base, copy: 1 })).toBeNull()
  })

  it('n’anime rien quand la sélection est inchangée', () => {
    expect(getTurnKind(base, { ...base })).toBeNull()
  })
})
