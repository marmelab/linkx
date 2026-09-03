import { describe, expect, it } from 'vitest'
import { enumerateLegalMoves } from '../../../src/game/legalMoves.ts'
import {
  parseGameRecord,
  serializeGameRecord,
} from '../../../src/game/moveNotation.ts'
import {
  LIBELLE_PLATEAU_VIDE,
  OUVERTURES,
  libelleOuverture,
} from './ouvertures.ts'

describe('jeu de débuts canoniques', () => {
  it('en compte une quinzaine, toutes distinctes', () => {
    expect(OUVERTURES.length).toBeGreaterThanOrEqual(14)
    const notations = OUVERTURES.map((ouverture) => ouverture.notation)
    expect(new Set(notations).size).toBe(notations.length)
    const libelles = OUVERTURES.map((ouverture) => ouverture.libelle)
    expect(new Set(libelles).size).toBe(libelles.length)
  })

  it('varie les formes et les colonnes', () => {
    const formes = new Set(
      OUVERTURES.map((ouverture) => /^\d[ILST]?/.exec(ouverture.notation)?.[0]),
    )
    expect(formes.size).toBeGreaterThanOrEqual(6)
    const colonnes = new Set(
      OUVERTURES.map((ouverture) => ouverture.notation.slice(0, 1)),
    )
    expect(colonnes.size).toBeGreaterThanOrEqual(4)
  })

  it('ne dépasse jamais deux demi-coups', () => {
    for (const { notation } of OUVERTURES) {
      expect(notation.split(' ').length).toBeLessThanOrEqual(2)
    }
  })

  for (const { notation, libelle } of OUVERTURES) {
    it(`« ${libelle} » (${notation}) est légale, canonique et jouable`, () => {
      const parsed = parseGameRecord(notation)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const etat = parsed.state
      expect(serializeGameRecord(etat)).toBe(notation)
      expect(etat.phase).toBe('playing')
      expect(etat.result).toBeNull()
      expect(
        enumerateLegalMoves(etat.board, etat.inventories[etat.activePlayer]).length,
      ).toBeGreaterThan(0)
    })
  }
})

describe('libellé d’une ouverture', () => {
  it('nomme le plateau vide', () => {
    expect(libelleOuverture('')).toBe(LIBELLE_PLATEAU_VIDE)
  })

  it('retrouve le libellé d’une ouverture imposée', () => {
    expect(libelleOuverture(OUVERTURES[0].notation)).toBe(OUVERTURES[0].libelle)
  })

  it('retombe sur la notation pour une ouverture inconnue', () => {
    expect(libelleOuverture('3Ir19')).toBe('3Ir19')
  })
})
