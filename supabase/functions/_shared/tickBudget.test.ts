import { describe, expect, it } from 'vitest'
import {
  CALL_LEASE_S,
  LEASE_PICKUP_RESERVE_MS,
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
  // Le jeton est rendu dès la réponse reçue, avant l'écriture du coup : il n'a
  // à couvrir que l'appel, jamais l'écriture.
  it('laisse au jeton d’appel le temps d’un appel entier', () => {
    expect(CALL_LEASE_S * 1000).toBeGreaterThan(MOVE_DEADLINE_MS)
  })

  /**
   * Les deux durées ne partent pas du même instant : l'invisibilité court dès
   * le dépilage, le jeton n'est pris qu'après la lecture de la partie et celle
   * de l'IA. Comparer `30 > 20` ne prouve donc rien de l'invariant voulu, qui
   * est que le message ne redevienne jamais visible tant que son jeton vit.
   */
  it('rend un message visible seulement après l’expiration de son jeton', () => {
    expect(QUEUE_VISIBILITY_S * 1000).toBeGreaterThanOrEqual(
      CALL_LEASE_S * 1000 + LEASE_PICKUP_RESERVE_MS,
    )
  })

  it('laisse à la prise du jeton une réserve qui couvre plusieurs allers-retours', () => {
    expect(LEASE_PICKUP_RESERVE_MS).toBeGreaterThan(MOVE_DEADLINE_MS)
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
