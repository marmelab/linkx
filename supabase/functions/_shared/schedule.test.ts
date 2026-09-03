import { describe, expect, it } from 'vitest'
import {
  MAX_GAMES_PER_BOT,
  buildSchedule,
  drawOpenings,
  openingsPerPair,
} from './schedule.ts'
import type { ScheduledGame, Schedule } from './schedule.ts'
import { OPENINGS } from './openings.ts'

function bots(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `ia-${String(i).padStart(2, '0')}`)
}

function pairKey(game: ScheduledGame): string {
  return [game.blue, game.white].sort().join('/')
}

function gamesPerBot(schedule: Schedule): Map<string, number> {
  const total = new Map<string, number>()
  for (const game of schedule.games) {
    total.set(game.blue, (total.get(game.blue) ?? 0) + 1)
    total.set(game.white, (total.get(game.white) ?? 0) + 1)
  }
  return total
}

describe('nombre d’ouvertures imposées', () => {
  it('prend le plus grand k tel que (n − 1) × (2 + 2k) ≤ 100', () => {
    expect(openingsPerPair(5, 99)).toBe(11)
    expect(openingsPerPair(6, 99)).toBe(9)
    expect(openingsPerPair(12, 99)).toBe(3)
    expect(openingsPerPair(26, 99)).toBe(1)
    expect(openingsPerPair(51, 99)).toBe(0)
  })

  it('reste borné par le nombre de débuts canoniques disponibles', () => {
    expect(openingsPerPair(2, 99)).toBe(49)
    expect(openingsPerPair(2, OPENINGS.length)).toBe(OPENINGS.length)
    expect(openingsPerPair(3, OPENINGS.length)).toBe(OPENINGS.length)
  })

  it('vaut zéro dès que l’aller-retour à plateau vide suffit', () => {
    expect(openingsPerPair(60, 99)).toBe(0)
    expect(openingsPerPair(200, 99)).toBe(0)
  })

  it('vaut zéro sans rencontre possible', () => {
    expect(openingsPerPair(0, 99)).toBe(0)
    expect(openingsPerPair(1, 99)).toBe(0)
  })
})

describe('cas limites du calendrier', () => {
  it('ne prévoit aucune partie sans IA', () => {
    expect(buildSchedule([], 'vague-1').games).toEqual([])
  })

  it('ne prévoit aucune partie pour une IA seule active', () => {
    const schedule = buildSchedule(['solo'], 'vague-1')
    expect(schedule.games).toEqual([])
    expect(schedule.openingsPerPair).toBe(0)
  })

  it('fait jouer deux IA l’une contre l’autre, couleurs équilibrées', () => {
    const schedule = buildSchedule(['a', 'b'], 'vague-1')
    const expected = 2 + 2 * schedule.openingsPerPair
    expect(schedule.games).toHaveLength(expected)
    expect(schedule.games.filter((game) => game.blue === 'a')).toHaveLength(
      expected / 2,
    )
  })

  it('dédoublonne les identifiants reçus', () => {
    const schedule = buildSchedule(['a', 'b', 'a'], 'vague-1')
    expect(schedule.games.every((game) => game.blue !== game.white)).toBe(true)
    expect(new Set(schedule.games.map(pairKey))).toEqual(new Set(['a/b']))
  })

  it('ne dépend pas de l’ordre dans lequel les IA sont fournies', () => {
    const direct = buildSchedule(['c', 'a', 'b'], 'vague-1')
    const reversed = buildSchedule(['b', 'c', 'a'], 'vague-1')
    expect(reversed).toEqual(direct)
  })
})

describe.each([5, 6, 12])('vague à %i IA', (count) => {
  const list = bots(count)
  const schedule = buildSchedule(list, 'vague-2026-09-03')
  const pairs = new Map<string, ScheduledGame[]>()
  for (const game of schedule.games) {
    const key = pairKey(game)
    pairs.set(key, [...(pairs.get(key) ?? []), game])
  }

  it('fait se rencontrer chaque paire, et elles seules', () => {
    expect(pairs.size).toBe((count * (count - 1)) / 2)
  })

  it('joue le bon nombre de parties par paire', () => {
    const expected = 2 + 2 * schedule.openingsPerPair
    for (const games of pairs.values()) expect(games).toHaveLength(expected)
  })

  it('joue autant de parties dans chaque couleur, dans chaque paire', () => {
    for (const games of pairs.values()) {
      const [first] = [games[0].blue, games[0].white].sort()
      const asBlue = games.filter((game) => game.blue === first)
      expect(asBlue).toHaveLength(games.length / 2)
    }
  })

  it('joue exactement deux parties à plateau vide par paire', () => {
    for (const games of pairs.values()) {
      const empty = games.filter((game) => game.opening === '')
      expect(empty).toHaveLength(2)
      expect(new Set(empty.map((game) => game.blue)).size).toBe(2)
    }
  })

  it('ne répète jamais une ouverture imposée dans une paire', () => {
    for (const games of pairs.values()) {
      const imposed = games
        .filter((game) => game.opening !== '')
        .map((game) => game.opening)
      expect(new Set(imposed).size).toBe(imposed.length / 2)
      for (const notation of new Set(imposed)) {
        expect(imposed.filter((other) => other === notation)).toHaveLength(2)
      }
    }
  })

  it('n’impose que des ouvertures du jeu canonique', () => {
    const known = new Set(OPENINGS.map((opening) => opening.notation))
    for (const game of schedule.games) {
      if (game.opening !== '') expect(known.has(game.opening)).toBe(true)
    }
  })

  it('laisse chaque IA sous la centaine de parties, et aucune sans adversaire', () => {
    const total = gamesPerBot(schedule)
    expect(total.size).toBe(count)
    for (const played of total.values()) {
      expect(played).toBeLessThanOrEqual(MAX_GAMES_PER_BOT)
      expect(played).toBeGreaterThan(0)
    }
  })

  it('redonne le même calendrier à graine égale, un autre à graine différente', () => {
    expect(buildSchedule(list, 'vague-2026-09-03')).toEqual(schedule)
    const other = buildSchedule(list, 'vague-2026-09-10')
    expect(other.openingsPerPair).toBe(schedule.openingsPerPair)
    expect(other).not.toEqual(schedule)
  })
})

describe('nombre impair d’IA', () => {
  it('n’exempte personne : toutes contre toutes n’apparie pas par ronde', () => {
    for (const count of [3, 5, 7, 9]) {
      const schedule = buildSchedule(bots(count), 'vague-1')
      const total = gamesPerBot(schedule)
      expect(total.size).toBe(count)
      const played = new Set(total.values())
      expect(played.size).toBe(1)
    }
  })
})

describe('tirage des ouvertures', () => {
  it('ne dépend que de la graine et de l’identité de la paire', () => {
    const a = drawOpenings('vague-1', 'ia-a', 'ia-b', 4)
    expect(drawOpenings('vague-1', 'ia-b', 'ia-a', 4)).toEqual(a)
    expect(drawOpenings('vague-2', 'ia-a', 'ia-b', 4)).not.toEqual(a)
    expect(drawOpenings('vague-1', 'ia-a', 'ia-c', 4)).not.toEqual(a)
  })

  it('rend des ouvertures distinctes, et jamais plus qu’il n’en existe', () => {
    const drawn = drawOpenings('vague-1', 'ia-a', 'ia-b', 99)
    expect(drawn).toHaveLength(OPENINGS.length)
    expect(new Set(drawn.map((opening) => opening.notation)).size).toBe(
      OPENINGS.length,
    )
  })

  it('ne tire rien quand on ne lui demande rien', () => {
    expect(drawOpenings('vague-1', 'ia-a', 'ia-b', 0)).toEqual([])
  })
})
