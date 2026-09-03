import { describe, expect, it } from 'vitest'
import {
  SLEEP_WAVES,
  closeWave,
  gamesToRequeue,
  planWaveOpening,
  qualificationNeeded,
  qualificationVerdict,
} from './wavePlan.ts'
import type { BotBefore, BotRow, WaveGameRecord } from './wavePlan.ts'
import { INITIAL_RATING } from './elo.ts'
import { closeInterruptedGame } from './referee.ts'
import type { GameOutcome } from './referee.ts'

function bot(id: string, overrides: Partial<BotRow> = {}): BotRow {
  return {
    id,
    statut: 'active',
    proprietaire: `auteur-${id}`,
    nom: id.toUpperCase(),
    ia_maison: false,
    ...overrides,
  }
}

function before(id: string, overrides: Partial<BotBefore> = {}): BotBefore {
  return {
    id,
    rating: INITIAL_RATING,
    ratedGames: 20,
    failureStreak: 0,
    statut: 'active',
    ...overrides,
  }
}

function technicalLoss(offender: string, opponent: string): WaveGameRecord {
  return {
    blue: offender,
    white: opponent,
    winner: 'white',
    reason: 'timeout',
    offender,
  }
}

const outcome = (patch: Partial<GameOutcome>): GameOutcome => ({
  winner: null,
  reason: 'draw',
  offender: null,
  offendingColor: null,
  notationReason: null,
  moveNumber: null,
  message: '',
  ...patch,
})

describe('ouverture d’une vague', () => {
  it('n’y fait entrer que les IA actives', () => {
    const plan = planWaveOpening(
      [
        bot('a'),
        bot('b'),
        bot('c', { statut: 'en_attente' }),
        bot('d', { statut: 'sommeil' }),
        bot('e', { statut: 'retiree' }),
      ],
      'graine',
    )
    expect(plan.botIds).toEqual(['a', 'b'])
    for (const game of plan.games) {
      expect(['a', 'b']).toContain(game.blue)
      expect(['a', 'b']).toContain(game.white)
    }
  })

  it('donne le même calendrier pour la même graine, et un autre sinon', () => {
    const bots = [bot('a'), bot('b'), bot('c')]
    expect(planWaveOpening(bots, 'g1')).toEqual(planWaveOpening(bots, 'g1'))
    expect(planWaveOpening(bots, 'g2').games).not.toEqual(
      planWaveOpening(bots, 'g1').games,
    )
  })

  it('ne prévoit aucune rencontre pour une IA seule active', () => {
    const plan = planWaveOpening([bot('a'), bot('b', { statut: 'sommeil' })], 'g')
    expect(plan.games).toEqual([])
  })
})

describe('déclenchement d’une qualification', () => {
  const waiting = { statut: 'en_attente', modifie_le: '2026-09-01T10:00:00Z' }

  it('la demande pour une IA en attente qui n’a jamais essayé', () => {
    expect(qualificationNeeded(waiting, [])).toBe(true)
  })

  it('ne la demande pas deux fois de suite', () => {
    expect(
      qualificationNeeded(waiting, [{ statut: 'en_cours', terminee_le: null }]),
    ).toBe(false)
  })

  it('ne relance pas d’elle-même une tentative échouée', () => {
    expect(
      qualificationNeeded(waiting, [
        { statut: 'terminee', terminee_le: '2026-09-02T10:00:00Z' },
      ]),
    ).toBe(false)
  })

  it('la relance dès que l’auteur a touché sa ligne', () => {
    expect(
      qualificationNeeded(
        { statut: 'en_attente', modifie_le: '2026-09-03T10:00:00Z' },
        [{ statut: 'terminee', terminee_le: '2026-09-02T10:00:00Z' }],
      ),
    ).toBe(true)
  })

  it('ne concerne pas une IA déjà active ou en sommeil', () => {
    expect(qualificationNeeded({ ...waiting, statut: 'active' }, [])).toBe(false)
    expect(qualificationNeeded({ ...waiting, statut: 'sommeil' }, [])).toBe(false)
  })
})

describe('verdict de qualification', () => {
  it('accepte une partie terminée, même perdue', () => {
    const verdict = qualificationVerdict(
      outcome({ winner: 'white', reason: 'connection' }),
      'candidate',
    )
    expect(verdict.qualified).toBe(true)
    expect(verdict.statut).toBe('active')
  })

  it('refuse une faute technique du candidat, en la nommant', () => {
    const verdict = qualificationVerdict(
      outcome({
        winner: 'blue',
        reason: 'timeout',
        offender: 'candidate',
        message: 'Perdu — hors délai au coup 3.',
      }),
      'candidate',
    )
    expect(verdict.qualified).toBe(false)
    expect(verdict.statut).toBe('en_attente')
    expect(verdict.message).toContain('hors délai au coup 3')
  })

  it('ne retient pas contre le candidat une panne de l’IA de la maison', () => {
    const verdict = qualificationVerdict(
      outcome({ winner: 'blue', reason: 'unreachable', offender: 'maison' }),
      'candidate',
    )
    expect(verdict.qualified).toBe(true)
  })

  it('refuse une partie interrompue à la fin de la vague', () => {
    expect(qualificationVerdict(closeInterruptedGame(), 'candidate').qualified)
      .toBe(false)
  })
})

describe('parties à remettre en file', () => {
  const now = new Date('2026-09-03T02:00:00Z')

  it('ne retient que les parties non terminées et immobiles', () => {
    expect(
      gamesToRequeue(
        [
          { id: 'vive', statut: 'en_cours', modifie_le: '2026-09-03T01:59:00Z' },
          { id: 'figee', statut: 'en_cours', modifie_le: '2026-09-03T01:50:00Z' },
          { id: 'jamais', statut: 'en_attente', modifie_le: '2026-09-03T01:00:00Z' },
          { id: 'finie', statut: 'terminee', modifie_le: '2026-09-03T01:00:00Z' },
        ],
        now,
      ),
    ).toEqual(['figee', 'jamais'])
  })
})

describe('clôture d’une vague', () => {
  it('classe les parties et rend le bilan de chaque IA', () => {
    const closures = closeWave(
      [before('a'), before('b')],
      [
        { blue: 'a', white: 'b', winner: 'blue', reason: 'connection', offender: null },
        { blue: 'b', white: 'a', winner: null, reason: 'draw', offender: null },
      ],
    )
    const a = closures.find((closure) => closure.bot === 'a')
    expect(a?.wins).toBe(1)
    expect(a?.draws).toBe(1)
    expect(a?.losses).toBe(0)
    expect(a?.elo).toBeGreaterThan(INITIAL_RATING)
    expect(a?.delta).toBe((a?.elo ?? 0) - INITIAL_RATING)
    expect(a?.ratedGames).toBe(22)
  })

  it('compte les défaites techniques et leur motif dominant', () => {
    const closures = closeWave(
      [before('a'), before('b')],
      [
        technicalLoss('a', 'b'),
        technicalLoss('a', 'b'),
        {
          blue: 'b',
          white: 'a',
          winner: 'blue',
          reason: 'unreachable',
          offender: 'a',
        },
      ],
    )
    const a = closures.find((closure) => closure.bot === 'a')
    expect(a?.technicalLosses).toBe(3)
    expect(a?.dominantReason).toBe('timeout')
    expect(a?.losses).toBe(3)
  })

  it('n’allonge la série d’échecs que si toutes les parties ont échoué', () => {
    const games: WaveGameRecord[] = [
      technicalLoss('a', 'b'),
      { blue: 'b', white: 'a', winner: 'white', reason: 'connection', offender: null },
    ]
    const closures = closeWave([before('a', { failureStreak: 2 }), before('b')], games)
    expect(closures.find((closure) => closure.bot === 'a')?.failureStreak).toBe(0)
    expect(closures.find((closure) => closure.bot === 'a')?.asleep).toBe(false)
  })

  it('endort une IA à la troisième vague entièrement échouée, pas à la deuxième', () => {
    const games = [technicalLoss('a', 'b'), technicalLoss('a', 'b')]
    const second = closeWave([before('a', { failureStreak: 1 }), before('b')], games)
    expect(second.find((closure) => closure.bot === 'a')?.failureStreak).toBe(2)
    expect(second.find((closure) => closure.bot === 'a')?.asleep).toBe(false)

    const third = closeWave(
      [before('a', { failureStreak: SLEEP_WAVES - 1 }), before('b')],
      games,
    )
    expect(third.find((closure) => closure.bot === 'a')?.asleep).toBe(true)
    expect(third.find((closure) => closure.bot === 'b')?.asleep).toBe(false)
  })

  it('ne rend rien pour une vague sans rencontre', () => {
    expect(closeWave([before('a')], [])).toEqual([])
  })

  it('donne exactement le même résultat deux fois', () => {
    const games: WaveGameRecord[] = [
      { blue: 'a', white: 'b', winner: 'blue', reason: 'connection', offender: null },
      technicalLoss('b', 'a'),
    ]
    const start = [before('a', { ratedGames: 3 }), before('b')]
    expect(closeWave(start, games)).toEqual(closeWave(start, games))
  })
})
