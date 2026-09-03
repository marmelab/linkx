/**
 * Classement Elo de la plateforme (histoire 15).
 *
 * Arrondi : le calcul d'une vague se mène en flottant et le classement n'est
 * arrondi à l'entier qu'à la clôture, si bien qu'un classement stocké est
 * toujours entier et qu'aucune décimale ne se propage d'une vague à l'autre.
 */
import type { PlayerId } from '../../../src/game/types.ts'

export const INITIAL_RATING = 1200
export const PROVISIONAL_GAMES = 10
export const PROVISIONAL_K_FACTOR = 40
export const ESTABLISHED_K_FACTOR = 20

export type BotRating = {
  rating: number
  /** Parties déjà classées avant la vague : c'est elle qui fixe le coefficient. */
  ratedGames: number
}

export type RatedGame = {
  blue: string
  white: string
  winner: PlayerId | null
}

export type BotSummary = {
  bot: string
  before: number
  after: number
  delta: number
  wins: number
  draws: number
  losses: number
  ratedGames: number
}

export type WaveResult = {
  ratings: Map<string, BotRating>
  summaries: BotSummary[]
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400))
}

/**
 * Coefficient d'une partie : il se lit sur le nombre de parties classées **à
 * l'ouverture de la vague**, jamais sur un compteur qui monterait en cours de
 * calcul. C'est ce qui rend le résultat indépendant de l'ordre interne d'une
 * vague, et donc reproductible.
 */
export function kFactor(ratedGamesBeforeWave: number): number {
  return ratedGamesBeforeWave < PROVISIONAL_GAMES
    ? PROVISIONAL_K_FACTOR
    : ESTABLISHED_K_FACTOR
}

type Tally = { wins: number; draws: number; losses: number }

function required<T>(table: ReadonlyMap<string, T>, key: string): T {
  const value = table.get(key)
  if (value === undefined) throw new Error(`IA inconnue : ${key}.`)
  return value
}

function startingRating(
  start: ReadonlyMap<string, BotRating>,
  bot: string,
): BotRating {
  return start.get(bot) ?? { rating: INITIAL_RATING, ratedGames: 0 }
}

/** Score du joueur bleu : 1 victoire, 0,5 nul, 0 défaite. */
function blueScore(winner: PlayerId | null): number {
  if (winner === 'blue') return 1
  if (winner === 'white') return 0
  return 0.5
}

/**
 * Applique une vague entière, parties prises dans l'ordre chronologique reçu.
 * Fonction pure : deux appels sur les mêmes entrées rendent les mêmes valeurs.
 */
export function applyWave(
  start: ReadonlyMap<string, BotRating>,
  games: readonly RatedGame[],
): WaveResult {
  const bots = new Set<string>()
  for (const game of games) {
    bots.add(game.blue)
    bots.add(game.white)
  }

  const before = new Map<string, BotRating>()
  const current = new Map<string, number>()
  const kFactors = new Map<string, number>()
  const tally = new Map<string, Tally>()
  for (const bot of bots) {
    const initial = startingRating(start, bot)
    before.set(bot, initial)
    current.set(bot, initial.rating)
    kFactors.set(bot, kFactor(initial.ratedGames))
    tally.set(bot, { wins: 0, draws: 0, losses: 0 })
  }

  for (const game of games) {
    const blueRating = required(current, game.blue)
    const whiteRating = required(current, game.white)
    const blueExpected = expectedScore(blueRating, whiteRating)
    const blueObtained = blueScore(game.winner)

    current.set(
      game.blue,
      blueRating + required(kFactors, game.blue) * (blueObtained - blueExpected),
    )
    current.set(
      game.white,
      whiteRating + required(kFactors, game.white) * (blueExpected - blueObtained),
    )

    const blueTally = required(tally, game.blue)
    const whiteTally = required(tally, game.white)
    if (game.winner === 'blue') {
      blueTally.wins += 1
      whiteTally.losses += 1
    } else if (game.winner === 'white') {
      blueTally.losses += 1
      whiteTally.wins += 1
    } else {
      blueTally.draws += 1
      whiteTally.draws += 1
    }
  }

  const ratings = new Map<string, BotRating>(start)
  const summaries: BotSummary[] = []
  for (const bot of [...bots].sort()) {
    const initial = required(before, bot)
    const played = required(tally, bot)
    const total = played.wins + played.draws + played.losses
    const after = Math.round(required(current, bot))
    const ratedGames = initial.ratedGames + total
    ratings.set(bot, { rating: after, ratedGames })
    summaries.push({
      bot,
      before: initial.rating,
      after,
      delta: after - initial.rating,
      wins: played.wins,
      draws: played.draws,
      losses: played.losses,
      ratedGames,
    })
  }

  return { ratings, summaries }
}

/** Écart signé, écrit comme le classement public l'exige : `+18`, `−7`, `=`. */
export function formatDelta(delta: number): string {
  if (delta === 0) return '='
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`
}
