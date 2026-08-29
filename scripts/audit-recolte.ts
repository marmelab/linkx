/**
 * Audit des entrées **récoltées** du livre : celles que la variante principale a
 * données gratuitement, au 2ᵈ coup blanc.
 *
 * Sonde de décision, pas un outil pérenne. `audit-livre.ts` ne juge que le
 * premier coup blanc ; or une entrée récoltée est plus profonde dans la partie
 * et se trouve à un seul palier au-dessus de ce que le jeu atteint seul — ce qui
 * s'est déjà révélé insuffisant, voire nuisible, pour le premier coup.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/audit-recolte.ts ancien.ts nouveau.ts
 */
import { readFileSync } from 'node:fs'
import { boardFromText } from '../src/game/boardText'
import { chooseMasterMove, searchMasterTopMoves } from '../src/game/engineSearch'
import type { LegalMove } from '../src/game/legalMoves'
import { lookupOpeningMove } from '../src/game/openingBook'
import type { OpeningBook } from '../src/game/openingBook'
import { simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import { BOARD_SIZE, SHAPE_IDS } from '../src/game/types'
import type { Inventory, PlayerId } from '../src/game/types'

const N = BOARD_SIZE
const NODES = 1_500_000
const JUDGE_DEPTH = 8

/** Le livre écrit est un littéral JavaScript : on en relit les entrées. */
function readBook(path: string): OpeningBook {
  const book: OpeningBook = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^ {2}("[^"]+"): (\[.*\]),$/.exec(line)
    if (m) book[JSON.parse(m[1]) as string] = JSON.parse(m[2]) as number[][]
  }
  return book
}

/** La clé canonique porte tout ce qu'il faut pour rebâtir la position. */
function positionFromKey(key: string): GamePosition {
  const [player, digits, cells] = key.split('|')
  const rows: string[] = []
  for (let y = 0; y < N; y += 1) rows.push(cells.slice(y * N, (y + 1) * N))
  const inventories = {} as Record<PlayerId, Inventory>
  ;(['blue', 'white'] as const).forEach((side, index) => {
    const inventory = {} as Inventory
    SHAPE_IDS.forEach((shape, slot) => {
      const count = Number(digits[index * SHAPE_IDS.length + slot])
      inventory[shape] = count === 0 ? 0 : count === 1 ? 1 : 2
    })
    inventories[side] = inventory
  })
  return {
    board: boardFromText(rows.join('\n')),
    inventories,
    activePlayer: player as PlayerId,
  }
}

const [oldPath, newPath] = process.argv.slice(2)
const before = readBook(oldPath)
const after = readBook(newPath)
const fresh = Object.keys(after).filter((key) => !(key in before))
process.stderr.write(`${fresh.length} entrée(s) nouvelle(s) à juger\n`)

const cellKey = (move: LegalMove): string =>
  move.cells
    .map(({ x, y }) => y * N + x)
    .sort((a, b) => a - b)
    .join(',')

let better = 0
let equal = 0
let worse = 0
let identical = 0

for (const key of fresh) {
  const position = positionFromKey(key)
  const fromBook = lookupOpeningMove(position, undefined, after)
  if (!fromBook) {
    process.stderr.write(`clé ${key.slice(0, 24)}… illisible — ignorée\n`)
    continue
  }
  const live = chooseMasterMove(position, { maxNodes: NODES })
  if (!live) throw new Error('le maître devrait trouver un coup')

  const judge = (move: LegalMove): number => {
    const next = simulateLegalMove(position, move)
    if (next.result) return next.result.winner === position.activePlayer ? 1e6 : 0
    const reply = searchMasterTopMoves(next.position, {
      maxDepth: JUDGE_DEPTH,
      maxNodes: Number.MAX_SAFE_INTEGER,
      allowOddDepth: true,
    })
    return reply ? -reply.score : 0
  }

  const same = cellKey(fromBook) === cellKey(live.move)
  const bookScore = judge(fromBook)
  const liveScore = same ? bookScore : judge(live.move)
  if (same) identical += 1
  if (bookScore > liveScore) better += 1
  else if (bookScore < liveScore) worse += 1
  else equal += 1
  process.stderr.write(
    `livre ${cellKey(fromBook)} (${bookScore}) · direct ${cellKey(live.move)} (${liveScore})` +
      `${same ? ' — identiques' : bookScore > liveScore ? ' — livre meilleur' : bookScore < liveScore ? ' — LIVRE MOINS BON' : ' — à égalité'}\n`,
  )
}

console.log(
  `\nentrées récoltées jugées : ${better + equal + worse}\n` +
    `coup identique au jeu direct : ${identical}\n` +
    `livre meilleur : ${better} · à égalité : ${equal} · livre moins bon : ${worse}`,
)
