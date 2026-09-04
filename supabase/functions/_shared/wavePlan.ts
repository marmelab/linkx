/**
 * Décisions d'une vague (histoire 15) : qui joue, qui se qualifie, quand la
 * vague se clôt et qui s'endort.
 *
 * La composition du courriel hebdomadaire n'est pas ici : elle appartient à
 * `waveMail.ts`, qui la reconstruit depuis la base. La clôture ne fait qu'en
 * demander l'envoi.
 *
 * Tout ce qui se décide est ici, sans base ni réseau : les deux fonctions edge
 * ne font que lire, écrire et ordonnancer. `buildSchedule` fournit le
 * calendrier, `applyWave` le classement ; ce module les enchaîne et en tire les
 * écritures.
 */
import { applyWave } from './elo.ts'
import type { BotRating, RatedGame } from './elo.ts'
import { buildSchedule } from './schedule.ts'
import type { ScheduledGame } from './schedule.ts'
import { TECHNICAL_REASONS } from './referee.ts'
import type { GameOutcome, OutcomeReason } from './referee.ts'
import type { PlayerId } from '../../../src/game/types.ts'

/** Trois vagues, et non une : une nuit d'indisponibilité ne coûte pas sa place. */
export const SLEEP_WAVES = 3

/**
 * Au-delà, une partie qui n'a pas bougé **et dont aucun message n'attend** est
 * considérée perdue par la file — son message a expiré sans être traité, ou n'a
 * jamais été empilé — et la vague la remet en file.
 */
export const STALE_GAME_MS = 5 * 60_000

export type BotRow = {
  id: string
  statut: string
  proprietaire: string
  nom: string
  ia_maison: boolean
}

/** Ce qu'une IA apporte à l'ouverture de la clôture. */
export type BotBefore = {
  id: string
  rating: number
  ratedGames: number
  failureStreak: number
  statut: string
}

/** Partie d'une vague, réduite à ce que le classement et le sommeil regardent. */
export type WaveGameRecord = {
  blue: string
  white: string
  winner: PlayerId | null
  reason: OutcomeReason
  /** IA fautive d'une défaite technique, sinon `null`. */
  offender: string | null
}

export type BotClosure = {
  bot: string
  eloBefore: number
  elo: number
  delta: number
  ratedGames: number
  wins: number
  draws: number
  losses: number
  technicalLosses: number
  /** Motif technique le plus fréquent de la vague, pour le courriel. */
  dominantReason: OutcomeReason | null
  failureStreak: number
  asleep: boolean
}

function isTechnicalReason(reason: OutcomeReason): boolean {
  return TECHNICAL_REASONS.includes(reason)
}

/** Calendrier de la vague : seules les IA actives y entrent. */
export function planWaveOpening(
  bots: readonly BotRow[],
  seed: string,
): { botIds: string[]; games: ScheduledGame[]; openingsPerPair: number } {
  const botIds = bots
    .filter((bot) => bot.statut === 'active')
    .map((bot) => bot.id)
    .sort()
  const schedule = buildSchedule(botIds, seed)
  return {
    botIds,
    games: schedule.games,
    openingsPerPair: schedule.openingsPerPair,
  }
}

export type QualificationAttempt = {
  statut: string
  terminee_le: string | null
}

/**
 * Une IA en attente joue une partie de qualification, et une seule à la fois.
 * Une tentative échouée n'est pas relancée d'elle-même — ce serait harceler une
 * adresse morte à chaque réveil : il faut que l'auteur ait touché sa ligne
 * depuis, en corrigeant l'adresse ou en redemandant la qualification.
 */
export function qualificationNeeded(
  bot: { statut: string; modifie_le: string },
  attempts: readonly QualificationAttempt[],
): boolean {
  if (bot.statut !== 'en_attente') return false
  if (attempts.some((attempt) => attempt.statut !== 'terminee')) return false
  const lastAttempt = attempts.reduce<number>((latest, attempt) => {
    const ended = attempt.terminee_le ? Date.parse(attempt.terminee_le) : 0
    return Math.max(latest, Number.isNaN(ended) ? 0 : ended)
  }, 0)
  if (lastAttempt === 0) return true
  return Date.parse(bot.modifie_le) > lastAttempt
}

export type QualificationVerdict = {
  qualified: boolean
  statut: 'active' | 'en_attente'
  message: string
}

/**
 * Terminer la partie sans faute technique **de son fait** suffit : perdre
 * n'empêche pas d'entrer, et une panne de l'IA de la maison ne se retient pas
 * contre le candidat.
 */
export function qualificationVerdict(
  outcome: GameOutcome,
  candidate: string,
): QualificationVerdict {
  if (outcome.reason === 'interrupted') {
    return {
      qualified: false,
      statut: 'en_attente',
      message:
        'Qualification refusée — la partie n’est pas allée à son terme dans la fenêtre de la vague.',
    }
  }
  if (isTechnicalReason(outcome.reason) && outcome.offender === candidate) {
    return {
      qualified: false,
      statut: 'en_attente',
      message: `Qualification refusée — faute technique. ${outcome.message}`,
    }
  }
  return {
    qualified: true,
    statut: 'active',
    message:
      'Qualification obtenue — partie menée à son terme sans faute technique. L’IA entre au classement.',
  }
}

/**
 * Parties qu'il faut remettre en file, faute d'avoir avancé.
 *
 * **L'immobilité ne suffit pas.** Une partie qui attend son tour — l'IA tient
 * déjà ses deux appels, et `referee-tick` a replanifié son message — ne touche
 * pas sa ligne. À l'ouverture d'une vague de 192 parties pour huit IA, elles
 * sont presque toutes dans ce cas : les réempiler au bout du délai leur donnerait
 * un second message, puis un troisième la minute suivante, chacun coûtant un
 * appel d'IA et une écriture de journal. `queued` porte les parties dont un
 * message attend déjà, visible ou non ; elles ne sont jamais réempilées.
 */
export function gamesToRequeue(
  games: readonly { id: string; statut: string; modifie_le: string }[],
  now: Date,
  queued: ReadonlySet<string>,
  staleMs: number = STALE_GAME_MS,
): string[] {
  return games
    .filter((game) => game.statut !== 'terminee')
    .filter((game) => !queued.has(game.id))
    .filter((game) => now.getTime() - Date.parse(game.modifie_le) >= staleMs)
    .map((game) => game.id)
}

function dominantReasonOf(reasons: readonly OutcomeReason[]): OutcomeReason | null {
  const counts = new Map<OutcomeReason, number>()
  for (const reason of reasons) counts.set(reason, (counts.get(reason) ?? 0) + 1)
  let best: OutcomeReason | null = null
  let bestCount = 0
  // Ordre d'apparition à égalité : le résultat ne dépend pas de l'itération.
  for (const reason of reasons) {
    const count = counts.get(reason) ?? 0
    if (count > bestCount) {
      best = reason
      bestCount = count
    }
  }
  return best
}

/**
 * Clôture d'une vague : classement, bilan et sommeil, en une seule passe pure.
 * Les parties doivent être données dans l'ordre chronologique — c'est lui qui
 * rend le calcul reproductible.
 */
export function closeWave(
  before: readonly BotBefore[],
  games: readonly WaveGameRecord[],
): BotClosure[] {
  const start = new Map<string, BotRating>(
    before.map((bot) => [bot.id, { rating: bot.rating, ratedGames: bot.ratedGames }]),
  )
  const rated: RatedGame[] = games.map((game) => ({
    blue: game.blue,
    white: game.white,
    winner: game.winner,
  }))
  const { summaries } = applyWave(start, rated)

  const played = new Map<string, number>()
  const technical = new Map<string, OutcomeReason[]>()
  for (const game of games) {
    for (const bot of [game.blue, game.white]) {
      played.set(bot, (played.get(bot) ?? 0) + 1)
    }
    if (game.offender && isTechnicalReason(game.reason)) {
      const reasons = technical.get(game.offender) ?? []
      reasons.push(game.reason)
      technical.set(game.offender, reasons)
    }
  }

  const streaks = new Map(before.map((bot) => [bot.id, bot.failureStreak]))

  return summaries.map((summary) => {
    const faults = technical.get(summary.bot) ?? []
    const total = played.get(summary.bot) ?? 0
    const fullyFailed = total > 0 && faults.length === total
    const streak = fullyFailed ? (streaks.get(summary.bot) ?? 0) + 1 : 0
    return {
      bot: summary.bot,
      eloBefore: summary.before,
      elo: summary.after,
      delta: summary.delta,
      ratedGames: summary.ratedGames,
      wins: summary.wins,
      draws: summary.draws,
      losses: summary.losses,
      technicalLosses: faults.length,
      dominantReason: dominantReasonOf(faults),
      failureStreak: streak,
      asleep: streak >= SLEEP_WAVES,
    }
  })
}
