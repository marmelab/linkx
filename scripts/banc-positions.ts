/**
 * Banc de positions étiquetées : juge un réglage du maître en minutes, sans duel.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/banc-positions.ts banc.jsonl --a reserve=300 --b courant --jobs 8
 *
 * Le banc est un fichier JSONL, une position par ligne : sa notation
 * (`notation`), son demi-coup (`demiCoup`, le rang du coup à jouer), sa valeur
 * **exacte** pour le joueur au trait (`valeur`, `W` gain ou `D` nul) et, pour
 * chacun de ses coups, la valeur exacte de la position qui en résulte
 * (`coups[].cases`, les cases posées ; `coups[].v`, `W`, `D`, `L`, ou `?` si
 * elle n'a pas été résolue). N'y figurent que des positions où **tous les coups
 * ne se valent pas** : un coup y conserve la valeur ou la perd. Le banc reste
 * hors du dépôt, il vient de parties privées.
 *
 * Pour chaque position, le script fait choisir un coup à chaque réglage et rend
 * le **taux de bons coups** — la part des coups qui conservent la valeur —,
 * global et par demi-coup, avec son intervalle de Wilson. La comparaison des
 * deux réglages est **appariée** : seules comptent les positions où l'un a
 * raison et l'autre tort, et le test des signes (McNemar exact) dit si l'écart
 * sort du hasard. Un coup choisi dont la valeur est inconnue sort du compte.
 *
 * Options : --a NOM · --b NOM (défaut `courant` ; voir `reglages-moteur.ts`) ·
 * --nodes N (défaut 312 000, soit 700 ms de l'IA de la maison ; 2 680 000 pour
 * 6 s) · --nodes-a N · --nodes-b N · --temps (égalise le temps : les nœuds d'un
 * réglage sont multipliés par sa vitesse relative à `courant`, mesurée au
 * lancement, si bien qu'un critère coûteux paie son coût) · --vitesse-a X ·
 * --vitesse-b X (impose ce rapport au lieu de le mesurer, pour rejouer une
 * mesure à l'identique) · --demi-coups 8-14 · --limite N · --jobs N (processus
 * parallèles, un moteur par processus : il n'est pas réentrant) · --sortie
 * FICHIER (coups choisis par position, en JSONL) · --choix-b FICHIER (reprend
 * pour B les coups de A d'une sortie précédente, réglage et budget compris,
 * plutôt que de les recalculer : la base ne se calcule qu'une fois).
 *
 * **Pourquoi.** Un duel apparié ne départage que les ouvertures gagnées des
 * deux couleurs par le même camp : quelques dizaines d'événements pour des
 * heures de calcul, trop peu pour voir un réglage d'évaluation. Ici chaque
 * position porte sa vérité, et les parties du tournoi se décident aux
 * demi-coups 8 à 14 : c'est là que le banc mesure. Le budget est en **nœuds**,
 * donc la mesure est reproductible au coup près ; `--temps` s'en écarte
 * délibérément, pour qu'un réglage lent ne reçoive pas le temps qu'il perd.
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chooseMasterMove, searchMasterTopMoves } from '../src/game/engineSearch'
import type { MasterSearchOptions } from '../src/game/engineSearch'
import { parseGameTimeline } from '../src/game/moveNotation'
import type { GamePosition } from '../src/game/simulation'
import { requireVariant } from './reglages-moteur'

type Value = 'W' | 'D' | 'L' | '?'
type BenchMove = { coup: string; cases: string; v: Value }
type BenchPosition = { notation: string; demiCoup: number; valeur: Value; coups: BenchMove[] }
/** Verdict d'un coup choisi : bon, mauvais, ou de valeur inconnue. */
type Verdict = 1 | 0 | null
type Choice = { index: number; a: string; b: string }

const argv = process.argv.slice(2)
const option = (flag: string): string | undefined => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const numberOption = (flag: string, fallback: number): number => {
  const value = option(flag)
  return value === undefined ? fallback : Number(value)
}

const FILE = argv[0]
if (!FILE || FILE.startsWith('--')) throw new Error('Usage : banc-positions.ts banc.jsonl [--a NOM] [--b NOM] …')
type Row = { notation: string; demiCoup: number; a: string; b: string; reglageA: string; noeudsA: number }
const reused = option('--choix-b')
const previous: Row[] | null = reused
  ? readFileSync(reused, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Row)
  : null
const previousChoice = new Map(previous?.map((row) => [row.notation, row.a]))
const A = option('--a') ?? 'courant'
const B = previous ? previous[0].reglageA : (option('--b') ?? 'courant')
const NODES = numberOption('--nodes', 312_000)
const JOBS = numberOption('--jobs', 1)
const LIMIT = numberOption('--limite', Number.POSITIVE_INFINITY)
const [PLY_FROM, PLY_TO] = (option('--demi-coups') ?? '1-99').split('-').map(Number)
const PART = option('--part')
const optionsA = requireVariant(A)
const optionsB = requireVariant(B)

const positions: BenchPosition[] = readFileSync(FILE, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line) as BenchPosition)
  .filter((p) => p.demiCoup >= PLY_FROM && p.demiCoup <= PLY_TO)
  .slice(0, LIMIT)

function gamePosition(notation: string): GamePosition {
  const timeline = parseGameTimeline(notation)
  if (!timeline.ok) throw new Error(`Notation refusée : ${notation}`)
  const state = timeline.states[timeline.states.length - 1]
  return { board: state.board, inventories: state.inventories, activePlayer: state.activePlayer }
}

/** Cases du coup choisi, sous la forme des clés du banc. */
function chosenCells(position: GamePosition, options: MasterSearchOptions, maxNodes: number): string {
  const move = chooseMasterMove(position, { ...options, maxNodes })?.move
  if (!move) throw new Error('Une position du banc doit offrir un coup.')
  return move.cells
    .map(({ x, y }) => y * 9 + x)
    .sort((a, b) => a - b)
    .join(',')
}

/**
 * Vitesse d'un réglage relative à `courant`, en nœuds par seconde : mesurée
 * sur les premières positions du banc, en alternant les deux pour que la charge
 * de la machine pèse autant sur l'un que sur l'autre.
 */
function relativeSpeed(options: MasterSearchOptions): number {
  const sample = positions.slice(0, 40).map((p) => gamePosition(p.notation))
  const base = requireVariant('courant')
  let timeBase = 0
  let timeOptions = 0
  let nodesBase = 0
  let nodesOptions = 0
  for (let round = 0; round < 2; round += 1) {
    for (const position of sample) {
      let started = performance.now()
      nodesBase += searchMasterTopMoves(position, { ...base, maxNodes: 60_000 })?.nodes ?? 0
      timeBase += performance.now() - started
      started = performance.now()
      nodesOptions += searchMasterTopMoves(position, { ...options, maxNodes: 60_000 })?.nodes ?? 0
      timeOptions += performance.now() - started
    }
  }
  return nodesOptions / timeOptions / (nodesBase / timeBase)
}

function budgets(): { nodesA: number; nodesB: number; speedA: number; speedB: number } {
  const timed = argv.includes('--temps')
  const speedA = option('--vitesse-a') !== undefined ? Number(option('--vitesse-a')) : timed ? relativeSpeed(optionsA) : 1
  const speedB =
    option('--vitesse-b') !== undefined ? Number(option('--vitesse-b')) : timed && !previous ? relativeSpeed(optionsB) : 1
  return {
    nodesA: Math.round(numberOption('--nodes-a', NODES) * speedA),
    nodesB: previous ? previous[0].noeudsA : Math.round(numberOption('--nodes-b', NODES) * speedB),
    speedA,
    speedB,
  }
}

/** Coups choisis par les deux réglages sur la tranche `part` du banc. */
function choose(part: number, parts: number, nodesA: number, nodesB: number): Choice[] {
  const choices: Choice[] = []
  positions.forEach((p, index) => {
    if (index % parts !== part) return
    const position = gamePosition(p.notation)
    const a = chosenCells(position, optionsA, nodesA)
    const b = previous
      ? previousChoice.get(p.notation)
      : // Même réglage, même budget : le second calcul redonnerait le même coup.
        A === B && nodesA === nodesB
        ? a
        : chosenCells(position, optionsB, nodesB)
    if (b === undefined) throw new Error(`Position absente de ${reused} : ${p.notation}`)
    choices.push({ index, a, b })
  })
  return choices
}

/** Processus lancés, arrêtés ensemble si l'un d'eux échoue. */
const children: ReturnType<typeof spawn>[] = []

function runChild(part: number, nodesA: number, nodesB: number): Promise<Choice[]> {
  return new Promise((resolve, reject) => {
    // `vite-node` retire le chemin du script de `process.argv` : on le retrouve
    // par l'URL du module, comme `generate-opening-book.ts`.
    const args = [
      ...process.execArgv,
      process.argv[1],
      fileURLToPath(import.meta.url),
      ...process.argv.slice(2),
      '--part',
      `${part}/${JOBS}`,
      '--budgets',
      `${nodesA},${nodesB}`,
    ]
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] })
    children.push(child)
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code !== 0) {
        for (const other of children) other.kill()
        reject(new Error(`processus ${part} : code ${code}`))
      }
      else resolve(JSON.parse(output.slice(output.indexOf('['))) as Choice[])
    })
  })
}

function verdict(p: BenchPosition, cells: string): Verdict {
  const move = p.coups.find((m) => m.cases === cells)
  if (!move) throw new Error(`Coup absent du banc : ${cells} dans ${p.notation}`)
  if (move.v === '?') return null
  return move.v === p.valeur ? 1 : 0
}

function wilson(good: number, total: number): [number, number] {
  if (total === 0) return [0, 1]
  const z = 1.96
  const p = good / total
  const denominator = 1 + (z * z) / total
  const centre = p + (z * z) / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total)
  return [(centre - spread) / denominator, (centre + spread) / denominator]
}

/** Test des signes bilatéral exact : McNemar sur les seules paires discordantes. */
function signTest(won: number, lost: number): number {
  const n = won + lost
  if (n === 0) return 1
  const extreme = Math.max(won, lost)
  let logTail = Number.NEGATIVE_INFINITY
  let logBinomial = 0
  for (let k = 0; k <= n; k += 1) {
    if (k >= extreme) {
      const high = Math.max(logTail, logBinomial)
      logTail = high + Math.log(Math.exp(logTail - high) + Math.exp(logBinomial - high))
    }
    logBinomial += Math.log(n - k) - Math.log(k + 1)
  }
  return Math.min(1, 2 * Math.exp(logTail - n * Math.log(2)))
}

const percent = (x: number): string => `${(100 * x).toFixed(1)} %`

function report(choices: Choice[], nodesA: number, nodesB: number, speedA: number, speedB: number): void {
  type Tally = { good: number; known: number; unknown: number }
  const empty = (): Tally => ({ good: 0, known: 0, unknown: 0 })
  const byPly = new Map<number, { a: Tally; b: Tally; aOnly: number; bOnly: number; chance: number; n: number }>()
  const total = { a: empty(), b: empty(), aOnly: 0, bOnly: 0, chance: 0, n: 0 }
  const add = (t: Tally, v: Verdict): void => {
    if (v === null) t.unknown += 1
    else {
      t.known += 1
      t.good += v
    }
  }
  const rows: unknown[] = []
  for (const { index, a, b } of choices) {
    const p = positions[index]
    const va = verdict(p, a)
    const vb = verdict(p, b)
    const known = p.coups.filter((m) => m.v !== '?')
    const chance = known.filter((m) => m.v === p.valeur).length / known.length
    if (!byPly.has(p.demiCoup)) byPly.set(p.demiCoup, { a: empty(), b: empty(), aOnly: 0, bOnly: 0, chance: 0, n: 0 })
    for (const bucket of [byPly.get(p.demiCoup)!, total]) {
      add(bucket.a, va)
      add(bucket.b, vb)
      bucket.chance += chance
      bucket.n += 1
      if (va === 1 && vb === 0) bucket.aOnly += 1
      if (va === 0 && vb === 1) bucket.bOnly += 1
    }
    rows.push({ notation: p.notation, demiCoup: p.demiCoup, a, b, va, vb, reglageA: A, noeudsA: nodesA, reglageB: B, noeudsB: nodesB })
  }
  const sortie = option('--sortie')
  if (sortie) writeFileSync(sortie, rows.map((row) => JSON.stringify(row)).join('\n') + '\n')

  const rate = (t: Tally): string => {
    const [low, high] = wilson(t.good, t.known)
    return `${percent(t.good / t.known)} [${percent(low)}, ${percent(high)}]`
  }
  console.log(
    `banc ${FILE} : ${choices.length} positions\n` +
      `A = ${A}, ${nodesA} nœuds${speedA !== 1 ? ` (vitesse relative ${speedA.toFixed(3)})` : ''}\n` +
      `B = ${B}, ${nodesB} nœuds${speedB !== 1 ? ` (vitesse relative ${speedB.toFixed(3)})` : ''}\n`,
  )
  console.log('demi-coup | positions | hasard | A bons coups | B bons coups | A seul | B seul | p')
  const line = (label: string, t: typeof total): void => {
    console.log(
      `${label.padEnd(9)} | ${String(t.n).padStart(9)} | ${percent(t.chance / t.n).padStart(6)} | ` +
        `${rate(t.a)} | ${rate(t.b)} | ${String(t.aOnly).padStart(6)} | ${String(t.bOnly).padStart(6)} | ` +
        signTest(t.aOnly, t.bOnly).toFixed(3),
    )
  }
  for (const ply of [...byPly.keys()].sort((x, y) => x - y)) line(String(ply), byPly.get(ply)!)
  line('total', total)
  console.log(
    `\ncoups de valeur inconnue, hors compte : A ${total.a.unknown}, B ${total.b.unknown}\n` +
      `A a raison seul ${total.aOnly} fois, B ${total.bOnly} fois — test des signes p = ${signTest(total.aOnly, total.bOnly).toFixed(4)}`,
  )
}

if (PART) {
  const [part, parts] = PART.split('/').map(Number)
  // Les budgets viennent du processus parent, vitesse déjà appliquée.
  const [nodesA, nodesB] = (option('--budgets') ?? '').split(',').map(Number)
  process.stdout.write(JSON.stringify(choose(part, parts, nodesA, nodesB)))
} else {
  const started = Date.now()
  const { nodesA, nodesB, speedA, speedB } = budgets()
  const choices =
    JOBS > 1
      ? (await Promise.all(Array.from({ length: JOBS }, (_, part) => runChild(part, nodesA, nodesB)))).flat()
      : choose(0, 1, nodesA, nodesB)
  choices.sort((x, y) => x.index - y.index)
  report(choices, nodesA, nodesB, speedA, speedB)
  console.log(`(${((Date.now() - started) / 1000).toFixed(0)} s)`)
}
