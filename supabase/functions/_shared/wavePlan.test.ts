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
import { TECHNICAL_REASONS, closeInterruptedGame } from './referee.ts'
import type { GameOutcome, OutcomeReason } from './referee.ts'

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
  const games = [
    { id: 'vive', statut: 'en_cours', modifie_le: '2026-09-03T01:59:00Z' },
    { id: 'figee', statut: 'en_cours', modifie_le: '2026-09-03T01:50:00Z' },
    { id: 'jamais', statut: 'en_attente', modifie_le: '2026-09-03T01:00:00Z' },
    { id: 'finie', statut: 'terminee', modifie_le: '2026-09-03T01:00:00Z' },
  ]

  it('ne retient que les parties non terminées et immobiles', () => {
    expect(gamesToRequeue(games, now, new Set())).toEqual(['figee', 'jamais'])
  })

  // Une partie qui attend son tour derrière une IA saturée ne touche pas sa
  // ligne : sans ce filtre, une vague entière recevrait un second message au
  // bout de cinq minutes, puis un troisième à la minute suivante.
  it('n’en réempile aucune dont un message attend déjà dans la file', () => {
    expect(gamesToRequeue(games, now, new Set(['figee', 'jamais']))).toEqual([])
    expect(gamesToRequeue(games, now, new Set(['figee']))).toEqual(['jamais'])
  })

  it('réempile une partie retirée de la file après son immobilisation', () => {
    expect(gamesToRequeue(games, now, new Set(['vive', 'finie'])))
      .toEqual(['figee', 'jamais'])
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

/**
 * Mise en sommeil (histoire 15). C'est le comportement le plus lourd de
 * conséquences pour un participant — son IA sort des appariements —, et le
 * moins visible : il ne se prononce qu'à la clôture, après trois vagues.
 */
describe('mise en sommeil', () => {
  const ORDINAIRES: readonly OutcomeReason[] = [
    'connection',
    'stalemate',
    'draw',
    'interrupted',
  ]

  it('ne compte comme technique que les motifs de TECHNICAL_REASONS', () => {
    for (const reason of TECHNICAL_REASONS) {
      const closures = closeWave(
        [before('a'), before('b')],
        [{ blue: 'a', white: 'b', winner: 'white', reason, offender: 'a' }],
      )
      const a = closures.find((closure) => closure.bot === 'a')
      expect(a?.technicalLosses, reason).toBe(1)
      expect(a?.failureStreak, reason).toBe(1)
    }
  })

  // Une fin de partie ordinaire n'est pas une faute, même si la ligne portait
  // par erreur une IA fautive : c'est le motif qui décide, et lui seul.
  it('ne retient aucune fin de partie ordinaire, fût-elle imputée', () => {
    for (const reason of ORDINAIRES) {
      const closures = closeWave(
        [before('a', { failureStreak: 2 }), before('b')],
        [{ blue: 'a', white: 'b', winner: 'white', reason, offender: 'a' }],
      )
      const a = closures.find((closure) => closure.bot === 'a')
      expect(a?.technicalLosses, reason).toBe(0)
      expect(a?.failureStreak, reason).toBe(0)
      expect(a?.asleep, reason).toBe(false)
    }
  })

  // « La totalité, et non une majorité, parce qu'une IA qui répond parfois est
  // une IA vivante. » Neuf échecs sur dix remettent donc la série à zéro.
  it('remet la série à zéro dès une seule partie non technique', () => {
    const games: WaveGameRecord[] = [
      ...Array.from({ length: 9 }, () => technicalLoss('a', 'b')),
      { blue: 'b', white: 'a', winner: 'blue', reason: 'connection', offender: null },
    ]
    const a = closeWave([before('a', { failureStreak: 2 }), before('b')], games)
      .find((closure) => closure.bot === 'a')
    expect(a?.technicalLosses).toBe(9)
    expect(a?.failureStreak).toBe(0)
    expect(a?.asleep).toBe(false)
  })

  it('endort à la troisième vague entièrement échouée, trois vagues de suite', () => {
    const games = [technicalLoss('a', 'b'), technicalLoss('a', 'b')]
    let streak = 0
    const observed: Array<{ streak: number; asleep: boolean }> = []
    for (let vague = 0; vague < SLEEP_WAVES; vague += 1) {
      const a = closeWave([before('a', { failureStreak: streak }), before('b')], games)
        .find((closure) => closure.bot === 'a')
      streak = a?.failureStreak ?? 0
      observed.push({ streak, asleep: a?.asleep ?? false })
    }
    expect(observed).toEqual([
      { streak: 1, asleep: false },
      { streak: 2, asleep: false },
      { streak: 3, asleep: true },
    ])
  })

  // La série compte les vagues **consécutives** : une vague vivante au milieu
  // efface les deux précédentes, et il en faut trois nouvelles pour endormir.
  it('ne cumule pas des vagues échouées séparées par une vague vivante', () => {
    const vivante: WaveGameRecord[] = [
      { blue: 'a', white: 'b', winner: 'blue', reason: 'connection', offender: null },
    ]
    const a = closeWave([before('a', { failureStreak: 2 }), before('b')], vivante)
      .find((closure) => closure.bot === 'a')
    expect(a?.failureStreak).toBe(0)

    const ensuite = closeWave(
      [before('a', { failureStreak: a?.failureStreak ?? 0 }), before('b')],
      [technicalLoss('a', 'b')],
    ).find((closure) => closure.bot === 'a')
    expect(ensuite?.asleep).toBe(false)
  })

  it('gèle le classement de l’IA endormie à sa dernière valeur', () => {
    const a = closeWave(
      [before('a', { rating: 1180, failureStreak: SLEEP_WAVES - 1 }), before('b')],
      [technicalLoss('a', 'b'), technicalLoss('a', 'b')],
    ).find((closure) => closure.bot === 'a')
    expect(a?.asleep).toBe(true)
    expect(a?.eloBefore).toBe(1180)
    // Elle a perdu ces parties : le gel porte sur la valeur d'après la vague,
    // et surtout pas sur un retour à 1200.
    expect(a?.elo).toBeLessThan(1180)
    expect(a?.elo).not.toBe(INITIAL_RATING)

    // Endormie, elle ne joue plus : plus aucune vague ne réécrit son Elo.
    const gele = a?.elo ?? 0
    const suivante = closeWave(
      [before('a', { rating: gele, statut: 'sommeil' }), before('b')],
      [{ blue: 'b', white: 'c', winner: 'blue', reason: 'connection', offender: null }],
    )
    expect(suivante.map((closure) => closure.bot)).not.toContain('a')
  })

  it('sort l’IA endormie des appariements de la vague suivante', () => {
    const plan = planWaveOpening(
      [bot('a', { statut: 'sommeil' }), bot('b'), bot('c')],
      'graine',
    )
    expect(plan.botIds).toEqual(['b', 'c'])
    expect(plan.games.some((game) => game.blue === 'a' || game.white === 'a'))
      .toBe(false)
  })

  /*
   * Une IA sans aucune partie dans la vague — le cas de l'IA seule active — ne
   * reçoit **aucun bilan** : elle n'a rien échoué, sa série ne monte pas ; elle
   * n'a rien prouvé non plus, sa série ne retombe pas ; et faute de partie
   * classée, son Elo ne bouge pas. C'est le seul traitement qui ne fasse pas
   * dépendre le sort d'une IA de ce qui est arrivé aux autres.
   */
  it('ne prononce rien sur une IA qui n’a joué aucune partie de la vague', () => {
    const closures = closeWave(
      [before('a', { failureStreak: SLEEP_WAVES - 1 }), before('b'), before('c')],
      [{ blue: 'b', white: 'c', winner: 'blue', reason: 'connection', offender: null }],
    )
    expect(closures.map((closure) => closure.bot)).toEqual(['b', 'c'])
    expect(closures.find((closure) => closure.bot === 'a')).toBeUndefined()
  })

  it('n’endort pas l’adversaire d’une IA muette', () => {
    const closures = closeWave(
      [before('a', { failureStreak: SLEEP_WAVES - 1 }), before('b', { failureStreak: 2 })],
      [technicalLoss('a', 'b'), technicalLoss('a', 'b')],
    )
    const b = closures.find((closure) => closure.bot === 'b')
    expect(b?.technicalLosses).toBe(0)
    expect(b?.failureStreak).toBe(0)
    expect(b?.asleep).toBe(false)
  })
})

/**
 * Écart corrigé : `BotBefore.statut` était transmis à `closeWave` et jamais lu.
 * Une IA retirée pendant la vague — ses parties continuent de se jouer — se
 * retrouvait donc endormie par la clôture, ce qui la sortait de `retiree` et
 * rouvrait à son auteur une réactivation que l'histoire 14 interdit.
 */
describe('sommeil et statut de l’IA', () => {
  const echouee = [technicalLoss('a', 'b'), technicalLoss('a', 'b')]
  const derniere = { failureStreak: SLEEP_WAVES - 1 }

  it('endort une IA encore active', () => {
    const a = closeWave(
      [before('a', { ...derniere, statut: 'active' }), before('b')],
      echouee,
    ).find((closure) => closure.bot === 'a')
    expect(a?.asleep).toBe(true)
  })

  it('n’endort pas une IA retirée pendant la vague : le retrait est terminal', () => {
    const a = closeWave(
      [before('a', { ...derniere, statut: 'retiree' }), before('b')],
      echouee,
    ).find((closure) => closure.bot === 'a')
    expect(a?.failureStreak).toBe(SLEEP_WAVES)
    expect(a?.asleep).toBe(false)
    // Son bilan de vague est calculé quand même : les parties ont eu lieu.
    expect(a?.technicalLosses).toBe(2)
  })
})
