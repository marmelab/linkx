/**
 * Ce que ce test garde : la réactivation d'une IA endormie **remet sa série
 * d'échecs à zéro** et **ne touche pas à son Elo** (histoire 15). Sans la remise
 * à zéro, une IA réactivée après trois vagues muettes se rendormirait à son
 * premier échec de vague, sans jamais avoir eu sa chance.
 */
import { describe, expect, it } from 'vitest'
import {
  REQUESTABLE,
  checkTransition,
  isRequestable,
  statusMessage,
  statusUpdate,
} from './botStatus.ts'
import type { BotStatus } from './botStatus.ts'

const VIVANTS: readonly BotStatus[] = ['en_attente', 'active', 'sommeil']

describe('statuts qu’un auteur peut demander', () => {
  it('n’en reconnaît que deux', () => {
    expect(REQUESTABLE).toEqual(['retiree', 'en_attente'])
    expect(isRequestable('retiree')).toBe(true)
    expect(isRequestable('en_attente')).toBe(true)
    expect(isRequestable('active')).toBe(false)
    expect(isRequestable('sommeil')).toBe(false)
    expect(isRequestable('')).toBe(false)
  })
})

describe('transitions ouvertes', () => {
  it('laisse retirer une IA depuis n’importe quel état vivant', () => {
    for (const depuis of VIVANTS) {
      expect(checkTransition(depuis, 'retiree').ok).toBe(true)
    }
  })

  it('ne fait revenir aucune IA retirée', () => {
    expect(checkTransition('retiree', 'en_attente').ok).toBe(false)
    expect(checkTransition('retiree', 'retiree').ok).toBe(false)
  })

  it('réactive une IA en sommeil', () => {
    expect(checkTransition('sommeil', 'en_attente').ok).toBe(true)
  })

  /**
   * Sans cette porte, une IA qui ratait sa première qualification y restait à
   * jamais : `qualificationNeeded` n'en rouvre une que si la ligne a bougé, et
   * rien d'autre ne peut la faire bouger.
   */
  it('relance la qualification d’une IA en attente', () => {
    expect(checkTransition('en_attente', 'en_attente').ok).toBe(true)
  })

  it('ne relance rien sur une IA active', () => {
    expect(checkTransition('active', 'en_attente').ok).toBe(false)
  })

  it('nomme le motif de chaque refus', () => {
    const verdict = checkTransition('active', 'en_attente')
    expect(verdict.ok === false && verdict.message).toContain('joue déjà')
  })
})

describe('message rendu à l’auteur', () => {
  it('distingue la relance de la réactivation', () => {
    expect(statusMessage('en_attente', 'en_attente')).toContain('relancée')
    expect(statusMessage('sommeil', 'en_attente')).toContain('réactivée')
  })

  it('dit le retrait quel que soit l’état de départ', () => {
    for (const depuis of VIVANTS) {
      expect(statusMessage(depuis, 'retiree')).toContain('retirée')
    }
  })
})

describe('écriture d’une transition acceptée', () => {
  it('remet la série d’échecs à zéro à la réactivation comme à la relance', () => {
    expect(statusUpdate('en_attente')).toEqual({
      statut: 'en_attente',
      vagues_echouees_consecutives: 0,
    })
  })

  it('ne touche pas à la série au retrait', () => {
    expect(statusUpdate('retiree')).toEqual({ statut: 'retiree' })
  })

  it('ne touche jamais à l’Elo : il reste gelé à sa dernière valeur', () => {
    for (const statut of REQUESTABLE) {
      expect(Object.keys(statusUpdate(statut))).not.toContain('elo')
      expect(Object.keys(statusUpdate(statut))).not.toContain('parties_classees')
    }
  })
})
