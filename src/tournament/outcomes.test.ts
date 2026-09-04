import { describe, expect, it } from 'vitest'
import { describeOutcome, outcomeKind, STATUS_LABELS } from './outcomes'
import type { OutcomeInput } from './outcomes'
import type { EndReason, GameResult, RefusalReason } from './types'

const game = (overrides: Partial<OutcomeInput> = {}): OutcomeInput => ({
  finished: true,
  result: 'blue' as GameResult,
  reason: 'connection' as EndReason,
  refusal: null,
  moveCount: 20,
  color: 'blue',
  ...overrides,
})

describe('issue d’une partie, en toutes lettres', () => {
  it('nomme une victoire par connexion', () => {
    expect(describeOutcome(game())).toBe('gagné par connexion')
  })

  it('nomme une défaite par connexion', () => {
    expect(describeOutcome(game({ color: 'white' }))).toBe('perdu par connexion')
  })

  it('distingue les deux côtés d’un blocage', () => {
    expect(describeOutcome(game({ reason: 'stalemate' }))).toBe(
      'gagné par blocage, à la plus grande zone',
    )
    expect(describeOutcome(game({ reason: 'stalemate', color: 'white' }))).toBe(
      'perdu par blocage, à la plus petite zone',
    )
  })

  it('nomme un nul par blocage', () => {
    expect(describeOutcome(game({ result: 'draw', reason: 'draw' }))).toBe(
      'nul par blocage, zones égales',
    )
  })

  it('nomme la partie close à la fin de la vague', () => {
    expect(
      describeOutcome(game({ result: 'draw', reason: 'interrupted' })),
    ).toBe('nul technique — vague terminée')
  })

  /**
   * `resultat` et `motif_fin` sont deux colonnes indépendantes de `parties` :
   * rien n'interdit un nul portant un motif technique. Testé avant, la branche
   * technique l'annonçait « perdu — hors délai », sur une ligne que le filtre
   * « Issue = nulle » venait pourtant de retenir.
   */
  it('reste un nul quand le motif est technique', () => {
    expect(
      describeOutcome(game({ result: 'draw', reason: 'timeout', moveCount: 13 })),
    ).toBe('nul technique — hors délai au coup 14')
  })

  it('situe un hors-délai au coup suivant le dernier joué', () => {
    expect(
      describeOutcome(
        game({ result: 'white', reason: 'timeout', moveCount: 13 }),
      ),
    ).toBe('perdu — hors délai au coup 14')
  })

  it('nomme le refus exact d’un coup illégal', () => {
    expect(
      describeOutcome(
        game({
          result: 'white',
          reason: 'illegal',
          refusal: 'unsupported' as RefusalReason,
          moveCount: 8,
        }),
      ),
    ).toBe('perdu — coup illégal au coup 9, support insuffisant')
  })

  it('attribue la faute à l’adversaire quand c’est lui qui la commet', () => {
    expect(
      describeOutcome(game({ reason: 'timeout', moveCount: 13 })),
    ).toBe('gagné — hors délai de l’adversaire au coup 14')
  })

  it('écrit « en cours » tant que la partie n’est pas terminée', () => {
    const running = game({ finished: false, result: null, reason: null })
    expect(outcomeKind(running)).toBe('en_cours')
    expect(describeOutcome(running)).toBe('en cours')
  })
})

describe('états d’une IA', () => {
  it('donne un mot à chacun, jamais une couleur seule', () => {
    expect(STATUS_LABELS.active).toBe('active')
    expect(STATUS_LABELS.sommeil).toBe('en sommeil')
    expect(STATUS_LABELS.en_attente).toBe('en qualification')
    expect(STATUS_LABELS.retiree).toBe('retirée')
  })
})
