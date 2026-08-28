/**
 * Empreinte de l'évaluation, et son coût.
 *
 * Une réécriture de l'évaluation qui rend **exactement** les mêmes valeurs n'a
 * pas à se mesurer en duel : elle ne peut pas changer un seul coup joué. Encore
 * faut-il le prouver. Ce script parcourt un corpus figé de positions, imprime
 * la liste des valeurs (`--dump`) ou leur empreinte, et chronomètre l'appel.
 *
 * Avant / après, sur le même corpus :
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/empreinte-evaluation.ts --dump > apres.txt
 *   git stash push src/game/engineSearch.ts
 *   node node_modules/vite-node/dist/cli.mjs scripts/empreinte-evaluation.ts --dump > avant.txt
 *   git stash pop && diff avant.txt apres.txt
 *
 * Le corpus mêle deux régimes qu'il faut tous deux couvrir : la partie de
 * référence avec **tous les enfants** de chacune de ses positions — le milieu de
 * partie, réserves fournies —, et des parties tirées au hasard menées jusqu'au
 * blocage, qui seules atteignent les réserves basses, les axes morts et les
 * plateaux presque pleins.
 */
import {
  applyMove,
  createEnginePosition,
  flipSide,
  generateMoves,
  hasAnyMove,
  loadPosition,
  otherSide,
  undoMove,
} from '../src/game/engineBoard'
import type { EnginePosition } from '../src/game/engineBoard'
import { evaluate } from '../src/game/engineSearch'
import {
  REFERENCE_GAME_LENGTH,
  referencePositionAfter,
} from '../src/game/referenceGame'

const RANDOM_GAMES = 12
const TIMING_ROUNDS = 4000

const values: number[] = []
const moves = new Int32Array(256)
const position = createEnginePosition()

/** La position et chacun de ses enfants. */
function record(): void {
  values.push(evaluate(position))
  const count = generateMoves(position, moves, 0)
  for (let index = 0; index < count; index += 1) {
    applyMove(position, moves[index])
    values.push(evaluate(position))
    undoMove(position, moves[index])
  }
}

for (let moveCount = 0; moveCount <= REFERENCE_GAME_LENGTH; moveCount += 1) {
  loadPosition(position, referencePositionAfter(moveCount))
  record()
}

// Tirage à graine : le corpus est le même d'une exécution à l'autre.
let seed = 123456789
const draw = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x80000000
}

for (let game = 0; game < RANDOM_GAMES; game += 1) {
  loadPosition(position, referencePositionAfter(0))
  for (;;) {
    const count = generateMoves(position, moves, 0)
    if (count === 0) {
      if (!hasAnyMove(position, otherSide(position.side))) break
      flipSide(position)
      continue
    }
    applyMove(position, moves[Math.floor(draw() * count)])
    record()
  }
}

if (process.argv.includes('--dump')) {
  console.log(values.join('\n'))
} else {
  let fingerprint = 0
  for (const value of values) fingerprint = (fingerprint * 31 + value) | 0

  const timed: EnginePosition[] = []
  for (let moveCount = 0; moveCount <= REFERENCE_GAME_LENGTH; moveCount += 1) {
    const copy = createEnginePosition()
    loadPosition(copy, referencePositionAfter(moveCount))
    timed.push(copy)
  }
  for (let round = 0; round < 200; round += 1) {
    for (const snapshot of timed) evaluate(snapshot)
  }
  const start = process.hrtime.bigint()
  for (let round = 0; round < TIMING_ROUNDS; round += 1) {
    for (const snapshot of timed) evaluate(snapshot)
  }
  const elapsed = Number(process.hrtime.bigint() - start) / 1e6
  const calls = TIMING_ROUNDS * timed.length

  console.log(`valeurs : ${values.length}`)
  console.log(`empreinte : ${fingerprint}`)
  console.log(`évaluation : ${((elapsed * 1000) / calls).toFixed(2)} µs par appel`)
}
