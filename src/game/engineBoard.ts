import { enumerateLegalMoves } from './legalMoves'
import type { LegalMove } from './legalMoves'
import type { GamePosition } from './simulation'
import { getUniqueOrientations } from './transforms'
import { BOARD_SIZE, SHAPE_IDS } from './types'
import type { Orientation, PlayerId, ShapeId } from './types'

/**
 * Représentation compacte d'une position, réservée à la recherche
 * ==============================================================
 *
 * `src/game/` reste la source de vérité des règles : ce module ne redéfinit
 * aucune règle, il en exploite deux conséquences qui rendent la recherche des
 * ordres de grandeur plus rapide.
 *
 * **Aucune colonne n'a jamais de trou.** Le support intégral impose que sous
 * chaque case posée il y ait le fond, une case de la même pièce ou une case déjà
 * occupée. Par récurrence depuis le plateau vide, une colonne est toujours une
 * pile contiguë. Une position se résume donc à des couleurs plus la hauteur de
 * chaque colonne.
 *
 * **La légalité se réduit à un test de planéité.** Chaque forme occupe des cases
 * contiguës dans chacune de ses colonnes ; une pose est donc légale si et
 * seulement si `top[x] - maxDy[dx]` vaut la même chose pour **toutes** les
 * colonnes que la pièce occupe, l'ancrage restant dans la grille. Plus de
 * simulation de chute, plus d'allocation : quelques soustractions entières.
 *
 * Ces deux propriétés sont **vérifiées par test différentiel** contre
 * `calculateDrop` et `enumerateLegalMoves` (voir `engineBoard.test.ts`). Elles
 * ne sont pas une nouvelle règle : si les règles changent, c'est le test qui
 * doit échouer en premier.
 */

const N = BOARD_SIZE
const CELLS = N * N

export const EMPTY = 0
export const BLUE = 1
export const WHITE = 2

/** Nombre maximal de coups légaux dans une position (95 sur la grille vide). */
export const MAX_MOVES = 128

export function toEngineSide(player: PlayerId): number {
  return player === 'blue' ? BLUE : WHITE
}

export function toPlayerId(side: number): PlayerId {
  return side === BLUE ? 'blue' : 'white'
}

export function otherSide(side: number): number {
  return side === BLUE ? WHITE : BLUE
}

// --- Orientations précompilées ----------------------------------------------

type EngineOrientation = {
  /** L'orientation du domaine, pour retraduire un coup vers `LegalMove`. */
  orientation: Orientation
  dx: Int8Array
  dy: Int8Array
  cellCount: number
  width: number
  /** Colonnes distinctes occupées, et la plus basse case de chacune. */
  colDx: Int8Array
  colMaxDy: Int8Array
  colCount: number
}

const ORIENTATIONS: EngineOrientation[][] = SHAPE_IDS.map((shapeId) =>
  getUniqueOrientations(shapeId).map((orientation) => {
    const dx = Int8Array.from(orientation.cells.map(({ x }) => x))
    const dy = Int8Array.from(orientation.cells.map(({ y }) => y))
    const lowestByColumn = new Map<number, number>()
    for (let i = 0; i < dx.length; i += 1) {
      lowestByColumn.set(dx[i], Math.max(lowestByColumn.get(dx[i]) ?? -1, dy[i]))
    }
    const columns = [...lowestByColumn.keys()].sort((a, b) => a - b)
    return {
      orientation,
      dx,
      dy,
      cellCount: dx.length,
      width: orientation.width,
      colDx: Int8Array.from(columns),
      colMaxDy: Int8Array.from(columns.map((column) => lowestByColumn.get(column)!)),
      colCount: columns.length,
    }
  }),
)

// --- Codage d'un coup --------------------------------------------------------
// Un coup tient dans 14 bits : orientation (3) | forme (3) | colonne (4) |
// ligne d'ancrage (4). Il sert donc aussi d'index dans la table d'historique.

export const MOVE_MASK = 0x3fff

const moveOrientation = (move: number): number => move & 7
const moveShape = (move: number): number => (move >> 3) & 7
const moveColumn = (move: number): number => (move >> 6) & 15
const moveAnchorY = (move: number): number => (move >> 10) & 15

export function encodeMove(
  orientationIndex: number,
  shapeIndex: number,
  column: number,
  anchorY: number,
): number {
  return orientationIndex | (shapeIndex << 3) | (column << 6) | (anchorY << 10)
}

/** Retraduit un coup compact vers la forme attendue par le reducer. */
export function toLegalMove(move: number): LegalMove {
  const entry = ORIENTATIONS[moveShape(move)][moveOrientation(move)]
  const column = moveColumn(move)
  const anchorY = moveAnchorY(move)
  return {
    shapeId: SHAPE_IDS[moveShape(move)],
    orientation: entry.orientation,
    column,
    cells: entry.orientation.cells.map(({ x, y }) => ({
      x: x + column,
      y: y + anchorY,
    })),
  }
}

// --- Zobrist -----------------------------------------------------------------
// Clés engendrées par un générateur à graine constante : le domaine n'appelle
// jamais `Math.random`, et deux exécutions produisent les mêmes clés.

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
}

const nextKey = seededRandom(0x15_ba_d1_7e)
const zCellA = new Int32Array(CELLS * 3)
const zCellB = new Int32Array(CELLS * 3)
const zInventoryA = new Int32Array(14 * 3)
const zInventoryB = new Int32Array(14 * 3)
for (let i = 0; i < zCellA.length; i += 1) {
  zCellA[i] = nextKey() | 0
  zCellB[i] = nextKey() | 0
}
for (let i = 0; i < zInventoryA.length; i += 1) {
  zInventoryA[i] = nextKey() | 0
  zInventoryB[i] = nextKey() | 0
}
const zTurnA = nextKey() | 0
const zTurnB = nextKey() | 0

// --- Position ----------------------------------------------------------------

export type EnginePosition = {
  /** 81 cases, `EMPTY` / `BLUE` / `WHITE`, indexées `y * 9 + x`. */
  board: Int8Array
  /** Ligne de la case occupée la plus haute de chaque colonne, `9` si vide. */
  top: Int8Array
  /** Exemplaires restants, indexés `(side - 1) * 7 + forme`. */
  inventory: Int8Array
  side: number
  hashA: number
  hashB: number
  /** Tampons de parcours de zone, réutilisés d'un appel à l'autre. */
  stamp: Int32Array
  stack: Int32Array
  stampGeneration: number
}

export function createEnginePosition(): EnginePosition {
  return {
    board: new Int8Array(CELLS),
    top: new Int8Array(N).fill(N),
    inventory: new Int8Array(14),
    side: BLUE,
    hashA: 0,
    hashB: 0,
    stamp: new Int32Array(CELLS),
    stack: new Int32Array(CELLS),
    stampGeneration: 0,
  }
}

function rehash(position: EnginePosition): void {
  let hashA = position.side === BLUE ? 0 : zTurnA
  let hashB = position.side === BLUE ? 0 : zTurnB
  for (let cell = 0; cell < CELLS; cell += 1) {
    const occupant = position.board[cell]
    if (occupant !== EMPTY) {
      hashA ^= zCellA[cell * 3 + occupant]
      hashB ^= zCellB[cell * 3 + occupant]
    }
  }
  for (let slot = 0; slot < 14; slot += 1) {
    hashA ^= zInventoryA[slot * 3 + position.inventory[slot]]
    hashB ^= zInventoryB[slot * 3 + position.inventory[slot]]
  }
  position.hashA = hashA
  position.hashB = hashB
}

/** Recopie une position du domaine dans la représentation compacte. */
export function loadPosition(
  position: EnginePosition,
  source: GamePosition,
): EnginePosition {
  position.board.fill(EMPTY)
  position.top.fill(N)
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const cell = source.board[y][x]
      if (!cell) continue
      position.board[y * N + x] = toEngineSide(cell.player)
      if (y < position.top[x]) position.top[x] = y
    }
  }
  for (const player of ['blue', 'white'] as const) {
    const base = (toEngineSide(player) - 1) * 7
    for (let shape = 0; shape < 7; shape += 1) {
      position.inventory[base + shape] = source.inventories[player][SHAPE_IDS[shape]]
    }
  }
  position.side = toEngineSide(source.activePlayer)
  position.stampGeneration = 0
  position.stamp.fill(0)
  rehash(position)
  return position
}

/** Demi-coups qu'il reste à jouer au plus : une pose consomme une pièce. */
export function remainingPlies(position: EnginePosition): number {
  let total = 0
  for (let slot = 0; slot < 14; slot += 1) total += position.inventory[slot]
  return total
}

export function filledCells(position: EnginePosition): number {
  let filled = 0
  for (let x = 0; x < N; x += 1) filled += N - position.top[x]
  return filled
}

/** Nombre de cases de chaque forme, dans l'ordre de `SHAPE_IDS`. */
const SHAPE_CELL_COUNT = ORIENTATIONS.map((entries) => entries[0].cellCount)

/**
 * Cases que `side` peut encore poser : la somme des cases de ses pièces
 * restantes. C'est le plafond de ce qu'il lui reste à conquérir — il ne peut pas
 * s'approprier plus de cases qu'il n'a de pièces.
 */
export function remainingCells(position: EnginePosition, side: number): number {
  const base = (side - 1) * 7
  let total = 0
  for (let shape = 0; shape < 7; shape += 1) {
    total += position.inventory[base + shape] * SHAPE_CELL_COUNT[shape]
  }
  return total
}

/**
 * Cases que les **deux** joueurs peuvent encore poser. Une case vide ne se
 * remplit que si la colonne monte jusqu'à elle, et cette montée peut venir de
 * l'un comme de l'autre : c'est donc ce total qui borne la hauteur atteignable.
 */
export function totalRemainingCells(position: EnginePosition): number {
  return remainingCells(position, BLUE) + remainingCells(position, WHITE)
}

// --- Génération de coups -----------------------------------------------------

/**
 * Écrit les coups légaux du joueur au trait dans `out` à partir de `offset`, et
 * renvoie leur nombre. Aucune allocation.
 */
export function generateMoves(
  position: EnginePosition,
  out: Int32Array,
  offset: number,
): number {
  const { top, inventory } = position
  const base = (position.side - 1) * 7
  let count = 0
  for (let shape = 0; shape < 7; shape += 1) {
    if (inventory[base + shape] === 0) continue
    const entries = ORIENTATIONS[shape]
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const lastColumn = N - entry.width
      for (let column = 0; column <= lastColumn; column += 1) {
        const anchorY = top[column + entry.colDx[0]] - 1 - entry.colMaxDy[0]
        if (anchorY < 0) continue
        let flush = true
        for (let c = 1; c < entry.colCount; c += 1) {
          if (top[column + entry.colDx[c]] - 1 - entry.colMaxDy[c] !== anchorY) {
            flush = false
            break
          }
        }
        if (flush) {
          out[offset + count] = encodeMove(index, shape, column, anchorY)
          count += 1
        }
      }
    }
  }
  return count
}

/** Le joueur `side` dispose-t-il d'au moins un coup légal ? */
export function hasAnyMove(position: EnginePosition, side: number): boolean {
  const { top, inventory } = position
  const base = (side - 1) * 7
  for (let shape = 0; shape < 7; shape += 1) {
    if (inventory[base + shape] === 0) continue
    const entries = ORIENTATIONS[shape]
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index]
      const lastColumn = N - entry.width
      for (let column = 0; column <= lastColumn; column += 1) {
        const anchorY = top[column + entry.colDx[0]] - 1 - entry.colMaxDy[0]
        if (anchorY < 0) continue
        let flush = true
        for (let c = 1; c < entry.colCount; c += 1) {
          if (top[column + entry.colDx[c]] - 1 - entry.colMaxDy[c] !== anchorY) {
            flush = false
            break
          }
        }
        if (flush) return true
      }
    }
  }
  return false
}

// --- Poser, retirer, passer --------------------------------------------------

export function flipSide(position: EnginePosition): void {
  position.side = otherSide(position.side)
  position.hashA ^= zTurnA
  position.hashB ^= zTurnB
}

/** Pose le coup pour le joueur au trait, puis passe le trait à l'adversaire. */
export function applyMove(position: EnginePosition, move: number): void {
  const side = position.side
  const shape = moveShape(move)
  const entry = ORIENTATIONS[shape][moveOrientation(move)]
  const column = moveColumn(move)
  const anchorY = moveAnchorY(move)
  for (let i = 0; i < entry.cellCount; i += 1) {
    const x = column + entry.dx[i]
    const y = anchorY + entry.dy[i]
    const cell = y * N + x
    position.board[cell] = side
    position.hashA ^= zCellA[cell * 3 + side]
    position.hashB ^= zCellB[cell * 3 + side]
    if (y < position.top[x]) position.top[x] = y
  }
  const slot = (side - 1) * 7 + shape
  position.hashA ^= zInventoryA[slot * 3 + position.inventory[slot]]
  position.hashB ^= zInventoryB[slot * 3 + position.inventory[slot]]
  position.inventory[slot] -= 1
  position.hashA ^= zInventoryA[slot * 3 + position.inventory[slot]]
  position.hashB ^= zInventoryB[slot * 3 + position.inventory[slot]]
  flipSide(position)
}

/** Annule `applyMove`, trait compris. À appeler avec le trait tel qu'il en sort. */
export function undoMove(position: EnginePosition, move: number): void {
  flipSide(position)
  const side = position.side
  const shape = moveShape(move)
  const entry = ORIENTATIONS[shape][moveOrientation(move)]
  const column = moveColumn(move)
  const anchorY = moveAnchorY(move)
  for (let i = 0; i < entry.cellCount; i += 1) {
    const x = column + entry.dx[i]
    const y = anchorY + entry.dy[i]
    const cell = y * N + x
    position.board[cell] = EMPTY
    position.hashA ^= zCellA[cell * 3 + side]
    position.hashB ^= zCellB[cell * 3 + side]
  }
  for (let c = 0; c < entry.colCount; c += 1) {
    position.top[column + entry.colDx[c]] = anchorY + entry.colMaxDy[c] + 1
  }
  const slot = (side - 1) * 7 + shape
  position.hashA ^= zInventoryA[slot * 3 + position.inventory[slot]]
  position.hashB ^= zInventoryB[slot * 3 + position.inventory[slot]]
  position.inventory[slot] += 1
  position.hashA ^= zInventoryA[slot * 3 + position.inventory[slot]]
  position.hashB ^= zInventoryB[slot * 3 + position.inventory[slot]]
}

// --- Connexion ---------------------------------------------------------------

function beginFlood(position: EnginePosition): void {
  position.stampGeneration += 1
}

/**
 * Taille du composant de `side` atteignable depuis `start`, et bords touchés
 * déposés dans `floodEdges` : 1 gauche, 2 droite, 4 haut, 8 bas.
 */
let floodEdges = 0

function flood(position: EnginePosition, start: number, side: number): number {
  const { board, stamp, stack } = position
  const generation = position.stampGeneration
  let pointer = 0
  let size = 0
  let edges = 0
  stack[pointer] = start
  pointer += 1
  stamp[start] = generation

  while (pointer > 0) {
    pointer -= 1
    const cell = stack[pointer]
    size += 1
    const x = cell % N
    const y = (cell / N) | 0
    if (x === 0) edges |= 1
    if (x === N - 1) edges |= 2
    if (y === 0) edges |= 4
    if (y === N - 1) edges |= 8

    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy
      if (ny < 0 || ny >= N) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        if (nx < 0 || nx >= N) continue
        const next = ny * N + nx
        if (stamp[next] === generation || board[next] !== side) continue
        stamp[next] = generation
        stack[pointer] = next
        pointer += 1
      }
    }
  }

  floodEdges = edges
  return size
}

const connects = (edges: number): boolean =>
  (edges & 3) === 3 || (edges & 12) === 12

/**
 * Le coup qui vient d'être posé par `side` lui donne-t-il la victoire ? Seul le
 * composant de la pièce posée peut avoir changé, donc on n'inonde que lui.
 */
export function movePlacedWins(
  position: EnginePosition,
  move: number,
  side: number,
): boolean {
  const entry = ORIENTATIONS[moveShape(move)][moveOrientation(move)]
  const column = moveColumn(move)
  const anchorY = moveAnchorY(move)
  beginFlood(position)
  for (let i = 0; i < entry.cellCount; i += 1) {
    const cell = (anchorY + entry.dy[i]) * N + (column + entry.dx[i])
    if (position.stamp[cell] === position.stampGeneration) continue
    flood(position, cell, side)
    if (connects(floodEdges)) return true
  }
  return false
}

export function largestZone(position: EnginePosition, side: number): number {
  beginFlood(position)
  let largest = 0
  for (let cell = 0; cell < CELLS; cell += 1) {
    if (position.board[cell] !== side) continue
    if (position.stamp[cell] === position.stampGeneration) continue
    const size = flood(position, cell, side)
    if (size > largest) largest = size
  }
  return largest
}

// --- Passerelle de test ------------------------------------------------------

/**
 * Les coups légaux du joueur au trait, traduits vers le domaine. Réservé aux
 * tests et au débogage : la recherche travaille sur les coups compacts.
 */
export function generateLegalMoves(position: EnginePosition): LegalMove[] {
  const buffer = new Int32Array(MAX_MOVES)
  const count = generateMoves(position, buffer, 0)
  const moves: LegalMove[] = []
  for (let i = 0; i < count; i += 1) moves.push(toLegalMove(buffer[i]))
  return moves
}

/** Clé de comparaison d'un coup, indépendante de l'orientation choisie. */
export function moveCellsKey(move: LegalMove): string {
  return move.cells
    .map(({ x, y }) => y * N + x)
    .sort((a, b) => a - b)
    .join(',')
}

/** Les mêmes coups que `enumerateLegalMoves`, vus par leurs cases. */
export function domainMoveKeys(source: GamePosition): string[] {
  return enumerateLegalMoves(
    source.board,
    source.inventories[source.activePlayer],
  )
    .map(moveCellsKey)
    .sort()
}

export function shapeIndex(shapeId: ShapeId): number {
  return SHAPE_IDS.indexOf(shapeId)
}
