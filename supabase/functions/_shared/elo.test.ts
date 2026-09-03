import { describe, expect, it } from 'vitest'
import {
  ESTABLISHED_K_FACTOR,
  INITIAL_RATING,
  PROVISIONAL_GAMES,
  PROVISIONAL_K_FACTOR,
  applyWave,
  expectedScore,
  formatDelta,
  kFactor,
} from './elo.ts'
import type { BotRating, RatedGame } from './elo.ts'

function start(
  entries: Record<string, [rating: number, games: number]>,
): Map<string, BotRating> {
  return new Map(
    Object.entries(entries).map(([bot, [rating, ratedGames]]) => [
      bot,
      { rating, ratedGames },
    ]),
  )
}

function game(
  blue: string,
  white: string,
  winner: RatedGame['winner'],
): RatedGame {
  return { blue, white, winner }
}

function summary(result: ReturnType<typeof applyWave>, bot: string) {
  const found = result.summaries.find((entry) => entry.bot === bot)
  if (!found) throw new Error(`Bilan manquant pour ${bot}.`)
  return found
}

describe('barème', () => {
  it('part à 1200 et applique 40 puis 20', () => {
    expect(INITIAL_RATING).toBe(1200)
    expect(PROVISIONAL_GAMES).toBe(10)
    expect(kFactor(0)).toBe(PROVISIONAL_K_FACTOR)
    expect(kFactor(9)).toBe(PROVISIONAL_K_FACTOR)
    expect(kFactor(10)).toBe(ESTABLISHED_K_FACTOR)
    expect(kFactor(500)).toBe(ESTABLISHED_K_FACTOR)
    expect(PROVISIONAL_K_FACTOR).toBeGreaterThan(ESTABLISHED_K_FACTOR)
  })

  it('donne une espérance d’une demie entre égaux', () => {
    expect(expectedScore(1200, 1200)).toBe(0.5)
    expect(expectedScore(1400, 1000)).toBeCloseTo(0.909, 3)
  })

  it('écrit l’écart avec son signe', () => {
    expect(formatDelta(18)).toBe('+18')
    expect(formatDelta(-7)).toBe('−7')
    expect(formatDelta(0)).toBe('=')
  })
})

describe('application d’une vague', () => {
  it('classe une IA inconnue à 1200', () => {
    const result = applyWave(new Map(), [game('a', 'b', 'blue')])
    expect(summary(result, 'a').before).toBe(1200)
    expect(summary(result, 'a').after).toBe(1220)
    expect(summary(result, 'b').after).toBe(1180)
  })

  it('compte un nul pour une demi-victoire de chacun', () => {
    const result = applyWave(new Map(), [game('a', 'b', null)])
    expect(summary(result, 'a').delta).toBe(0)
    expect(summary(result, 'b').delta).toBe(0)
    expect(summary(result, 'a').draws).toBe(1)
    expect(summary(result, 'b').draws).toBe(1)
  })

  it('applique le coefficient établi à une IA rodée', () => {
    const result = applyWave(start({ a: [1200, 30], b: [1200, 30] }), [
      game('a', 'b', 'blue'),
    ])
    expect(summary(result, 'a').after).toBe(1210)
    expect(summary(result, 'b').after).toBe(1190)
  })

  it('lit le coefficient à l’ouverture de la vague, pas sur un compteur qui monte', () => {
    const games = [
      game('jeune', 'rodee', 'blue'),
      game('rodee', 'jeune', 'blue'),
      game('jeune', 'rodee', 'blue'),
      game('rodee', 'jeune', 'blue'),
      game('jeune', 'rodee', 'blue'),
    ]
    const result = applyWave(
      start({ jeune: [1200, 9], rodee: [1200, 40] }),
      games,
    )

    // Référence : coefficient figé sur tout la vague, 40 pour la jeune IA.
    let youngRating = 1200
    let seasonedRating = 1200
    for (const played of games) {
      const youngIsBlue = played.blue === 'jeune'
      const youngExpected = expectedScore(youngRating, seasonedRating)
      const youngObtained =
        played.winner === null
          ? 0.5
          : (played.winner === 'blue') === youngIsBlue
            ? 1
            : 0
      youngRating += PROVISIONAL_K_FACTOR * (youngObtained - youngExpected)
      seasonedRating += ESTABLISHED_K_FACTOR * (youngExpected - youngObtained)
    }

    expect(summary(result, 'jeune').after).toBe(Math.round(youngRating))
    expect(summary(result, 'rodee').after).toBe(Math.round(seasonedRating))
    expect(summary(result, 'jeune').ratedGames).toBe(14)
  })

  it('tient le compte des victoires, nuls et défaites', () => {
    const result = applyWave(new Map(), [
      game('a', 'b', 'blue'),
      game('b', 'a', 'blue'),
      game('a', 'b', null),
      game('a', 'b', 'white'),
    ])
    const a = summary(result, 'a')
    expect([a.wins, a.draws, a.losses]).toEqual([1, 1, 2])
    const b = summary(result, 'b')
    expect([b.wins, b.draws, b.losses]).toEqual([2, 1, 1])
    expect(a.ratedGames).toBe(4)
  })

  it('prend les parties dans leur ordre chronologique', () => {
    const games = [
      game('a', 'b', 'blue'),
      game('a', 'c', 'white'),
      game('b', 'c', 'blue'),
    ]
    const direct = applyWave(new Map(), games)
    const shuffled = applyWave(new Map(), [games[2], games[0], games[1]])
    expect(summary(shuffled, 'c').after).not.toBe(summary(direct, 'c').after)
  })

  it('rend exactement les mêmes valeurs à la relecture', () => {
    const games = [
      game('a', 'b', 'blue'),
      game('b', 'c', null),
      game('c', 'a', 'blue'),
      game('a', 'b', 'white'),
      game('c', 'b', null),
    ]
    const initial = start({ a: [1250, 12], b: [1180, 3], c: [1200, 0] })
    const first = applyWave(initial, games)
    const second = applyWave(initial, games)
    expect(second.summaries).toEqual(first.summaries)
    expect([...second.ratings]).toEqual([...first.ratings])
    // Le calcul ne consomme pas ses entrées.
    expect([...initial]).toEqual([
      ['a', { rating: 1250, ratedGames: 12 }],
      ['b', { rating: 1180, ratedGames: 3 }],
      ['c', { rating: 1200, ratedGames: 0 }],
    ])
  })

  it('rend des classements entiers', () => {
    const result = applyWave(start({ a: [1250, 12], b: [1180, 3] }), [
      game('a', 'b', 'blue'),
      game('b', 'a', null),
    ])
    for (const { rating } of result.ratings.values()) {
      expect(Number.isInteger(rating)).toBe(true)
    }
  })

  it('laisse intacts les classements des IA qui n’ont pas joué', () => {
    const result = applyWave(
      start({ a: [1250, 12], b: [1180, 3], absente: [1300, 40] }),
      [game('a', 'b', 'blue')],
    )
    expect(result.ratings.get('absente')).toEqual({
      rating: 1300,
      ratedGames: 40,
    })
    expect(result.summaries.map((entry) => entry.bot)).toEqual(['a', 'b'])
  })

  it('ne change rien sur une vague sans rencontre', () => {
    const initial = start({ solo: [1234, 20] })
    const result = applyWave(initial, [])
    expect(result.summaries).toEqual([])
    expect([...result.ratings]).toEqual([...initial])
  })
})
