import { getLargestZone } from './connectivity'
import { getConnectionScore } from './evaluation'
import { enumerateLegalMoves } from './legalMoves'
import type { LegalMove } from './legalMoves'
import { getOtherPlayer, simulateLegalMove } from './simulation'
import type { GamePosition, SimulationTransition } from './simulation'
import { BOARD_SIZE, DEFAULT_DIFFICULTY, SHAPE_IDS } from './types'
import type { Difficulty, GameResult, PlayerId } from './types'

/**
 * Barème d'abordabilité par niveau : pour chaque niveau, ses profondeurs en
 * ordre décroissant, chacune avec le nombre maximal de coups légaux jusqu'où elle
 * tient le budget de réflexion. Au-delà, la recherche se rabat d'un cran, car
 * chaque tour d'anticipation multiplie le travail par le facteur de branchement.
 * Ce barème est l'unique source des profondeurs : `DIFFICULTY_DEPTHS` en dérive.
 *
 * Le maître tolère un temps de réflexion plus long que l'expert — jusqu'à deux ou
 * trois secondes sur mobile au lieu d'une à deux —, d'où des plafonds plus hauts
 * à profondeur égale. C'est ce surcroît de budget, et non un simple +1 de
 * profondeur, qui le rend strictement plus profond que l'expert sur tout le jeu
 * hors des tout premiers coups : là où l'expert tient depth 3, le maître tient
 * depth 4 ; là où l'expert retombe à depth 2, le maître tient encore depth 3.
 *
 * Seuils calés au profileur (portable de développement, mobile ~3-4× plus lent) :
 * depth 3 ~0,15 s à 32 coups et ~1 s à 57 ; depth 4 ~0,5 s à 32 et ~4 s à 57 ;
 * depth 2 ~0,3 s sur la grille vide, qui en offre 95. Ils se règlent sur la
 * machine cible, la contrainte tenable étant le temps, pas le nombre.
 */
export const WIDE_POSITION_MOVES = 24
export const MASTER_DEEP_MOVES = 30
export const MASTER_WIDE_MOVES = 48

type DepthCeiling = { depth: number; maxMoves: number }

const DEPTH_SCHEDULE: Record<Difficulty, DepthCeiling[]> = {
  easy: [{ depth: 1, maxMoves: Number.POSITIVE_INFINITY }],
  standard: [{ depth: 2, maxMoves: Number.POSITIVE_INFINITY }],
  hard: [
    { depth: 3, maxMoves: WIDE_POSITION_MOVES },
    { depth: 2, maxMoves: Number.POSITIVE_INFINITY },
  ],
  master: [
    { depth: 4, maxMoves: MASTER_DEEP_MOVES },
    { depth: 3, maxMoves: MASTER_WIDE_MOVES },
    { depth: 2, maxMoves: Number.POSITIVE_INFINITY },
  ],
}

/**
 * Profondeur nominale de chaque niveau : la plus grande qu'il vise jamais, une
 * fois le plateau assez resserré — le sommet de son barème. Dérivée de
 * `DEPTH_SCHEDULE` pour n'avoir qu'une source ; `getAffordableDepth` l'abaisse
 * tant que la position offre trop de coups.
 */
export const DIFFICULTY_DEPTHS: Record<Difficulty, number> = {
  easy: DEPTH_SCHEDULE.easy[0].depth,
  standard: DEPTH_SCHEDULE.standard[0].depth,
  hard: DEPTH_SCHEDULE.hard[0].depth,
  master: DEPTH_SCHEDULE.master[0].depth,
}

const DEFAULT_DEPTH = DIFFICULTY_DEPTHS[DEFAULT_DIFFICULTY]
/** Valeur d'une partie terminée : elle domine toujours l'heuristique. */
export const TERMINAL_SCORE = 1_000_000
const CONNECTION_WEIGHT = 100
const UNREACHABLE_SCORE = BOARD_SIZE * BOARD_SIZE + 1

export type MinimaxOptions = {
  depth?: number
  /**
   * Départage des coups de valeur strictement égale. Absent, le premier coup
   * rencontré l'emporte et la recherche reste déterministe ; fourni, il tire au
   * sort parmi les ex æquo, ce qui varie les parties sans jamais coûter un
   * point d'évaluation. Le hasard est **injecté** pour que le domaine reste
   * pur : `minimax.ts` n'appelle jamais `Math.random` lui-même.
   */
  random?: () => number
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

type OrderedTransition = {
  move: LegalMove
  transition: SimulationTransition
  orderingScore: number
}

/**
 * Trie les coups pour que l'élagage alpha-bêta rencontre les meilleurs d'abord :
 * un coup fort resserre tôt la fenêtre et coupe tout le reste. On classe chaque
 * coup par l'évaluation statique de la position qu'il produit — la même mesure
 * qu'aux feuilles —, décroissante pour le joueur qui maximise, croissante pour
 * l'adversaire qui minimise. Ce tri des nœuds internes, absent jusqu'ici, fait
 * chuter d'un ordre de grandeur le nombre de nœuds explorés sur les positions
 * larges, là où le facteur de branchement est le plus fort.
 */
function orderTransitions(
  position: GamePosition,
  moves: LegalMove[],
  orderingDepth: number,
  aiPlayer: PlayerId,
  maximizing: boolean,
): OrderedTransition[] {
  const scored = moves.map((move) => {
    const transition = simulateLegalMove(position, move)
    const orderingScore = transition.result
      ? evaluateResult(transition.result, aiPlayer, orderingDepth)
      : evaluatePosition(transition.position, aiPlayer)
    return { move, transition, orderingScore }
  })
  scored.sort((left, right) =>
    maximizing
      ? right.orderingScore - left.orderingScore
      : left.orderingScore - right.orderingScore,
  )
  return scored
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

  // Aux nœuds internes (depth ≥ 2), on trie d'abord tous les coups pour
  // rencontrer les meilleurs en premier : un coup fort élague un sous-arbre
  // entier, et le tri, qui coûte une évaluation par enfant, s'y rentabilise.
  // Au palier des feuilles (depth 1), la boucle reste paresseuse : elle simule à
  // la demande et coupe sans tout évaluer. Même boucle, sans fermeture par nœud.
  const ordered =
    depth >= 2
      ? orderTransitions(position, moves, depth - 1, context.aiPlayer, maximizing)
      : null

  for (let index = 0; index < moves.length; index += 1) {
    const transition = ordered
      ? ordered[index].transition
      : simulateLegalMove(position, moves[index])
    const score = scoreTransition(transition, depth - 1, alpha, beta, context)
    if (maximizing) {
      bestScore = Math.max(bestScore, score)
      alpha = Math.max(alpha, bestScore)
    } else {
      bestScore = Math.min(bestScore, score)
      beta = Math.min(beta, bestScore)
    }
    if (beta <= alpha) break
  }

  context.transpositions.set(key, {
    score: bestScore,
    bound: classifyTranspositionBound(bestScore, nodeAlpha, nodeBeta),
  })
  return bestScore
}

/**
 * Un coup parmi des ex æquo. Sans tirage fourni, le premier l'emporte, ce qui
 * garde la recherche déterministe. Le `Math.min` protège du tirage qui rendrait
 * exactement 1.
 */
function pickAmongEquals(moves: LegalMove[], random?: () => number): LegalMove {
  if (!random || moves.length === 1) return moves[0]
  return moves[Math.min(Math.floor(random() * moves.length), moves.length - 1)]
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
  let bestMoves: LegalMove[] = [moves[0]]
  let bestScore = Number.NEGATIVE_INFINITY
  // Le trait racine maximise toujours (l'ordinateur y joue) : même tri que les
  // nœuds internes, d'où le partage de `orderTransitions`.
  const candidates = orderTransitions(
    position,
    moves,
    depth - 1,
    context.aiPlayer,
    true,
  )

  for (const { move, transition, orderingScore } of candidates) {
    if (depth === 1) context.exploredNodes += 1
    const score = depth === 1
      ? orderingScore
      : scoreTransition(transition, depth - 1, alpha, beta, context)
    if (score > bestScore) {
      bestMoves = [move]
      bestScore = score
    } else if (score === bestScore) {
      bestMoves.push(move)
    }
    // Fenêtre ouverte d'un point sous le meilleur score, là où la recherche
    // coupait à ce score exactement. Les scores sont entiers, donc la coupure
    // reste la même pour tout coup strictement moins bon, mais un coup ex æquo
    // tombe désormais **dans** la fenêtre : son score revient exact au lieu
    // d'être une borne supérieure tronquée, seule façon de reconnaître une
    // égalité sans se laisser abuser par un élagage.
    alpha = Math.max(alpha, bestScore - 1)
    if (bestScore >= TERMINAL_SCORE) break
  }

  return {
    move: pickAmongEquals(bestMoves, options.random),
    score: bestScore,
    exploredNodes: context.exploredNodes,
  }
}

/**
 * Profondeur réellement explorée pour un niveau donné dans une position dont on
 * connaît le nombre de coups légaux.
 *
 * Le niveau fixe une profondeur visée, pas une promesse d'attente : tant que la
 * position reste large, la recherche s'arrête plus tôt pour ne pas figer
 * l'écran. Elle va au bout dès que le plateau se resserre, c'est-à-dire là où
 * la profondeur décide de la partie. On prend le premier palier du barème du
 * niveau (`DEPTH_SCHEDULE`) dont le plafond de coups couvre la position.
 */
export function getAffordableDepth(
  difficulty: Difficulty,
  legalMoveCount: number,
): number {
  for (const { depth, maxMoves } of DEPTH_SCHEDULE[difficulty]) {
    if (legalMoveCount <= maxMoves) return depth
  }
  // Inatteignable : le dernier palier de chaque barème porte un plafond infini.
  return DIFFICULTY_DEPTHS[difficulty]
}

/**
 * Coup choisi pour le joueur au trait, à la force demandée.
 *
 * `random` départage les ex æquo, comme dans `chooseMinimaxMove` : l'adversaire
 * ordinateur le fournit pour varier ses parties, le conseil l'omet pour rendre
 * deux fois la même recommandation sur une même position.
 */
export function chooseMoveForDifficulty(
  position: GamePosition,
  difficulty: Difficulty,
  random?: () => number,
): MinimaxDecision | null {
  const legalMoveCount = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  ).length
  if (legalMoveCount === 0) return null
  return chooseMinimaxMove(position, {
    depth: getAffordableDepth(difficulty, legalMoveCount),
    random,
  })
}
