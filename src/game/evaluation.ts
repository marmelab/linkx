import { BOARD_SIZE } from './types'
import type { Board, PlayerId } from './types'

const CELL_COUNT = BOARD_SIZE * BOARD_SIZE
const BLOCKED = Number.POSITIVE_INFINITY

/**
 * Buffers de travail réutilisés d'un appel à l'autre. `getConnectionScore` est
 * l'entrée la plus chaude de la recherche (~60 % du temps mesuré au profileur) :
 * réallouer trois tableaux de 81 à chaque appel — quatre par évaluation — pesait
 * lourd. Ces buffers sont **entièrement réécrits** au début de chaque calcul, si
 * bien que la fonction reste déterministe et pure de comportement ; elle n'est
 * simplement pas réentrante, ce qu'aucun appelant n'exige (les axes et les deux
 * joueurs sont évalués l'un après l'autre, jamais imbriqués). Le garde `scoring`
 * transforme une future violation silencieuse de cette règle en erreur franche.
 */
const cost = new Float64Array(CELL_COUNT)
const distance = new Float64Array(CELL_COUNT)
const settled = new Uint8Array(CELL_COUNT)
let scoring = false

/**
 * Coût de traversée de chaque case pour `player`, indexé `y * BOARD_SIZE + x` :
 * 0 sur ses propres cases, 1 sur une case vide, l'infini sur une case adverse
 * infranchissable. Calculé une fois par joueur, les deux axes le partagent.
 */
function fillCost(board: Board, player: PlayerId): void {
  for (let y = 0, index = 0; y < BOARD_SIZE; y += 1) {
    const row = board[y]
    for (let x = 0; x < BOARD_SIZE; x += 1, index += 1) {
      const occupant = row[x]?.player
      cost[index] = occupant === player ? 0 : occupant === undefined ? 1 : BLOCKED
    }
  }
}

/**
 * Nombre minimal de cases vides encore à conquérir pour relier les deux bords
 * d'un axe, par un BFS 0-1 (deque) sur le coût précalculé. Les cases de départ
 * sont le bord d'entrée de l'axe ; la cible est le bord opposé.
 */
function getAxisScore(vertical: boolean): number {
  distance.fill(BLOCKED)
  settled.fill(0)
  let front: number[] = []
  let back: number[] = []
  const popFront = (): number | undefined => {
    if (front.length === 0) {
      const previousBack = back
      back = []
      front = previousBack.reverse()
    }
    return front.pop()
  }

  for (let offset = 0; offset < BOARD_SIZE; offset += 1) {
    // Bord d'entrée : colonne 0 pour l'horizontale, ligne 0 pour la verticale.
    const index = vertical ? offset : offset * BOARD_SIZE
    const entryCost = cost[index]
    distance[index] = entryCost
    if (entryCost === 0) front.push(index)
    else if (entryCost === 1) back.push(index)
  }

  while (front.length > 0 || back.length > 0) {
    const current = popFront()
    if (current === undefined || settled[current]) continue
    settled[current] = 1
    const currentDistance = distance[current]
    const x = current % BOARD_SIZE
    const y = (current / BOARD_SIZE) | 0
    if (vertical ? y === BOARD_SIZE - 1 : x === BOARD_SIZE - 1) return currentDistance

    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy
      if (ny < 0 || ny >= BOARD_SIZE) continue
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        if (nx < 0 || nx >= BOARD_SIZE) continue
        const next = ny * BOARD_SIZE + nx
        if (settled[next]) continue
        const candidate = currentDistance + cost[next]
        if (candidate < distance[next]) {
          distance[next] = candidate
          if (cost[next] === 0) front.push(next)
          else if (cost[next] === 1) back.push(next)
        }
      }
    }
  }

  return BLOCKED
}

/**
 * Estimates the number of empty cells still needed for a player to connect
 * either pair of opposite edges. Player cells cost 0, empty cells cost 1 and
 * opponent cells cannot be crossed. A lower score is better.
 */
export function getConnectionScore(board: Board, player: PlayerId): number {
  if (scoring) {
    throw new Error(
      'getConnectionScore réentrant : ses buffers partagés seraient corrompus.',
    )
  }
  scoring = true
  try {
    fillCost(board, player)
    return Math.min(getAxisScore(false), getAxisScore(true))
  } finally {
    scoring = false
  }
}
