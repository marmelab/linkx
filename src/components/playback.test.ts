import { describe, expect, it } from 'vitest'
import { parseGameTimeline } from '../game/moveNotation'
import { createInitialState, firstAvailableCopy, gameReducer } from '../game/reducer'
import type { GameState } from '../game/types'
import {
  extendPlayback,
  isReplaying,
  lastRank,
  playbackState,
  seekPlayback,
  startPlayback,
  stepPlayback,
} from './playback'

/** Douze coups joués, aux bleus de jouer. */
const ONGOING = '4Lr32 3Ir12 3Ir12 3Ir13 4Tr24 4Lr38 3Ir15 15 2r13 2r15 15 2r13'

/** Partie ouverte par les blancs, avec une passe forcée puis un blocage. */
const FORCED_PASS =
  'w 2r16 3Ir17 24 4Ssr12 4Ss4 16 3I5 3Ir16 3Ir19 3L2 4Ssr12 14 18 4Tr32 18 3L8 3Lr12 2r16 4Lsr27 2r18 4Lr18 4Lsr37 -- 4Lr14 3Lr24'

function timeline(record: string): GameState[] {
  const parsed = parseGameTimeline(record)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.states
}

function occupied(state: GameState): number {
  return state.board.flat().filter(Boolean).length
}

describe('lecture d’une partie coup par coup', () => {
  it('ouvre sur la dernière position, curseur au bout, sans rien animer', () => {
    const playback = startPlayback(timeline(ONGOING))

    expect(playback.cursor).toBe(12)
    expect(lastRank(playback)).toBe(12)
    expect(playback.falling).toBeNull()
    expect(isReplaying(playback)).toBe(false)
  })

  it('déplace le curseur au début, en arrière et à la fin', () => {
    const playback = startPlayback(timeline(ONGOING))

    const start = seekPlayback(playback, 0)
    expect(start.cursor).toBe(0)
    expect(occupied(start.states[start.cursor])).toBe(0)
    expect(isReplaying(start)).toBe(true)

    const back = seekPlayback(playback, playback.cursor - 1)
    expect(back.cursor).toBe(11)

    expect(seekPlayback(start, lastRank(start)).cursor).toBe(12)
    // Les rangs hors de la partie sont ramenés dans ses bornes.
    expect(seekPlayback(start, -4).cursor).toBe(0)
    expect(seekPlayback(start, 99).cursor).toBe(12)
  })

  it('n’anime que le pas en avant, et seulement la pièce de ce coup', () => {
    const playback = startPlayback(timeline(ONGOING))
    const start = seekPlayback(playback, 0)

    const stepped = stepPlayback(start)
    expect(stepped.cursor).toBe(1)
    expect(stepped.falling).toBe(stepped.states[1].lastPlacedPieceId)
    expect(stepped.falling).not.toBeNull()

    // Reculer, sauter, aller à un bout : la position se substitue.
    expect(seekPlayback(stepped, 0).falling).toBeNull()
    expect(seekPlayback(stepped, 7).falling).toBeNull()
    expect(seekPlayback(stepped, lastRank(stepped)).falling).toBeNull()
  })

  it('franchit un tour passé sans rien animer', () => {
    const states = timeline(FORCED_PASS)
    const playback = startPlayback(states)
    const final = states[states.length - 1]
    const passRank = final.history.findIndex((entry) => entry.kind === 'pass') + 1

    const before = seekPlayback(playback, passRank - 1)
    const crossed = stepPlayback(before)

    expect(crossed.cursor).toBe(passRank)
    expect(crossed.falling).toBeNull()
    expect(occupied(crossed.states[crossed.cursor])).toBe(
      occupied(before.states[before.cursor]),
    )
  })

  it('ne dépasse jamais le dernier coup', () => {
    const playback = startPlayback(timeline(ONGOING))

    expect(stepPlayback(playback)).toBe(playback)
  })

  it('écarte la pièce en main des positions lues, et rend la partie vivante au bout', () => {
    const states = timeline(ONGOING)
    const playback = startPlayback(states)
    const live = states[states.length - 1]

    expect(playbackState(playback, live)).toBe(live)

    const read = playbackState(seekPlayback(playback, 5), live)
    expect(read.selection).toBeNull()
    expect(read.lastEvent).toBeNull()
    expect(occupied(read)).toBe(occupied(states[5]))
  })

  it('prolonge la partie lue d’un coup joué depuis la fin', () => {
    const states = timeline(ONGOING)
    const playback = startPlayback(states)
    const live = states[states.length - 1]

    // Sélectionner ou tourner ne fait pas avancer la partie : rien ne change.
    const armed = gameReducer(live, {
      type: 'SELECT_SHAPE',
      player: 'blue',
      shapeId: 'mono',
      copy: firstAvailableCopy(live, 'blue', 'mono')!,
    })
    expect(extendPlayback(playback, armed)).toBe(playback)

    const played = gameReducer(armed, { type: 'DROP_SELECTED_SHAPE', column: 0 })
    expect(played.history).toHaveLength(13)

    const extended = extendPlayback(playback, played)!
    expect(lastRank(extended)).toBe(13)
    expect(extended.cursor).toBe(13)
    expect(isReplaying(extended)).toBe(false)
    expect(extended.falling).toBe(played.lastPlacedPieceId)
  })

  it('sort de la lecture quand une nouvelle partie commence', () => {
    const playback = startPlayback(timeline(ONGOING))

    expect(extendPlayback(playback, createInitialState())).toBeNull()
  })
})
