/**
 * Duel apparié du maître TS contre son portage Go (`engine-go/`), ou de deux
 * réglages du portage Go entre eux, comme le jeu.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-go.ts --nodes 50000 --openings 10 --temoin
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-go.ts --ms 2500 --jobs 3 --journal duel.jsonl
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-go.ts --ms 2500 --jobs 1 --a go:threads=4 --b go:threads=1
 *
 * Options :
 * - --a ARME, --b ARME (défaut `go` contre `ts`) : `ts`, `go` ou `go:threads=N`,
 *   le binaire cherchant alors à N fils (Lazy SMP, au temps seulement). Avec
 *   plusieurs fils, `--jobs 1` : sinon les processus se disputent les cœurs ;
 * - --ms N (défaut 2 500, `MASTER_BUDGET_MS`) : budget de temps par coup ;
 * - --nodes N : plafond de nœuds par coup à la place du temps ;
 * - --openings M (défaut : toutes) : nombre d'ouvertures jouées, chacune deux fois ;
 * - --ouvertures FICHIER : ouvertures d'un fichier JSONL (voir `duel-appariee.ts`)
 *   au lieu des 50 premiers coups distincts de bleu, ceux que mesure
 *   `choisir-ouvertures.ts` ;
 * - --graine N (défaut 1) · --jobs N · --journal FICHIER : comme `duel-appariee.ts`,
 *   le journal portant une ligne par **partie** ;
 * - --temoin : rejoue aussi chaque ouverture B contre B et compare les parties.
 *   À nœuds égaux, si A et B sont identiques nœud pour nœud — Go et TS, ou
 *   deux réglages de fils, ignorés aux nœuds —, chaque partie A contre B doit
 *   être celle de B contre B ;
 * - --binaire CHEMIN : binaire du maître Go, construit d'office sinon.
 *
 * **Protocole.** Celui de `duel-appariee.ts --comme-le-jeu` : chaque ouverture
 * jouée deux fois, couleurs échangées ; livre d'ouverture au premier coup puis
 * recherche, avec tirage parmi les ex æquo. Le binaire Go repart d'une graine
 * neuve à chaque requête : la suite graine par ouverture et par couleur ne
 * départage donc pas elle-même, elle tire **une graine par coup**, dont chaque
 * arme fait un mulberry32 neuf, consommé par le livre puis la recherche, comme
 * l'entrée du maître Go. Les deux parties d'une paire tirent ainsi les mêmes
 * graines pour la même couleur, quel que soit le moteur.
 */
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { chooseMasterMove } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { parseGameRecord, serializeGameRecord } from '../src/game/moveNotation'
import { lookupOpeningMove } from '../src/game/openingBook'
import { simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { PlayerId } from '../src/game/types'
import { defaultOpenings, fileOpenings, percent, report, seedOf, seededRandom, tokenOf } from './duel-commun'
import type { Opening, PairResult } from './duel-commun'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const text = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const NODES = arg('--nodes', 0)
const MS = NODES > 0 ? 0 : arg('--ms', 2_500)
const LIMIT = arg('--openings', Number.POSITIVE_INFINITY)
const OPENINGS_FILE = text('--ouvertures', '')
const SEED = arg('--graine', 1)
const JOBS = arg('--jobs', 1)
const JOURNAL = text('--journal', '')
const CONTROL = process.argv.includes('--temoin')
const PART = text('--part', '')
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BINARY = text('--binaire', resolve(ROOT, 'engine-go/bin/linkx-maitre'))

type Arm = { name: string; engine: 'go' | 'ts'; threads: number }

function parseArm(spec: string): Arm {
  const match = /^(go|ts)(?::threads=(\d+))?$/.exec(spec)
  if (!match || (match[1] === 'ts' && match[2])) throw new Error(`arme inconnue : ${spec} (ts, go ou go:threads=N)`)
  return { name: spec, engine: match[1] as Arm['engine'], threads: Number(match[2] ?? 1) }
}

const ARMS = { a: parseArm(text('--a', 'go')), b: parseArm(text('--b', 'ts')) }
const LABELS =
  ARMS.a.name === ARMS.b.name ? { a: `A (${ARMS.a.name})`, b: `B (${ARMS.b.name})` } : { a: ARMS.a.name, b: ARMS.b.name }

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`

type Side = 'a' | 'b'

// --- Armes -------------------------------------------------------------------

/** `nodes` : nœuds du palier retenu ; `totalNodes` : tout ce qu'ont cherché les fils. */
type Choice = { token: string; fromBook: boolean; depth: number; nodes: number; totalNodes: number; ms: number }

type GoAnswer = Partial<Choice> & { move?: string; elapsedMs?: number; error?: string }

/** Le binaire Go, une requête à la fois. */
class GoMaster {
  private readonly process: ChildProcessByStdio<Writable, Readable, null>
  private pending: ((line: string) => void) | null = null

  constructor(path: string) {
    this.process = spawn(path, [], { stdio: ['pipe', 'pipe', 'inherit'] })
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      const resolveLine = this.pending
      this.pending = null
      resolveLine?.(line)
    })
  }

  async choose(record: string, seed: number, threads: number): Promise<Choice> {
    const request = { record, budgetMs: MS, maxNodes: NODES, seed, book: true, threads }
    const line = await new Promise<string>((resolveLine) => {
      this.pending = resolveLine
      this.process.stdin.write(`${JSON.stringify(request)}\n`)
    })
    const answer = JSON.parse(line) as GoAnswer
    if (answer.error || !answer.move) throw new Error(`Go, « ${record} » : ${answer.error ?? line}`)
    return {
      token: answer.move,
      fromBook: answer.fromBook ?? false,
      depth: answer.depth ?? 0,
      nodes: answer.nodes ?? 0,
      totalNodes: answer.totalNodes ?? answer.nodes ?? 0,
      ms: answer.elapsedMs ?? 0,
    }
  }

  close() {
    this.process.stdin.end()
  }
}

/** `chooseMoveForDifficulty(…, 'master', random, MS)`, profondeur et nœuds en plus. */
function chooseTs(position: GamePosition, seed: number): Choice {
  const random = seededRandom(seed)
  const start = performance.now()
  const bookMove = lookupOpeningMove(position, random)
  if (bookMove) return { token: tokenOf(bookMove), fromBook: true, depth: 0, nodes: 0, totalNodes: 0, ms: 0 }
  const decision = chooseMasterMove(position, MS > 0 ? { budgetMs: MS, random } : { maxNodes: NODES, random })
  if (!decision) throw new Error('Le joueur au trait devrait disposer d’un coup légal.')
  return {
    token: tokenOf(decision.move),
    fromBook: false,
    depth: decision.depth,
    nodes: decision.nodes,
    totalNodes: decision.nodes,
    ms: performance.now() - start,
  }
}

// --- Partie ------------------------------------------------------------------

/** Cumuls d'une arme sur une partie, coups du livre exclus. */
type Tally = { searches: number; depthSum: number; nodes: number; totalNodes: number; ms: number }

const TALLY_KEYS = ['searches', 'depthSum', 'nodes', 'totalNodes', 'ms'] as const

const emptyTally = (): Tally => ({ searches: 0, depthSum: 0, nodes: 0, totalNodes: 0, ms: 0 })

type Game = {
  opening: number
  notation: string
  white: Side
  blue: Side
  record: string
  winner: Side | null
  winnerColor: PlayerId | null
  tally: Record<Side, Tally>
}

async function play(
  opening: Opening,
  index: number,
  sides: Record<PlayerId, Side>,
  go: GoMaster | null,
): Promise<Game> {
  const seeds: Record<PlayerId, () => number> = {
    white: seededRandom(seedOf(SEED, index, 'white')),
    blue: seededRandom(seedOf(SEED, index, 'blue')),
  }
  const tally: Record<Side, Tally> = { a: emptyTally(), b: emptyTally() }
  const tokens = opening.notation.split(/\s+/).filter(Boolean)
  let position = opening.position
  let winnerColor: PlayerId | null | undefined
  for (let turn = 0; turn < 60 && winnerColor === undefined; turn += 1) {
    const player = position.activePlayer
    const side = sides[player]
    const arm = ARMS[side]
    const seed = Math.floor(seeds[player]() * 4_294_967_296)
    const choice =
      arm.engine === 'go' ? await go!.choose(tokens.join(' '), seed, arm.threads) : chooseTs(position, seed)
    if (!choice.fromBook) {
      const sum = tally[side]
      sum.searches += 1
      sum.depthSum += choice.depth
      sum.nodes += choice.nodes
      sum.totalNodes += choice.totalNodes
      sum.ms += choice.ms
    }
    const move: LegalMove | undefined = enumerateLegalMoves(position.board, position.inventories[player]).find(
      (candidate) => tokenOf(candidate) === choice.token,
    )
    if (!move) throw new Error(`${arm.name} joue ${choice.token}, illégal après « ${tokens.join(' ')} »`)
    tokens.push(choice.token)
    const transition = simulateLegalMove(position, move)
    if (transition.result) winnerColor = transition.result.winner ?? null
    position = transition.position
  }
  if (winnerColor === undefined) throw new Error('La partie simulée dépasse le nombre maximal de poses.')
  const replayed = parseGameRecord(tokens.join(' '))
  if (!replayed.ok || replayed.state.phase === 'playing') throw new Error(`rejeu refusé : ${tokens.join(' ')}`)
  return {
    opening: index,
    notation: opening.notation,
    white: sides.white,
    blue: sides.blue,
    record: serializeGameRecord(replayed.state),
    winner: winnerColor === null ? null : sides[winnerColor],
    winnerColor,
    tally,
  }
}

/** Les deux parties d'une ouverture, A en blanc puis A en bleu ; et le témoin B contre B. */
type PairOutcome = PairResult & { games: Game[]; control?: Game }

async function playPair(opening: Opening, index: number, go: GoMaster | null): Promise<PairOutcome> {
  const games = [
    await play(opening, index, { white: 'a', blue: 'b' }, go),
    await play(opening, index, { white: 'b', blue: 'a' }, go),
  ]
  const points = games.map((game) => (game.winner === null ? 0.5 : game.winner === 'a' ? 1 : 0))
  return {
    index,
    notation: opening.notation,
    points: [points[0], points[1]],
    games,
    control: CONTROL ? await play(opening, index, { white: 'b', blue: 'b' }, go) : undefined,
  }
}

/** Premier coup où deux parties divergent, ou `null` si elles sont identiques. */
function divergence(a: string, b: string): string | null {
  if (a === b) return null
  const left = a.split(' ')
  const right = b.split(' ')
  let k = 0
  while (left[k] === right[k]) k += 1
  return `après « ${left.slice(0, k).join(' ')} » : ${left[k] ?? 'fin'} contre ${right[k] ?? 'fin'}`
}

// --- Exécution ---------------------------------------------------------------

const openings = OPENINGS_FILE ? fileOpenings(OPENINGS_FILE, LIMIT) : defaultOpenings(LIMIT)
const usesGo = ARMS.a.engine === 'go' || ARMS.b.engine === 'go'

if (PART) {
  const [part, parts] = PART.split('/').map(Number)
  const go = usesGo ? new GoMaster(BINARY) : null
  for (const [index, opening] of openings.entries()) {
    if (index % parts !== part) continue
    console.log(JSON.stringify(await playPair(opening, index, go)))
  }
  go?.close()
} else {
  if (usesGo && !process.argv.includes('--binaire')) {
    const build = spawnSync('go', ['build', '-o', 'bin/linkx-maitre', './cmd/linkx-maitre'], {
      cwd: resolve(ROOT, 'engine-go'),
      stdio: 'inherit',
    })
    if (build.status !== 0) throw new Error('go build a échoué')
  }
  if (usesGo && !existsSync(BINARY)) throw new Error(`binaire introuvable : ${BINARY}`)
  process.stderr.write(
    `duel apparié : ${LABELS.a} contre ${LABELS.b}, ${MS > 0 ? `${MS} ms` : `${NODES} nœuds`} par coup, ` +
      `${openings.length} ouvertures${OPENINGS_FILE ? ` de ${OPENINGS_FILE}` : ''}, ` +
      `comme le jeu (graine ${SEED}), ${JOBS} processus${CONTROL ? `, avec témoin ${ARMS.b.name} contre ${ARMS.b.name}` : ''}\n`,
  )
  const pairs: PairResult[] = []
  const totals: Record<Side, Tally> = { a: emptyTally(), b: emptyTally() }
  const control = { identical: 0, games: 0, divergences: [] as string[] }
  const record = (pair: PairOutcome) => {
    pairs.push({ index: pair.index, notation: pair.notation, points: pair.points })
    for (const game of pair.games) {
      for (const side of ['a', 'b'] as const) {
        for (const key of TALLY_KEYS) totals[side][key] += game.tally[side][key]
      }
      const different = pair.control ? divergence(game.record, pair.control.record) : null
      if (pair.control) {
        control.games += 1
        if (different === null) control.identical += 1
        else control.divergences.push(`${pair.notation}, A en ${game.white === 'a' ? 'blanc' : 'bleu'}, ${different}`)
      }
      if (JOURNAL) {
        const summary = (side: Side) => {
          const { searches, depthSum, totalNodes, ms } = game.tally[side]
          return {
            arm: ARMS[side].name,
            depth: searches ? Number((depthSum / searches).toFixed(2)) : null,
            nodesPerSecond: ms ? Math.round(totalNodes / (ms / 1000)) : null,
            ...game.tally[side],
          }
        }
        const line = {
          ...game,
          tally: undefined,
          a: summary('a'),
          b: summary('b'),
          ...(pair.control ? { controlRecord: pair.control.record, identicalToControl: different === null } : {}),
        }
        appendFileSync(JOURNAL, `${JSON.stringify(line)}\n`)
      }
    }
    process.stderr.write(
      `[${elapsed()}] ${pairs.length}/${openings.length} ${pair.notation} — A en blanc : ${pair.points[0]} · ` +
        `A en bleu : ${pair.points[1]}${pair.control ? ` · témoin : ${pair.games.map((game) => (divergence(game.record, pair.control!.record) ? 'diverge' : 'identique')).join(', ')}` : ''}\n`,
    )
  }
  const summary = () => {
    let out = report(pairs, openings.length, LABELS.a, LABELS.b, elapsed())
    for (const side of ['a', 'b'] as const) {
      const { searches, depthSum, totalNodes, ms } = totals[side]
      out +=
        `\n${LABELS[side]} : profondeur moyenne ${searches ? (depthSum / searches).toFixed(2) : '—'} sur ${searches} recherches, ` +
        `${ms ? Math.round(totalNodes / (ms / 1000)).toLocaleString('fr-FR') : '—'} nœuds/s tous fils confondus, ` +
        `${searches ? Math.round(ms / searches) : '—'} ms par recherche`
    }
    if (CONTROL) {
      out += `\ntémoin : ${control.identical}/${control.games} parties identiques à ${ARMS.b.name} contre ${ARMS.b.name} (${percent(control.games ? control.identical / control.games : 0)})`
      for (const line of control.divergences) out += `\n  divergence : ${line}`
    }
    return out
  }

  const processes = Array.from({ length: Math.max(1, JOBS) }, (_, part) =>
    // `vite-node` retire le chemin du script de `process.argv` : on le retrouve
    // par l'URL du module, comme `duel-appariee.ts`.
    spawn(
      process.execPath,
      [
        ...process.execArgv,
        process.argv[1],
        fileURLToPath(import.meta.url),
        ...process.argv.slice(2),
        '--binaire',
        BINARY,
        '--part',
        `${part}/${Math.max(1, JOBS)}`,
      ],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    ),
  )
  const children = processes.map((child) => {
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.startsWith('{')) record(JSON.parse(line) as PairOutcome)
    })
    return new Promise<number | null>((resolveCode) => child.on('close', resolveCode))
  })
  const stop = () => {
    for (const child of processes) child.kill('SIGKILL')
    console.log(summary())
    process.exit(1)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  const codes = await Promise.all(children)
  console.log(summary())
  if (codes.some((code) => code !== 0) || control.divergences.length > 0) process.exitCode = 1
}
