import { describe, expect, it } from 'vitest'
import {
  botToPlay,
  closeInterruptedGame,
  isTechnicalLoss,
  judgeReply,
  openGame,
  outcomeFromState,
} from './referee.ts'
import type { OngoingGame, Pairing } from './referee.ts'

const PAIRING: Pairing = { blue: 'ia-bleue', white: 'ia-blanche' }

/** Partie gagnée par les bleus au septième coup, `2r13` (voir moveNotation.test.ts). */
const BEFORE_BLUE_WIN = '4Lr32 4Ss3 4Lr32 3Ir12 3Ir13 3Ir14'

/** Partie ouverte par les blancs, bloquée : les blancs l'emportent à la plus grande zone. */
const BEFORE_STALEMATE =
  'w 2r16 3Ir17 24 4Ssr12 4Ss4 16 3I5 3Ir16 3Ir19 3L2 4Ssr12 14 18 4Tr32 18 3L8 3Lr12 2r16 4Lsr27 2r18 4Lr18 4Lsr37 -- 4Lr14'

/** Le même, arrêté juste avant la passe forcée des blancs. */
const BEFORE_FORCED_PASS = BEFORE_STALEMATE.split(' ').slice(0, -3).join(' ')

function game(opening: string): OngoingGame {
  const opened = openGame(opening, PAIRING)
  if (!opened.ok) throw new Error(opened.error.message)
  return opened.game
}

describe('ouverture d’une partie', () => {
  it('ouvre sur un plateau vide et rend la main aux bleus', () => {
    const ongoing = game('')
    expect(ongoing.notation).toBe('')
    expect(ongoing.state.phase).toBe('playing')
    expect(botToPlay(ongoing)).toEqual({ color: 'blue', bot: 'ia-bleue' })
  })

  it('ouvre sur une ouverture imposée de deux demi-coups', () => {
    const ongoing = game('3I4 15')
    expect(ongoing.notation).toBe('3I4 15')
    expect(botToPlay(ongoing)).toEqual({ color: 'blue', bot: 'ia-bleue' })
  })

  it('refuse une ouverture illégale en conservant le refus de la notation', () => {
    const opened = openGame('4S4', PAIRING)
    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.error.reason).toBe('unsupported')
  })
})

describe('coup accepté', () => {
  it('applique le coup et rend la notation canonique', () => {
    const result = judgeReply(game('15'), { ok: true, body: '3Ir17' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.game.notation).toBe('15 3Ir17')
    expect(result.outcome).toBeNull()
    expect(botToPlay(result.game)).toEqual({ color: 'blue', bot: 'ia-bleue' })
  })

  it('tolère les espaces autour du jeton, et rien d’autre', () => {
    const result = judgeReply(game('15'), {
      ok: true,
      body: '\n  3Ir17\t ',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.game.notation).toBe('15 3Ir17')
  })

  it('applique la passe forcée sans jamais appeler l’IA au tour passé', () => {
    const ongoing = game(BEFORE_FORCED_PASS)
    expect(botToPlay(ongoing)).toEqual({ color: 'blue', bot: 'ia-bleue' })

    const result = judgeReply(ongoing, { ok: true, body: '4Lsr37' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.game.notation.endsWith('4Lsr37 --')).toBe(true)
    expect(botToPlay(result.game)).toEqual({ color: 'blue', bot: 'ia-bleue' })
  })
})

describe('fin de partie', () => {
  it('reconnaît la victoire par connexion', () => {
    const result = judgeReply(game(BEFORE_BLUE_WIN), {
      ok: true,
      body: '2r13',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome).toEqual({
      winner: 'blue',
      reason: 'connection',
      offender: null,
      offendingColor: null,
      notationReason: null,
      moveNumber: null,
      message: 'Gagné par connexion.',
    })
  })

  it('reconnaît la victoire par blocage, à la plus grande zone', () => {
    const result = judgeReply(game(BEFORE_STALEMATE), {
      ok: true,
      body: '3Lr24',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcome?.reason).toBe('stalemate')
    expect(result.outcome?.winner).toBe('white')
  })

  it('reconnaît le nul à zones égales', () => {
    const ongoing = game(BEFORE_BLUE_WIN)
    const draw = outcomeFromState({
      ...ongoing.state,
      phase: 'finished',
      result: { winner: null, reason: 'draw' },
    })
    expect(draw?.reason).toBe('draw')
    expect(draw?.winner).toBeNull()
  })

  it('ne rend aucune issue tant que la partie continue', () => {
    expect(outcomeFromState(game('15').state)).toBeNull()
  })

  it('clôt en nul technique une partie interrompue à la fin de la vague', () => {
    const outcome = closeInterruptedGame()
    expect(outcome.reason).toBe('interrupted')
    expect(outcome.winner).toBeNull()
    expect(outcome.offender).toBeNull()
    expect(isTechnicalLoss(outcome)).toBe(false)
  })
})

describe('défaites techniques', () => {
  it('fait perdre le hors-délai, à l’IA au trait', () => {
    const result = judgeReply(game('15'), {
      ok: false,
      failure: 'timeout',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.outcome.reason).toBe('timeout')
    expect(result.outcome.winner).toBe('blue')
    expect(result.outcome.offendingColor).toBe('white')
    expect(result.outcome.offender).toBe('ia-blanche')
    expect(result.outcome.moveNumber).toBe(2)
    expect(isTechnicalLoss(result.outcome)).toBe(true)
  })

  it('fait perdre le service injoignable', () => {
    const result = judgeReply(game(''), {
      ok: false,
      failure: 'unreachable',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.outcome.reason).toBe('unreachable')
    expect(result.outcome.offender).toBe('ia-bleue')
    expect(result.outcome.moveNumber).toBe(1)
  })

  it('fait perdre une réponse vide, multiple ou surabondante', () => {
    for (const body of ['', '   ', '15 24', '15,24', '15+24', '1'.repeat(40)]) {
      const result = judgeReply(game('15'), { ok: true, body })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.outcome.reason).toBe('unreadable-reply')
      expect(result.outcome.offender).toBe('ia-blanche')
    }
  })

  // Sur une notation vide, le premier jeton d'une notation peut être un
  // marqueur de premier joueur : il se relit sans erreur et ne pose aucune
  // pièce. Accepté, il ferait redemander le même coup jusqu'à la fin de la
  // vague, et `w` inverserait en plus le premier joueur sans que les couleurs
  // bougent en base.
  it('fait perdre un marqueur de premier joueur, qui n’avance pas la partie', () => {
    for (const body of ['b', 'blue', 'BLUE', 'w', 'white']) {
      const result = judgeReply(game(''), { ok: true, body })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.outcome.reason).toBe('unreadable-reply')
      expect(result.outcome.offender).toBe('ia-bleue')
      expect(result.outcome.moveNumber).toBe(1)
    }
  })

  it('fait perdre un marqueur de premier joueur en cours de partie aussi', () => {
    for (const body of ['b', 'blue', 'BLUE', 'w', 'white']) {
      const result = judgeReply(game('15'), { ok: true, body })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.outcome.offender).toBe('ia-blanche')
    }
  })

  it('fait perdre le jeton de passe, même là où la position passe vraiment', () => {
    const ongoing = game(BEFORE_FORCED_PASS)
    const after = judgeReply(ongoing, { ok: true, body: '4Lsr37' })
    expect(after.ok).toBe(true)
    if (!after.ok) return

    // Les blancs viennent d'être passés : c'est aux bleus, qui ne doivent
    // pourtant jamais répondre `--`.
    const result = judgeReply(after.game, { ok: true, body: '--' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.outcome.reason).toBe('illegal')
    expect(result.outcome.notationReason).toBe('unexpected-pass')
    expect(result.outcome.offender).toBe('ia-bleue')
  })

  it('conserve le motif exact d’un coup illégal, pour chacun des refus', () => {
    const cases: [string, string, string][] = [
      ['15', 'bonjour', 'syntax'],
      ['15', '3Ir10', 'syntax'],
      ['15 3Ir17 15 3Ir16', '15', 'exhausted'],
      ['15', '3I8', 'horizontal-bounds'],
      ['', '4S4', 'unsupported'],
    ]
    for (const [notation, body, reason] of cases) {
      const result = judgeReply(game(notation), { ok: true, body })
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.outcome.reason).toBe('illegal')
      expect(result.outcome.notationReason).toBe(reason)
      expect(result.outcome.message).toMatch(
        /^Perdu — coup illégal au coup \d+, /,
      )
    }
  })

  it('désigne toujours l’adversaire comme vainqueur d’une défaite technique', () => {
    const result = judgeReply(game('15'), { ok: true, body: '3I8' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.outcome.offendingColor).toBe('white')
    expect(result.outcome.winner).toBe('blue')
  })

  it('refuse d’arbitrer une partie déjà terminée', () => {
    const result = judgeReply(game(BEFORE_BLUE_WIN), {
      ok: true,
      body: '2r13',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(() => judgeReply(result.game, { ok: true, body: '15' })).toThrow()
  })
})
