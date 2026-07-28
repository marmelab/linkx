/**
 * Génère le livre d'ouverture du maître (src/game/openingBook.data.ts).
 *
 * Le livre couvre les deux premiers coups de l'IA (blanc), qu'elle ouvre ou
 * réplique. À chaque position du livre, on stocke l'ensemble des meilleurs coups
 * ex æquo trouvés par une recherche profonde — profondeur hors de portée du
 * budget en direct au fort facteur de branchement du début de partie.
 *
 * Lancement (hors ligne, long) :
 *   node node_modules/vite-node/dist/cli.mjs scripts/generate-opening-book.ts
 *
 * Options : --depth N (défaut 5) · --replies K (défaut 8, réponses adverses
 * couvertes au 2ᵈ coup) · --openings M (limite d'ouvertures, pour un échantillon)
 * · --out chemin.
 *
 * Symétrie : seule la symétrie gauche-droite est une symétrie du jeu (la gravité
 * fixe un bas), donc c'est la seule par laquelle on réduit — voir openingBook.ts.
 */
import { writeFileSync } from 'node:fs'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { searchTopMoves } from '../src/game/minimax'
import { canonicalPosition, lookupOpeningMove } from '../src/game/openingBook'
import type { OpeningBook } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import { BOARD_SIZE } from '../src/game/types'

const N = BOARD_SIZE
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const DEPTH = Number(arg('--depth', '5'))
const REPLIES = Number(arg('--replies', '8'))
const OPENING_LIMIT = Number(arg('--openings', 'Infinity'))
const OUT = arg('--out', 'src/game/openingBook.data.ts')

const mirrorIndex = (i: number): number => {
  const x = i % N
  return ((i - x) / N) * N + (N - 1 - x)
}
const toCanonicalCells = (move: LegalMove, mirror: boolean): number[] => {
  const cells = move.cells.map(({ x, y }) => y * N + x)
  return (mirror ? cells.map(mirrorIndex) : cells).sort((a, b) => a - b)
}

const book: OpeningBook = {}
const seen = new Set<string>()
let searches = 0
const t0 = process.hrtime.bigint()
const elapsed = () => `${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(0)}s`
const log = (msg: string) => process.stderr.write(`[${elapsed()}] ${msg}\n`)

/** Les K réponses adverses les plus plausibles, classées par une recherche courte. */
function plausibleReplies(position: GamePosition, k: number): LegalMove[] {
  const player = position.activePlayer
  const replies = enumerateLegalMoves(position.board, position.inventories[player])
  const scored = replies.map((reply) => {
    const after = simulateLegalMove(position, reply)
    let value: number
    if (after.result) {
      value = after.result.winner === player ? 1e9 : after.result.winner === null ? 0 : -1e9
    } else {
      const response = searchTopMoves(after.position, { depth: 1 })
      value = response ? -response.score : 0
    }
    return { reply, value }
  })
  scored.sort((a, b) => b.value - a.value)
  return scored.slice(0, k).map((s) => s.reply)
}

/** Stocke le meilleur coup de blanc à cette position, et étend d'un coup si niveau 1. */
function visit(position: GamePosition, whitePlayed: number): void {
  const { key, mirror } = canonicalPosition(position)
  if (seen.has(key)) return
  seen.add(key)
  searches += 1

  const moveCount = enumerateLegalMoves(position.board, position.inventories.white).length
  log(`recherche ${searches} — coup blanc ${whitePlayed + 1}, ${moveCount} coups légaux…`)
  const top = searchTopMoves(position, { depth: DEPTH })
  if (!top) return
  book[key] = top.moves.map((move) => toCanonicalCells(move, mirror))

  // Auto-contrôle : la relecture doit retrouver un coup de l'ensemble stocké.
  if (!lookupOpeningMove(position, undefined, book)) {
    throw new Error(`Auto-contrôle échoué pour la clé ${key}`)
  }

  if (whitePlayed >= 1) return // niveau 2 : dernier coup couvert, pas d'extension.

  // Niveau 1 : pour chaque meilleur coup de blanc (variété), on couvre les
  // réponses plausibles de bleu, puis le 2ᵈ coup de blanc.
  for (const whiteMove of top.moves) {
    const afterWhite = simulateLegalMove(position, whiteMove)
    if (afterWhite.result) continue
    for (const reply of plausibleReplies(afterWhite.position, REPLIES)) {
      const afterBlue = simulateLegalMove(afterWhite.position, reply)
      if (afterBlue.result) continue
      visit(afterBlue.position, whitePlayed + 1)
    }
  }
}

log(`génération : profondeur ${DEPTH}, ${REPLIES} réponses, limite ouvertures ${OPENING_LIMIT}`)

// Racine « blanc ouvre » : plateau vide, blanc au trait.
visit(createGamePosition('white'), 0)

// Racine « blanc réplique » : chaque ouverture de bleu, puis blanc au trait.
const blueStart = createGamePosition('blue')
const openings = enumerateLegalMoves(blueStart.board, blueStart.inventories.blue).slice(
  0,
  OPENING_LIMIT,
)
for (const opening of openings) {
  const after = simulateLegalMove(blueStart, opening)
  if (after.result) continue
  visit(after.position, 0)
}

const entries = Object.entries(book)
const lines = entries.map(([key, moves]) => `  ${JSON.stringify(key)}: ${JSON.stringify(moves)},`)
const file =
  `import type { OpeningBook } from './openingBook'\n\n` +
  `// Livre d'ouverture — fichier généré par scripts/generate-opening-book.ts.\n` +
  `// Ne pas éditer à la main. depth=${DEPTH} replies=${REPLIES} entrées=${entries.length}\n` +
  `export const OPENING_BOOK: OpeningBook = {\n${lines.join('\n')}\n}\n`
writeFileSync(OUT, file)
log(`écrit ${entries.length} positions dans ${OUT} (${searches} recherches).`)
