/**
 * Données de référence du portage Go du maître (`engine-go/`).
 *
 * Le portage doit rendre **exactement** ce que rend le moteur TS : mêmes coups
 * légaux dans le même ordre, mêmes hachages, mêmes valeurs d'évaluation, et à
 * plafond de nœuds égal le même coup, le même score, la même profondeur et le
 * même nombre de nœuds. Ce script écrit tout cela dans un fichier JSON que
 * `go test ./...` relit et compare, une valeur à la fois.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/empreinte-go.ts
 *
 * À relancer après toute modification des règles, de l'évaluation, de la
 * recherche ou du livre : le test Go échoue alors jusqu'au portage de la même
 * modification. Compter une minute environ.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyMove,
  createEnginePosition,
  flipSide,
  generateMoves,
  hasAnyMove,
  largestZone,
  loadPosition,
  otherSide,
  undoMove,
} from '../src/game/engineBoard'
import {
  DEFAULT_CRITERIA,
  chooseMasterMove,
  evaluate,
  evaluationWeights,
  searchMasterTopMoves,
} from '../src/game/engineSearch'
import type { EvaluationCriteria, MasterSearchOptions } from '../src/game/engineSearch'
import { hasWinningConnection } from '../src/game/connectivity'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { parseGameRecord, parseGameTimeline, serializeGameRecord, serializeMove } from '../src/game/moveNotation'
import { lookupOpeningMove } from '../src/game/openingBook'
import { OPENING_BOOK } from '../src/game/openingBook.data'
import { REFERENCE_GAME, REFERENCE_GAME_LENGTH, referencePositionAfter } from '../src/game/referenceGame'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { GameState, PlayerId } from '../src/game/types'

const OUTPUT = fileURLToPath(new URL('../engine-go/conformance/testdata/empreinte.json', import.meta.url))

/** mulberry32 de `duel-appariee.ts`, que `engine-go/rng` porte à l'identique. */
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

const token = (move: LegalMove): string =>
  serializeMove({
    shapeId: move.shapeId,
    rotation: move.orientation.rotation,
    flipped: move.orientation.flipped,
    column: move.column,
  })

const positionOf = (state: GameState): GamePosition => ({
  board: state.board,
  inventories: state.inventories,
  activePlayer: state.activePlayer,
})

function parsedState(record: string): GameState {
  const parsed = parseGameRecord(record)
  if (!parsed.ok) throw new Error(`${record} : ${parsed.error.message}`)
  return parsed.state
}

// --- Parties aléatoires, menées jusqu'au bout --------------------------------

/** Une partie tirée au hasard, rendue en notation, passes comprises. */
function randomGame(first: PlayerId, random: () => number): string {
  const tokens: string[] = first === 'white' ? ['w'] : []
  let position = createGamePosition(first)
  for (;;) {
    const player = position.activePlayer
    const moves = enumerateLegalMoves(position.board, position.inventories[player])
    const move = moves[Math.floor(random() * moves.length)]
    tokens.push(token(move))
    const transition = simulateLegalMove(position, move)
    if (transition.result) break
    if (transition.position.activePlayer === player) tokens.push('--')
    position = transition.position
  }
  return tokens.join(' ')
}

const RANDOM_GAMES = 30
const gameRecords = [REFERENCE_GAME]
const gameRandom = seededRandom(20_260_101)
for (let game = 0; game < RANDOM_GAMES; game += 1) {
  gameRecords.push(randomGame(game % 2 === 0 ? 'blue' : 'white', gameRandom))
}

const engine = createEnginePosition()
const buffer = new Int32Array(256)

const games = gameRecords.map((record) => {
  const timeline = parseGameTimeline(record)
  if (!timeline.ok) throw new Error(`${record} : ${timeline.error.message}`)
  const states = timeline.states
  const final = states[states.length - 1]
  return {
    record,
    serialized: serializeGameRecord(final),
    result: final.result,
    positions: states.map((state) => {
      const position = positionOf(state)
      loadPosition(engine, position)
      const count = generateMoves(engine, buffer, 0)
      return {
        active: state.activePlayer,
        finished: state.phase === 'finished',
        legal: enumerateLegalMoves(state.board, state.inventories[state.activePlayer]).map(token),
        engineMoves: Array.from(buffer.subarray(0, count)),
        hash: [engine.hashA >>> 0, engine.hashB >>> 0],
        zones: [largestZone(engine, 1), largestZone(engine, 2)],
        wins: [hasWinningConnection(state.board, 'blue'), hasWinningConnection(state.board, 'white')],
      }
    }),
  }
})

// --- Notation ----------------------------------------------------------------

const finishedByConnection = games.find((game) => game.result?.reason === 'connection')!.record
const notationInputs = [
  '',
  '2r23',
  '1r27',
  '2l13',
  '3Ls4',
  '4Ls5',
  '4Ssr21',
  '4ssr21',
  'B 15',
  'white 15 25',
  'W',
  '15,25+35',
  '  15   25  ',
  'zz',
  '15 --',
  '19 19 19 19 19 19 19 19 19 19',
  '3I9',
  '4T1',
  '15 25 15 25 15',
  '4ſ3',
  '3i5 3l5 4t5 4S5 4l5',
  `${finishedByConnection} 15`,
  REFERENCE_GAME.replace(' --', ''),
  REFERENCE_GAME.replace(' --', ' -- --'),
]
const notation = notationInputs.map((input) => {
  const parsed = parseGameRecord(input)
  return parsed.ok
    ? { input, output: serializeGameRecord(parsed.state) }
    : { input, error: { index: parsed.error.index, token: parsed.error.token, reason: parsed.error.reason, message: parsed.error.message } }
})

// --- Évaluation : le corpus de `empreinte-evaluation.ts` ------------------------

const ALL_CRITERIA: EvaluationCriteria = {
  gravity: 7,
  zoneCount: 11,
  caps: 13,
  robust: 17,
  mobility: 19,
  reserve: 4,
  bar3: 23,
  largeL: -29,
  topRows: 31,
  hanging: 2,
  hangingWall: 4,
  zoneStall: 37,
}
const CUSTOM_WEIGHTS = evaluationWeights(2, { pathWidth: 50, zoneBase: 20, zoneFill: 91, tempo: 700 })

/** Positions du corpus, rejouables : un préfixe de la partie de référence, ou un tirage. */
const corpusRandomGames: number[][] = []
const corpus: (() => void)[] = []
{
  for (let moveCount = 0; moveCount <= REFERENCE_GAME_LENGTH; moveCount += 1) {
    corpus.push(() => loadPosition(engine, referencePositionAfter(moveCount)))
  }
  // Même tirage que `empreinte-evaluation.ts`, relevé coup par coup : le Go
  // rejoue la suite au lieu de refaire le calcul flottant du générateur.
  let seed = 123456789
  const draw = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x80000000
  }
  for (let game = 0; game < 12; game += 1) {
    const steps: number[] = []
    loadPosition(engine, referencePositionAfter(0))
    for (;;) {
      const count = generateMoves(engine, buffer, 0)
      if (count === 0) {
        if (!hasAnyMove(engine, otherSide(engine.side))) break
        flipSide(engine)
        steps.push(-1)
        continue
      }
      const move = buffer[Math.floor(draw() * count)]
      applyMove(engine, move)
      steps.push(move)
      const replay = [...steps]
      corpus.push(() => {
        loadPosition(engine, referencePositionAfter(0))
        for (const step of replay) {
          if (step < 0) flipSide(engine)
          else applyMove(engine, step)
        }
      })
    }
    corpusRandomGames.push(steps)
  }
}

function evaluateCorpus(evaluateOne: () => number): number[] {
  const values: number[] = []
  for (const load of corpus) {
    load()
    values.push(evaluateOne())
    const count = generateMoves(engine, buffer, 0)
    const children = Array.from(buffer.subarray(0, count))
    for (const move of children) {
      applyMove(engine, move)
      values.push(evaluateOne())
      undoMove(engine, move)
    }
  }
  return values
}

const evaluation = {
  randomGames: corpusRandomGames,
  allCriteria: ALL_CRITERIA,
  customWeights: CUSTOM_WEIGHTS,
  values: evaluateCorpus(() => evaluate(engine)),
  valuesAllCriteria: evaluateCorpus(() => evaluate(engine, undefined, ALL_CRITERIA)),
  valuesCustomWeights: evaluateCorpus(() => evaluate(engine, undefined, DEFAULT_CRITERIA, CUSTOM_WEIGHTS)),
}

// --- Recherche ---------------------------------------------------------------

const searchRecords: string[] = []
{
  const referenceTokens = REFERENCE_GAME.split(/\s+/)
  for (let moveCount = 0; moveCount <= REFERENCE_GAME_LENGTH; moveCount += 1) {
    const record = referenceTokens.slice(0, moveCount).join(' ')
    if (parsedState(record).phase === 'playing') searchRecords.push(record)
  }
  // Des parties aléatoires, à tous les âges : ouverture, milieu, fin résolue.
  for (const game of games.slice(1, 9)) {
    const tokens = game.record.split(' ')
    for (const fraction of [0.3, 0.6, 0.85]) {
      const record = tokens.slice(0, Math.floor(tokens.length * fraction)).join(' ')
      if (parsedState(record).phase === 'playing' && !searchRecords.includes(record)) searchRecords.push(record)
    }
  }
}

type SearchCase = {
  record: string
  maxNodes: number
  seed: number
  variant?: 'reduce' | 'evenDepth' | 'keepPartial' | 'allCriteria' | 'customWeights'
}

const VARIANTS: Record<NonNullable<SearchCase['variant']>, MasterSearchOptions> = {
  reduce: { reduce: true },
  evenDepth: { allowOddDepth: false },
  keepPartial: { keepPartial: true },
  allCriteria: { criteria: ALL_CRITERIA },
  customWeights: { weights: CUSTOM_WEIGHTS },
}

const searchCases: SearchCase[] = []
searchRecords.forEach((record, index) => {
  for (const maxNodes of [20_000, 200_000]) searchCases.push({ record, maxNodes, seed: 1000 + index })
})
const variantNames = Object.keys(VARIANTS) as NonNullable<SearchCase['variant']>[]
searchRecords.slice(0, 2 * variantNames.length).forEach((record, index) => {
  searchCases.push({ record, maxNodes: 50_000, seed: 7 + index, variant: variantNames[index % variantNames.length] })
})

const search = searchCases.map((entry) => {
  const position = positionOf(parsedState(entry.record))
  const options: MasterSearchOptions = { maxNodes: entry.maxNodes, ...(entry.variant ? VARIANTS[entry.variant] : {}) }
  const top = searchMasterTopMoves(position, options)!
  const chosen = chooseMasterMove(position, { ...options, random: seededRandom(entry.seed) })!
  return {
    ...entry,
    moves: top.moves.map(token),
    pv: top.pv.map(token),
    score: top.score,
    depth: top.depth,
    exact: top.exact,
    nodes: top.nodes,
    chosen: token(chosen.move),
  }
})

// --- Livre, et entrée du maître ------------------------------------------------

const bookRecords = ['', 'w', 'b']
for (const move of enumerateLegalMoves(createGamePosition('blue').board, createGamePosition('blue').inventories.blue)) {
  bookRecords.push(token(move))
}
{
  // Deuxièmes coups de blanc : premier coup bleu, réponse du livre, coup bleu au hasard.
  const random = seededRandom(99)
  for (const first of bookRecords.slice(3, 63)) {
    const reply = lookupOpeningMove(positionOf(parsedState(first)))
    if (!reply) continue
    const state = parsedState(`${first} ${token(reply)}`)
    const moves = enumerateLegalMoves(state.board, state.inventories[state.activePlayer])
    bookRecords.push(`${first} ${token(reply)} ${token(moves[Math.floor(random() * moves.length)])}`)
  }
}
const book = {
  entries: Object.keys(OPENING_BOOK).length,
  lookups: bookRecords.flatMap((record, index) =>
    [undefined, 31 + index, 77 + index].map((seed) => {
      const move = lookupOpeningMove(positionOf(parsedState(record)), seed === undefined ? undefined : seededRandom(seed))
      return { record, seed: seed ?? null, move: move ? token(move) : null }
    }),
  ),
}

/** Le chemin du jeu : le livre d'abord, puis la recherche, sous le même aléa. */
const master = ['', 'w', '15', '4Lsr21 4Ss3', bookRecords[bookRecords.length - 1], REFERENCE_GAME.split(' ').slice(0, 12).join(' ')].map(
  (record, index) => {
    const position = positionOf(parsedState(record))
    const random = seededRandom(500 + index)
    const fromBook = lookupOpeningMove(position, random)
    const move = fromBook ?? chooseMasterMove(position, { maxNodes: 20_000, random })!.move
    return { record, seed: 500 + index, maxNodes: 20_000, move: token(move), fromBook: fromBook !== null }
  },
)

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify({ reference: REFERENCE_GAME, games, notation, evaluation, search, book, master })}\n`)
console.log(
  `${games.length} parties, ${games.reduce((total, game) => total + game.positions.length, 0)} positions, ` +
    `${evaluation.values.length} évaluations, ${search.length} recherches, ${book.lookups.length} lectures du livre → ${OUTPUT}`,
)
