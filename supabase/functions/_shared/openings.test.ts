import { describe, expect, it } from 'vitest'
import {
  MATE_THRESHOLD,
  searchMasterTopMoves,
} from '../../../src/game/engineSearch.ts'
import { enumerateLegalMoves } from '../../../src/game/legalMoves.ts'
import {
  parseGameRecord,
  serializeGameRecord,
} from '../../../src/game/moveNotation.ts'
import { EMPTY_BOARD_LABEL, OPENINGS, openingLabel } from './openings.ts'

/**
 * Profondeur et plafond de nœuds du contrôle « pas déjà décidée ». Le plafond
 * fait de la recherche une fonction **déterministe** de la position — l'horloge
 * n'est jamais lue —, donc ce test ne peut pas dépendre de la machine ; et à ce
 * palier il ne mord pas, la recherche s'arrêtant sur la profondeur.
 */
const CONTROL_DEPTH = 4
const CONTROL_NODES = 200_000

describe('jeu de débuts canoniques', () => {
  it('en compte seize, toutes distinctes', () => {
    expect(OPENINGS.length).toBe(16)
    const notations = OPENINGS.map((opening) => opening.notation)
    expect(new Set(notations).size).toBe(notations.length)
    const labels = OPENINGS.map((opening) => opening.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('varie les formes et les colonnes', () => {
    // Six formes seulement peuvent ouvrir : le S n'a aucune orientation à base
    // plate, il ne tient donc pas sur un plateau vide.
    const shapes = OPENINGS.map(
      (opening) => /^\d[ILST]?/.exec(opening.notation)?.[0],
    )
    expect(new Set(shapes).size).toBeGreaterThanOrEqual(5)
    // La colonne d'ancrage est le **dernier** caractère du premier coup.
    const columns = OPENINGS.map((opening) =>
      opening.notation.split(' ')[0].slice(-1),
    )
    expect(new Set(columns).size).toBeGreaterThanOrEqual(6)

    // Règle de diversité de `scripts/choisir-ouvertures.ts` : ni une forme ni
    // une colonne ne prend plus du quart de la liste.
    const quota = Math.ceil(OPENINGS.length / 4)
    for (const group of [shapes, columns]) {
      for (const value of new Set(group)) {
        expect(group.filter((other) => other === value).length).toBeLessThanOrEqual(quota)
      }
    }
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

  /**
   * Le vrai défaut d'une ouverture imposée n'est pas d'être illégale, c'est
   * d'être **déjà décidée** : les deux camps y jouent la même fin forcée et la
   * partie ne mesure plus rien. `scripts/choisir-ouvertures.ts` l'écarte à
   * profondeur 6 ; on le revérifie ici à un palier abordable, qui suffit à
   * attraper une notation recopiée de travers ou une liste écrite à la main.
   */
  it('n’impose aucune position déjà décidée', () => {
    for (const { notation, label } of OPENINGS) {
      const parsed = parseGameRecord(notation)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return

      const { board, inventories, activePlayer } = parsed.state
      const search = searchMasterTopMoves(
        { board, inventories, activePlayer },
        {
          maxDepth: CONTROL_DEPTH,
          maxNodes: CONTROL_NODES,
          allowOddDepth: true,
        },
      )
      expect(search, label).not.toBeNull()
      if (!search) return
      // Ni gain ni perte forcés pour le camp au trait, et donc aucune valeur de
      // jeu prouvée : la partie reste entièrement à jouer.
      expect(Math.abs(search.score), label).toBeLessThan(MATE_THRESHOLD)
      expect(search.exact, label).toBe(false)
    }
  }, 20_000)
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
