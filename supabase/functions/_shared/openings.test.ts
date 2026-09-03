import { describe, expect, it } from 'vitest'
import { enumerateLegalMoves } from '../../../src/game/legalMoves.ts'
import {
  parseGameRecord,
  serializeGameRecord,
} from '../../../src/game/moveNotation.ts'
import { EMPTY_BOARD_LABEL, OPENINGS, openingLabel } from './openings.ts'

describe('jeu de débuts canoniques', () => {
  it('en compte une quinzaine, toutes distinctes', () => {
    expect(OPENINGS.length).toBeGreaterThanOrEqual(14)
    const notations = OPENINGS.map((opening) => opening.notation)
    expect(new Set(notations).size).toBe(notations.length)
    const labels = OPENINGS.map((opening) => opening.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('varie les formes et les colonnes', () => {
    const shapes = new Set(
      OPENINGS.map((opening) => /^\d[ILST]?/.exec(opening.notation)?.[0]),
    )
    expect(shapes.size).toBeGreaterThanOrEqual(6)
    const columns = new Set(
      OPENINGS.map((opening) => opening.notation.slice(0, 1)),
    )
    expect(columns.size).toBeGreaterThanOrEqual(4)
  })

  it('ne dépasse jamais deux demi-coups', () => {
    for (const { notation } of OPENINGS) {
      expect(notation.split(' ').length).toBeLessThanOrEqual(2)
    }
  })

  for (const { notation, label } of OPENINGS) {
    it(`« ${label} » (${notation}) est légale, canonique et jouable`, () => {
      const parsed = parseGameRecord(notation)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const state = parsed.state
      expect(serializeGameRecord(state)).toBe(notation)
      expect(state.phase).toBe('playing')
      expect(state.result).toBeNull()
      expect(
        enumerateLegalMoves(state.board, state.inventories[state.activePlayer])
          .length,
      ).toBeGreaterThan(0)
    })
  }
})

describe('libellé d’une ouverture', () => {
  it('nomme le plateau vide', () => {
    expect(openingLabel('')).toBe(EMPTY_BOARD_LABEL)
  })

  it('retrouve le libellé d’une ouverture imposée', () => {
    expect(openingLabel(OPENINGS[0].notation)).toBe(OPENINGS[0].label)
  })

  it('retombe sur la notation pour une ouverture inconnue', () => {
    expect(openingLabel('3Ir19')).toBe('3Ir19')
  })
})
