import { getLargestZone } from './connectivity'
import { getConnectionScore } from './evaluation'
import { enumerateLegalMoves } from './legalMoves'
import type { LegalMove } from './legalMoves'
import { getOtherPlayer, simulateLegalMove } from './simulation'
import type { GamePosition, SimulationTransition } from './simulation'
import { BOARD_SIZE, DEFAULT_DIFFICULTY, SHAPE_IDS } from './types'
import type { Difficulty, GameResult, PlayerId } from './types'

/**
 * Profondeur visée par chaque niveau, en nombre de poses examinées.
 *
 * Le plafond vient du temps de réflexion : la recherche est synchrone dans le
 * navigateur, y compris sur mobile. Chaque profondeur supplémentaire multiplie
 * le temps par le facteur de branchement, qui atteint 95 coups légaux sur une
 * grille vide et retombe sous 20 en fin de partie.
 */
export const DIFFICULTY_DEPTHS: Record<Difficulty, number> = {
  easy: 1,
  standard: 2,
  hard: 3,
}

/**
 * Nombre de coups légaux au-delà duquel la profondeur 3 dépasse le budget de
 * réflexion. Temps mesurés à cette profondeur sur un portable de développement,
 * un mobile étant plusieurs fois plus lent : 0,3 s en moyenne et 1 s au pire
 * jusqu'à 27 coups, 1,4 s vers 30 coups, 2 s à 48 coups, 15 s sur une grille
 * vide, qui en offre 95.
 */
export const WIDE_POSITION_MOVES = 24
/** Profondeur retenue tant que la position reste trop large. */
const WIDE_POSITION_DEPTH = 2

const DEFAULT_DEPTH = DIFFICULTY_DEPTHS[DEFAULT_DIFFICULTY]
/** Valeur d'une partie terminée : elle domine toujours l'heuristique. */
export const TERMINAL_SCORE = 1_000_000
const CONNECTION_WEIGHT = 100
const UNREACHABLE_SCORE = BOARD_SIZE * BOARD_SIZE + 1

export type MinimaxOptions = {
  depth?: number
}

export type MinimaxDecision = {
  move: LegalMove
  score: number
  exploredNodes: number
}

type SearchContext = {
  aiPlayer: PlayerId
  exploredNodes: number
  transpositions: Map<string, TranspositionEntry>
}

export type TranspositionBound = 'exact' | 'lower' | 'upper'

type TranspositionEntry = {
  score: number
  bound: TranspositionBound
}

/**
 * Classe la valeur d'un nœud par rapport à la fenêtre alpha-bêta réellement
 * explorée, resserrement par la table de transposition compris.
 *
 * Une valeur obtenue dans une fenêtre resserrée n'est qu'une borne : la classer
 * par rapport à la fenêtre reçue du parent la marquerait « exacte » à tort, et
 * une entrée exacte est relue sans vérifier la fenêtre de l'appelant.
 */
export function classifyTranspositionBound(
  score: number,
  alpha: number,
  beta: number,
): TranspositionBound {
  if (score <= alpha) return 'upper'
  if (score >= beta) return 'lower'
  return 'exact'
}

function finiteConnectionScore(score: number): number {
  return Number.isFinite(score) ? score : UNREACHABLE_SCORE
}

function evaluatePosition(position: GamePosition, aiPlayer: PlayerId): number {
  const opponent = getOtherPlayer(aiPlayer)
  const connectionAdvantage =
    finiteConnectionScore(getConnectionScore(position.board, opponent)) -
    finiteConnectionScore(getConnectionScore(position.board, aiPlayer))
  const zoneAdvantage =
    getLargestZone(position.board, aiPlayer) -
    getLargestZone(position.board, opponent)
  return connectionAdvantage * CONNECTION_WEIGHT + zoneAdvantage
}

function evaluateResult(
  result: GameResult,
  aiPlayer: PlayerId,
  remainingDepth: number,
): number {
  if (result.winner === null) return 0
  return result.winner === aiPlayer
    ? TERMINAL_SCORE + remainingDepth
    : -TERMINAL_SCORE - remainingDepth
}

/**
 * Clé de la table de transposition. Deux nœuds ne partagent une valeur que s'ils
 * ont la même profondeur restante, le même joueur au trait, les mêmes réserves
 * et le même plateau. Les réserves sont indispensables : deux monos et un domino
 * laissent le même plateau mais pas les mêmes coups futurs.
 */
export function positionKey(position: GamePosition, depth: number): string {
  const board = position.board
    .map((row) =>
      row
        .map((cell) => (cell ? (cell.player === 'blue' ? 'B' : 'W') : '.'))
        .join(''),
    )
    .join('')
  const inventories = (['blue', 'white'] as const)
    .flatMap((player) => SHAPE_IDS.map((shapeId) => position.inventories[player][shapeId]))
    .join('')
  return `${depth}:${position.activePlayer}:${inventories}:${board}`
}

function scoreTransition(
  transition: SimulationTransition,
  depth: number,
  alpha: number,
  beta: number,
  context: SearchContext,
): number {
  if (transition.result) {
    return evaluateResult(transition.result, context.aiPlayer, depth)
  }
  return minimax(transition.position, depth, alpha, beta, context)
}

function minimax(
  position: GamePosition,
  depth: number,
  alpha: number,
  beta: number,
  context: SearchContext,
): number {
  context.exploredNodes += 1
  if (depth === 0) return evaluatePosition(position, context.aiPlayer)

  const key = positionKey(position, depth)
  const cached = context.transpositions.get(key)
  if (cached) {
    if (cached.bound === 'exact') return cached.score
    if (cached.bound === 'lower') alpha = Math.max(alpha, cached.score)
    if (cached.bound === 'upper') beta = Math.min(beta, cached.score)
    if (beta <= alpha) return cached.score
  }
  // Fenêtre du nœud une fois l'entrée en cache appliquée : c'est elle qui donne
  // son sens au score obtenu, donc c'est elle qui classe la borne stockée.
  const nodeAlpha = alpha
  const nodeBeta = beta

  const moves = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  )
  if (moves.length === 0) return evaluatePosition(position, context.aiPlayer)

  const maximizing = position.activePlayer === context.aiPlayer
  let bestScore = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY

  for (const move of moves) {
    const transition = simulateLegalMove(position, move)
    const score = scoreTransition(transition, depth - 1, alpha, beta, context)

    if (maximizing) {
      bestScore = Math.max(bestScore, score)
      alpha = Math.max(alpha, bestScore)
    } else {
      bestScore = Math.min(bestScore, score)
      beta = Math.min(beta, bestScore)
    }
    if (beta <= alpha) {
      break
    }
  }

  context.transpositions.set(key, {
    score: bestScore,
    bound: classifyTranspositionBound(bestScore, nodeAlpha, nodeBeta),
  })
  return bestScore
}

export function chooseMinimaxMove(
  position: GamePosition,
  options: MinimaxOptions = {},
): MinimaxDecision | null {
  const depth = options.depth ?? DEFAULT_DEPTH
  if (!Number.isInteger(depth) || depth < 1) {
    throw new Error('La profondeur Minimax doit être un entier supérieur ou égal à 1.')
  }

  const moves = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  )
  if (moves.length === 0) return null

  const context: SearchContext = {
    aiPlayer: position.activePlayer,
    exploredNodes: 1,
    transpositions: new Map(),
  }
  let alpha = Number.NEGATIVE_INFINITY
  const beta = Number.POSITIVE_INFINITY
  let bestMove = moves[0]
  let bestScore = Number.NEGATIVE_INFINITY
  const candidates = moves
    .map((move) => {
      const transition = simulateLegalMove(position, move)
      const orderingScore = transition.result
        ? evaluateResult(transition.result, context.aiPlayer, depth - 1)
        : evaluatePosition(transition.position, context.aiPlayer)
      return { move, transition, orderingScore }
    })
    .sort((left, right) => right.orderingScore - left.orderingScore)

  for (const { move, transition, orderingScore } of candidates) {
    if (depth === 1) context.exploredNodes += 1
    const score = depth === 1
      ? orderingScore
      : scoreTransition(transition, depth - 1, alpha, beta, context)
    if (score > bestScore) {
      bestMove = move
      bestScore = score
    }
    alpha = Math.max(alpha, bestScore)
    if (bestScore >= TERMINAL_SCORE) break
  }

  return { move: bestMove, score: bestScore, exploredNodes: context.exploredNodes }
}

/**
 * Profondeur réellement explorée pour un niveau donné dans une position dont on
 * connaît le nombre de coups légaux.
 *
 * Le niveau fixe une profondeur visée, pas une promesse d'attente : tant que la
 * position reste large, la recherche s'arrête plus tôt pour ne pas figer
 * l'écran. Elle va au bout dès que le plateau se resserre, c'est-à-dire là où
 * la profondeur décide de la partie.
 */
export function getAffordableDepth(
  difficulty: Difficulty,
  legalMoveCount: number,
): number {
  const depth = DIFFICULTY_DEPTHS[difficulty]
  if (legalMoveCount <= WIDE_POSITION_MOVES) return depth
  return Math.min(depth, WIDE_POSITION_DEPTH)
}

/** Coup choisi pour le joueur au trait, à la force demandée. */
export function chooseMoveForDifficulty(
  position: GamePosition,
  difficulty: Difficulty,
): MinimaxDecision | null {
  const legalMoveCount = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  ).length
  if (legalMoveCount === 0) return null
  return chooseMinimaxMove(position, {
    depth: getAffordableDepth(difficulty, legalMoveCount),
  })
}
