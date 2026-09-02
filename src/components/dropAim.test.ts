import { describe, expect, it } from 'vitest'
import { columnAtX } from './dropAim'

// Bande de 90 pixels alignée sur le damier : une colonne fait dix pixels.
const BAND = { left: 100, right: 190 }

const columnAt = (clientX: number) => columnAtX(BAND.left, BAND.right, clientX)

describe('colonne visée sous le doigt', () => {
  it('découpe la bande en neuf colonnes égales', () => {
    expect(columnAt(105)).toBe(0)
    expect(columnAt(145)).toBe(4)
    expect(columnAt(185)).toBe(8)
  })

  it('place la frontière exactement entre deux colonnes', () => {
    expect(columnAt(109.9)).toBe(0)
    expect(columnAt(110)).toBe(1)
  })

  it('retient le doigt qui sort de la bande sur la colonne de bord', () => {
    expect(columnAt(-40)).toBe(0)
    expect(columnAt(1000)).toBe(8)
  })
})
