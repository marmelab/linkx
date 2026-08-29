/**
 * Audit du livre d'ouverture, entrée par entrée.
 *
 * Pour chaque ouverture de bleu, compare trois choses sur la même position :
 * le coup du livre, le coup que le maître joue en direct au budget donné, et
 * le score que la recherche profonde attribue à chacun. Un livre utile doit
 * différer du jeu en direct **et** valoir mieux à profondeur égale.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/audit-livre.ts
 *
 * Options : --nodes N (défaut 60 000) · --depth N (défaut 9 ; l'arbitre juge à
 * `--depth − 1`) · --openings M (limite, pour un échantillon).
 *
 * **L'arbitre doit voir plus loin que les deux coups qu'il départage**, sans quoi
 * il ne fait que ratifier celui qu'il aurait joué lui-même. Mesuré : arbitré à
 * profondeur 6, le livre engendré à profondeur 7 paraissait n'être jamais moins
 * bon que le jeu direct ; arbitré à 8, il est moins bon sur **14** des 50
 * ouvertures. La conclusion rassurante venait de l'arbitre, pas du livre.
 *
 * Le défaut de `--nodes` n'est **pas** le budget du jeu : c'est le seuil de
 * force mesuré (voir `plan.md`), retenu parce qu'il rend l'audit abordable. Le
 * maître en examine aujourd'hui près de deux millions dans ses six secondes ;
 * auditer contre une recherche vingt fois plus faible flatterait le livre. Pour
 * juger de son intérêt réel, passer `--nodes 1500000`.
 */
import { chooseMasterMove, searchMasterTopMoves } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { canonicalPosition, lookupOpeningMove } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import { BOARD_SIZE } from '../src/game/types'

const N = BOARD_SIZE
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const NODES = arg('--nodes', 60_000)
const DEPTH = arg('--depth', 9)
const LIMIT = arg('--openings', Number.POSITIVE_INFINITY)

const cellKey = (move: LegalMove): string =>
  move.cells
    .map(({ x, y }) => y * N + x)
    .sort((a, b) => a - b)
    .join(',')

const blueStart = createGamePosition('blue')
const openings = enumerateLegalMoves(blueStart.board, blueStart.inventories.blue)

const keys = new Set<string>()
let audited = 0
let missing = 0
let identical = 0
let bookBetter = 0
let bookWorse = 0
let bookEqual = 0

for (const opening of openings) {
  if (audited >= LIMIT) break
  const after = simulateLegalMove(blueStart, opening)
  if (after.result) continue
  const position = after.position
  const { key } = canonicalPosition(position)
  if (keys.has(key)) continue
  keys.add(key)

  const fromBook = lookupOpeningMove(position)
  if (!fromBook) {
    missing += 1
    process.stderr.write(`ouverture ${keys.size} — absente du livre\n`)
    continue
  }
  audited += 1

  const live = chooseMasterMove(position, { maxNodes: NODES })
  if (!live) throw new Error('le maître devrait trouver un coup')

  const same = cellKey(fromBook) === cellKey(live.move)
  if (same) identical += 1

  // Arbitre commun : la recherche profonde note les deux coups à la même
  // profondeur, en jouant chacun puis en cherchant la réponse de bleu.
  const judge = (move: LegalMove): number => {
    const next = simulateLegalMove(position, move)
    if (next.result) return next.result.winner === 'white' ? 1e6 : 0
    const reply = searchMasterTopMoves(next.position, {
      maxDepth: DEPTH - 1,
      maxNodes: Number.MAX_SAFE_INTEGER,
      allowOddDepth: true,
    })
    return reply ? -reply.score : 0
  }
  const bookScore = judge(fromBook)
  const liveScore = same ? bookScore : judge(live.move)
  if (bookScore > liveScore) bookBetter += 1
  else if (bookScore < liveScore) bookWorse += 1
  else bookEqual += 1

  process.stderr.write(
    `ouverture ${keys.size} — livre ${cellKey(fromBook)} (${bookScore}) · ` +
      `direct ${cellKey(live.move)} (${liveScore})` +
      `${same ? ' — identiques' : bookScore > liveScore ? ' — livre meilleur' : bookScore < liveScore ? ' — LIVRE MOINS BON' : ' — à égalité'}\n`,
  )
}

console.log(
  `\n${audited} ouvertures auditées, ${missing} absentes du livre.\n` +
    `coup identique au jeu direct : ${identical}\n` +
    `livre meilleur : ${bookBetter} · à égalité : ${bookEqual} · livre moins bon : ${bookWorse}`,
)
