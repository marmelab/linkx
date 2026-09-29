/**
 * Duel apparié entre deux réglages du moteur, à ouverture imposée.
 *
 * C'est l'instrument de décision : aucune modification de la recherche ou de
 * l'évaluation n'est conservée si elle ne se mesure pas ici au-dessus du bruit.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-appariee.ts --a impair --b pair
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-appariee.ts --a texel --b courant \
 *     --ouvertures ouvertures.jsonl --comme-le-jeu --nodes 312000 --vitesse-a 0.863 --jobs 8
 *
 * Options :
 * - --a NOM · --b NOM : réglages opposés (voir `reglages-moteur.ts`) ;
 * - --nodes N (défaut 120 000) · --nodes-a N · --nodes-b N : plafond de nœuds par
 *   coup, commun ou propre à chaque arme ;
 * - --vitesse-a X · --vitesse-b X : vitesse relative mesurée d'un réglage, qui
 *   multiplie son plafond de nœuds — c'est le duel **à coût égal** ;
 * - --ms N : budget de temps par coup, commun aux deux armes, à la place des
 *   nœuds. Il reproduit le jeu, mais ne se rejoue pas ;
 * - --openings M (défaut 24, toutes avec `--ouvertures`) : nombre d'ouvertures
 *   jouées, chacune deux fois ;
 * - --ouvertures FICHIER : ouvertures lues d'un fichier JSONL, une par ligne,
 *   chaîne de notation ou objet `{ "notation": "…" }` (voir `parseGameRecord`),
 *   au lieu des premiers coups distincts de bleu ;
 * - --comme-le-jeu : chaque camp choisit son coup comme l'IA de la maison — le
 *   livre d'ouverture d'abord, puis la recherche avec tirage parmi les ex æquo ;
 * - --graine N (défaut 1) : graine de ce tirage ;
 * - --jobs N : répartit les ouvertures sur N processus, le moteur n'étant pas
 *   réentrant ;
 * - --journal FICHIER : ajoute à ce fichier une ligne JSON par ouverture jouée.
 *
 * **Protocole.** Chaque ouverture imposée donne **deux** parties, une par
 * attribution des couleurs, si bien qu'aucun avantage de couleur ne peut être
 * pris pour une différence de force. Sans `--comme-le-jeu`, rien n'est tiré au
 * sort : à ouverture donnée, la partie est entièrement déterminée par les deux
 * réglages. Avec, le tirage vient d'un générateur **graine par ouverture et par
 * couleur**, non par réglage : les deux parties d'une paire tirent la même suite
 * pour la même couleur, un réglage opposé à lui-même rejoue donc deux fois la
 * même partie et marque exactement 50 %. C'est le témoin du protocole.
 *
 * **Livre.** `lookupOpeningMove` ne répond qu'au premier coup de blanc. Une
 * ouverture imposée de deux demi-coups ou plus le met donc hors jeu.
 *
 * **Statistique.** Seules les ouvertures **discordantes** — où un réglage gagne
 * des deux couleurs — portent de l'information : le test des signes ne compte
 * qu'elles. Le **pentanomial** répartit les paires selon les points de A (0, ½,
 * 1, 1½, 2) ; l'intervalle de score qui en découle tient compte de
 * l'appariement, là où l'intervalle de Wilson, partie par partie, l'ignore et
 * se laisse écraser par l'effet de couleur.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { chooseMasterMove } from '../src/game/engineSearch'
import type { MasterSearchOptions } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { parseGameRecord, serializeMove } from '../src/game/moveNotation'
import { canonicalPosition, lookupOpeningMove } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { PlayerId } from '../src/game/types'
import { requireVariant } from './reglages-moteur'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const name = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const flag = (option: string): boolean => process.argv.includes(option)

const NODES = arg('--nodes', 120_000)
// Budgets distincts : opposer un moteur à lui-même avec plus de nœuds dit si
// c'est la profondeur ou le jugement qui borne sa force. Sans cette mesure, on
// optimise la recherche sans savoir si elle est le facteur limitant.
const NODES_A = Math.round(arg('--nodes-a', NODES) * arg('--vitesse-a', 1))
const NODES_B = Math.round(arg('--nodes-b', NODES) * arg('--vitesse-b', 1))
const LIMIT = arg('--openings', process.argv.includes('--ouvertures') ? Number.POSITIVE_INFINITY : 24)
// Budget de temps par coup, commun aux deux arms. Il remplace le plafond de
// nœuds quand un réglage coûte plus cher par nœud : à nœuds égaux, on lui
// offrirait le temps qu'il perd. La mesure n'est alors plus rejouable.
const MS = arg('--ms', 0)
const A = name('--a', 'courant')
const B = name('--b', 'pair')
const OPENINGS_FILE = name('--ouvertures', '')
const LIKE_GAME = flag('--comme-le-jeu')
const SEED = arg('--graine', 1)
const JOBS = arg('--jobs', 1)
const JOURNAL = name('--journal', '')
// Interne : `--part k/N` désigne un processus enfant, qui ne joue que les
// ouvertures d'indice k modulo N et rend une ligne JSON par ouverture.
const PART = name('--part', '')
for (const variant of [A, B]) requireVariant(variant)

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`

// --- Ouvertures --------------------------------------------------------------

type Opening = { notation: string; position: GamePosition }

const tokenOf = (move: LegalMove): string =>
  serializeMove({
    shapeId: move.shapeId,
    rotation: move.orientation.rotation,
    flipped: move.orientation.flipped,
    column: move.column,
  })

function defaultOpenings(): Opening[] {
  const blueStart = createGamePosition('blue')
  const seen = new Set<string>()
  const openings: Opening[] = []
  for (const move of enumerateLegalMoves(blueStart.board, blueStart.inventories.blue)) {
    if (openings.length >= LIMIT) break
    const after = simulateLegalMove(blueStart, move)
    if (after.result) continue
    const { key } = canonicalPosition(after.position)
    if (seen.has(key)) continue
    seen.add(key)
    openings.push({ notation: tokenOf(move), position: after.position })
  }
  return openings
}

function fileOpenings(path: string): Opening[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(0, LIMIT)
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      const notation =
        typeof parsed === 'string' ? parsed : String((parsed as { notation: unknown }).notation)
      const record = parseGameRecord(notation)
      if (!record.ok) throw new Error(`${notation} : ${record.error.message}`)
      const { board, inventories, activePlayer, phase } = record.state
      if (phase !== 'playing') throw new Error(`${notation} : la partie est déjà terminée.`)
      return { notation, position: { board, inventories, activePlayer } }
    })
}

// --- Tirage graine -----------------------------------------------------------

/** mulberry32 : petit générateur déterministe, suffisant pour départager des ex æquo. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const seedOf = (opening: number, player: PlayerId): number =>
  Math.imul(SEED, 0x9e3779b1) ^ Math.imul(opening + 1, 0x85ebca6b) ^ (player === 'white' ? 0x5bd1e995 : 0)

// --- Partie ------------------------------------------------------------------

function chooseMove(position: GamePosition, variant: string, random?: () => number): LegalMove | undefined {
  const budget: MasterSearchOptions =
    MS > 0 ? { budgetMs: MS } : { maxNodes: variant === A ? NODES_A : NODES_B }
  if (!random) return chooseMasterMove(position, { ...requireVariant(variant), ...budget })?.move
  // La logique de `chooseMoveForDifficulty(…, 'master', random, budgetMs)`,
  // mais avec les options du réglage, que cette entrée ne transmet pas.
  return (
    lookupOpeningMove(position, random) ??
    chooseMasterMove(position, { ...requireVariant(variant), ...budget, random })?.move
  )
}

/** Une partie entière, chaque camp jouant avec son propre réglage. */
function play(start: GamePosition, sides: Record<PlayerId, string>, opening: number): PlayerId | null {
  const randoms: Record<PlayerId, (() => number) | undefined> = {
    white: LIKE_GAME ? seededRandom(seedOf(opening, 'white')) : undefined,
    blue: LIKE_GAME ? seededRandom(seedOf(opening, 'blue')) : undefined,
  }
  let position = start
  for (let turn = 0; turn < 60; turn += 1) {
    const player = position.activePlayer
    const move = chooseMove(position, sides[player], randoms[player])
    if (!move) throw new Error('Le joueur au trait devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, move)
    if (transition.result) return transition.result.winner ?? null
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

/** Points de A sur une ouverture : quand A a blanc, puis quand A a bleu. */
type PairResult = { index: number; notation: string; points: [number, number] }

function playPair(opening: Opening, index: number): PairResult {
  const points: number[] = []
  for (const aPlays of ['white', 'blue'] as const) {
    const other = aPlays === 'white' ? 'blue' : 'white'
    const winner = play(opening.position, { [aPlays]: A, [other]: B } as Record<PlayerId, string>, index)
    points.push(winner === null ? 0.5 : winner === aPlays ? 1 : 0)
  }
  return { index, notation: opening.notation, points: [points[0], points[1]] }
}

// --- Statistique -------------------------------------------------------------

/**
 * Intervalle de Wilson à 95 % sur la proportion de points de A, partie par
 * partie. Préféré à l'intervalle normal, qui est faux aux petits effectifs.
 */
function wilson(score: number, games: number): [number, number] {
  if (games === 0) return [0, 1]
  const z = 1.96
  const p = score / games
  const denominator = 1 + (z * z) / games
  const centre = p + (z * z) / (2 * games)
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games)
  return [(centre - spread) / denominator, (centre + spread) / denominator]
}

/**
 * Test des signes bilatéral sur les ouvertures discordantes. Sur données
 * appariées c'est le test le plus puissant dont on dispose sans hypothèse
 * supplémentaire : il élimine l'effet de couleur.
 */
function signTest(won: number, lost: number): number {
  const n = won + lost
  if (n === 0) return 1
  const extreme = Math.max(won, lost)
  let tail = 0
  let binomial = 1
  for (let k = 0; k <= n; k += 1) {
    if (k >= extreme) tail += binomial
    binomial = (binomial * (n - k)) / (k + 1)
  }
  return Math.min(1, (2 * tail) / 2 ** n)
}

/** Intervalle normal à 95 % sur le score moyen par partie, estimé sur les paires. */
function pentanomialInterval(pairs: PairResult[]): { mean: number; low: number; high: number } {
  const n = pairs.length
  const scores = pairs.map(({ points }) => (points[0] + points[1]) / 2)
  const mean = scores.reduce((total, score) => total + score, 0) / n
  const variance = n > 1 ? scores.reduce((total, score) => total + (score - mean) ** 2, 0) / (n - 1) : 0
  const spread = 1.96 * Math.sqrt(variance / n)
  return { mean, low: mean - spread, high: mean + spread }
}

const formatP = (p: number) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3))

const percent = (value: number) => `${(100 * value).toFixed(1)} %`

function report(pairs: PairResult[], expected: number): string {
  if (pairs.length === 0) return `\n${A} contre ${B} : aucune ouverture achevée (${elapsed()})`
  const games = 2 * pairs.length
  const all = pairs.flatMap(({ points }) => points)
  const score = all.reduce((total, points) => total + points, 0)
  const winsA = all.filter((points) => points === 1).length
  const winsB = all.filter((points) => points === 0).length
  const draws = games - winsA - winsB
  const pentanomial = [0, 0, 0, 0, 0]
  for (const { points } of pairs) pentanomial[Math.round(2 * (points[0] + points[1]))] += 1
  const openingsWon = pairs.filter(({ points }) => points[0] + points[1] === 2).length
  const openingsLost = pairs.filter(({ points }) => points[0] + points[1] === 0).length
  const decisive = pairs.filter(({ points }) => points[0] + points[1] !== 1).length
  const [low, high] = wilson(score, games)
  const penta = pentanomialInterval(pairs)
  const conclusive = penta.low > 0.5 || penta.high < 0.5
  return (
    `\n${A} contre ${B} : ${winsA} victoire(s), ${winsB} défaite(s), ${draws} nulle(s) ` +
    `sur ${games} parties, ${pairs.length}/${expected} ouvertures (${elapsed()})\n` +
    `score de ${A} : ${percent(score / games)} ` +
    `— intervalle de Wilson à 95 % [${percent(low)}, ${percent(high)}]\n` +
    `pentanomial (paires à 0 / ½ / 1 / 1½ / 2 points pour ${A}) : ${pentanomial.join(' / ')} ` +
    `— intervalle apparié à 95 % [${percent(penta.low)}, ${percent(penta.high)}]\n` +
    `paires qui départagent (score différent de 1) : ${decisive}/${pairs.length} ` +
    `(${percent(decisive / pairs.length)})\n` +
    `ouvertures gagnées des deux couleurs : ${openingsWon} pour ${A}, ` +
    `${openingsLost} pour ${B}, ${pairs.length - openingsWon - openingsLost} indécises ` +
    `— test des signes p = ${formatP(signTest(openingsWon, openingsLost))}\n` +
    (conclusive
      ? penta.low > 0.5
        ? `conclusion : ${A} est plus fort.`
        : `conclusion : ${A} est plus faible.`
      : "conclusion : l'intervalle apparié contient 50 %, la mesure ne tranche pas.")
  )
}

// --- Exécution ---------------------------------------------------------------

const openings = OPENINGS_FILE ? fileOpenings(OPENINGS_FILE) : defaultOpenings()

const describe = (pair: PairResult) =>
  `${pair.notation} — ${A} en blanc : ${pair.points[0]} · ${A} en bleu : ${pair.points[1]}`

if (PART) {
  const [part, parts] = PART.split('/').map(Number)
  openings.forEach((opening, index) => {
    if (index % parts !== part) return
    console.log(JSON.stringify(playPair(opening, index)))
  })
} else {
  process.stderr.write(
    (MS > 0
      ? `duel apparié : ${A} contre ${B}, ${MS} ms par coup`
      : `duel apparié : ${A} (${NODES_A} nœuds) contre ${B} (${NODES_B} nœuds)`) +
      `, ${openings.length} ouvertures${OPENINGS_FILE ? ` de ${OPENINGS_FILE}` : ''}` +
      `${LIKE_GAME ? `, comme le jeu (graine ${SEED})` : ''}, ${JOBS} processus\n`,
  )
  const pairs: PairResult[] = []
  const record = (pair: PairResult) => {
    pairs.push(pair)
    if (JOURNAL) appendFileSync(JOURNAL, `${JSON.stringify({ a: A, b: B, ...pair })}\n`)
    process.stderr.write(`[${elapsed()}] ${pairs.length}/${openings.length} ${describe(pair)}\n`)
  }

  if (JOBS <= 1) {
    openings.forEach((opening, index) => record(playPair(opening, index)))
    console.log(report(pairs, openings.length))
  } else {
    // Un duel interrompu rend encore ce qu'il a joué : c'est ce qui permet de
    // l'arrêter à l'heure sans perdre la mesure.
    const processes = Array.from({ length: JOBS }, (_, part) =>
      // `vite-node` retire le chemin du script de `process.argv` : on le retrouve
      // par l'URL du module, comme `banc-positions.ts`.
      spawn(
        process.execPath,
        [...process.execArgv, process.argv[1], fileURLToPath(import.meta.url), ...process.argv.slice(2), '--part', `${part}/${JOBS}`],
        {
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      ),
    )
    const children = processes.map((child) => {
      createInterface({ input: child.stdout }).on('line', (line) => {
        if (line.startsWith('{')) record(JSON.parse(line) as PairResult)
      })
      return new Promise<number | null>((resolve) => child.on('close', resolve))
    })
    const stop = () => {
      for (const child of processes) child.kill('SIGKILL')
      console.log(report(pairs, openings.length))
      process.exit(1)
    }
    process.on('SIGTERM', stop)
    process.on('SIGINT', stop)
    const codes = await Promise.all(children)
    console.log(report(pairs, openings.length))
    if (codes.some((code) => code !== 0)) process.exitCode = 1
  }
}
