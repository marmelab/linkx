/**
 * Outils communs aux analyses des parties du tournoi : lecture de l'export
 * CSV, rejeu, modèle de force des IA, tests statistiques à force égale et
 * mesures de position. `analyse-parties.ts` en est le premier client ; une
 * hypothèse nouvelle s'y écrit en quelques lignes sans rien recopier.
 */
import { readFileSync } from 'node:fs'
import { getComponents } from '../src/game/connectivity'
import { parseGameTimeline } from '../src/game/moveNotation'
import { BOARD_SIZE } from '../src/game/types'
import type { Board, GameState, PlayerId, Point, ShapeId } from '../src/game/types'

// ---------------------------------------------------------------- lecture

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  const endField = (): void => {
    row.push(field)
    field = ''
  }
  const endRow = (): void => {
    endField()
    rows.push(row)
    row = []
  }
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i += 1
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') endField()
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      endRow()
    } else field += c
  }
  if (field || row.length) endRow()
  const [header, ...body] = rows
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])))
}

export type Move = {
  ply: number
  player: PlayerId
  shapeId: ShapeId
  cells: Point[]
  /** Premier coup d'un camp, quand aucune ouverture imposée ne le lui a dicté. */
  firstFree: boolean
}

export type Game = {
  id: string
  bots: Record<PlayerId, string>
  /** 1 bleu gagne, 0 blanc gagne, ½ nul. */
  blueScore: number
  reason: 'connection' | 'stalemate' | 'draw'
  states: GameState[]
  moves: Move[]
  final: GameState
}

export const other = (p: PlayerId): PlayerId => (p === 'blue' ? 'white' : 'blue')

function placedCells(before: Board, after: Board): Point[] {
  const cells: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y += 1)
    for (let x = 0; x < BOARD_SIZE; x += 1)
      if (!before[y][x] && after[y][x]) cells.push({ x, y })
  return cells
}

export function loadGames(path: string): { games: Game[]; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {}
  const games: Game[] = []
  for (const row of parseCsv(readFileSync(path, 'utf8'))) {
    const reason = row.motif_fin
    if (reason !== 'connection' && reason !== 'stalemate' && reason !== 'draw') {
      skipped[reason] = (skipped[reason] ?? 0) + 1
      continue
    }
    const timeline = parseGameTimeline(row.notation)
    if (!timeline.ok) {
      skipped['notation refusée'] = (skipped['notation refusée'] ?? 0) + 1
      continue
    }
    const { states } = timeline
    const final = states[states.length - 1]
    const imposed = row.ouverture ? row.ouverture.trim().split(/[\s,+]+/).length : 0
    const moves: Move[] = []
    const seen = new Set<PlayerId>()
    final.history.forEach((entry, ply) => {
      if (entry.kind !== 'move') return
      const player = ply % 2 === 0 ? final.firstPlayer : other(final.firstPlayer)
      const firstFree = ply >= imposed && !seen.has(player)
      seen.add(player)
      moves.push({
        ply,
        player,
        shapeId: entry.shapeId,
        cells: placedCells(states[ply].board, states[ply + 1].board),
        firstFree,
      })
    })
    const winner = final.result?.winner
    games.push({
      id: row.id,
      bots: { blue: row.bot_bleu, white: row.bot_blanc },
      blueScore: winner === 'blue' ? 1 : winner === 'white' ? 0 : 0.5,
      reason,
      states,
      moves,
      final,
    })
  }
  return { games, skipped }
}

// ---------------------------------------------------------------- force

export const sigmoid = (t: number): number => 1 / (1 + Math.exp(-t))

/**
 * Bradley-Terry avec avantage du premier coup, par ascension de Newton
 * coordonnée. Le léger rappel vers zéro borne les IA qui n'ont joué que
 * quelques parties, toutes perdues.
 */
export function fitStrength(games: Game[]): { strength: Map<string, number>; firstMove: number } {
  const strength = new Map<string, number>()
  for (const g of games) for (const b of Object.values(g.bots)) strength.set(b, 0)
  let firstMove = 0
  const ridge = 0.05
  for (let iteration = 0; iteration < 300; iteration += 1) {
    const gradient = new Map<string, number>()
    const curvature = new Map<string, number>()
    let gFirst = 0
    let cFirst = 0
    for (const g of games) {
      const p = sigmoid(strength.get(g.bots.blue)! - strength.get(g.bots.white)! + firstMove)
      const r = g.blueScore - p
      const w = p * (1 - p)
      gradient.set(g.bots.blue, (gradient.get(g.bots.blue) ?? 0) + r)
      gradient.set(g.bots.white, (gradient.get(g.bots.white) ?? 0) - r)
      curvature.set(g.bots.blue, (curvature.get(g.bots.blue) ?? 0) + w)
      curvature.set(g.bots.white, (curvature.get(g.bots.white) ?? 0) + w)
      gFirst += r
      cFirst += w
    }
    for (const [bot, s] of strength)
      strength.set(bot, s + (gradient.get(bot)! - ridge * s) / (curvature.get(bot)! + ridge))
    firstMove += gFirst / cFirst
  }
  return { strength, firstMove }
}

// ---------------------------------------------------------------- statistique

export function normalCdf(z: number): number {
  // Abramowitz et Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2)
  const erf =
    1 -
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
      Math.exp(-(z * z) / 2)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}
export const twoSided = (z: number): number => 2 * (1 - normalCdf(Math.abs(z)))

export type Test = {
  hypothesis: string
  measure: string
  n: number
  observed: number
  expected: number
  z: number
  p: number
  adjusted?: number
}

export type Context = {
  games: Game[]
  expectedBlue: (g: Game) => number
}

export const scoreOf = (g: Game, side: PlayerId): number => (side === 'blue' ? g.blueScore : 1 - g.blueScore)
export const expectedOf = (ctx: Context, g: Game, side: PlayerId): number =>
  side === 'blue' ? ctx.expectedBlue(g) : 1 - ctx.expectedBlue(g)

/** Écart au modèle de force, sur une liste de (partie, camp) retenus. */
export function residualTest(
  ctx: Context,
  hypothesis: string,
  measure: string,
  picks: { game: Game; side: PlayerId }[],
): Test {
  let o = 0
  let e = 0
  let v = 0
  for (const { game, side } of picks) {
    const p = expectedOf(ctx, game, side)
    o += scoreOf(game, side)
    e += p
    v += p * (1 - p)
  }
  const z = v > 0 ? (o - e) / Math.sqrt(v) : 0
  const n = picks.length
  return { hypothesis, measure, n, observed: o / n, expected: e / n, z, p: twoSided(z) }
}

/**
 * Le camp qui a **le plus** de la caractéristique gagne-t-il plus que sa force
 * ne le prédit ? Les parties où les deux camps sont à égalité n'entrent pas.
 */
export function comparativeTest(
  ctx: Context,
  hypothesis: string,
  measure: string,
  games: Game[],
  feature: (g: Game, side: PlayerId) => number | null,
): Test {
  const picks: { game: Game; side: PlayerId }[] = []
  for (const game of games) {
    const b = feature(game, 'blue')
    const w = feature(game, 'white')
    if (b === null || w === null || b === w) continue
    picks.push({ game, side: b > w ? 'blue' : 'white' })
  }
  return residualTest(ctx, hypothesis, measure, picks)
}

// ---------------------------------------------------------------- géométrie

export function cellsOf(board: Board, player: PlayerId): Point[] {
  const cells: Point[] = []
  for (let y = 0; y < BOARD_SIZE; y += 1)
    for (let x = 0; x < BOARD_SIZE; x += 1) if (board[y][x]?.player === player) cells.push({ x, y })
  return cells
}

/**
 * Nombre minimal de cases vides à conquérir pour relier les deux bords d'un
 * axe, comme `getConnectionScore`. Avec `gravity`, une case vide coûte en plus
 * la moitié des cases vides qui restent sous elle : on ne l'atteint qu'une fois
 * sa colonne remplie jusque-là, par l'un ou l'autre camp.
 */
export function axisDistance(board: Board, player: PlayerId, vertical: boolean, gravity: boolean): number {
  const size = BOARD_SIZE
  const cost = (x: number, y: number): number => {
    const cell = board[y][x]
    if (cell) return cell.player === player ? 0 : Infinity
    if (!gravity) return 1
    let below = 0
    for (let yy = y + 1; yy < size; yy += 1) if (!board[yy][x]) below += 1
    return 1 + below / 2
  }
  const distance = new Float64Array(size * size).fill(Infinity)
  const done = new Uint8Array(size * size)
  for (let k = 0; k < size; k += 1) {
    const [x, y] = vertical ? [k, 0] : [0, k]
    distance[y * size + x] = cost(x, y)
  }
  for (;;) {
    let best = -1
    for (let i = 0; i < distance.length; i += 1)
      if (!done[i] && distance[i] < Infinity && (best < 0 || distance[i] < distance[best])) best = i
    if (best < 0) return Infinity
    done[best] = 1
    const x = best % size
    const y = (best / size) | 0
    if (vertical ? y === size - 1 : x === size - 1) return distance[best]
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx
        const ny = y + dy
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= size || ny >= size) continue
        const d = distance[best] + cost(nx, ny)
        if (d < distance[ny * size + nx]) distance[ny * size + nx] = d
      }
  }
}

export const bestAxis = (board: Board, player: PlayerId, gravity: boolean): number =>
  Math.min(axisDistance(board, player, false, gravity), axisDistance(board, player, true, gravity))

export const finiteOr = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback)

/** Liens diagonaux qu'aucune case orthogonale du même camp ne double. */
export function diagonalOnlyLinks(board: Board, player: PlayerId): number {
  const own = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE && board[y][x]?.player === player
  let links = 0
  for (const { x, y } of cellsOf(board, player))
    for (const dx of [-1, 1])
      if (own(x + dx, y + 1) && !own(x + dx, y) && !own(x, y + 1)) links += 1
  return links
}

export function contacts(board: Board, player: PlayerId): number {
  let count = 0
  for (const { x, y } of cellsOf(board, player)) {
    let touches = false
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1) {
        const n = board[y + dy]?.[x + dx]
        if (n && n.player !== player) touches = true
      }
    if (touches) count += 1
  }
  return count
}

/** Cases du camp posées directement sur une case adverse. */
export function caps(board: Board, player: PlayerId): number {
  return cellsOf(board, player).filter(
    ({ x, y }) => y + 1 < BOARD_SIZE && board[y + 1][x] && board[y + 1][x]!.player !== player,
  ).length
}

export function winningAxes(g: Game): { horizontal: boolean; vertical: boolean } | null {
  const winner = g.final.result?.winner
  if (g.reason !== 'connection' || !winner) return null
  const comps = getComponents(g.final.board, winner)
  return {
    horizontal: comps.some((c) => c.touchesLeft && c.touchesRight),
    vertical: comps.some((c) => c.touchesTop && c.touchesBottom),
  }
}

export const snapshot = (g: Game, ply: number): GameState | null =>
  g.states.length > ply && g.states[ply].phase === 'playing' ? g.states[ply] : null

/** Parties, modèle de force ajusté et contexte de test, en un appel. */
export function loadContext(path: string): Context & {
  skipped: Record<string, number>
  strength: Map<string, number>
  firstMove: number
} {
  const { games, skipped } = loadGames(path)
  const { strength, firstMove } = fitStrength(games)
  return {
    games,
    skipped,
    strength,
    firstMove,
    expectedBlue: (g) => sigmoid(strength.get(g.bots.blue)! - strength.get(g.bots.white)! + firstMove),
  }
}
