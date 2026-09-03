/**
 * Un coup de partie, vu depuis la ligne stockée : que faire ensuite, et quoi
 * écrire une fois l'IA rendue (histoire 15).
 *
 * Module pur, et c'est ce qui rend `referee-tick` idempotente. Toute écriture
 * décidée ici porte l'état sur lequel le coup a été décidé : la notation, et
 * surtout `expectedMoveCount`, dont la fonction edge fait le filtre de son
 * `update`. Un message rejoué — visibilité expirée, invocation morte, doublon
 * d'empilage — ne modifie donc **rien** dès lors qu'un autre passage a déjà
 * avancé la partie : le compte ne correspond plus, aucune ligne n'est touchée.
 * La notation en base fait foi, et elle seule.
 *
 * Aucune règle n'est réécrite : `referee.ts` arbitre, ce module ne fait que
 * traduire son verdict en colonnes.
 */
import type { BotCallResult } from './botClient.ts'
import { toBotReply } from './botClient.ts'
import {
  botToPlay,
  closeInterruptedGame,
  judgeReply,
  openGame,
  outcomeFromState,
} from './referee.ts'
import type { GameOutcome, OngoingGame, OutcomeReason } from './referee.ts'
import type { NotationErrorReason } from '../../../src/game/moveNotation.ts'
import type { PlayerId } from '../../../src/game/types.ts'

/** Ligne de `parties`, réduite à ce que l'arbitrage demande. */
export type StoredGame = {
  id: string
  /** Notation depuis le début, ouverture imposée comprise. */
  notation: string
  blueBot: string
  whiteBot: string
}

export type GameStep =
  | {
    kind: 'call'
    color: PlayerId
    botId: string
    /** Notation à transmettre à l'IA, telle quelle. */
    record: string
    /** Rang du coup demandé, à partir de 1, passes comprises. */
    moveNumber: number
  }
  | { kind: 'settle'; outcome: GameOutcome; moveCount: number }
  | { kind: 'broken'; message: string }

/** Colonnes de `parties` écrites à l'issue d'un coup. */
export type GameUpdate = {
  notation: string
  statut: 'en_cours' | 'terminee'
  resultat: 'blue' | 'white' | 'draw' | null
  motif_fin: OutcomeReason | null
  motif_refus: NotationErrorReason | null
  bot_fautif: string | null
  nombre_coups: number
  terminee_le: string | null
}

/** Ligne de `evenements_partie` : ce que l'auteur d'une IA vient lire. */
export type JournalEntry = {
  partie_id: string
  rang_coup: number
  bot_id: string
  latence_ms: number
  statut_http: number | null
  coup: string | null
  erreur: string | null
  reponse_brute: string | null
}

export type GameMutation = {
  /** Notation sur laquelle ce coup a été décidé : invariant de l'écriture. */
  expectedNotation: string
  /**
   * Nombre de coups de la ligne au moment de la décision. C'est **ce** filtre
   * que l'écriture porte : un entier, sans échappement d'URL à réussir, et
   * strictement croissant tant que la partie avance.
   */
  expectedMoveCount: number
  update: GameUpdate
  /** Issue de la partie, ou `null` si elle continue. */
  outcome: GameOutcome | null
  journal: JournalEntry | null
}

/** Nombre d'entrées d'historique d'une notation ; zéro si elle ne se relit pas. */
export function moveCountOf(notation: string): number {
  const opened = openGame(notation, { blue: 'blue', white: 'white' })
  return opened.ok ? opened.game.state.history.length : 0
}

function pairingOf(row: StoredGame) {
  return { blue: row.blueBot, white: row.whiteBot }
}

function openStored(row: StoredGame): OngoingGame | null {
  const opened = openGame(row.notation, pairingOf(row))
  return opened.ok ? opened.game : null
}

/** Ce que la partie attend : un appel d'IA, une clôture, ou rien de jouable. */
export function planGameStep(row: StoredGame): GameStep {
  const game = openStored(row)
  if (!game) {
    return {
      kind: 'broken',
      message: `Notation stockée illisible pour la partie ${row.id}.`,
    }
  }

  const finished = outcomeFromState(game.state)
  if (finished) {
    return { kind: 'settle', outcome: finished, moveCount: game.state.history.length }
  }

  const toPlay = botToPlay(game)
  if (!toPlay) {
    return { kind: 'broken', message: `Aucune IA au trait sur la partie ${row.id}.` }
  }

  return {
    kind: 'call',
    color: toPlay.color,
    botId: toPlay.bot,
    record: game.notation,
    moveNumber: game.state.history.length + 1,
  }
}

function resultOf(outcome: GameOutcome): 'blue' | 'white' | 'draw' {
  return outcome.winner ?? 'draw'
}

function finishedUpdate(
  notation: string,
  outcome: GameOutcome,
  moveCount: number,
  now: Date,
): GameUpdate {
  return {
    notation,
    statut: 'terminee',
    resultat: resultOf(outcome),
    motif_fin: outcome.reason,
    motif_refus: outcome.notationReason,
    bot_fautif: outcome.offender,
    nombre_coups: moveCount,
    terminee_le: now.toISOString(),
  }
}

/** Écrit l'issue d'une partie que la notation déclare déjà terminée. */
export function settleMutation(
  row: StoredGame,
  outcome: GameOutcome,
  moveCount: number,
  now: Date,
): GameMutation {
  return {
    expectedNotation: row.notation,
    expectedMoveCount: moveCount,
    update: finishedUpdate(row.notation, outcome, moveCount, now),
    outcome,
    journal: null,
  }
}

/** Fin de fenêtre : la partie encore en cours devient un nul technique. */
export function interruptMutation(row: StoredGame, now: Date): GameMutation {
  const game = openStored(row)
  const moveCount = game ? game.state.history.length : 0
  const outcome = closeInterruptedGame()
  return {
    expectedNotation: row.notation,
    expectedMoveCount: moveCount,
    update: finishedUpdate(row.notation, outcome, moveCount, now),
    outcome,
    journal: null,
  }
}

function errorOf(result: BotCallResult, outcome: GameOutcome | null): string | null {
  if (!result.ok) return result.detail
  if (outcome && outcome.offender !== null) return outcome.message
  return null
}

/**
 * Verdict de l'arbitre sur la réponse reçue, traduit en écriture. Une défaite
 * technique termine la partie ; un coup accepté l'avance d'un cran, et peut la
 * terminer aussi.
 */
export function replyMutation(
  row: StoredGame,
  step: Extract<GameStep, { kind: 'call' }>,
  result: BotCallResult,
  now: Date,
): GameMutation {
  const game = openStored(row)
  // Une notation stockée illisible ne peut pas être arbitrée : la partie sort
  // en nul technique plutôt que de bloquer la file jusqu'à midi.
  if (!game) return interruptMutation(row, now)

  const verdict = judgeReply(game, toBotReply(result))
  const journal: JournalEntry = {
    partie_id: row.id,
    rang_coup: step.moveNumber,
    bot_id: step.botId,
    latence_ms: result.latencyMs,
    statut_http: result.status,
    coup: result.ok ? result.move : null,
    erreur: errorOf(result, verdict.outcome),
    reponse_brute: result.snippet === '' ? null : result.snippet,
  }

  if (!verdict.ok) {
    return {
      expectedNotation: row.notation,
      expectedMoveCount: game.state.history.length,
      update: finishedUpdate(
        row.notation,
        verdict.outcome,
        game.state.history.length,
        now,
      ),
      outcome: verdict.outcome,
      journal,
    }
  }

  const played = verdict.game
  const moveCount = played.state.history.length
  const update: GameUpdate = verdict.outcome
    ? finishedUpdate(played.notation, verdict.outcome, moveCount, now)
    : {
      notation: played.notation,
      statut: 'en_cours',
      resultat: null,
      motif_fin: null,
      motif_refus: null,
      bot_fautif: null,
      nombre_coups: moveCount,
      terminee_le: null,
    }

  return {
    expectedNotation: row.notation,
    expectedMoveCount: game.state.history.length,
    update,
    outcome: verdict.outcome,
    journal,
  }
}
