import { BOARD_SIZE } from './types'
import type { Board, PlayerId, Point } from './types'

type Component = {
  cells: Point[]
  touchesLeft: boolean
  touchesRight: boolean
  touchesTop: boolean
  touchesBottom: boolean
}

export const CONNECTION_NEIGHBORS = [-1, 0, 1].flatMap((dy) =>
  [-1, 0, 1]
    .filter((dx) => dx !== 0 || dy !== 0)
    .map((dx) => ({ x: dx, y: dy })),
)

export function getComponents(board: Board, player: PlayerId): Component[] {
  // Un octet visité par case, indexé `y * BOARD_SIZE + x` : c'est l'entrée
  // chaude de la recherche (détection de victoire et plus grande zone à chaque
  // nœud). Les clés de chaîne `"x,y"` d'un Set y coûtaient une allocation et un
  // hachage par cellule visitée ; l'index entier les supprime.
  const visited = new Uint8Array(BOARD_SIZE * BOARD_SIZE)
  const components: Component[] = []

  for (let start = 0; start < visited.length; start += 1) {
    const sx = start % BOARD_SIZE
    const sy = (start / BOARD_SIZE) | 0
    if (visited[start] || board[sy][sx]?.player !== player) continue

    const queue: number[] = [start]
    const cells: Point[] = []
    let touchesLeft = false
    let touchesRight = false
    let touchesTop = false
    let touchesBottom = false
    visited[start] = 1

    for (let index = 0; index < queue.length; index += 1) {
      const cell = queue[index]
      const x = cell % BOARD_SIZE
      const y = (cell / BOARD_SIZE) | 0
      cells.push({ x, y })
      if (x === 0) touchesLeft = true
      if (x === BOARD_SIZE - 1) touchesRight = true
      if (y === 0) touchesTop = true
      if (y === BOARD_SIZE - 1) touchesBottom = true

      for (const offset of CONNECTION_NEIGHBORS) {
        const nx = x + offset.x
        const ny = y + offset.y
        if (nx < 0 || nx >= BOARD_SIZE || ny < 0 || ny >= BOARD_SIZE) continue
        const nextCell = ny * BOARD_SIZE + nx
        if (visited[nextCell] || board[ny][nx]?.player !== player) continue
        visited[nextCell] = 1
        queue.push(nextCell)
      }
    }

    components.push({ cells, touchesLeft, touchesRight, touchesTop, touchesBottom })
  }

  return components
}

// --- Parcours de zone connexe, cœur chaud de la recherche ---
// `getLargestZone` (deux fois par évaluation) et `hasWinningConnection` (à chaque
// coup simulé) inondent de la même façon ; ils partagent donc ce parcours et ses
// buffers réutilisés plutôt que de rallouer un tableau et des points par appel.
// Ces buffers étant un état mutable de module, les deux fonctions ne sont pas
// réentrantes — ce qu'aucun appelant n'exige, les axes et les joueurs étant
// évalués l'un après l'autre. `beginFlood` transforme une future violation
// silencieuse en erreur franche.
const floodVisited = new Uint8Array(BOARD_SIZE * BOARD_SIZE)
const floodStack: number[] = []
let flooding = false
/** Bords touchés par le dernier composant inondé : 1=gauche 2=droite 4=haut 8=bas. */
let floodEdges = 0

function beginFlood(): void {
  if (flooding) {
    throw new Error(
      'Parcours de zone réentrant : les buffers partagés seraient corrompus.',
    )
  }
  flooding = true
  floodVisited.fill(0)
}

/**
 * Inonde le composant du joueur atteignable depuis `start` (voisinage à huit),
 * le marque dans `floodVisited`, dépose ses bords dans `floodEdges` et renvoie sa
 * taille. À n'appeler qu'entre `beginFlood()` et la remise à zéro de `flooding`.
 */
function floodComponent(board: Board, player: PlayerId, start: number): number {
  let size = 0
  let edges = 0
  const stack = floodStack
  stack.length = 0
  floodVisited[start] = 1
  stack.push(start)

  for (let cell = stack.pop(); cell !== undefined; cell = stack.pop()) {
    size += 1
    const x = cell % BOARD_SIZE
    const y = (cell / BOARD_SIZE) | 0
    if (x === 0) edges |= 1
    if (x === BOARD_SIZE - 1) edges |= 2
    if (y === 0) edges |= 4
    if (y === BOARD_SIZE - 1) edges |= 8

    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy
      if (ny < 0 || ny >= BOARD_SIZE) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        if (nx < 0 || nx >= BOARD_SIZE) continue
        const next = ny * BOARD_SIZE + nx
        if (floodVisited[next] || board[ny][nx]?.player !== player) continue
        floodVisited[next] = 1
        stack.push(next)
      }
    }
  }

  floodEdges = edges
  return size
}

export function hasWinningConnection(board: Board, player: PlayerId): boolean {
  beginFlood()
  try {
    for (let start = 0; start < floodVisited.length; start += 1) {
      const sx = start % BOARD_SIZE
      const sy = (start / BOARD_SIZE) | 0
      if (floodVisited[start] || board[sy][sx]?.player !== player) continue

      floodComponent(board, player, start)
      // Gauche+droite (1|2) ou haut+bas (4|8) : ce composant relie deux bords
      // opposés, donc le joueur a gagné. Inutile de parcourir le reste.
      if ((floodEdges & 3) === 3 || (floodEdges & 12) === 12) return true
    }
    return false
  } finally {
    flooding = false
  }
}

function findPathBetweenEdges(
  board: Board,
  player: PlayerId,
  starts: Point[],
  reachesTarget: (point: Point) => boolean,
): Point[] {
  const queue = [...starts]
  const previous = new Map<string, string | null>()
  for (const point of starts) previous.set(`${point.x},${point.y}`, null)

  for (let index = 0; index < queue.length; index += 1) {
    const point = queue[index]
    if (reachesTarget(point)) {
      const path: Point[] = []
      let key: string | null = `${point.x},${point.y}`
      while (key) {
        const [x, y] = key.split(',').map(Number)
        path.push({ x, y })
        key = previous.get(key) ?? null
      }
      return path.reverse()
    }

    for (const offset of CONNECTION_NEIGHBORS) {
      const next = { x: point.x + offset.x, y: point.y + offset.y }
      const key = `${next.x},${next.y}`
      if (
        next.x >= 0 &&
        next.x < BOARD_SIZE &&
        next.y >= 0 &&
        next.y < BOARD_SIZE &&
        !previous.has(key) &&
        board[next.y][next.x]?.player === player
      ) {
        previous.set(key, `${point.x},${point.y}`)
        queue.push(next)
      }
    }
  }

  return []
}

export function getWinningPath(board: Board, player: PlayerId): Point[] {
  const leftStarts = Array.from({ length: BOARD_SIZE }, (_, y) => ({ x: 0, y })).filter(
    ({ x, y }) => board[y][x]?.player === player,
  )
  const horizontal = findPathBetweenEdges(
    board,
    player,
    leftStarts,
    ({ x }) => x === BOARD_SIZE - 1,
  )
  if (horizontal.length > 0) return horizontal

  const topStarts = Array.from({ length: BOARD_SIZE }, (_, x) => ({ x, y: 0 })).filter(
    ({ x, y }) => board[y][x]?.player === player,
  )
  return findPathBetweenEdges(
    board,
    player,
    topStarts,
    ({ y }) => y === BOARD_SIZE - 1,
  )
}

/**
 * Taille de la plus grande zone connexe du joueur. Appelée deux fois par
 * évaluation, elle évite `getComponents` : elle n'a besoin ni des cellules ni des
 * bords touchés, seulement d'un compte. Elle partage le parcours et les buffers
 * de `hasWinningConnection` ci-dessus.
 */
export function getLargestZone(board: Board, player: PlayerId): number {
  beginFlood()
  try {
    let largest = 0
    for (let start = 0; start < floodVisited.length; start += 1) {
      const sx = start % BOARD_SIZE
      const sy = (start / BOARD_SIZE) | 0
      if (floodVisited[start] || board[sy][sx]?.player !== player) continue

      const size = floodComponent(board, player, start)
      if (size > largest) largest = size
    }
    return largest
  } finally {
    flooding = false
  }
}
