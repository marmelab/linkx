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
 * Options : --depth N (défaut 6, profondeur exigée de chaque recherche) ·
 * --nodes N (plafond de secours, positions examinées par recherche) ·
 * --replies K (défaut 0, réponses adverses couvertes au 2ᵈ coup) ·
 * --rank-nodes N (défaut 60 000, budget du classement de ces réponses) ·
 * --openings M (limite d'ouvertures, pour un échantillon) · --out chemin.
 *
 * Deux façons de couvrir le 2ᵈ coup blanc, complémentaires. La **récolte** de la
 * variante principale est gratuite mais ne suit qu'une ligne, et n'apporte
 * quelque chose qu'à partir de `--depth 8` (voir `harvest`). Les **réponses**
 * (`--replies`) couvrent K lignes mais se paient une recherche chacune ; leur
 * intérêt tient à la couverture, puisqu'il faut tomber sur la réponse que
 * l'adversaire joue vraiment parmi la soixantaine qui s'offre à lui.
 *
 * Le budget est une **profondeur exigée**, jamais un temps : deux exécutions
 * produisent donc exactement le même livre, sur n'importe quelle machine.
 *
 * Elle doit dépasser ce que la recherche en direct atteint, sans quoi le livre
 * n'apporterait rien — c'est tout son intérêt d'être calculé hors ligne. En jeu,
 * l'ouverture plafonne à la profondeur 4 ; le livre vise donc **6**. Compter
 * environ 4,4 millions de positions et deux minutes par entrée sur une machine
 * de bureau, soit une à deux heures pour le livre entier.
 *
 * Le livre doit être engendré par **ce moteur-ci**. Un livre issu d'une autre
 * évaluation affaiblit la recherche au lieu de l'aider : mesuré sur le livre
 * engendré par l'ancien alpha-bêta, le maître tombait à 17 victoires à 7 là où
 * il faisait 24 à 0 sans livre. Engendré par le même évaluateur avec davantage
 * de profondeur, il ne peut en revanche qu'égaler ou dépasser ce que la
 * recherche en direct trouverait.
 *
 * Symétrie : seule la symétrie gauche-droite est une symétrie du jeu (la gravité
 * fixe un bas), donc c'est la seule par laquelle on réduit — voir openingBook.ts.
 */
import { writeFileSync } from 'node:fs'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { searchMasterTopMoves } from '../src/game/engineSearch'
import {
  canonicalPosition,
  isWithinBookRange,
  lookupOpeningMove,
} from '../src/game/openingBook'
import type { OpeningBook } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import { BOARD_SIZE } from '../src/game/types'

const N = BOARD_SIZE
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const DEPTH = Number(arg('--depth', '6'))
const NODES = Number(arg('--nodes', String(Number.MAX_SAFE_INTEGER)))
const REPLIES = Number(arg('--replies', '0'))
const RANK_NODES = Number(arg('--rank-nodes', '60000'))
const OPENING_LIMIT = Number(arg('--openings', 'Infinity'))
const OUT = arg('--out', 'src/game/openingBook.data.ts')

/**
 * Profondeur que la recherche en direct atteint seule en ouverture. Mesurée :
 * elle vaut 4 pendant les **cinq** premiers coups blancs, le plateau offrant
 * encore 21 à 78 coups légaux. Une entrée de livre n'a donc d'intérêt qu'au-delà
 * — en deçà, elle ne ferait que répéter ce que le jeu trouve tout seul.
 *
 * Réglable par `--harvest-above` : la mesure dépend du budget de réflexion, et
 * l'abaisser permet aussi d'exercer la récolte sans payer une profondeur 8.
 */
const LIVE_OPENING_DEPTH = Number(arg('--harvest-above', '4'))

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
let harvestedEntries = 0
const t0 = process.hrtime.bigint()
const elapsed = () => `${(Number(process.hrtime.bigint() - t0) / 1e9).toFixed(0)}s`
const log = (msg: string) => process.stderr.write(`[${elapsed()}] ${msg}\n`)

/**
 * Les K réponses adverses les plus plausibles.
 *
 * Ce classement décide quelles branches reçoivent des heures de calcul, il ne
 * doit donc pas être bâclé : il tourne à `--rank-nodes`, par défaut le budget du
 * jeu, pour refléter ce que l'adversaire jouerait vraiment. À 2 000 nœuds, ce
 * qu'il faisait auparavant, il classait presque au hasard.
 */
function plausibleReplies(position: GamePosition, k: number): LegalMove[] {
  // Sans réponse demandée, il n'y a rien à classer. Sans cette sortie, on payait
  // une petite recherche par réponse légale — environ 85 — pour les jeter toutes
  // aussitôt, soit près de 5 % du temps total de génération à `--replies 0`.
  if (k <= 0) return []

  const player = position.activePlayer
  const replies = enumerateLegalMoves(position.board, position.inventories[player])
  const scored = replies.map((reply) => {
    const after = simulateLegalMove(position, reply)
    let value: number
    if (after.result) {
      value = after.result.winner === player ? 1e9 : after.result.winner === null ? 0 : -1e9
    } else {
      const response = searchMasterTopMoves(after.position, { maxNodes: RANK_NODES })
      value = response ? -response.score : 0
    }
    return { reply, value }
  })
  scored.sort((a, b) => b.value - a.value)
  return scored.slice(0, k).map((s) => s.reply)
}

/**
 * Qualité de l'entrée déjà en place, pour ne jamais la dégrader : la profondeur
 * d'abord, puis, à profondeur égale, une recherche complète l'emporte sur une
 * récolte. La première rend **tous** les ex æquo, ce qui fait varier les
 * parties ; la seconde ne connaît que le coup de la variante principale.
 */
const storedRank = new Map<string, number>()
const rankOf = (depth: number, full: boolean): number => depth * 2 + (full ? 1 : 0)

function store(
  position: GamePosition,
  moves: LegalMove[],
  depth: number,
  full: boolean,
): void {
  const { key, mirror } = canonicalPosition(position)
  const rank = rankOf(depth, full)
  if ((storedRank.get(key) ?? -1) >= rank) return
  book[key] = moves.map((move) => toCanonicalCells(move, mirror))
  storedRank.set(key, rank)

  // Auto-contrôle : la relecture doit retrouver un coup de l'ensemble stocké.
  // Il attrape aussi bien une erreur de miroir qu'une entrée que la garde de
  // `lookupOpeningMove` refuserait — celle-ci ne couvre que les deux premiers
  // coups du joueur au trait, ce qu'une racine plus profonde pourrait dépasser.
  if (!lookupOpeningMove(position, undefined, book)) {
    throw new Error(`Auto-contrôle échoué pour la clé ${key}`)
  }
}

/**
 * Récolte de la variante principale : les positions qu'elle traverse ont déjà
 * été analysées par la recherche qui vient de finir, il n'y a qu'à les écrire.
 *
 * Le gain diminue d'un demi-coup par pli parcouru, si bien que la récolte
 * s'arrête dès que la profondeur restante n'excède plus ce que le jeu atteint
 * seul. Concrètement, une racine à profondeur 6 ne donne **rien** — après deux
 * plis il ne reste que 4 —, et une racine à profondeur 8 donne le deuxième coup
 * blanc. C'est la seule raison sérieuse d'aller chercher la profondeur 8.
 *
 * Elle ne couvre qu'**une** ligne, celle que le moteur juge la meilleure. Les
 * autres réponses de bleu n'ont pas été évaluées mais réfutées, et ne peuvent
 * pas être récoltées ; c'est `--replies` qui les couvre, en les cherchant.
 */
function harvest(root: GamePosition, pv: LegalMove[], rootDepth: number): number {
  let cursor = root
  let harvested = 0
  for (let i = 0; i + 1 < pv.length; i += 1) {
    const next = simulateLegalMove(cursor, pv[i])
    if (next.result) break
    cursor = next.position
    if (rootDepth - (i + 1) <= LIVE_OPENING_DEPTH) break
    // Au-delà du périmètre du livre, la lecture refuserait l'entrée : plus rien
    // à récolter sur cette ligne, quelle que soit la profondeur restante.
    if (!isWithinBookRange(cursor)) break
    if (cursor.activePlayer !== 'white') continue
    store(cursor, [pv[i + 1]], rootDepth - (i + 1), false)
    harvested += 1
  }
  return harvested
}

/** Stocke le meilleur coup de blanc à cette position, et étend d'un coup si niveau 1. */
function visit(position: GamePosition, whitePlayed: number): void {
  const { key } = canonicalPosition(position)
  if (seen.has(key)) return
  seen.add(key)
  searches += 1

  const moveCount = enumerateLegalMoves(position.board, position.inventories.white).length
  log(`recherche ${searches} — coup blanc ${whitePlayed + 1}, ${moveCount} coups légaux…`)
  const top = searchMasterTopMoves(position, {
    maxDepth: DEPTH,
    maxNodes: NODES,
    allowOddDepth: true,
  })
  if (!top) return
  store(position, top.moves, top.depth, true)
  const gleaned = harvest(position, top.pv, top.depth)
  harvestedEntries += gleaned
  if (gleaned > 0) log(`  ↳ ${gleaned} entrée(s) récoltée(s) sur la variante principale`)

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
log(
  `écrit ${entries.length} positions dans ${OUT} — ${searches} recherches, ` +
    `${harvestedEntries} entrée(s) récoltée(s) sur les variantes principales.`,
)
