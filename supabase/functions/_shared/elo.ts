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
 * calcul — comme les classements eux-mêmes (`applyWave`). Une IA garde donc son
 * coefficient de début de vague jusqu'à la clôture.
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
 * Applique une vague entière, **en un seul coup**.
 *
 * Chaque partie se juge sur les classements d'**avant la vague** : l'espérance
 * de victoire s'y lit, les écarts s'accumulent, et la somme ne s'applique qu'à
 * la fin. Un tournoi n'est pas une suite de parties isolées, c'est une ronde ;
 * on la classe une fois qu'elle est jouée.
 *
 * Mettre à jour le classement après chaque partie rendait le résultat dépendant
 * de **l'ordre** des rencontres, et de façon massive : une vague fait jouer deux
 * IA des dizaines de fois d'affilée, si bien qu'à K = 40 leurs classements
 * s'écartaient de plusieurs centaines de points **à l'intérieur d'une même
 * vague**. Une IA ayant gagné tôt voyait ensuite chaque défaite lui coûter près
 * de 40 points, contre un adversaire artificiellement effondré — au point que
 * 19 victoires sur 34 pouvaient rendre un écart **négatif**. Mesuré sur une
 * vague réelle, pas supposé.
 *
 * Fonction pure, et désormais **commutative** : l'ordre des parties ne change
 * plus rien, ce que le coefficient promettait déjà sans que les classements le
 * tiennent.
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
  const deltas = new Map<string, number>()
  const kFactors = new Map<string, number>()
  const tally = new Map<string, Tally>()
  for (const bot of bots) {
    const initial = startingRating(start, bot)
    before.set(bot, initial)
    deltas.set(bot, 0)
    kFactors.set(bot, kFactor(initial.ratedGames))
    tally.set(bot, { wins: 0, draws: 0, losses: 0 })
  }

  for (const game of games) {
    const blueRating = required(before, game.blue).rating
    const whiteRating = required(before, game.white).rating
    const blueExpected = expectedScore(blueRating, whiteRating)
    const blueObtained = blueScore(game.winner)

    deltas.set(
      game.blue,
      required(deltas, game.blue) +
        required(kFactors, game.blue) * (blueObtained - blueExpected),
    )
    deltas.set(
      game.white,
      required(deltas, game.white) +
        required(kFactors, game.white) * (blueExpected - blueObtained),
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
    const after = Math.round(initial.rating + required(deltas, bot))
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
