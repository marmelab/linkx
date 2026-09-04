import { describe, expect, it } from 'vitest'
import {
  interruptMutation,
  moveCountOf,
  planGameStep,
  replyMutation,
  settleMutation,
} from './gameTick.ts'
import type { GameStep, StoredGame } from './gameTick.ts'
import type { BotCallResult } from './botClient.ts'
import { REFERENCE_GAME } from '../../../src/game/referenceGame.ts'

const NOW = new Date('2026-09-03T02:34:56.000Z')

function row(notation: string): StoredGame {
  return {
    id: 'partie-1',
    notation,
    blueBot: 'ia-bleue',
    whiteBot: 'ia-blanche',
  }
}

function call(step: GameStep): Extract<GameStep, { kind: 'call' }> {
  if (step.kind !== 'call') throw new Error('un appel était attendu')
  return step
}

function replied(move: string): BotCallResult {
  return { ok: true, move, latencyMs: 412, status: 200, snippet: `{"move":"${move}"}` }
}

const timedOut: BotCallResult = {
  ok: false,
  failure: 'timeout',
  latencyMs: 6000,
  status: null,
  snippet: '',
  detail: 'pas de réponse en 6000 ms',
}

describe('coup attendu par une partie', () => {
  it('demande le premier coup à l’IA bleue, sur une notation vide', () => {
    const step = call(planGameStep(row('')))
    expect(step.color).toBe('blue')
    expect(step.botId).toBe('ia-bleue')
    expect(step.record).toBe('')
    expect(step.moveNumber).toBe(1)
  })

  it('passe la main à l’IA blanche après une ouverture imposée', () => {
    const step = call(planGameStep(row('15')))
    expect(step.color).toBe('white')
    expect(step.botId).toBe('ia-blanche')
    expect(step.record).toBe('15')
    expect(step.moveNumber).toBe(2)
  })

  it('n’appelle personne sur une partie déjà terminée', () => {
    const step = planGameStep(row(REFERENCE_GAME))
    expect(step.kind).toBe('settle')
    if (step.kind !== 'settle') return
    expect(step.outcome.reason).toBe('stalemate')
    expect(step.outcome.winner).toBe('blue')
    expect(step.moveCount).toBe(24)
  })

  it('signale une notation stockée illisible plutôt que de l’arbitrer', () => {
    const step = planGameStep(row('coup-qui-nexiste-pas'))
    expect(step.kind).toBe('broken')
  })
})

describe('écriture d’un coup accepté', () => {
  const start = row('15')
  const step = call(planGameStep(start))
  const mutation = replyMutation(start, step, replied('3Ir13'), NOW)

  it('avance la notation et laisse la partie en cours', () => {
    expect(mutation.update.notation).toBe('15 3Ir13')
    expect(mutation.update.statut).toBe('en_cours')
    expect(mutation.update.nombre_coups).toBe(2)
    expect(mutation.update.resultat).toBeNull()
    expect(mutation.update.terminee_le).toBeNull()
    expect(mutation.outcome).toBeNull()
  })

  it('conditionne l’écriture à l’état sur lequel le coup a été décidé', () => {
    expect(mutation.expectedNotation).toBe('15')
    expect(mutation.expectedMoveCount).toBe(1)
  })

  it('journalise le rang, l’IA appelée, la latence et le code HTTP', () => {
    expect(mutation.journal).toEqual({
      partie_id: 'partie-1',
      rang_coup: 2,
      bot_id: 'ia-blanche',
      latence_ms: 412,
      statut_http: 200,
      coup: '3Ir13',
      erreur: null,
      reponse_brute: '{"move":"3Ir13"}',
    })
  })
})

describe('écriture d’une défaite technique', () => {
  it('donne la partie à l’adversaire sur un hors-délai', () => {
    const start = row('')
    const mutation = replyMutation(start, call(planGameStep(start)), timedOut, NOW)
    expect(mutation.update.statut).toBe('terminee')
    expect(mutation.update.resultat).toBe('white')
    expect(mutation.update.motif_fin).toBe('timeout')
    expect(mutation.update.motif_refus).toBeNull()
    expect(mutation.update.bot_fautif).toBe('ia-bleue')
    expect(mutation.update.notation).toBe('')
    expect(mutation.update.terminee_le).toBe(NOW.toISOString())
    // Le verdict de l'arbitre **et** le détail du transport : le premier nomme
    // le motif et le rang, le second dit ce qui s'est passé sur le fil.
    expect(mutation.journal?.erreur).toBe(
      'Perdu — hors délai au coup 1. (pas de réponse en 6000 ms)',
    )
    expect(mutation.journal?.statut_http).toBeNull()
  })

  it('porte le refus exact de la notation sur un coup illégal', () => {
    const start = row('')
    const mutation = replyMutation(
      start,
      call(planGameStep(start)),
      replied('4T4'),
      NOW,
    )
    expect(mutation.update.motif_fin).toBe('illegal')
    expect(mutation.update.motif_refus).toBe('unsupported')
    expect(mutation.update.bot_fautif).toBe('ia-bleue')
    expect(mutation.journal?.erreur).toContain('support insuffisant')
  })

  it('refuse la passe rendue par une IA', () => {
    const start = row('')
    const mutation = replyMutation(start, call(planGameStep(start)), replied('--'), NOW)
    expect(mutation.update.motif_fin).toBe('illegal')
    expect(mutation.update.motif_refus).toBe('unexpected-pass')
  })
})

describe('clôtures', () => {
  it('écrit l’issue d’une partie que la notation déclare terminée', () => {
    const start = row(REFERENCE_GAME)
    const step = planGameStep(start)
    if (step.kind !== 'settle') throw new Error('une clôture était attendue')
    const mutation = settleMutation(start, step.outcome, step.moveCount, NOW)
    expect(mutation.update.statut).toBe('terminee')
    expect(mutation.update.resultat).toBe('blue')
    expect(mutation.update.motif_fin).toBe('stalemate')
    expect(mutation.update.nombre_coups).toBe(24)
    expect(mutation.journal).toBeNull()
  })

  it('close une partie en cours en nul technique à la fin de la vague', () => {
    const mutation = interruptMutation(row('15 3Ir13'), NOW)
    expect(mutation.update.statut).toBe('terminee')
    expect(mutation.update.resultat).toBe('draw')
    expect(mutation.update.motif_fin).toBe('interrupted')
    expect(mutation.update.bot_fautif).toBeNull()
    expect(mutation.update.nombre_coups).toBe(2)
    expect(mutation.expectedNotation).toBe('15 3Ir13')
  })
})

describe('nombre de coups d’une notation', () => {
  it('compte les jetons d’une ouverture imposée, passes comprises', () => {
    expect(moveCountOf('')).toBe(0)
    expect(moveCountOf('15')).toBe(1)
    expect(moveCountOf('3I4 15')).toBe(2)
    expect(moveCountOf(REFERENCE_GAME)).toBe(24)
  })

  it('rend zéro sur une notation qui ne se relit pas', () => {
    expect(moveCountOf('pas-un-coup')).toBe(0)
  })
})

describe('rejeu d’un message', () => {
  it('rend deux fois la même écriture, filtrée par la même notation', () => {
    const start = row('15')
    const step = call(planGameStep(start))
    const first = replyMutation(start, step, replied('3Ir13'), NOW)
    const second = replyMutation(start, step, replied('3Ir13'), NOW)
    expect(second).toEqual(first)
    // La partie a déjà avancé : la ligne ne porte plus la notation attendue,
    // et l'écriture conditionnelle du second passage ne touche aucune ligne.
    const advanced = row(first.update.notation)
    expect(advanced.notation).not.toBe(first.expectedNotation)
    expect(moveCountOf(advanced.notation)).not.toBe(first.expectedMoveCount)
  })
})
