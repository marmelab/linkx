import { describe, expect, it } from 'vitest'
import {
  MAX_DEADLINE_MS,
  MIN_BUDGET_MS,
  RESPONSE_MARGIN_MS,
  SearchQueueFullError,
  TARGET_BUDGET_MS,
  affordableBudgetMs,
  enqueueSearch,
  pendingSearches,
} from './searchQueue.ts'

describe('budget accordé', () => {
  it('vise le palier mesuré quand le temps ne manque pas', () => {
    expect(affordableBudgetMs(MAX_DEADLINE_MS)).toBe(TARGET_BUDGET_MS)
  })

  it('ne descend jamais sous le plancher de recherche', () => {
    expect(affordableBudgetMs(0)).toBe(MIN_BUDGET_MS)
  })
})

describe('admission dans la file', () => {
  it('enchaîne les recherches et rend le budget à chacune', async () => {
    const budgets: number[] = []
    const first = enqueueSearch((budget) => {
      budgets.push(budget)
      return 'a'
    }, MAX_DEADLINE_MS)
    expect(pendingSearches()).toBe(1)
    const second = enqueueSearch((budget) => {
      budgets.push(budget)
      return 'b'
    }, MAX_DEADLINE_MS)

    expect(await first).toBe('a')
    expect(await second).toBe('b')
    expect(budgets).toHaveLength(2)
    expect(pendingSearches()).toBe(0)
  })

  it('refuse un appel dont le délai ne laisse pas de quoi chercher', async () => {
    await expect(
      enqueueSearch(() => 'jamais', MIN_BUDGET_MS + RESPONSE_MARGIN_MS - 1),
    ).rejects.toBeInstanceOf(SearchQueueFullError)
  })

  it('plafonne le délai annoncé par l’appelant', async () => {
    // Une place occupée pour chaque palier au-delà du plafond : sans
    // plafonnement, un délai d'une minute se ferait admettre derrière elles.
    const occupied = Array.from({ length: 9 }, () =>
      enqueueSearch(() => 'place', MAX_DEADLINE_MS).catch(() => 'refusée'))
    const stretched = enqueueSearch(() => 'triche', 60_000)
    await expect(stretched).rejects.toBeInstanceOf(SearchQueueFullError)
    await Promise.all(occupied)
  })
})
