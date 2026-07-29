/**
 * Duel apparié « avec livre » contre « sans livre », à ouverture imposée.
 *
 * Les deux camps sont le **même** moteur au même budget ; la seule différence
 * est que blanc consulte le livre. Aucun aléa n'intervient : la partie varie par
 * l'ouverture de bleu, imposée de l'extérieur, si bien que chaque paire de
 * parties exerce une entrée différente du livre et que les deux bras sont
 * comparables coup pour coup.
 *
 * Le compte de déclenchements affiché en fin de run dit ce que la mesure a
 * réellement exercé : un livre qui ne se déclenche pas ne se mesure pas, et
 * c'est de n'avoir pas vu cela qu'était venue une conclusion fausse.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-livre.ts
 *
 * Options : --nodes N (défaut 60 000) · --openings M (défaut 12).
 *
 * Pourquoi pas `duel-maitre.ts` : celui-ci alterne les couleurs et fait varier
 * les parties par l'aléa de départage. Or le livre n'a que des clés `white|` —
 * il ne se déclenche jamais quand le camp mesuré joue bleu, si bien que la
 * moitié des parties oppose deux moteurs identiques et ne mesure rien. C'est ce
 * biais qui avait fait conclure à tort que le livre coûtait des parties.
 */
import { chooseMasterMove } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import { canonicalPosition, lookupOpeningMove } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { GameResult } from '../src/game/types'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const NODES = arg('--nodes', 60_000)
const LIMIT = arg('--openings', 12)

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`

type Played = { result: GameResult; bookMoves: number }

/**
 * Une partie entière depuis la position donnée, sans aléa.
 *
 * Le livre est consulté à **chaque** coup blanc, pas seulement au premier : un
 * livre engendré avec `--replies` couvre aussi le 2ᵈ, et le brider ici rendrait
 * ces entrées-là invisibles à la mesure. C'est `lookupOpeningMove` qui borne son
 * propre périmètre, via `isWithinBookRange` — le duel n'a rien à en présumer.
 */
function play(start: GamePosition, whiteUsesBook: boolean): Played {
  let position = start
  let bookMoves = 0
  for (let turn = 0; turn < 60; turn += 1) {
    let move = null
    if (whiteUsesBook && position.activePlayer === 'white') {
      move = lookupOpeningMove(position)
      if (move) bookMoves += 1
    }
    if (!move) move = chooseMasterMove(position, { maxNodes: NODES })?.move ?? null
    if (!move) throw new Error('Le joueur au trait devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, move)
    if (transition.result) return { result: transition.result, bookMoves }
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

const blueStart = createGamePosition('blue')
const seen = new Set<string>()
let withBook = 0
let withoutBook = 0
let sameOutcome = 0
let played = 0
let bookMoves = 0

process.stderr.write(`duel apparié : ${LIMIT} ouvertures, ${NODES} nœuds\n`)

for (const opening of enumerateLegalMoves(blueStart.board, blueStart.inventories.blue)) {
  if (played >= LIMIT) break
  const after = simulateLegalMove(blueStart, opening)
  if (after.result) continue
  const { key } = canonicalPosition(after.position)
  if (seen.has(key)) continue
  seen.add(key)
  played += 1

  const armWith = play(after.position, true)
  const armWithout = play(after.position, false)
  const resultWith = armWith.result
  const resultWithout = armWithout.result
  bookMoves += armWith.bookMoves
  const wonWith = resultWith.winner === 'white'
  const wonWithout = resultWithout.winner === 'white'
  if (wonWith) withBook += 1
  if (wonWithout) withoutBook += 1
  if (wonWith === wonWithout) sameOutcome += 1

  process.stderr.write(
    `[${elapsed()}] ouverture ${played}/${LIMIT} — ${armWith.bookMoves} coup(s) de livre · avec livre : ${
      resultWith.winner ?? 'nulle'
    } · sans livre : ${resultWithout.winner ?? 'nulle'}` +
      `${wonWith === wonWithout ? '' : wonWith ? '  ← le livre gagne la partie' : '  ← le livre perd la partie'}\n`,
  )
}

console.log(
  `\nblanc avec livre : ${withBook} victoire(s) sur ${played} · ` +
    `blanc sans livre : ${withoutBook} sur ${played} · ` +
    `même issue dans ${sameOutcome} cas (${elapsed()})\n` +
    `livre déclenché ${bookMoves} fois au total, soit ${(bookMoves / Math.max(played, 1)).toFixed(1)} ` +
    `coup(s) par partie — un livre qui ne se déclenche pas ne se mesure pas.`,
)
