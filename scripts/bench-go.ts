/**
 * Débit du maître TS sur la partie de référence, pour le comparer au portage Go.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/bench-go.ts [--nodes 200000] [--budget 2500]
 *
 * À plafond de nœuds égal, les deux moteurs visitent exactement les mêmes nœuds
 * (voir `empreinte-go.ts`) : le rapport des temps est celui des débits. Côté Go,
 * depuis `engine-go/` et avec les mêmes options :
 *
 *   go test ./conformance -run '^$' -bench ReferenceGame -benchtime 1x -args -nodes 200000 -budget 2500
 *
 * Avec `--budget`, chaque position est cherchée au temps et la profondeur
 * atteinte s'affiche.
 */
import { searchMasterTopMoves } from '../src/game/engineSearch'
import { parseGameRecord } from '../src/game/moveNotation'
import { REFERENCE_GAME } from '../src/game/referenceGame'

const arg = (name: string): number | undefined => {
  const index = process.argv.indexOf(name)
  return index < 0 ? undefined : Number(process.argv[index + 1])
}
const budget = arg('--budget')
const maxNodes = arg('--nodes') ?? 200_000

const tokens = REFERENCE_GAME.split(/\s+/)
let nodes = 0
let elapsed = 0
const depths: number[] = []
for (let moveCount = 0; moveCount <= tokens.length; moveCount += 1) {
  const parsed = parseGameRecord(tokens.slice(0, moveCount).join(' '))
  if (!parsed.ok || parsed.state.phase !== 'playing') continue
  const { board, inventories, activePlayer } = parsed.state
  const start = performance.now()
  const result = searchMasterTopMoves({ board, inventories, activePlayer }, budget ? { budgetMs: budget } : { maxNodes })!
  elapsed += performance.now() - start
  nodes += result.nodes
  depths.push(result.depth)
}
console.log(`${depths.length} positions, ${nodes} nœuds en ${(elapsed / 1000).toFixed(2)} s : ${Math.round(nodes / (elapsed / 1000))} nœuds/s`)
console.log(`profondeurs : ${depths.join(' ')}`)
