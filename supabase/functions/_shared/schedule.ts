/**
 * Calendrier d'une vague : toutes contre toutes, deux étages par paire
 * (histoire 15). Aucune IA n'est jamais exemptée, la parité du nombre
 * d'inscrits n'entrant pas en jeu.
 */
import { OPENINGS } from './openings.ts'
import type { Opening } from './openings.ts'

export const MAX_GAMES_PER_BOT = 100

export type ScheduledGame = {
  blue: string
  white: string
  /** Notation imposée ; chaîne vide pour une partie à plateau vide. */
  opening: string
}

export type Schedule = {
  /** `k` : ouvertures imposées par paire, chacune jouée deux fois. */
  openingsPerPair: number
  games: ScheduledGame[]
}

/**
 * `k` est le plus grand entier tel que `(n − 1) × (2 + 2k) ≤ 100`, borné par le
 * nombre de débuts canoniques disponibles, et nul dès que l'aller-retour à
 * plateau vide suffit à atteindre ce total.
 */
export function openingsPerPair(
  botCount: number,
  availableOpenings: number,
): number {
  if (botCount < 2) return 0
  const opponents = botCount - 1
  const perOpponent = Math.floor(MAX_GAMES_PER_BOT / opponents)
  return Math.max(
    0,
    Math.min(Math.floor((perOpponent - 2) / 2), availableOpenings),
  )
}

/** Empreinte FNV-1a : convertit l'identité d'une paire en graine entière. */
function fingerprint(text: string): number {
  let value = 0x81_1c_9d_c5
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01_00_01_93) >>> 0
  }
  return value >>> 0
}

/** Même générateur congruentiel que le Zobrist de `engineBoard.ts`. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
}

/**
 * Tire `k` ouvertures distinctes pour une paire. Le tirage ne dépend que de la
 * graine de la vague et des deux identifiants, pris dans l'ordre alphabétique :
 * reconstruire la vague redonne exactement les mêmes ouvertures.
 */
export function drawOpenings(
  seed: string,
  first: string,
  second: string,
  count: number,
  openings: readonly Opening[] = OPENINGS,
): Opening[] {
  const [a, b] = [first, second].sort()
  const next = seededRandom(fingerprint(`${seed}|${a}|${b}`))
  const shuffled = [...openings]
  const taken = Math.min(count, shuffled.length)
  for (let i = 0; i < taken; i += 1) {
    const j = i + (next() % (shuffled.length - i))
    const swap = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = swap
  }
  return shuffled.slice(0, taken)
}

/**
 * Construit le calendrier complet. Les identifiants sont dédoublonnés et triés :
 * le calendrier ne dépend que de l'ensemble des IA actives et de la graine.
 */
export function buildSchedule(
  botIds: readonly string[],
  seed: string,
  openings: readonly Opening[] = OPENINGS,
): Schedule {
  const bots = [...new Set(botIds)].sort()
  const count = openingsPerPair(bots.length, openings.length)
  const games: ScheduledGame[] = []

  for (let i = 0; i < bots.length; i += 1) {
    for (let j = i + 1; j < bots.length; j += 1) {
      const a = bots[i]
      const b = bots[j]
      games.push({ blue: a, white: b, opening: '' })
      games.push({ blue: b, white: a, opening: '' })
      for (const opening of drawOpenings(seed, a, b, count, openings)) {
        games.push({ blue: a, white: b, opening: opening.notation })
        games.push({ blue: b, white: a, opening: opening.notation })
      }
    }
  }

  return { openingsPerPair: count, games }
}
