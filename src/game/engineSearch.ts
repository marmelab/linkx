import {
  BLUE,
  MAX_MOVES,
  MOVE_MASK,
  applyMove,
  createEnginePosition,
  filledCells,
  flipSide,
  generateMoves,
  hasAnyMove,
  largestZone,
  loadPosition,
  remainingCells,
  totalRemainingCells,
  movePlacedWins,
  otherSide,
  remainingPlies,
  toLegalMove,
  undoMove,
} from './engineBoard'
import type { EnginePosition } from './engineBoard'
import type { LegalMove } from './legalMoves'
import type { GamePosition } from './simulation'
import { BOARD_SIZE } from './types'

/**
 * Recherche du niveau maître
 * ==========================
 *
 * Alpha-bêta outillé sur la représentation compacte d'`engineBoard` :
 * approfondissement itératif, fenêtre nulle (PVS), table de transposition avec
 * meilleur coup, coups tueurs et heuristique d'historique. Elle s'arrête **au
 * temps**, jamais à une profondeur devinée, et garde toujours sous la main le
 * meilleur coup de la dernière itération achevée.
 *
 * **Fin de partie exacte.** Une pose consomme une pièce, donc `remainingPlies`
 * majore le nombre de demi-coups restants. Dès qu'une itération atteint cette
 * profondeur, aucune feuille n'a été coupée par la profondeur : la valeur rendue
 * est la **valeur de jeu vraie** et non une estimation. C'est la même boucle qui
 * joue le milieu de partie et qui résout la fin ; il n'y a pas de second moteur.
 *
 * **Pureté.** L'horloge est injectée (`now`), comme l'aléa de départage l'était
 * déjà. Ce module n'appelle ni `Date.now` ni `Math.random`.
 */

const N = BOARD_SIZE
const CELLS = N * N
const MAX_PLY = 40

/** Valeur d'une partie gagnée. Une victoire proche vaut mieux qu'une lointaine. */
export const MATE = 1_000_000
/** Au-delà, un score désigne une partie décidée, pas une estimation. */
export const MATE_THRESHOLD = MATE - MAX_PLY - 1

// --- Évaluation --------------------------------------------------------------

const BLOCKED = 1 << 24
/** Un cran au-delà de la pire distance atteignable : traverser neuf cases. */
const AXIS_UNREACHABLE = N + 1
/**
 * L'axe le plus court domine — on gagne sur l'un *ou* l'autre —, le second ne
 * fait que départager. Même arbitrage que `evaluation.ts`, dont ce calcul est la
 * transposition sur tableaux typés.
 */
const PRIMARY_AXIS_WEIGHT = AXIS_UNREACHABLE + 1
const CONNECTION_WEIGHT = 100

/**
 * Poids du départage au blocage, croissant avec le remplissage du plateau.
 *
 * La taille de la plus grande zone ne décide la partie que si **personne** ne
 * connecte : elle ne doit donc jamais primer sur une menace de connexion, mais
 * elle pèse de plus en plus lourd à mesure que le plateau se ferme. Un écart de
 * zone de huit cases sur un plateau plein vaut ainsi moins qu'un cran d'axe
 * principal (1 100 points) — c'est un départage, pas une consigne.
 *
 * L'ancienne évaluation la pondérait à 1 contre 100, soit une quantité
 * négligeable ; c'est pourtant sur ce critère que se sont jouées les fins de
 * partie fermées.
 */
const ZONE_WEIGHT_BASE = 20
const ZONE_WEIGHT_FILL = 60

/**
 * Largeur d'un chemin : nombre de cases vides situées sur **au moins un** plus
 * court chemin, plafonné.
 *
 * C'est le correctif propre aux jeux de connexion. Mesurer la seule longueur du
 * plus court chemin donne la même valeur à un chemin unique — que l'adversaire
 * coupe d'une pièce — et à un faisceau de chemins équivalents, incoupable. La
 * littérature du Hex répond à cela par les connexions virtuelles et les réseaux
 * de résistances ; on en retient ici l'essentiel à un coût tenable : à distance
 * égale, un chemin large vaut mieux qu'un chemin étroit.
 *
 * Le plafond évite qu'une position très ouverte, où tout est encore possible,
 * pèse plus lourd qu'un cran d'avance réel.
 */
const PATH_WIDTH_CAP = 16
const PATH_WIDTH_WEIGHT = 30

// Tampons de l'évaluation. La recherche est mono-thread et n'imbrique jamais
// deux évaluations : ces tampons sont entièrement réécrits à chaque appel.
const cost = new Int32Array(CELLS)
const distanceNear = new Int32Array(CELLS)
const distanceFar = new Int32Array(CELLS)
const settled = new Uint8Array(CELLS)
let frontA: number[] = []
let frontB: number[] = []

/**
 * Coût de traversée de chaque case pour `side` : 0 sur les siennes, 1 sur une
 * case vide, infini sur une case adverse — **et infini aussi sur une case vide
 * que plus personne ne peut atteindre**.
 *
 * C'est la correction que la seule distance ne voyait pas. Une case vide ne se
 * remplit que si sa colonne monte jusqu'à elle, et la faire monter coûte
 * `top[x] - 1 - y` cases prises dans les réserves — celles des deux joueurs,
 * puisque n'importe quelle pièce fait monter la pile. Passé ce budget, la case
 * restera vide jusqu'à la fin de la partie : la compter à 1 faisait miroiter au
 * moteur des chemins qu'aucune réserve ne pouvait plus tracer.
 *
 * La borne est **sûre** dans le sens qui compte : elle ne déclare inatteignable
 * qu'une case dont on est certain qu'elle le restera, et laisse à 1 tout ce dont
 * on n'est pas sûr. Elle ne peut donc pas masquer une menace réelle.
 */
function fillCost(position: EnginePosition, side: number, stackBudget: number): void {
  const board = position.board
  const top = position.top
  for (let cell = 0; cell < CELLS; cell += 1) {
    const occupant = board[cell]
    if (occupant === side) {
      cost[cell] = 0
    } else if (occupant !== 0) {
      cost[cell] = BLOCKED
    } else {
      const x = cell % N
      const y = (cell / N) | 0
      cost[cell] = top[x] - 1 - y > stackBudget ? BLOCKED : 1
    }
  }
}

/**
 * Distances depuis l'un des deux bords d'un axe, sur tout le plateau, par un
 * parcours 0-1. Contrairement à `evaluation.ts`, ce parcours ne s'arrête pas au
 * bord opposé : la carte complète est nécessaire pour mesurer la largeur.
 */
function fillDistances(vertical: boolean, far: boolean, out: Int32Array): void {
  out.fill(BLOCKED)
  settled.fill(0)
  frontA.length = 0
  frontB.length = 0

  for (let offset = 0; offset < N; offset += 1) {
    const cell = vertical
      ? far
        ? (N - 1) * N + offset
        : offset
      : far
        ? offset * N + (N - 1)
        : offset * N
    const entry = cost[cell]
    if (entry >= BLOCKED) continue
    out[cell] = entry
    if (entry === 0) frontA.push(cell)
    else frontB.push(cell)
  }

  while (frontA.length > 0 || frontB.length > 0) {
    if (frontA.length === 0) {
      const swap = frontA
      frontA = frontB.reverse()
      frontB = swap
    }
    const current = frontA.pop()
    if (current === undefined || settled[current]) continue
    settled[current] = 1
    const currentDistance = out[current]
    const x = current % N
    const y = (current / N) | 0

    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy
      if (ny < 0 || ny >= N) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        if (nx < 0 || nx >= N) continue
        const next = ny * N + nx
        if (settled[next] || cost[next] >= BLOCKED) continue
        const candidate = currentDistance + cost[next]
        if (candidate < out[next]) {
          out[next] = candidate
          if (cost[next] === 0) frontA.push(next)
          else frontB.push(next)
        }
      }
    }
  }
}

// Résultats du dernier axe mesuré, pour éviter d'allouer un objet par appel.
let axisDistance = 0
let axisWidth = 0

function measureAxis(position: EnginePosition, vertical: boolean): void {
  fillDistances(vertical, false, distanceNear)

  let best = BLOCKED
  for (let offset = 0; offset < N; offset += 1) {
    const cell = vertical ? (N - 1) * N + offset : offset * N + (N - 1)
    if (distanceNear[cell] < best) best = distanceNear[cell]
  }
  axisDistance = best
  axisWidth = 0
  if (best >= BLOCKED) return

  fillDistances(vertical, true, distanceFar)
  const board = position.board
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (board[cell] !== 0) continue
    if (distanceNear[cell] + distanceFar[cell] - cost[cell] === best) {
      axisWidth += 1
    }
  }
}

const finiteAxis = (value: number): number =>
  value >= AXIS_UNREACHABLE ? AXIS_UNREACHABLE : value

// Potentiel et largeur du dernier joueur mesuré.
let playerPotential = 0
let playerWidth = 0

/**
 * Potentiel de connexion d'un joueur — bas vaut mieux — et largeur de son axe
 * dominant. L'axe le plus court domine, le second départage : même arbitrage
 * que `evaluation.ts`, dont ce calcul est la transposition sur tableaux typés.
 */
function measurePlayer(
  position: EnginePosition,
  side: number,
  ownBudget: number,
  stackBudget: number,
): void {
  fillCost(position, side, stackBudget)

  measureAxis(position, false)
  const horizontal = axisDistance
  const horizontalWidth = axisWidth

  measureAxis(position, true)
  const vertical = axisDistance
  const verticalWidth = axisWidth

  // Un axe qui demande plus de cases qu'il n'en reste en réserve est mort : le
  // joueur doit **posséder** chaque case du chemin, et il ne peut pas en poser
  // plus qu'il n'a de pièces. Sans cette borne, le moteur défendait encore
  // contre une menace que l'adversaire n'avait plus les moyens de conclure, et
  // négligeait le départage au blocage — précisément la fin de partie perdue.
  const reachable = (distance: number): number =>
    distance > ownBudget ? BLOCKED : distance
  const horizontalReach = reachable(horizontal)
  const verticalReach = reachable(vertical)

  const horizontalLeads = horizontalReach <= verticalReach
  const primary = finiteAxis(horizontalLeads ? horizontalReach : verticalReach)
  const secondary = finiteAxis(horizontalLeads ? verticalReach : horizontalReach)
  playerPotential = primary * PRIMARY_AXIS_WEIGHT + secondary
  playerWidth = Math.min(
    horizontalLeads ? horizontalWidth : verticalWidth,
    PATH_WIDTH_CAP,
  )
}

/** Évaluation statique, du point de vue du joueur au trait. */
export function evaluate(position: EnginePosition): number {
  const side = position.side
  const opponent = otherSide(side)

  const stackBudget = totalRemainingCells(position)
  measurePlayer(position, side, remainingCells(position, side), stackBudget)
  const myPotential = playerPotential
  const myWidth = playerWidth

  measurePlayer(position, opponent, remainingCells(position, opponent), stackBudget)
  const connection = playerPotential - myPotential
  const width = myWidth - playerWidth

  const zoneWeight =
    ZONE_WEIGHT_BASE + Math.round((ZONE_WEIGHT_FILL * filledCells(position)) / CELLS)
  const zone = largestZone(position, side) - largestZone(position, opponent)

  return (
    connection * CONNECTION_WEIGHT +
    width * PATH_WIDTH_WEIGHT +
    zone * zoneWeight
  )
}

/** Valeur d'une fin par blocage, du point de vue de `side`. */
function stalemateValue(position: EnginePosition, side: number, ply: number): number {
  const mine = largestZone(position, side)
  const theirs = largestZone(position, otherSide(side))
  if (mine === theirs) return 0
  return mine > theirs ? MATE - ply : -MATE + ply
}

// --- Table de transposition --------------------------------------------------

const TT_BITS = 18
const TT_SIZE = 1 << TT_BITS
const TT_MASK = TT_SIZE - 1

const EXACT = 0
const LOWER = 1
const UPPER = 2

const ttKeyA = new Int32Array(TT_SIZE)
const ttKeyB = new Int32Array(TT_SIZE)
const ttScore = new Int32Array(TT_SIZE)
const ttMove = new Int32Array(TT_SIZE)
const ttDepth = new Int8Array(TT_SIZE)
const ttFlag = new Int8Array(TT_SIZE)
const ttFilled = new Uint8Array(TT_SIZE)

/**
 * Vide la table. Elle survit d'un coup à l'autre — une valeur reste vraie tant
 * que l'évaluation ne change pas —, ce qui accélère les coups suivants.
 */
export function clearTranspositions(): void {
  ttFilled.fill(0)
}

// --- Contexte de recherche ---------------------------------------------------

const moveBuffer = new Int32Array(MAX_PLY * MAX_MOVES)
const orderBuffer = new Int32Array(MAX_PLY * MAX_MOVES)
const killers = new Int32Array(MAX_PLY * 2)
const history = new Int32Array(2 * (MOVE_MASK + 1))

type SearchContext = {
  position: EnginePosition
  now: () => number
  deadline: number
  /** Plafond de nœuds, `Infinity` quand la recherche est bornée au temps. */
  maxNodes: number
  nodes: number
  aborted: boolean
}

const CHECK_INTERVAL = 2047

function exhausted(context: SearchContext): boolean {
  if (context.aborted) return true
  if (context.nodes >= context.maxNodes) {
    context.aborted = true
  } else if (
    context.maxNodes === Number.POSITIVE_INFINITY &&
    (context.nodes & CHECK_INTERVAL) === 0 &&
    context.now() >= context.deadline
  ) {
    context.aborted = true
  }
  return context.aborted
}

/**
 * Classe les coups sans les simuler : coup de la table d'abord, puis les deux
 * tueurs du palier, puis l'historique des coupures. Ce classement ne coûte
 * qu'une lecture par coup, là où évaluer chaque enfant coûtait une recherche
 * complète de position.
 */
function scoreMoves(
  moves: Int32Array,
  scores: Int32Array,
  base: number,
  count: number,
  ttBest: number,
  ply: number,
  side: number,
): void {
  const killerA = killers[ply * 2]
  const killerB = killers[ply * 2 + 1]
  const historyBase = (side - 1) * (MOVE_MASK + 1)
  for (let i = 0; i < count; i += 1) {
    const move = moves[base + i]
    scores[base + i] =
      move === ttBest
        ? 1 << 30
        : move === killerA
          ? 1 << 29
          : move === killerB
            ? (1 << 29) - 1
            : history[historyBase + move]
  }
}

/** Amène en tête le coup de meilleur score restant (tri par sélection). */
function pickBest(
  moves: Int32Array,
  scores: Int32Array,
  base: number,
  count: number,
  from: number,
): void {
  let best = from
  for (let i = from + 1; i < count; i += 1) {
    if (scores[base + i] > scores[base + best]) best = i
  }
  if (best === from) return
  const move = moves[base + from]
  moves[base + from] = moves[base + best]
  moves[base + best] = move
  const score = scores[base + from]
  scores[base + from] = scores[base + best]
  scores[base + best] = score
}

function recordCutoff(move: number, ply: number, side: number, depth: number): void {
  if (killers[ply * 2] !== move) {
    killers[ply * 2 + 1] = killers[ply * 2]
    killers[ply * 2] = move
  }
  const slot = (side - 1) * (MOVE_MASK + 1) + move
  history[slot] += depth * depth
  // Sans plafond, l'historique finit par écraser tueurs et coup de table.
  if (history[slot] > 1 << 28) {
    for (let i = 0; i < history.length; i += 1) history[i] >>= 1
  }
}

/**
 * Negamax : le score rendu est toujours du point de vue du joueur au trait.
 *
 * Une passe forcée ne change pas le trait ; la récursion se fait alors **sans**
 * négation et avec la même fenêtre, sinon les deux camps seraient confondus.
 */
function search(
  context: SearchContext,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  const position = context.position
  context.nodes += 1
  if (exhausted(context)) return 0

  const alphaOrigin = alpha
  const slot = position.hashA & TT_MASK
  let ttBest = 0
  if (
    ttFilled[slot] === 1 &&
    ttKeyA[slot] === position.hashA &&
    ttKeyB[slot] === position.hashB
  ) {
    ttBest = ttMove[slot]
    if (ttDepth[slot] >= depth) {
      let score = ttScore[slot]
      if (score > MATE_THRESHOLD) score -= ply
      else if (score < -MATE_THRESHOLD) score += ply
      const flag = ttFlag[slot]
      if (flag === EXACT) return score
      if (flag === LOWER && score >= beta) return score
      if (flag === UPPER && score <= alpha) return score
    }
  }

  if (depth <= 0) return evaluate(position)

  const base = ply * MAX_MOVES
  const count = generateMoves(position, moveBuffer, base)
  // Le joueur au trait a toujours un coup ici : l'appelant a déjà résolu la
  // passe forcée et le blocage avant de récurser.
  if (count === 0) return evaluate(position)
  scoreMoves(moveBuffer, orderBuffer, base, count, ttBest, ply, position.side)

  let best = -MATE - 1
  let bestMove = 0
  const mover = position.side

  for (let index = 0; index < count; index += 1) {
    pickBest(moveBuffer, orderBuffer, base, count, index)
    const move = moveBuffer[base + index]
    applyMove(position, move)

    let score: number
    if (movePlacedWins(position, move, mover)) {
      score = MATE - ply
    } else if (hasAnyMove(position, position.side)) {
      if (index === 0) {
        score = -search(context, depth - 1, -beta, -alpha, ply + 1)
      } else {
        // Fenêtre nulle : on ne cherche qu'à savoir si ce coup dépasse alpha.
        score = -search(context, depth - 1, -alpha - 1, -alpha, ply + 1)
        if (score > alpha && score < beta) {
          score = -search(context, depth - 1, -beta, -alpha, ply + 1)
        }
      }
    } else {
      flipSide(position)
      if (hasAnyMove(position, position.side)) {
        score = search(context, depth - 1, alpha, beta, ply + 1)
      } else {
        score = stalemateValue(position, mover, ply)
      }
      flipSide(position)
    }

    undoMove(position, move)
    if (context.aborted) return 0

    if (score > best) {
      best = score
      bestMove = move
    }
    if (best > alpha) alpha = best
    if (alpha >= beta) {
      recordCutoff(move, ply, mover, depth)
      break
    }
  }

  let stored = best
  if (stored > MATE_THRESHOLD) stored += ply
  else if (stored < -MATE_THRESHOLD) stored -= ply
  ttFilled[slot] = 1
  ttKeyA[slot] = position.hashA
  ttKeyB[slot] = position.hashB
  ttScore[slot] = stored
  ttMove[slot] = bestMove
  ttDepth[slot] = depth
  ttFlag[slot] = best <= alphaOrigin ? UPPER : best >= beta ? LOWER : EXACT
  return best
}

export type RootSearch = {
  /** Tous les coups de valeur strictement égale à la meilleure, avant tirage. */
  moves: number[]
  score: number
}

/**
 * Recherche à la racine. La fenêtre alpha reste ouverte d'un point sous le
 * meilleur score pour qu'un ex æquo revienne **exact** au lieu d'une borne
 * tronquée — même raison qu'à la racine de `minimax.ts`, et sans quoi le tirage
 * de départage n'aurait jamais qu'un candidat.
 */
function searchRoot(context: SearchContext, depth: number): RootSearch | null {
  const position = context.position
  const count = generateMoves(position, moveBuffer, 0)
  if (count === 0) return null

  const slot = position.hashA & TT_MASK
  const ttBest =
    ttFilled[slot] === 1 &&
    ttKeyA[slot] === position.hashA &&
    ttKeyB[slot] === position.hashB
      ? ttMove[slot]
      : 0
  scoreMoves(moveBuffer, orderBuffer, 0, count, ttBest, 0, position.side)

  const mover = position.side
  let alpha = -MATE - 1
  let best = -MATE - 1
  let bestMoves: number[] = []

  for (let index = 0; index < count; index += 1) {
    pickBest(moveBuffer, orderBuffer, 0, count, index)
    const move = moveBuffer[index]
    applyMove(position, move)

    let score: number
    if (movePlacedWins(position, move, mover)) {
      score = MATE
    } else if (hasAnyMove(position, position.side)) {
      score = -search(context, depth - 1, -MATE - 1, -alpha, 1)
    } else {
      flipSide(position)
      if (hasAnyMove(position, position.side)) {
        score = search(context, depth - 1, alpha, MATE + 1, 1)
      } else {
        score = stalemateValue(position, mover, 0)
      }
      flipSide(position)
    }

    undoMove(position, move)
    if (context.aborted) break

    if (score > best) {
      best = score
      bestMoves = [move]
    } else if (score === best) {
      bestMoves.push(move)
    }
    if (best - 1 > alpha) alpha = best - 1
  }

  if (bestMoves.length === 0) return null
  return { moves: bestMoves, score: best }
}

const pvBuffer = new Int32Array(MAX_MOVES)

/**
 * Variante principale de la dernière recherche, lue dans la table.
 *
 * Elle sert au livre d'ouverture : les positions qu'elle traverse ont déjà été
 * analysées par la recherche qui vient de finir, à une profondeur amputée d'un
 * demi-coup par pli parcouru. Les inscrire au livre ne coûte donc rien.
 *
 * Deux conditions rendent cette récolte **saine**, et il ne faut en relâcher
 * aucune. Seul un nœud marqué `EXACT` est retenu : un nœud `LOWER` ou `UPPER`
 * n'a pas été évalué mais seulement réfuté à fenêtre nulle, et le coup que la
 * table y garde est un coup de coupure, pas un meilleur coup prouvé. Et le coup
 * lu est vérifié légal avant d'être joué, la table pouvant rendre l'entrée d'une
 * autre position sur collision des deux empreintes.
 *
 * La variante s'arrête d'elle-même dès qu'une entrée manque — la table étant à
 * remplacement systématique, un nœud de la variante a pu être écrasé.
 */
function collectPrincipalVariation(
  position: EnginePosition,
  rootMove: number,
  limit: number,
): LegalMove[] {
  const line: LegalMove[] = [toLegalMove(rootMove)]
  const played: number[] = [rootMove]
  applyMove(position, rootMove)

  while (line.length < limit) {
    const slot = position.hashA & TT_MASK
    if (
      ttFilled[slot] !== 1 ||
      ttKeyA[slot] !== position.hashA ||
      ttKeyB[slot] !== position.hashB ||
      ttFlag[slot] !== EXACT
    ) {
      break
    }
    const move = ttMove[slot]
    if (move === 0) break

    const count = generateMoves(position, pvBuffer, 0)
    let legal = false
    for (let i = 0; i < count; i += 1) {
      if (pvBuffer[i] === move) {
        legal = true
        break
      }
    }
    if (!legal) break

    line.push(toLegalMove(move))
    played.push(move)
    applyMove(position, move)
  }

  for (let i = played.length - 1; i >= 0; i -= 1) undoMove(position, played[i])
  return line
}

// --- Entrée publique ---------------------------------------------------------

export type MasterSearchOptions = {
  /** Horloge injectée : le domaine n'en appelle jamais une lui-même. */
  now?: () => number
  /**
   * Temps de réflexion accordé, en millisecondes. Une recherche bornée au temps
   * est **anytime** mais pas reproductible : deux appels sur une même position
   * peuvent s'arrêter à des profondeurs différentes. C'est ce qu'il faut pour
   * l'adversaire, qui doit répondre dans un délai tenu.
   */
  budgetMs?: number
  /**
   * Plafond de nœuds. Fourni, il **remplace** le budget de temps et l'horloge
   * n'est jamais consultée : la recherche devient alors strictement
   * déterministe, à position égale. C'est ce qu'il faut pour le conseil, dont
   * `plan.md` exige qu'il ne change pas quand on le redemande.
   */
  maxNodes?: number
  /** Plafond de profondeur, surtout utile aux tests. */
  maxDepth?: number
  /**
   * Accepte aussi les profondeurs impaires. **Réservé au livre d'ouverture.**
   *
   * En jeu, la profondeur atteinte dépend de l'horloge et donc de la machine :
   * retenir une profondeur impaire y ferait jouer, selon l'appareil, une valeur
   * biaisée face à une valeur saine. Le livre, lui, est calculé hors ligne à
   * plafond fixe : tous les coups candidats d'une position y sont comparés à la
   * **même** profondeur, si bien que le biais est uniforme et s'annule dans le
   * classement. Le refuser coûterait un demi-coup d'anticipation pour rien — au
   * plateau vide, la profondeur 6 est hors de portée même à quatre millions de
   * positions, si bien que la parité y plafonnerait le livre au niveau du jeu.
   */
  allowOddDepth?: boolean
  /** Départage des ex æquo, comme ailleurs dans le domaine. */
  random?: () => number
}

export type MasterDecision = {
  move: LegalMove
  score: number
  /** Profondeur de la dernière itération achevée. */
  depth: number
  /** Vrai quand la valeur rendue est la valeur de jeu **exacte**. */
  exact: boolean
  nodes: number
}

export const DEFAULT_BUDGET_MS = 2_000

const searchPosition = createEnginePosition()

/**
 * Meilleur coup pour le joueur au trait, à budget de temps donné.
 *
 * La recherche approfondit tant qu'il reste du temps et rend toujours le
 * résultat de la **dernière itération achevée** : une itération interrompue est
 * jetée, jamais jouée à moitié. `exact` dit si la partie a été résolue.
 */
export type MasterSearch = {
  /** Tous les coups de valeur strictement égale à la meilleure, avant tirage. */
  moves: LegalMove[]
  score: number
  depth: number
  exact: boolean
  nodes: number
  /**
   * Variante principale, à partir du premier des ex æquo. Le livre d'ouverture
   * y récolte des positions déjà analysées ; le jeu l'ignore.
   */
  pv: LegalMove[]
}

/**
 * Recherche à la racine rendant **tout** l'ensemble des meilleurs ex æquo.
 *
 * `chooseMasterMove` n'en garde qu'un ; le générateur du livre d'ouverture
 * les stocke tous, pour que le livre varie les parties sans jamais concéder un
 * point d'évaluation.
 */
export function searchMasterTopMoves(
  source: GamePosition,
  options: MasterSearchOptions = {},
): MasterSearch | null {
  const now = options.now ?? (() => Date.now())
  const budget = options.budgetMs ?? DEFAULT_BUDGET_MS
  const maxNodes = options.maxNodes ?? Number.POSITIVE_INFINITY
  const position = loadPosition(searchPosition, source)
  const plies = remainingPlies(position)
  const ceiling = Math.min(options.maxDepth ?? MAX_PLY, plies, MAX_PLY - 1)

  // Tueurs, historique et table sont remis à zéro à chaque recherche : sans
  // cela le résultat dépendrait des recherches précédentes, et le conseil ne
  // serait plus stable d'un appel à l'autre. On y perd la réutilisation d'un
  // coup au suivant ; la reproductibilité vaut davantage.
  killers.fill(0)
  history.fill(0)
  clearTranspositions()

  const timed = maxNodes === Number.POSITIVE_INFINITY
  const context: SearchContext = {
    position,
    now,
    // Sous plafond de nœuds, l'horloge n'est **jamais** lue — pas même pour
    // fixer une échéance : c'est ce qui rend la recherche reproductible.
    deadline: timed ? now() + budget : Number.POSITIVE_INFINITY,
    maxNodes,
    nodes: 0,
    aborted: false,
  }

  let decision: MasterSearch | null = null
  for (let depth = 1; depth <= ceiling; depth += 1) {
    const result = searchRoot(context, depth)
    if (context.aborted || !result) break

    const exact = depth >= plies || Math.abs(result.score) > MATE_THRESHOLD
    // Une profondeur **impaire** s'arrête juste après un coup du moteur : elle
    // voit son propre gain sans voir la réponse, et surestime donc la position.
    // Le biais est loin d'être théorique — à budget serré, ne retenir que les
    // profondeurs impaires faisait passer le niveau de 8 victoires sur 8 contre
    // le maître à 4 sur 8. Comme le budget est en temps, la profondeur atteinte
    // dépend de la machine : un téléphone lent tomberait sur la mauvaise parité
    // et jouerait nettement plus faible. On ne **retient** donc qu'une
    // profondeur paire — les impaires servent quand même à ordonner les coups de
    // l'itération suivante, ce qui ne coûte presque rien. Exceptions : la
    // profondeur 1, pour avoir toujours un coup sous la main, et une valeur
    // exacte, qui ne souffre d'aucun biais puisqu'elle ne dépend d'aucune
    // évaluation.
    if (options.allowOddDepth || depth % 2 === 0 || depth === 1 || exact) {
      decision = {
        moves: result.moves.map(toLegalMove),
        score: result.score,
        depth,
        // Aucune feuille n'a été coupée par la profondeur : la valeur est vraie.
        exact,
        nodes: context.nodes,
        // Relevée maintenant : la table décrit l'itération qui vient de finir,
        // et une itération suivante, même abandonnée, en écraserait des nœuds.
        pv: collectPrincipalVariation(position, result.moves[0], depth),
      }
      if (exact) break
    }
    // Approfondir coûte plusieurs fois l'itération précédente : sans marge, on
    // en lance une qu'on n'a aucune chance d'achever. La marge est doublée
    // après une profondeur impaire : s'arrêter là rendrait un coup plus ancien,
    // donc il vaut mieux ne pas s'y engager sans de quoi finir la suivante.
    // Sans budget de temps, la borne est le plafond de nœuds, que `exhausted`
    // fait respecter.
    const margin = depth % 2 === 0 ? budget / 4 : budget / 2
    if (timed && now() >= context.deadline - margin) break
  }

  if (decision) return decision

  // Budget épuisé avant la première itération : on rend un coup légal plutôt
  // que rien, l'interface ne doit jamais rester sans réponse.
  const count = generateMoves(position, moveBuffer, 0)
  if (count === 0) return null
  return {
    moves: [toLegalMove(moveBuffer[0])],
    score: 0,
    depth: 0,
    exact: false,
    nodes: context.nodes,
    pv: [toLegalMove(moveBuffer[0])],
  }
}

export function chooseMasterMove(
  source: GamePosition,
  options: MasterSearchOptions = {},
): MasterDecision | null {
  const search = searchMasterTopMoves(source, options)
  if (!search) return null
  return {
    move:
      search.moves.length === 1 || !options.random
        ? search.moves[0]
        : search.moves[
            Math.min(
              Math.floor(options.random() * search.moves.length),
              search.moves.length - 1,
            )
          ],
    score: search.score,
    depth: search.depth,
    exact: search.exact,
    nodes: search.nodes,
  }
}

/** Le camp bleu, pour les tests qui veulent parler en côtés du moteur. */
export const ENGINE_BLUE = BLUE
