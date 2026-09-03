import type { GameState } from '../game/types'

/**
 * Lecture pas à pas d'une partie reçue en notation (plan.md, histoire 13).
 *
 * `states[k]` est la position atteinte après `k` entrées d'historique, et
 * `states[0]` le plateau vide : le rang du curseur est donc exactement l'index
 * dans cette suite, ce que la barre affiche tel quel.
 *
 * Ce n'est **pas** une annulation de coup : la partie lue n'est jamais
 * tronquée, aucune bifurcation n'est ouverte, et seule la position affichée
 * change. Le dernier rang, lui, reste la partie vivante, celle du reducer.
 */
export type Playback = {
  states: GameState[]
  cursor: number
  /**
   * Pièce à faire tomber. Seul le pas en avant en désigne une : reculer, sauter
   * ou aller à un bout substitue la position sans rien animer, sans quoi le
   * moindre déplacement du curseur ferait retomber tout le plateau.
   */
  falling: string | null
}

/** Ouvre la lecture à la fin de la partie, sans qu'aucune pièce ne tombe. */
export function startPlayback(states: GameState[]): Playback {
  return { states, cursor: states.length - 1, falling: null }
}

/** Rang du dernier coup, c'est-à-dire de la position jouable. */
export function lastRank(playback: Playback): number {
  return playback.states.length - 1
}

/** Hors du dernier coup, le plateau se lit et ne se joue pas. */
export function isReplaying(playback: Playback): boolean {
  return playback.cursor < lastRank(playback)
}

/**
 * Position à afficher. Au dernier rang c'est la partie vivante elle-même ;
 * ailleurs c'est une position passée, dont la sélection est écartée — une pièce
 * en main y laisserait croire qu'on peut poser.
 */
export function playbackState(playback: Playback, live: GameState): GameState {
  if (!isReplaying(playback)) return live
  return {
    ...playback.states[playback.cursor],
    selection: null,
    lastEvent: null,
  }
}

/** Saut à un rang quelconque : la position se substitue, sans animation. */
export function seekPlayback(playback: Playback, cursor: number): Playback {
  const clamped = Math.min(Math.max(cursor, 0), lastRank(playback))
  if (clamped === playback.cursor && playback.falling === null) return playback
  return { ...playback, cursor: clamped, falling: null }
}

/**
 * Pas en avant : la seule pièce du coup franchi tombe depuis le bord haut du
 * plateau. Franchir un tour passé n'anime rien, puisque rien n'y est posé.
 */
export function stepPlayback(playback: Playback): Playback {
  if (playback.cursor >= lastRank(playback)) return playback
  const cursor = playback.cursor + 1
  const state = playback.states[cursor]
  const crossed = state.history[cursor - 1]
  return {
    ...playback,
    cursor,
    falling: crossed?.kind === 'move' ? state.lastPlacedPieceId : null,
  }
}

/**
 * Prolonge la lecture d'un coup joué depuis la fin : le curseur reste au bout et
 * le total augmente d'une unité. Rend `null` quand l'état n'est plus la suite de
 * la partie lue — une nouvelle partie, qui n'a pas de barre de lecture.
 */
export function extendPlayback(
  playback: Playback,
  live: GameState,
): Playback | null {
  const last = playback.states[lastRank(playback)]
  if (live.phase === 'setup' || live.history.length < last.history.length) {
    return null
  }
  // Sélection, rotation, refus : l'état change sans que la partie avance.
  if (live.history.length === last.history.length) return playback

  const states = [...playback.states]
  while (states.length <= live.history.length) states.push(live)
  return { states, cursor: states.length - 1, falling: live.lastPlacedPieceId }
}
