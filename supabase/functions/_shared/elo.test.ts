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
    // Dix-huit points, non vingt : à l'équilibre, l'espérance se relit sur les
    // classements obtenus, où le gagnant est déjà passé devant. Le coefficient
    // reste le plafond de ce qu'une vague peut déplacer, jamais le montant.
    const result = applyWave(new Map(), [game('a', 'b', 'blue')])
    expect(summary(result, 'a').before).toBe(1200)
    expect(summary(result, 'a').after).toBe(1218)
    expect(summary(result, 'b').after).toBe(1182)
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
    expect(summary(result, 'a').after).toBe(1209)
    expect(summary(result, 'b').after).toBe(1191)
  })

  it('lit le coefficient à l’ouverture de la vague, pas sur un compteur qui monte', () => {
    // Trois victoires sur cinq pour la jeune IA. Son coefficient double celui de
    // la rodée, si bien qu'elle gagne plus de points que l'autre n'en perd : à
    // l'équilibre 1214 contre 1193, et non deux écarts opposés.
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

    expect(summary(result, 'jeune').after).toBe(1214)
    expect(summary(result, 'rodee').after).toBe(1193)
    expect(summary(result, 'jeune').delta).toBeGreaterThan(
      Math.abs(summary(result, 'rodee').delta),
    )
    expect(summary(result, 'jeune').ratedGames).toBe(14)
  })

  it('tient un écart dans les bornes sur une vague massive', () => {
    // Le cas qui a bloqué une vague de production : quinze IA, quatre-vingt-
    // quatre parties chacune, deux d'entre elles n'en gagnant que trois. Jugée
    // sur les seuls classements de départ, la vague leur retirait 1560 points et
    // les envoyait sous le zéro que la base interdit.
    const noms = Array.from({ length: 15 }, (_, index) => `ia-${index}`)
    const games: ReturnType<typeof game>[] = []
    for (const [index, nom] of noms.entries()) {
      for (const autre of noms) {
        if (autre === nom) continue
        // La dernière perd tout, les autres se partagent le reste.
        for (let tour = 0; tour < 3; tour += 1) {
          const perdante = index === noms.length - 1
          games.push(game(nom, autre, perdante ? 'white' : 'blue'))
        }
      }
    }

    const result = applyWave(new Map(), games)
    for (const bot of noms) {
      const after = summary(result, bot).after
      expect(after).toBeGreaterThan(0)
      expect(after).toBeLessThan(4000)
    }
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

  it('rend le même classement quel que soit l’ordre des parties', () => {
    const games = [
      game('a', 'b', 'blue'),
      game('a', 'c', 'white'),
      game('b', 'c', 'blue'),
    ]
    const direct = applyWave(new Map(), games)
    const shuffled = applyWave(new Map(), [games[2], games[0], games[1]])
    for (const bot of ['a', 'b', 'c']) {
      expect(summary(shuffled, bot).after).toBe(summary(direct, bot).after)
    }
  })

  it('ne rend pas un écart négatif à qui gagne la majorité de ses parties', () => {
    // Le cas mesuré sur une vague réelle : deux IA, trente-quatre rencontres,
    // victoires groupées au milieu. Le classement mis à jour partie après partie
    // enflait puis s'effondrait, et rendait −2 à dix-neuf victoires sur trente-
    // quatre. Les classements figés sur la vague l'interdisent.
    const suite = 'VDDNVDVNDVVVVDVDVVVDVVVVDDVVDVDVDD'
    const games = [...suite].map((issue, index) => {
      const aEstBleu = index % 2 === 0
      const winner = issue === 'N'
        ? null
        : (issue === 'V') === aEstBleu
          ? 'blue'
          : 'white'
      return aEstBleu ? game('a', 'b', winner) : game('b', 'a', winner)
    })

    const result = applyWave(new Map(), games)
    const a = summary(result, 'a')
    expect(a.wins).toBeGreaterThan(a.losses)
    expect(a.delta).toBeGreaterThan(0)
    expect(summary(result, 'b').delta).toBe(-a.delta)
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
