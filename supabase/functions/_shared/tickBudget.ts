/**
 * Budget d'un tour d'arbitrage et délais de la file (histoire 15).
 *
 * Les trois durées se tiennent, et l'ordre compte :
 *
 *   délai d'appel (6 s) < jeton d'appel (20 s) < invisibilité d'un message (30 s)
 *
 * Un message ne redevient visible qu'après l'expiration du jeton pris pour lui :
 * sans quoi une seconde invocation reprendrait la partie pendant que la
 * première tient encore son appel, et l'IA verrait trois appels simultanés.
 *
 * Le budget d'horloge, lui, reste loin des 150 s de l'edge runtime, et la
 * réserve garantit qu'un appel commencé a le temps d'être écrit avant la fin.
 */
import { MOVE_DEADLINE_MS } from './botClient.ts'

/** Horloge d'un `referee-tick` avant qu'il ne rende la main. */
export const TICK_BUDGET_MS = 50_000

/** Invisibilité d'un message dépilé, en secondes (argument de la file). */
export const QUEUE_VISIBILITY_S = 30

/** Durée d'un jeton d'appel, en secondes : ce qui reste pris si l'on meurt. */
export const CALL_LEASE_S = 20

/** Parties menées de front par un tour : la limite réelle est par IA, en base. */
export const TICK_BATCH_SIZE = 8

/** Marge laissée à l'écriture du coup et du journal après la réponse d'une IA. */
export const WRITE_RESERVE_MS = 3_000

export function remainingMs(
  startedAt: number,
  now: number,
  budgetMs: number = TICK_BUDGET_MS,
): number {
  return Math.max(0, startedAt + budgetMs - now)
}

/** Vrai s'il reste de quoi mener un appel entier, écriture comprise. */
export function canStartCall(
  startedAt: number,
  now: number,
  budgetMs: number = TICK_BUDGET_MS,
  callCostMs: number = MOVE_DEADLINE_MS + WRITE_RESERVE_MS,
): boolean {
  return remainingMs(startedAt, now, budgetMs) >= callCostMs
}
