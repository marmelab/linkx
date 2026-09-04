/**
 * Arbitrage d'une partie entre deux IA distantes (histoires 14 et 15).
 *
 * Le module n'appelle rien : il reçoit la réponse brute d'une IA et rend un
 * verdict. C'est ce qui le rend testable, et c'est aussi ce qui garantit qu'il
 * ne réécrit aucune règle : la légalité d'un coup, c'est `parseGameRecord` et
 * rien d'autre. L'arbitre exige en revanche que la réponse **fasse avancer** la
 * partie, ce qui n'est pas une règle du jeu mais une condition de lisibilité.
 */
import { parseGameRecord, serializeGameRecord } from '../../../src/game/moveNotation.ts'
import type { NotationError, NotationErrorReason } from '../../../src/game/moveNotation.ts'
import type { GameState, PlayerId } from '../../../src/game/types.ts'

/** Identifiants des deux IA, par la couleur qu'elles tiennent. */
export type Pairing = { blue: string; white: string }

export type OutcomeReason =
  | 'connection'
  | 'stalemate'
  | 'draw'
  | 'timeout'
  | 'illegal'
  | 'unreachable'
  | 'unreadable-reply'
  | 'interrupted'

export type GameOutcome = {
  winner: PlayerId | null
  reason: OutcomeReason
  /** IA fautive d'une défaite technique, sinon `null`. */
  offender: string | null
  offendingColor: PlayerId | null
  /** Refus exact rendu par `parseGameRecord`, conservé tel quel. */
  notationReason: NotationErrorReason | null
  /** Rang du coup fautif, à partir de 1, passes comprises. */
  moveNumber: number | null
  message: string
}

export type BotReply =
  | { ok: true; body: string }
  | { ok: false; failure: 'timeout' | 'unreachable'; detail?: string }

export type OngoingGame = {
  notation: string
  state: GameState
  pairing: Pairing
}

export type RefereeResult =
  | { ok: true; game: OngoingGame; outcome: GameOutcome | null }
  | { ok: false; outcome: GameOutcome }

export type OpeningResult =
  | { ok: true; game: OngoingGame }
  | { ok: false; error: NotationError }

/** Motifs qui font perdre la partie sans qu'elle soit allée à son terme. */
export const TECHNICAL_REASONS: readonly OutcomeReason[] = [
  'timeout',
  'illegal',
  'unreachable',
  'unreadable-reply',
]

export const PASS_TOKEN = '--'

/** Les sept motifs de refus, dans les termes que l'auteur d'une IA lira. */
export const REFUSAL_LABELS: Record<NotationErrorReason, string> = {
  syntax: 'syntaxe invalide',
  exhausted: 'pièce épuisée',
  'horizontal-bounds': 'débordement latéral',
  overflow: 'débordement par le haut',
  unsupported: 'support insuffisant',
  'game-over': 'partie déjà terminée',
  'unexpected-pass': 'passe non forcée',
}

/**
 * Tolérance sur la réponse d'une IA : seuls les espaces autour du jeton sont
 * ignorés ; tout le reste — jeton vide, jetons multiples, séparateur interne —
 * est une réponse illisible.
 */
const MAX_REPLY_LENGTH = 32
const SEPARATORS = /[\s,+]+/

export function isTechnicalLoss(outcome: GameOutcome): boolean {
  return TECHNICAL_REASONS.includes(outcome.reason)
}

function opponent(color: PlayerId): PlayerId {
  return color === 'blue' ? 'white' : 'blue'
}

function botOfColor(pairing: Pairing, color: PlayerId): string {
  return color === 'blue' ? pairing.blue : pairing.white
}

/** Couleur au trait et IA qu'elle désigne, ou `null` si la partie est finie. */
export function botToPlay(
  game: OngoingGame,
): { color: PlayerId; bot: string } | null {
  if (game.state.phase !== 'playing') return null
  const color = game.state.activePlayer
  return { color, bot: botOfColor(game.pairing, color) }
}

/** Rang du prochain coup, à partir de 1, les passes comptant pour un rang. */
function nextMoveNumber(state: GameState): number {
  return state.history.length + 1
}

/** Issue d'une partie allée à son terme, ou `null` si elle continue. */
export function outcomeFromState(state: GameState): GameOutcome | null {
  if (state.phase !== 'finished' || !state.result) return null
  const { winner, reason } = state.result
  if (reason === 'connection') {
    return {
      winner,
      reason: 'connection',
      offender: null,
      offendingColor: null,
      notationReason: null,
      moveNumber: null,
      message: 'Gagné par connexion.',
    }
  }
  if (reason === 'stalemate') {
    return {
      winner,
      reason: 'stalemate',
      offender: null,
      offendingColor: null,
      notationReason: null,
      moveNumber: null,
      message: 'Gagné par blocage, à la plus grande zone.',
    }
  }
  return {
    winner: null,
    reason: 'draw',
    offender: null,
    offendingColor: null,
    notationReason: null,
    moveNumber: null,
    message: 'Nul par blocage, zones égales.',
  }
}

function illegalMoveMessage(
  state: GameState,
  reason: NotationErrorReason,
): string {
  return `Perdu — coup illégal au coup ${nextMoveNumber(state)}, ${REFUSAL_LABELS[reason]}.`
}

function technicalLoss(
  game: OngoingGame,
  offendingColor: PlayerId,
  reason: OutcomeReason,
  message: string,
  notationReason: NotationErrorReason | null = null,
): GameOutcome {
  return {
    winner: opponent(offendingColor),
    reason,
    offender: botOfColor(game.pairing, offendingColor),
    offendingColor,
    notationReason,
    moveNumber: nextMoveNumber(game.state),
    message,
  }
}

/** Ouvre une partie, à plateau vide (`''`) ou sur une ouverture imposée. */
export function openGame(opening: string, pairing: Pairing): OpeningResult {
  const parsed = parseGameRecord(opening)
  if (!parsed.ok) return { ok: false, error: parsed.error }
  return {
    ok: true,
    game: {
      notation: serializeGameRecord(parsed.state),
      state: parsed.state,
      pairing,
    },
  }
}

/**
 * Valide la réponse d'une IA et l'applique, ou rend la défaite technique
 * motivée. Un `--` reçu d'une IA est toujours un coup illégal : les passes sont
 * forcées par les règles et appliquées par le rejeu de la notation, une IA dont
 * le tour est passé n'étant jamais appelée.
 */
export function judgeReply(game: OngoingGame, reply: BotReply): RefereeResult {
  const toPlay = botToPlay(game)
  if (!toPlay) {
    throw new Error('La partie est terminée : aucune IA n’est au trait.')
  }
  const color = toPlay.color

  if (!reply.ok) {
    const message = reply.failure === 'timeout'
      ? `Perdu — hors délai au coup ${nextMoveNumber(game.state)}.`
      : `Perdu — service injoignable au coup ${nextMoveNumber(game.state)}.`
    return {
      ok: false,
      outcome: technicalLoss(game, color, reply.failure, message),
    }
  }

  const token = reply.body.trim()
  const unreadable =
    token === '' ||
    token.length > MAX_REPLY_LENGTH ||
    token.split(SEPARATORS).length !== 1
  if (unreadable) {
    return {
      ok: false,
      outcome: technicalLoss(
        game,
        color,
        'unreadable-reply',
        `Perdu — réponse illisible au coup ${nextMoveNumber(game.state)}.`,
      ),
    }
  }

  if (token === PASS_TOKEN) {
    return {
      ok: false,
      outcome: technicalLoss(
        game,
        color,
        'illegal',
        illegalMoveMessage(game.state, 'unexpected-pass'),
        'unexpected-pass',
      ),
    }
  }

  const continued = game.notation === '' ? token : `${game.notation} ${token}`
  const parsed = parseGameRecord(continued)
  if (!parsed.ok) {
    return {
      ok: false,
      outcome: technicalLoss(
        game,
        color,
        'illegal',
        illegalMoveMessage(game.state, parsed.error.reason),
        parsed.error.reason,
      ),
    }
  }

  // La notation admet un marqueur de premier joueur en tête : sur une notation
  // vide, `b`, `blue`, `w` ou `white` se relisent donc sans erreur et rendent une
  // partie à **zéro coup**. Accepter cela réécrirait le même état indéfiniment,
  // et la partie redemanderait le même coup jusqu'à la fin de la vague. Un coup
  // ajoute au moins une entrée d'historique : à défaut, la réponse est illisible.
  if (parsed.state.history.length <= game.state.history.length) {
    return {
      ok: false,
      outcome: technicalLoss(
        game,
        color,
        'unreadable-reply',
        `Perdu — réponse illisible au coup ${nextMoveNumber(game.state)}.`,
      ),
    }
  }

  const next: OngoingGame = {
    notation: serializeGameRecord(parsed.state),
    state: parsed.state,
    pairing: game.pairing,
  }
  return { ok: true, game: next, outcome: outcomeFromState(parsed.state) }
}

/** Fin de la fenêtre horaire : la partie non terminée devient un nul technique. */
export function closeInterruptedGame(): GameOutcome {
  return {
    winner: null,
    reason: 'interrupted',
    offender: null,
    offendingColor: null,
    notationReason: null,
    moveNumber: null,
    message: 'Nul technique — partie interrompue à la fin de la vague.',
  }
}
