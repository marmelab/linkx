import { describe, expect, it } from 'vitest'
import { summarizeQueue } from './queue'
import type { QueueRow } from './queue'

const MAINTENANT = Date.parse('2026-09-04T12:00:00Z')

function ligne(partial: Partial<QueueRow> = {}): QueueRow {
  return {
    statut: 'en_attente',
    vague_id: 'vague-1',
    modifie_le: '2026-09-04T12:00:00Z',
    ...partial,
  }
}

describe('état de la file d’arbitrage', () => {
  it('ne compte rien sur une file vide, et n’invente pas d’attente', () => {
    const state = summarizeQueue([], MAINTENANT)
    expect(state.total).toBe(0)
    expect(state.oldestIdleMs).toBeNull()
  })

  it('sépare ce qui est en cours de ce qui attend', () => {
    const state = summarizeQueue(
      [ligne({ statut: 'en_cours' }), ligne(), ligne()],
      MAINTENANT,
    )
    expect(state.running).toBe(1)
    expect(state.waiting).toBe(2)
    expect(state.total).toBe(3)
  })

  it('sépare les parties de vague des qualifications', () => {
    // Les deux n'avancent pas aux mêmes heures : les confondre laisserait
    // croire qu'un tour hors fenêtre va faire bouger une partie de vague.
    const state = summarizeQueue(
      [ligne(), ligne({ vague_id: null }), ligne({ vague_id: null })],
      MAINTENANT,
    )
    expect(state.wave).toBe(1)
    expect(state.qualifications).toBe(2)
  })

  it('rend l’âge du mouvement le plus ancien, pas du plus récent', () => {
    const state = summarizeQueue(
      [
        ligne({ modifie_le: '2026-09-04T11:59:00Z' }),
        ligne({ modifie_le: '2026-09-04T11:30:00Z' }),
      ],
      MAINTENANT,
    )
    expect(state.oldestIdleMs).toBe(30 * 60_000)
  })

  it('ignore une date illisible plutôt que de rendre NaN', () => {
    const state = summarizeQueue(
      [ligne({ modifie_le: 'pas une date' }), ligne({ modifie_le: '2026-09-04T11:45:00Z' })],
      MAINTENANT,
    )
    expect(state.oldestIdleMs).toBe(15 * 60_000)
  })

  it('ne rend jamais un âge négatif, l’horloge du visiteur pouvant retarder', () => {
    const state = summarizeQueue(
      [ligne({ modifie_le: '2026-09-04T12:05:00Z' })],
      MAINTENANT,
    )
    expect(state.oldestIdleMs).toBe(0)
  })
})
