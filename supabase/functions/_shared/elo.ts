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
 * Amortissement de l'itération. Réinjecter le résultat tel quel fait **osciller**
 * sans jamais converger, et la moitié n'y suffit pas non plus : mesuré sur une
 * vague de quinze IA, seul un tiers ou moins atteint l'équilibre — en soixante-
 * huit passes à ce réglage, contre aucune convergence en cinq mille au-delà.
 */
const RELAXATION = 0.3

/** Écart en deçà duquel les classements sont tenus pour stables, en points. */
const CONVERGENCE = 1e-9

/**
 * Plafond de sécurité : l'équilibre est atteint bien avant, mais une fonction de
 * domaine ne boucle pas sans borne. Il ne mord sur aucune vague mesurée.
 */
const MAX_ITERATIONS = 500

/**
 * Classements d'équilibre de la vague, écrits dans `deltas`.
 *
 * On cherche les classements tels que, pour chacun, l'écart appliqué soit
 * exactement celui que ses propres résultats justifient **une fois ces
 * classements admis** — le point fixe de l'Elo. À chaque passe, les espérances
 * se relisent sur les classements courants ; l'amortissement empêche l'aller-
 * retour autour de la solution.
 */
function solveRatings(
  bots: ReadonlySet<string>,
  before: ReadonlyMap<string, BotRating>,
  kFactors: ReadonlyMap<string, number>,
  obtained: ReadonlyMap<string, number>,
  games: readonly RatedGame[],
  deltas: Map<string, number>,
): void {
  const current = new Map<string, number>()
  for (const bot of bots) current.set(bot, required(before, bot).rating)

  for (let pass = 0; pass < MAX_ITERATIONS; pass += 1) {
    const expected = new Map<string, number>()
    for (const bot of bots) expected.set(bot, 0)
    for (const game of games) {
      const blueExpected = expectedScore(
        required(current, game.blue),
        required(current, game.white),
      )
      expected.set(game.blue, required(expected, game.blue) + blueExpected)
      expected.set(game.white, required(expected, game.white) + (1 - blueExpected))
    }

    let move = 0
    for (const bot of bots) {
      const delta = required(kFactors, bot) *
        (required(obtained, bot) - required(expected, bot))
      const target = required(before, bot).rating + delta
      const rating = required(current, bot)
      move = Math.max(move, Math.abs(target - rating))
      current.set(bot, rating + RELAXATION * (target - rating))
    }
    if (move < CONVERGENCE) break
  }

  for (const bot of bots) {
    deltas.set(bot, required(current, bot) - required(before, bot).rating)
  }
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
 * Les classements se cherchent par **point fixe** : on lit les espérances sur
 * les classements obtenus, on les réinjecte, et l'on recommence jusqu'à ce
 * qu'ils ne bougent plus. Juger la vague sur les seuls classements de départ
 * supprimait en effet le frein de l'Elo — l'espérance d'une IA qui descend
 * baisse, donc ses défaites suivantes lui coûtent moins — et rendait l'écart
 * proportionnel au **nombre** de parties : à quinze IA et quatre-vingt-quatre
 * parties chacune, trois victoires valaient −1560 points, sous le zéro que la
 * base interdit. L'équilibre rend le même ordre, sans l'emballement : la même
 * vague donne 855 au lieu de −360, et 1389 au lieu de 2240.
 *
 * Fonction pure et **commutative** : l'ordre des parties ne change rien.
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

  // Score obtenu, et décompte : ni l'un ni l'autre ne dépend des classements,
  // ils se comptent donc une seule fois.
  const obtained = new Map<string, number>()
  for (const bot of bots) obtained.set(bot, 0)

  for (const game of games) {
    const blueObtained = blueScore(game.winner)
    obtained.set(game.blue, required(obtained, game.blue) + blueObtained)
    obtained.set(game.white, required(obtained, game.white) + (1 - blueObtained))

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

  solveRatings(bots, before, kFactors, obtained, games, deltas)

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
