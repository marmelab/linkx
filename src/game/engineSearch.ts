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
import {
  CELL_BIT,
  CELL_LIMB,
  EDGE_BOTTOM,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  LIMBS,
  LIMB_MASK,
  createLayers,
  fillLayers,
  setTerrain,
  popcount,
} from './bitboard'
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
 * L'axe le plus court domine : on gagne sur l'un *ou* l'autre. Le second compte
 * aussi, mais moins — voir `SECONDARY_AXIS_WEIGHT`, qui est l'écart entre cette
 * évaluation et celle de `evaluation.ts`, restée lexicographique pour les trois
 * premiers niveaux.
 */
const PRIMARY_AXIS_WEIGHT = AXIS_UNREACHABLE + 1
const CONNECTION_WEIGHT = 100

/**
 * Poids du **second** axe dans le potentiel de connexion.
 *
 * À 1, le potentiel est un ordre lexicographique : `PRIMARY_AXIS_WEIGHT` étant
 * strictement supérieur à toute la plage du second axe, un cran sur l'axe
 * dominant l'emporte sur n'importe quelle variation du second, qui ne peut donc
 * que départager des égalités.
 *
 * C'est discutable dans **ce** jeu. Contrairement au Hex, aucun joueur ne se
 * voit assigner un axe : menacer les deux paires de bords à la fois est l'arme
 * principale, et l'ordre lexicographique la valorise à peine — une position à
 * distance 3 sur les deux axes y est jugée pire qu'une position à distance 2 sur
 * un axe et bloquée sur l'autre, alors qu'elle est bien plus difficile à
 * couper. Le poids est donc un réglage à mesurer, pas une évidence.
 *
 * **Mesuré.** À 3 contre 1, 30 victoires à 18 sur 48 parties appariées, et
 * 7 ouvertures gagnées des deux couleurs contre 1 (test des signes p = 0,07).
 * À 5 contre 3, en revanche, 49 % — les deux se valent. Le gain vient donc de
 * sortir de l'ordre lexicographique, pas du réglage fin du poids ; 3 est retenu
 * comme la plus petite valeur qui le fasse.
 */
const SECONDARY_AXIS_WEIGHT = 3

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

/**
 * Avantage du trait, en points d'évaluation.
 *
 * Sans lui, une position vaut plus cher vue juste après un coup qu'après la
 * réponse : le joueur au trait tient un gain que l'autre n'a pas encore
 * annulé. Le biais est mesurable — `scripts/bench-moteur.ts` affiche le score
 * de chaque palier, et les paliers impairs revenaient de plusieurs centaines de
 * points au-dessus de leurs voisins pairs, soit près d'un cran d'axe principal.
 *
 * C'est ce biais, et non la profondeur, qui rendait une profondeur impaire
 * inexploitable : la recherche la calculait puis la jetait. Un terme constant
 * ajouté au joueur au trait décale les feuilles paires de `+TEMPO` et les
 * impaires de `-TEMPO`, donc referme l'écart de `2 × TEMPO`.
 *
 * **Calibrage.** La valeur est mesurée, pas devinée : sur les 26 comparaisons
 * de profondeurs 4, 5 et 6 de la partie de référence, l'écart moyen impair
 * moins pair valait environ 1 250 points sans terme de tempo, et une vingtaine
 * avec celui-ci. Le recalibrer après **toute** modification de l'évaluation —
 * changer le poids du second axe a déplacé l'écart de 200 points. La correction
 * à appliquer est la moitié de l'écart moyen constaté, et un test garde cet
 * étalonnage.
 *
 * La correction n'est pas parfaite — une passe forcée récurse sans changer le
 * trait et retourne le signe pour ce sous-arbre, et l'écart réel varie d'une
 * position à l'autre — mais elle annule le biais **en moyenne**, ce qui suffit
 * à rendre une profondeur impaire aussi jouable qu'une paire.
 */
export const TEMPO = 819

/**
 * L'évaluation travaille sur des **plateaux de bits** (`bitboard.ts`) : les 81
 * cases tiennent dans trois mots, et le voisinage à huit cases d'un ensemble
 * entier s'obtient en quatre décalages. Le parcours de distances en visitait
 * près de quatre mille par évaluation, une par une.
 */

/** Cases vides franchissables du joueur mesuré, relues par `axisWidth`. */
let free0 = 0
let free1 = 0
let free2 = 0

const horizontalLayers = createLayers()
const verticalLayers = createLayers()
const returnLayers = createLayers()

/**
 * Distance de connexion d'un axe, et couches laissées derrière elle pour la
 * mesure de largeur. `BLOCKED` quand le bord d'arrivée est hors d'atteinte.
 */
function axisDistance(entry: Int32Array, exit: Int32Array, layers: Int32Array): number {
  const distance = fillLayers(entry, exit, layers)
  return distance < 0 ? BLOCKED : distance
}

/**
 * Cases d'une colonne situées à la ligne `from` ou en dessous, en plateau de
 * bits, indexées `(x * (N + 1) + from) * LIMBS`. Une colonne hors budget se
 * retire alors d'un masque, sans parcourir le plateau.
 */
const COLUMN_FROM = new Int32Array(N * (N + 1) * LIMBS)
for (let x = 0; x < N; x += 1) {
  for (let from = N - 1; from >= 0; from -= 1) {
    const slot = (x * (N + 1) + from) * LIMBS
    const cell = from * N + x
    for (let limb = 0; limb < LIMBS; limb += 1) {
      COLUMN_FROM[slot + limb] = COLUMN_FROM[slot + LIMBS + limb]
    }
    COLUMN_FROM[slot + CELL_LIMB[cell]] |= CELL_BIT[cell]
  }
}

/**
 * Terrain du parcours de distances pour `side` : ses cases, franchissables sans
 * coût, et les cases vides, qui coûtent un pas. Tout le reste est
 * infranchissable — les cases adverses, **et les cases vides que plus personne
 * ne peut atteindre**.
 *
 * C'est la correction que la seule distance ne voyait pas. Une case vide ne se
 * remplit que si sa colonne monte jusqu'à elle, et la faire monter coûte
 * `top[x] - 1 - y` cases prises dans les réserves — celles des **deux** joueurs,
 * puisque n'importe quelle pièce fait monter la pile. Passé ce budget, la case
 * restera vide jusqu'à la fin de la partie : la compter à un pas faisait
 * miroiter au moteur des chemins qu'aucune réserve ne pouvait plus tracer. La
 * borne est sûre dans le sens qui compte — elle n'écarte qu'une case dont on est
 * certain qu'elle le restera — et ne peut donc masquer aucune menace réelle.
 */
function fillMasks(position: EnginePosition, side: number, stackBudget: number): void {
  const bits = position.bits
  const base = (side - 1) * LIMBS
  const other = (otherSide(side) - 1) * LIMBS
  let f0 = ~(bits[base] | bits[other]) & LIMB_MASK
  let f1 = ~(bits[base + 1] | bits[other + 1]) & LIMB_MASK
  let f2 = ~(bits[base + 2] | bits[other + 2]) & LIMB_MASK

  // Tant qu'il reste huit cases en réserve, aucune case vide n'est hors
  // d'atteinte : le budget ne se regarde qu'en toute fin de partie.
  if (stackBudget < N - 1) {
    const top = position.top
    let reach0 = 0
    let reach1 = 0
    let reach2 = 0
    for (let x = 0; x < N; x += 1) {
      const lowest = top[x] - 1 - stackBudget
      const slot = (x * (N + 1) + (lowest > 0 ? lowest : 0)) * LIMBS
      reach0 |= COLUMN_FROM[slot]
      reach1 |= COLUMN_FROM[slot + 1]
      reach2 |= COLUMN_FROM[slot + 2]
    }
    f0 &= reach0
    f1 &= reach1
    f2 &= reach2
  }

  free0 = f0
  free1 = f1
  free2 = f2
  setTerrain(bits[base], bits[base + 1], bits[base + 2], f0, f1, f2)
}

/**
 * Largeur d'un axe : cases vides situées sur **au moins un** plus court chemin.
 * Voir `PATH_WIDTH_WEIGHT` pour ce qu'elle vaut dans l'évaluation.
 *
 * Une case vide est sur un plus court chemin quand sa distance à l'aller plus sa
 * distance au retour valent la longueur du chemin plus son propre pas, soit
 * `aller + retour = best + 1`. En couches, cela se lit sans parcourir le
 * plateau : on croise la couche `d` de l'aller avec la couche `best + 1 - d` du
 * retour. On ne le fait que pour l'axe **dominant**, le seul dont la largeur
 * compte.
 */
function axisWidth(
  near: Int32Array,
  exit: Int32Array,
  entry: Int32Array,
  best: number,
): number {
  if (best >= BLOCKED) return 0
  fillLayers(exit, entry, returnLayers)
  let width = 0
  for (let depth = 1; depth <= best; depth += 1) {
    const here = depth * LIMBS
    const back = (best + 1 - depth) * LIMBS
    width +=
      popcount(near[here] & returnLayers[back] & free0) +
      popcount(near[here + 1] & returnLayers[back + 1] & free1) +
      popcount(near[here + 2] & returnLayers[back + 2] & free2)
  }
  return width
}

const finiteAxis = (value: number): number =>
  value >= AXIS_UNREACHABLE ? AXIS_UNREACHABLE : value

// Potentiel et largeur du dernier joueur mesuré.
let playerPotential = 0
let playerWidth = 0

/**
 * Potentiel de connexion d'un joueur — bas vaut mieux — et largeur de son axe
 * dominant. L'axe le plus court pèse `PRIMARY_AXIS_WEIGHT`, le second
 * `SECONDARY_AXIS_WEIGHT`.
 */
function measurePlayer(
  position: EnginePosition,
  side: number,
  ownBudget: number,
  stackBudget: number,
  secondaryWeight: number,
): void {
  fillMasks(position, side, stackBudget)

  const horizontal = axisDistance(EDGE_LEFT, EDGE_RIGHT, horizontalLayers)
  const vertical = axisDistance(EDGE_TOP, EDGE_BOTTOM, verticalLayers)

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
  playerPotential = primary * PRIMARY_AXIS_WEIGHT + secondary * secondaryWeight
  playerWidth = Math.min(
    horizontalLeads
      ? axisWidth(horizontalLayers, EDGE_RIGHT, EDGE_LEFT, horizontal)
      : axisWidth(verticalLayers, EDGE_BOTTOM, EDGE_TOP, vertical),
    PATH_WIDTH_CAP,
  )
}

/** Évaluation statique, du point de vue du joueur au trait. */
export function evaluate(
  position: EnginePosition,
  secondaryWeight: number = SECONDARY_AXIS_WEIGHT,
): number {
  const side = position.side
  const opponent = otherSide(side)

  const stackBudget = totalRemainingCells(position)
  measurePlayer(position, side, remainingCells(position, side), stackBudget, secondaryWeight)
  const myPotential = playerPotential
  const myWidth = playerWidth

  measurePlayer(
    position,
    opponent,
    remainingCells(position, opponent),
    stackBudget,
    secondaryWeight,
  )
  const connection = playerPotential - myPotential
  const width = myWidth - playerWidth

  const zoneWeight =
    ZONE_WEIGHT_BASE + Math.round((ZONE_WEIGHT_FILL * filledCells(position)) / CELLS)
  const zone = largestZone(position, side) - largestZone(position, opponent)

  return (
    connection * CONNECTION_WEIGHT +
    width * PATH_WIDTH_WEIGHT +
    zone * zoneWeight +
    TEMPO
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
  /** Réduire les coups tardifs. Voir `reduction`. */
  reduce: boolean
  /** Poids du second axe dans l'évaluation. Voir `SECONDARY_AXIS_WEIGHT`. */
  secondaryWeight: number
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
 * Réduction des coups tardifs.
 *
 * Le facteur de branchement de ce jeu est de 95 à l'ouverture — c'est lui, et
 * non le débit, qui plafonne l'anticipation : monter d'un palier coûte cinq à
 * neuf fois le palier précédent (`scripts/bench-moteur.ts`). Accélérer la
 * machine ne fait que déplacer ce mur ; le faire reculer demande de ne pas
 * accorder à tous les coups la même profondeur.
 *
 * Les coups sont déjà triés : coup de la table, tueurs, puis historique des
 * coupures. Passé les premiers, un coup n'est presque jamais le meilleur. On le
 * cherche donc à profondeur réduite, à fenêtre nulle, et **on le recherche à
 * pleine profondeur dès qu'il dépasse alpha** — la réduction ne peut donc
 * jamais faire manquer un bon coup, seulement retarder sa découverte.
 *
 * Ni le coup de la table ni les tueurs ne sont réduits : ce sont ceux dont on a
 * déjà la preuve qu'ils valent quelque chose ici.
 *
 * **Limite à connaître.** Un coup réduit qui reste sous alpha n'est pas
 * rejugé : la réduction est donc une heuristique, pas une équivalence, et une
 * recherche qui réduit ne **prouve** plus rien. C'est pourquoi
 * `searchMasterTopMoves` la coupe sur l'itération qui résout la fin de partie
 * (`depth >= remainingPlies`) : là, la valeur rendue doit être la valeur de jeu
 * vraie, pas une estimation. Les scores de mat, eux, restent sûrs — ils
 * naissent de `movePlacedWins` et de `stalemateValue`, qui ne dépendent
 * d'aucune profondeur.
 */
const LMR_MIN_DEPTH = 3
const LMR_MIN_INDEX = 4
const LMR_DEEP_INDEX = 12
/** Seuil de score au-dessus duquel un coup est un tueur ou celui de la table. */
const ORDER_TRUSTED = (1 << 29) - 1

function reduction(depth: number, index: number, order: number): number {
  if (depth < LMR_MIN_DEPTH || index < LMR_MIN_INDEX || order >= ORDER_TRUSTED) {
    return 0
  }
  return index < LMR_DEEP_INDEX ? 1 : 2
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

  if (depth <= 0) return evaluate(position, context.secondaryWeight)

  const base = ply * MAX_MOVES
  const count = generateMoves(position, moveBuffer, base)
  // Le joueur au trait a toujours un coup ici : l'appelant a déjà résolu la
  // passe forcée et le blocage avant de récurser.
  if (count === 0) return evaluate(position, context.secondaryWeight)
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
        // Fenêtre nulle : on ne cherche qu'à savoir si ce coup dépasse alpha,
        // et à profondeur réduite s'il est classé assez loin pour cela.
        const cut = context.reduce ? reduction(depth, index, orderBuffer[base + index]) : 0
        score = -search(context, depth - 1 - cut, -alpha - 1, -alpha, ply + 1)
        // Un coup réduit qui dépasse quand même alpha a droit à sa profondeur
        // pleine : c'est ce qui rend la réduction sans perte.
        if (cut > 0 && score > alpha) {
          score = -search(context, depth - 1, -alpha - 1, -alpha, ply + 1)
        }
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
  /**
   * Coups racine dont la recherche est allée à son terme. Inférieur à leur
   * nombre total quand le budget s'est épuisé en cours d'itération : l'appelant
   * s'en sert pour décider si le résultat partiel vaut mieux que le palier
   * précédent.
   */
  completed: number
}

/**
 * Recherche à la racine.
 *
 * Deux points la distinguent d'un nœud interne. La fenêtre alpha reste ouverte
 * d'un point sous le meilleur score, pour qu'un ex æquo revienne **exact** au
 * lieu d'une borne tronquée — même raison qu'à la racine de `minimax.ts`, et
 * sans quoi le tirage de départage n'aurait jamais qu'un candidat. Et la
 * fenêtre nulle y est employée comme ailleurs : chercher chaque coup à fenêtre
 * pleine interdisait toute coupure là où il y a le plus de coups — 95 à
 * l'ouverture —, donc au poste le plus cher de l'arbre.
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
  let completed = 0

  for (let index = 0; index < count; index += 1) {
    pickBest(moveBuffer, orderBuffer, 0, count, index)
    const move = moveBuffer[index]
    applyMove(position, move)

    let score: number
    if (movePlacedWins(position, move, mover)) {
      score = MATE
    } else if (hasAnyMove(position, position.side)) {
      if (index === 0) {
        score = -search(context, depth - 1, -MATE - 1, -alpha, 1)
      } else {
        // Fenêtre nulle : savoir si ce coup atteint le meilleur score suffit à
        // écarter tous ceux qui sont strictement moins bons. Un dépassement
        // — donc un ex æquo ou un progrès — impose seul une seconde recherche,
        // à fenêtre pleine, pour obtenir la valeur exacte que le départage
        // réclame.
        score = -search(context, depth - 1, -alpha - 1, -alpha, 1)
        if (score > alpha && !context.aborted) {
          score = -search(context, depth - 1, -MATE - 1, -alpha, 1)
        }
      }
    } else {
      flipSide(position)
      if (hasAnyMove(position, position.side)) {
        if (index === 0) {
          score = search(context, depth - 1, alpha, MATE + 1, 1)
        } else {
          score = search(context, depth - 1, alpha, alpha + 1, 1)
          if (score > alpha && !context.aborted) {
            score = search(context, depth - 1, alpha, MATE + 1, 1)
          }
        }
      } else {
        score = stalemateValue(position, mover, 0)
      }
      flipSide(position)
    }

    undoMove(position, move)
    if (context.aborted) break
    completed += 1

    if (score > best) {
      best = score
      bestMoves = [move]
    } else if (score === best) {
      bestMoves.push(move)
    }
    if (best - 1 > alpha) alpha = best - 1
  }

  if (bestMoves.length === 0) return null
  return { moves: bestMoves, score: best, completed }
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
   * Retient les profondeurs impaires. Vrai par défaut depuis que `TEMPO` en
   * annule le biais ; l'option ne sert plus qu'à mesurer ce choix, en opposant
   * les deux arms dans `scripts/duel-appariee.ts`.
   */
  allowOddDepth?: boolean
  /**
   * Réduit les coups tardifs (voir `reduction`). **Faux par défaut** : elle
   * divise bien le nombre de nœuds par 4 à 9, mais fait 22 victoires à 26 en
   * duel apparié à nœuds égaux. L'option reste pour la remesurer une fois le
   * tri des coups amélioré.
   */
  reduce?: boolean
  /**
   * Poids du second axe dans l'évaluation (voir `SECONDARY_AXIS_WEIGHT`).
   * Réglage à mesurer, arme contre arme, dans `duel-appariee.ts`.
   */
  secondaryAxisWeight?: number
  /**
   * Retient un palier interrompu qui confirme ou améliore le précédent.
   * **Faux par défaut** : la mesure ne l'a pas départagé de son absence
   * (2 ouvertures gagnées contre 5, test des signes p = 0,45 sur 22 ouvertures).
   * Comme pour `reduce`, une profondeur nominale gagnée sur une recherche
   * incomplète ne se transforme pas en force. L'option reste pour la remesurer.
   */
  keepPartial?: boolean
  /** Départage des ex æquo, comme ailleurs dans le domaine. */
  random?: () => number
}

export type MasterDecision = {
  move: LegalMove
  score: number
  /** Profondeur du dernier palier retenu, achevé ou interrompu. */
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

  // Les paliers impairs sont retenus par défaut : `TEMPO` en annule le biais.
  // L'option ne subsiste que pour mesurer ce choix, arme contre arme.
  const keepOddDepth = options.allowOddDepth ?? true
  const reduce = options.reduce ?? false
  const keepPartial = options.keepPartial ?? false
  const secondaryWeight = options.secondaryAxisWeight ?? SECONDARY_AXIS_WEIGHT
  const timed = maxNodes === Number.POSITIVE_INFINITY
  const context: SearchContext = {
    position,
    now,
    // Sous plafond de nœuds, l'horloge n'est **jamais** lue — pas même pour
    // fixer une échéance : c'est ce qui rend la recherche reproductible.
    deadline: timed ? now() + budget : Number.POSITIVE_INFINITY,
    maxNodes,
    reduce,
    secondaryWeight,
    nodes: 0,
    aborted: false,
  }

  let decision: MasterSearch | null = null
  let previousSpent = 0
  for (let depth = 1; depth <= ceiling; depth += 1) {
    const iterationStart = timed ? now() : 0
    // L'itération qui atteint le nombre de demi-coups restants ne juge plus, elle
    // prouve : elle doit donc voir tout l'arbre, sans réduction.
    context.reduce = reduce && depth < plies
    const result = searchRoot(context, depth)
    if (!result) break

    // Une itération interrompue n'a pas examiné tous les coups racine : sa
    // valeur de jeu n'est donc pas prouvée, sauf victoire trouvée — une
    // victoire forcée reste forcée quels que soient les coups non examinés.
    const partial = context.aborted
    const exact = partial
      ? result.score > MATE_THRESHOLD
      : depth >= plies || Math.abs(result.score) > MATE_THRESHOLD
    // Une profondeur impaire s'arrête juste après un coup du moteur : elle voit
    // son propre gain sans voir la réponse. C'est le biais que `TEMPO` corrige
    // à la source ; il n'y a donc plus de raison de jeter ces paliers, et les
    // jeter coûtait cher — mesuré sur la partie de référence, la profondeur 5
    // s'achevait en 1,2 s aux demi-coups 9 et 12, pour être remplacée par une
    // profondeur 4 et cinq secondes de budget dépensées en pure perte.
    const retained = keepOddDepth || depth % 2 === 0 || depth === 1 || exact

    // Un palier **interrompu** n'est retenu que s'il confirme ou améliore le
    // précédent. Les coups racine étant triés meilleur d'abord, celui du palier
    // précédent a été réexaminé le premier et plus profondément : son score est
    // donc mieux fondé. Un palier qui s'effondre, à l'inverse, a découvert une
    // réfutation sans avoir eu le temps de chercher la parade ailleurs ; jouer
    // sur cette moitié d'information serait pire que s'en tenir au palier
    // complet précédent.
    const improves = decision === null || result.score >= decision.score
    if (retained && (!partial || (keepPartial && improves))) {
      decision = {
        moves: result.moves.map(toLegalMove),
        score: result.score,
        depth,
        // Hors interruption, aucune feuille n'a été coupée par la profondeur :
        // la valeur est vraie.
        exact,
        nodes: context.nodes,
        // Relevée maintenant : la table décrit l'itération qui vient de finir,
        // et une itération suivante, même abandonnée, en écraserait des nœuds.
        pv: collectPrincipalVariation(position, result.moves[0], depth),
      }
    }
    if (partial || exact) break
    // Ne pas s'engager dans un palier qu'on n'a pas le temps de finir. Un palier
    // interrompu n'étant pas retenu (voir `keepPartial`), tout ce qu'on y passe
    // est perdu — mesuré, quatre à six secondes sur six avec la marge fixe
    // d'avant, qui ne regardait que la parité.
    //
    // Le coût du palier suivant s'**observe** au lieu de se deviner : il vaut
    // plusieurs fois celui qu'on vient de finir, et ce facteur se lit sur les
    // deux derniers paliers. Faute de deux paliers, on prend le bas de la plage
    // mesurée sur la partie de référence, entre trois et neuf.
    //
    // Sous plafond de nœuds l'horloge n'est **jamais** lue, pas même ici : c'est
    // ce qui rend le conseil reproductible. La borne y est le plafond lui-même,
    // que `exhausted` fait respecter.
    if (timed) {
      const spent = now() - iterationStart
      const growth = previousSpent > 0 ? Math.max(2, spent / previousSpent) : 4
      previousSpent = spent
      if (now() + spent * growth > context.deadline) break
    }
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
