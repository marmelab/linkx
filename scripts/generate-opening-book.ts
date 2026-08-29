/**
 * Génère le livre d'ouverture du maître (src/game/openingBook.data.ts).
 *
 * Le livre couvre les deux premiers coups de l'IA (blanc), qu'elle ouvre ou
 * réplique. À chaque position du livre, on stocke l'ensemble des meilleurs coups
 * ex æquo trouvés par une recherche profonde — profondeur hors de portée du
 * budget en direct au fort facteur de branchement du début de partie.
 *
 * Lancement (hors ligne, long) :
 *   node node_modules/vite-node/dist/cli.mjs scripts/generate-opening-book.ts --jobs 8
 *
 * Options : --depth N (défaut 9, profondeur exigée de chaque recherche) ·
 * --jobs N (défaut 1, processus travaillant en parallèle) ·
 * --nodes N (plafond de secours, positions examinées par recherche) ·
 * --replies K (défaut 0, réponses adverses couvertes au 2ᵈ coup) ·
 * --rank-nodes N (défaut 60 000, budget du classement de ces réponses) ·
 * --openings M (limite d'ouvertures, pour un échantillon) · --out chemin ·
 * --shard i/N et --merge a.json,b.json (rouages de `--jobs`, voir plus bas).
 *
 * `--jobs` ne change **rien** au livre produit : à options égales, le fichier
 * est identique octet pour octet quel que soit le nombre de lots, ce que vérifie
 * la comparaison décrite avec `supersedes`. Mesuré, ×2,9 à quatre lots et ×3,4 à
 * huit sur une machine à quatre cœurs de performance et quatre d'efficience.
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
 * l'ouverture plafonne désormais à la profondeur **6** ; le livre vise donc
 * **9**, deux paliers au-dessus. Compter huit heures et demie en huit lots. Un
 * seul palier d'avance ne suffit pas : le livre engendré à profondeur 7 était
 * moins bon que le jeu direct sur 14 des 50 ouvertures. Ce chiffre suit le
 * moteur : à
 * chaque fois qu'il gagne un palier en direct, le livre doit en gagner un
 * aussi, sans quoi il ne fait plus que répéter ce que le jeu trouve seul.
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
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { searchMasterTopMoves } from '../src/game/engineSearch'
import {
  canonicalPosition,
  isWithinBookRange,
  lookupOpeningMove,
} from '../src/game/openingBook'
import type { OpeningBook, StoredMove } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import { BOARD_SIZE } from '../src/game/types'

const N = BOARD_SIZE
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const DEPTH = Number(arg('--depth', '9'))
const NODES = Number(arg('--nodes', String(Number.MAX_SAFE_INTEGER)))
const REPLIES = Number(arg('--replies', '0'))
const RANK_NODES = Number(arg('--rank-nodes', '60000'))
const OPENING_LIMIT = Number(arg('--openings', 'Infinity'))
const OUT = arg('--out', 'src/game/openingBook.data.ts')

/**
 * Parallélisme.
 *
 * Le travail se découpe par **racine** — le plateau vide, puis chaque ouverture
 * de bleu — et chaque racine porte tout son sous-arbre : la recherche du premier
 * coup blanc, le classement des réponses, et les recherches du second coup. Deux
 * racines ne se parlent jamais. Le seul recouvrement est qu'une même position de
 * second coup peut se rejoindre depuis deux racines ; elle est alors cherchée
 * deux fois, ce qui coûte environ un cinquième du travail et ne change aucun
 * résultat, la recherche étant une fonction pure de la position.
 *
 * Le découpage est en **processus**, pas en fils d'exécution : `engineSearch.ts`
 * garde tout son état dans des singletons de module — table de transposition,
 * tueurs, historique, tampons de l'évaluation —, ce qui interdit deux recherches
 * simultanées dans une même instance. Un processus par lot leur donne chacun les
 * siens, comme le worker du navigateur le fait déjà en jeu.
 *
 * `--jobs N` fait tout : il relance ce script N fois avec `--shard i/N`, attend,
 * puis fusionne. `--shard` et `--merge` sont ses rouages, utilisables à la main.
 */
const JOBS = Number(arg('--jobs', '1'))
const SHARD = arg('--shard', '')
const MERGE = arg('--merge', '')

/**
 * Profondeur que la recherche en direct atteint seule en ouverture. Mesurée sur
 * la partie de référence : elle vaut **6** pendant les premiers coups blancs, le
 * plateau offrant encore 62 à 95 coups légaux. Une entrée de livre n'a donc
 * d'intérêt qu'au-delà — en deçà, elle ne ferait que répéter ce que le jeu
 * trouve tout seul.
 *
 * Réglable par `--harvest-above` : la mesure dépend du budget de réflexion et du
 * débit du moteur, et l'abaisser permet aussi d'exercer la récolte sans payer
 * une profondeur 10.
 */
const LIVE_OPENING_DEPTH = Number(arg('--harvest-above', '6'))

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
const tag = SHARD ? `lot ${SHARD} ` : ''
const log = (msg: string) => process.stderr.write(`[${tag}${elapsed()}] ${msg}\n`)

/**
 * Les K réponses adverses les plus plausibles.
 *
 * Ce classement décide quelles branches reçoivent des heures de calcul, il ne
 * doit donc pas être bâclé : il tourne à `--rank-nodes`, soixante mille
 * positions, pour refléter ce que l'adversaire jouerait vraiment. À 2 000 nœuds,
 * ce qu'il faisait auparavant, il classait presque au hasard. C'était le budget
 * du jeu au moment du réglage ; le moteur en examine aujourd'hui bien davantage
 * en six secondes, mais monter ce plafond se paie une recherche par réponse
 * légale — près de quatre-vingt-dix par entrée de premier niveau.
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
type Stored = { rank: number; root: number }
const storedRank = new Map<string, Stored>()
const rankOf = (depth: number, full: boolean): number => depth * 2 + (full ? 1 : 0)

/**
 * Ordre de préséance entre deux entrées d'une même clé : le rang d'abord, puis
 * la **racine la plus ancienne**. Ce second critère n'est pas cosmétique — c'est
 * lui qui rend le livre indépendant du découpage en lots, deux racines pouvant
 * proposer des coups différents pour une même position récoltée au même rang.
 * Sans lui, `--jobs 4` et `--jobs 1` ne donneraient pas le même fichier.
 */
function supersedes(existing: Stored | undefined, rank: number, root: number): boolean {
  if (!existing) return true
  return rank === existing.rank ? root < existing.root : rank > existing.rank
}

/** Racine en cours de traitement, pour départager les ex æquo à la fusion. */
let currentRoot = 0

function store(
  position: GamePosition,
  moves: LegalMove[],
  depth: number,
  full: boolean,
): void {
  const { key, mirror } = canonicalPosition(position)
  const rank = rankOf(depth, full)
  if (!supersedes(storedRank.get(key), rank, currentRoot)) return
  book[key] = moves.map((move) => toCanonicalCells(move, mirror))
  storedRank.set(key, { rank, root: currentRoot })

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
 * seul. La racine doit donc dépasser `LIVE_OPENING_DEPTH` de plus de deux plis :
 * à profondeur 6 en direct, il faut une racine à profondeur 9.
 *
 * **Elle ne rapporte pourtant rien à profondeur 9 non plus**, et pour une raison
 * qui n'est pas arithmétique : la variante principale n'est pas relevée pendant
 * la recherche mais **reconstruite après coup** en marchant dans la table de
 * transposition, ce qui exige d'y retrouver un nœud `EXACT` à chaque pli. À 2¹⁸
 * entrées qui se remplacent toujours, et des dizaines de millions de positions
 * visitées, ces entrées sont écrasées avant la fin : la variante rendue tombe à
 * un ou deux coups. Mesuré, zéro entrée récoltée sur les 51 racines. La débloquer
 * demanderait de relever la variante au fil de la recherche, pas d'aller plus
 * profond.
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

// --- Racines -----------------------------------------------------------------

/**
 * Les positions à traiter, dans un ordre stable : le plateau vide où blanc
 * ouvre, puis chaque ouverture de bleu. Elles sont dédoublonnées **ici**, avant
 * le découpage en lots, pour que deux lots ne se voient jamais confier la même
 * racine — le dédoublonnage interne à `visit` est propre à un processus et ne
 * pourrait pas s'en charger.
 */
function buildRoots(): GamePosition[] {
  const roots = [createGamePosition('white')]
  const blueStart = createGamePosition('blue')
  const seenRoots = new Set(roots.map((root) => canonicalPosition(root).key))
  const openings = enumerateLegalMoves(
    blueStart.board,
    blueStart.inventories.blue,
  ).slice(0, OPENING_LIMIT)
  for (const opening of openings) {
    const after = simulateLegalMove(blueStart, opening)
    if (after.result) continue
    const { key } = canonicalPosition(after.position)
    if (seenRoots.has(key)) continue
    seenRoots.add(key)
    roots.push(after.position)
  }
  return roots
}

const roots = buildRoots()

/** Les mêmes arguments, moins ceux que le chef de lots impose lui-même. */
function withoutOptions(args: string[], dropped: string[]): string[] {
  const kept: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    if (dropped.includes(args[i])) {
      i += 1
      continue
    }
    kept.push(args[i])
  }
  return kept
}

// --- Écriture ----------------------------------------------------------------

/** Le fichier de données, clés triées : deux générations identiques donnent le même texte. */
function writeBook(entries: Array<[string, StoredMove[]]>, count: number): void {
  const lines = entries
    .slice()
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, moves]) => `  ${JSON.stringify(key)}: ${JSON.stringify(moves)},`)
  writeFileSync(
    OUT,
    `import type { OpeningBook } from './openingBook'\n\n` +
      `// Livre d'ouverture — fichier généré par scripts/generate-opening-book.ts.\n` +
      `// Ne pas éditer à la main. depth=${DEPTH} replies=${REPLIES} entrées=${count}\n` +
      `export const OPENING_BOOK: OpeningBook = {\n${lines.join('\n')}\n}\n`,
  )
}

/** Un lot : ce qu'il a trouvé, avec de quoi le fusionner sans dépendre du découpage. */
type Part = {
  depth: number
  replies: number
  entries: Record<string, { moves: StoredMove[]; rank: number; root: number }>
}

// --- Fusion ------------------------------------------------------------------

if (MERGE) {
  const merged = new Map<string, { moves: StoredMove[]; rank: number; root: number }>()
  for (const file of MERGE.split(',')) {
    const part = JSON.parse(readFileSync(file, 'utf8')) as Part
    if (part.depth !== DEPTH || part.replies !== REPLIES) {
      throw new Error(
        `${file} : profondeur ${part.depth} et ${part.replies} réponses, ` +
          `attendu ${DEPTH} et ${REPLIES} — fusionner des lots dissemblables ferait un livre incohérent.`,
      )
    }
    for (const [key, entry] of Object.entries(part.entries)) {
      if (supersedes(merged.get(key), entry.rank, entry.root)) merged.set(key, entry)
    }
  }
  const entries = [...merged].map(([key, entry]): [string, StoredMove[]] => [key, entry.moves])
  writeBook(entries, entries.length)
  log(`fusionné ${MERGE.split(',').length} lot(s) en ${entries.length} positions dans ${OUT}.`)
} else if (JOBS > 1 && !SHARD) {
  // --- Chef de lots ----------------------------------------------------------
  // On se relance soi-même, un processus par lot, avec les mêmes options.
  // `vite-node` retire le chemin du script de `process.argv` : il ne reste que
  // ses propres arguments. On retrouve donc le script par son URL de module.
  const [node, cli] = process.argv
  const script = fileURLToPath(import.meta.url)
  const passed = withoutOptions(process.argv.slice(2), ['--jobs', '--out'])
  const dir = mkdtempSync(join(tmpdir(), 'linkx-livre-'))
  const parts = Array.from({ length: JOBS }, (_, i) => join(dir, `lot-${i}.json`))
  log(`génération en ${JOBS} lots — profondeur ${DEPTH}, ${REPLIES} réponses`)

  await Promise.all(
    parts.map(
      (part, index) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            node,
            [cli, script, ...passed, '--shard', `${index}/${JOBS}`, '--out', part],
            { stdio: ['ignore', 'inherit', 'inherit'] },
          )
          child.on('error', reject)
          child.on('exit', (code) =>
            code === 0 ? resolve() : reject(new Error(`lot ${index} : sortie ${code}`)),
          )
        }),
    ),
  )

  const merge = spawn(node, [cli, script, ...passed, '--merge', parts.join(','), '--out', OUT], {
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  await new Promise<void>((resolve, reject) => {
    merge.on('error', reject)
    merge.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`fusion : sortie ${code}`)),
    )
  })
  rmSync(dir, { recursive: true, force: true })
  log(`terminé en ${JOBS} lots.`)
} else {
  // --- Un lot, ou la totalité ------------------------------------------------
  const [shardIndex, shardCount] = SHARD
    ? SHARD.split('/').map(Number)
    : [0, 1]
  log(
    `génération : profondeur ${DEPTH}, ${REPLIES} réponses, ` +
      `lot ${shardIndex + 1}/${shardCount}, limite ouvertures ${OPENING_LIMIT}`,
  )

  for (let index = 0; index < roots.length; index += 1) {
    if (index % shardCount !== shardIndex) continue
    currentRoot = index
    visit(roots[index], 0)
  }

  if (SHARD) {
    const entries: Part['entries'] = {}
    for (const [key, moves] of Object.entries(book)) {
      const stored = storedRank.get(key)!
      entries[key] = { moves, rank: stored.rank, root: stored.root }
    }
    writeFileSync(OUT, JSON.stringify({ depth: DEPTH, replies: REPLIES, entries } satisfies Part))
    log(`lot ${shardIndex + 1}/${shardCount} : ${Object.keys(entries).length} positions dans ${OUT}.`)
  } else {
    const entries = Object.entries(book)
    writeBook(entries, entries.length)
    log(
      `écrit ${entries.length} positions dans ${OUT} — ${searches} recherches, ` +
        `${harvestedEntries} entrée(s) récoltée(s) sur les variantes principales.`,
    )
  }
}
