import { describe, expect, it } from 'vitest'
import {
  CALL_LEASE_S,
  QUEUE_VISIBILITY_S,
  TICK_BUDGET_MS,
  WRITE_RESERVE_MS,
  canStartCall,
  remainingMs,
} from './tickBudget.ts'
import { MOVE_DEADLINE_MS } from './botClient.ts'

/** Horloge maximale d'une invocation edge, annoncée par le README. */
const EDGE_WALL_CLOCK_MS = 150_000

describe('ordre des trois délais', () => {
  it('laisse au jeton d’appel le temps d’un appel entier', () => {
    expect(CALL_LEASE_S * 1000).toBeGreaterThan(MOVE_DEADLINE_MS + WRITE_RESERVE_MS)
  })

  it('rend un message visible seulement après l’expiration de son jeton', () => {
    expect(QUEUE_VISIBILITY_S).toBeGreaterThan(CALL_LEASE_S)
  })

  it('rend la main bien avant la limite d’horloge de l’edge runtime', () => {
    expect(TICK_BUDGET_MS + MOVE_DEADLINE_MS).toBeLessThan(EDGE_WALL_CLOCK_MS)
  })
})

describe('budget d’un tour', () => {
  it('décompte le temps écoulé et ne descend pas sous zéro', () => {
    expect(remainingMs(1_000, 1_000)).toBe(TICK_BUDGET_MS)
    expect(remainingMs(1_000, 1_000 + TICK_BUDGET_MS + 5_000)).toBe(0)
  })

  it('refuse d’ouvrir un appel qu’il ne pourrait pas écrire', () => {
    const started = 0
    expect(canStartCall(started, TICK_BUDGET_MS - MOVE_DEADLINE_MS - WRITE_RESERVE_MS))
      .toBe(true)
    expect(canStartCall(started, TICK_BUDGET_MS - MOVE_DEADLINE_MS)).toBe(false)
  })
})
