import { describe, expect, it } from 'vitest'
import { boardToText } from './boardText'
import {
  PASS_TOKEN,
  parseGameRecord,
  parseMove,
  serializeGameRecord,
  serializeMove,
} from './moveNotation'
import { getUniqueOrientations } from './transforms'
import { SHAPE_IDS } from './types'
import type { GameState, Inventory, ShapeId } from './types'

/** Partie gagnée par les bleus : une colonne bleue relie le haut au bas. */
const BLUE_WIN = '4Lr32 4Ss3 4Lr32 3Ir12 3Ir13 3Ir14 2r13'

/** La même partie sans son dernier coup : les bleus gagnent en jouant `2r13`. */
const ALMOST_BLUE_WIN = '4Lr32 4Ss3 4Lr32 3Ir12 3Ir13 3Ir14'

/** Partie gagnée par les blancs, bleus premier joueur. */
const WHITE_WIN =
  '4Tr21 4Lr34 3Ir12 3Ir12 4Lsr33 4Lr33 3Ir15 4Ss4 4Lsr26 4Ss8 4Tr16 3Lr17 27 3Ir16 12 2r13'

/** Partie ouverte par les blancs, avec une passe forcée puis un blocage total. */
const FORCED_PASS =
  'w 2r16 3Ir17 24 4Ssr12 4Ss4 16 3I5 3Ir16 3Ir19 3L2 4Ssr12 14 18 4Tr32 18 3L8 3Lr12 2r16 4Lsr27 2r18 4Lr18 4Lsr37 -- 4Lr14 3Lr24'

/** Partie en cours : douze coups joués, aux bleus de jouer. */
const ONGOING = '4Lr32 3Ir12 3Ir12 3Ir13 4Tr24 4Lr38 3Ir15 15 2r13 2r15 15 2r13'

function inventory(counts: Partial<Record<ShapeId, number>>): Inventory {
  return {
    mono: 2,
    domino: 2,
    bar3: 2,
    smallL: 2,
    s: 2,
    t: 2,
    largeL: 2,
    ...counts,
  } as Inventory
}

function replay(record: string): GameState {
  const parsed = parseGameRecord(record)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.state
}

function boardOf(record: string): string {
  return boardToText(replay(record).board)
}

function rows(...lines: string[]): string {
  return lines.join('\n')
}

describe('grammaire de la notation', () => {
  it('donne une seule écriture canonique à chaque orientation unique', () => {
    const expected: Record<ShapeId, string[]> = {
      mono: ['11'],
      domino: ['21', '2r11'],
      bar3: ['3I1', '3Ir11'],
      smallL: ['3L1', '3Lr11', '3Lr21', '3Lr31'],
      s: ['4S1', '4Sr11', '4Ss1', '4Ssr11'],
      t: ['4T1', '4Tr11', '4Tr21', '4Tr31'],
      largeL: [
        '4L1',
        '4Lr11',
        '4Lr21',
        '4Lr31',
        '4Ls1',
        '4Lsr11',
        '4Lsr21',
        '4Lsr31',
      ],
    }

    for (const shapeId of SHAPE_IDS) {
      const tokens = getUniqueOrientations(shapeId).map(({ rotation, flipped }) =>
        serializeMove({ shapeId, rotation, flipped, column: 0 }),
      )
      expect(tokens).toEqual(expected[shapeId])
      expect(new Set(tokens).size).toBe(tokens.length)
    }
  })

  it('ramène les écritures redondantes à leur forme canonique', () => {
    const canonical = (token: string): string => {
      const parsed = parseMove(token)
      if (!parsed.ok) throw new Error(`Jeton refusé : ${token}`)
      return serializeMove(parsed.move)
    }

    // Demi-tour sans effet sur une barre, mono insensible à la rotation.
    expect(canonical('2r23')).toBe('23')
    expect(canonical('1r27')).toBe('17')
    // Quarts de tour antihoraires : alias des quarts horaires complémentaires.
    expect(canonical('2l13')).toBe('2r13')
    expect(canonical('4lsl15')).toBe('4Lsr35')
    // Miroir redondant du petit L : ramené à une rotation.
    expect(canonical('3Ls4')).toBe('3Lr14')
    // Miroir utile du grand L et du S : conservé tel quel.
    expect(canonical('4Ls5')).toBe('4Ls5')
    expect(canonical('4Ssr21')).toBe('4Ss1')
    // La casse est libre à la lecture, normalisée à l'écriture.
    expect(canonical('4lsr23')).toBe('4Lsr23')
  })

  it('lit la colonne d’ancrage à partir de 1 et refuse tout autre jeton', () => {
    expect(parseMove('3I7')).toEqual({
      ok: true,
      move: { shapeId: 'bar3', rotation: 0, flipped: false, column: 6 },
    })
    for (const token of ['1', '3I0', '5x', '4Z3', '2r43', '3I', '', '--']) {
      expect(parseMove(token)).toEqual({ ok: false, reason: 'syntax' })
    }
  })
})

describe('parties complètes rejouées depuis leur notation', () => {
  it('reconstitue une partie gagnée par les bleus', () => {
    const state = replay(BLUE_WIN)

    expect(boardToText(state.board)).toBe(
      rows(
        '.WB......',
        '.WB......',
        '.WB......',
        '.BB......',
        '.BBW.....',
        '.BBW.....',
        '.BWW.....',
        '.BWW.....',
        '.BBW.....',
      ),
    )
    expect(state.phase).toBe('finished')
    expect(state.result).toEqual({ winner: 'blue', reason: 'connection' })
    expect(state.inventories.blue).toEqual(
      inventory({ domino: 1, bar3: 1, largeL: 0 }),
    )
    expect(state.inventories.white).toEqual(inventory({ bar3: 0, s: 1 }))
    expect(state.playedCopies.blue.largeL).toEqual([true, true])
    expect(state.playedCopies.blue.smallL).toEqual([false, false])
  })

  it('reconstitue une partie gagnée par les blancs', () => {
    const state = replay(WHITE_WIN)

    expect(boardToText(state.board)).toBe(
      rows(
        '.BW......',
        '.WW......',
        '.WWW.....',
        '.WWWWWBB.',
        '.BWWWWWW.',
        '.BBBBWBW.',
        '.BBWBBBW.',
        '.BBWBBBWW',
        'BBBWWBBBW',
      ),
    )
    expect(state.phase).toBe('finished')
    expect(state.result).toEqual({ winner: 'white', reason: 'connection' })
    expect(state.firstPlayer).toBe('blue')
    expect(state.inventories.blue).toEqual(
      inventory({ mono: 1, domino: 1, bar3: 0, t: 0, largeL: 0 }),
    )
    expect(state.inventories.white).toEqual(
      inventory({ domino: 1, bar3: 0, smallL: 1, s: 0, largeL: 0 }),
    )
  })

  it('reconstitue une partie ouverte par les blancs avec passe forcée', () => {
    const state = replay(FORCED_PASS)

    expect(boardToText(state.board)).toBe(
      rows(
        '....WBBB.',
        '.WWWWBBWW',
        '.BWBBBBBW',
        '.BBBBBWBW',
        '.BWWBBWWW',
        '.WWWWWWBB',
        '.BBWWBBBW',
        '.BBBWWBWW',
        '.BBWWWBWW',
      ),
    )
    expect(state.firstPlayer).toBe('white')
    expect(state.history.filter((entry) => entry.kind === 'pass')).toHaveLength(1)
    expect(state.phase).toBe('finished')
    expect(state.result).toEqual({
      winner: 'white',
      reason: 'stalemate',
      largestZones: { blue: 20, white: 23 },
    })
    expect(state.inventories.blue).toEqual(
      inventory({ mono: 0, domino: 0, bar3: 0, smallL: 0, s: 1, t: 1, largeL: 0 }),
    )
    expect(state.inventories.white).toEqual(
      inventory({ mono: 0, domino: 0, bar3: 0, smallL: 0, s: 0, largeL: 0 }),
    )
  })

  it('reconstitue une partie encore en cours et son joueur actif', () => {
    const state = replay(ONGOING)

    expect(boardToText(state.board)).toBe(
      rows(
        '.B..B....',
        '.BW.W....',
        '.BW.W....',
        '.WB.W....',
        '.WB.B....',
        '.WW.B....',
        '.BW.B..W.',
        '.BW.B..W.',
        '.BBBBB.WW',
      ),
    )
    expect(state.phase).toBe('playing')
    expect(state.result).toBeNull()
    expect(state.activePlayer).toBe('blue')
    expect(state.history).toHaveLength(12)
    expect(state.inventories.blue).toEqual(
      inventory({ mono: 1, domino: 1, bar3: 0, t: 1, largeL: 1 }),
    )
    expect(state.inventories.white).toEqual(
      inventory({ mono: 1, domino: 0, bar3: 0, largeL: 1 }),
    )
    expect(state.playedCopies.blue.bar3).toEqual([true, true])
  })

  it('fait l’aller-retour sur chaque partie', () => {
    for (const record of [
      BLUE_WIN,
      ALMOST_BLUE_WIN,
      WHITE_WIN,
      FORCED_PASS,
      ONGOING,
      '',
    ]) {
      expect(serializeGameRecord(replay(record))).toBe(record)
    }
  })

  it('accepte une passe implicite et la réécrit toujours', () => {
    const withoutToken = FORCED_PASS.replace(` ${PASS_TOKEN}`, '')

    expect(withoutToken).not.toBe(FORCED_PASS)
    expect(boardOf(withoutToken)).toBe(boardOf(FORCED_PASS))
    expect(serializeGameRecord(replay(withoutToken))).toBe(FORCED_PASS)
  })

  it('accepte les séparateurs d’URL et la casse libre', () => {
    const urlForm = ONGOING.replace(/ /g, '+').toLowerCase()

    expect(boardOf(urlForm)).toBe(boardOf(ONGOING))
    expect(serializeGameRecord(replay(urlForm))).toBe(ONGOING)
  })
})

describe('refus d’une notation illégale', () => {
  const cases: {
    label: string
    prefix: string
    record: string
    index: number
    token: string
    reason: string
  }[] = [
    {
      label: 'pièce épuisée',
      prefix: '11 12 13 14',
      record: '11 12 13 14 15',
      index: 4,
      token: '15',
      reason: 'exhausted',
    },
    {
      label: 'coup non supporté',
      prefix: '11 13',
      record: '11 13 3I1',
      index: 2,
      token: '3I1',
      reason: 'unsupported',
    },
    {
      label: 'débordement par le haut',
      prefix: '3Ir11 3Ir11 3Ir11',
      record: '3Ir11 3Ir11 3Ir11 2r11',
      index: 3,
      token: '2r11',
      reason: 'overflow',
    },
    {
      label: 'colonne hors plateau',
      prefix: '',
      record: '3I9',
      index: 0,
      token: '3I9',
      reason: 'horizontal-bounds',
    },
    {
      label: 'syntaxe invalide',
      prefix: '11 12',
      record: '11 12 4Z3',
      index: 2,
      token: '4Z3',
      reason: 'syntax',
    },
    {
      label: 'coup après la fin de la partie',
      prefix: BLUE_WIN,
      record: `${BLUE_WIN} 11`,
      index: 7,
      token: '11',
      reason: 'game-over',
    },
    {
      label: 'passe non forcée',
      prefix: '11 12',
      record: '11 12 -- 13',
      index: 2,
      token: PASS_TOKEN,
      reason: 'unexpected-pass',
    },
  ]

  for (const { label, prefix, record, index, token, reason } of cases) {
    it(`refuse ${label} en désignant le coup fautif`, () => {
      const before = replay(prefix)
      const parsed = parseGameRecord(record)

      expect(parsed.ok).toBe(false)
      if (parsed.ok) return
      expect(parsed.error).toMatchObject({ index, token, reason })
      expect(parsed.error.message).toContain(token)

      // Un refus n'applique rien : la position atteinte par le préfixe légal
      // reste inchangée, grille, réserves et joueur actif compris.
      const after = replay(prefix)
      expect(boardToText(after.board)).toBe(boardToText(before.board))
      expect(after.inventories).toEqual(before.inventories)
      expect(after.activePlayer).toBe(before.activePlayer)
      expect(after.history).toEqual(before.history)
    })
  }
})
