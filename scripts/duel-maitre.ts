/**
 * Duel du maître contre son propre passé, hors de Vitest.
 *
 * Le même duel existe dans `src/game/depthDuel.test.ts`, mais une recherche
 * profonde bloque le fil d'exécution pendant des minutes sans jamais rendre la
 * main : le worker de Vitest ne peut plus répondre à ses propres appels et la
 * suite s'interrompt sur un « Timeout calling onTaskUpdate » qui ne dit rien de
 * la force du moteur. Ce script fait le même travail sans harnais, en affichant
 * l'avancement partie par partie.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-maitre.ts
 *
 * Options : --games N (défaut 8) · --nodes N (défaut 60 000, le seuil mesuré
 * au-delà duquel le moteur domine) · --book master|none|both (défaut `master`).
 *
 * **La référence doit rester fixe.** `--book both` donne aussi le livre à
 * l'ancien maître, dont la recherche d'ouverture est très courte : il en profite
 * bien plus que le moteur actuel, qui trouve déjà un bon premier coup tout seul.
 * Comparer un run `both` à un run `none` fait alors varier les **deux** camps à
 * la fois et ne mesure plus rien — c'est le piège dans lequel ce script est
 * tombé une première fois.
 *
 * **Ce script ne mesure pas le livre.** Il alterne les couleurs, alors que le
 * livre ne couvre que blanc : une partie sur deux, le camp mesuré joue bleu, le
 * livre ne se déclenche pas et les deux moteurs deviennent identiques. Agréger
 * les deux moitiés dilue l'effet du livre dans des parties où il n'existe pas —
 * c'est ce qui avait fait conclure à tort qu'il coûtait des parties. Le compte
 * de déclenchements affiché en fin de run rend ce biais visible. Pour mesurer le
 * livre, utiliser `duel-livre.ts`, qui apparie les parties à ouverture imposée.
 */
import { chooseMasterMove } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import { chooseMinimaxMove } from '../src/game/minimax'
import { lookupOpeningMove } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { GameResult, PlayerId } from '../src/game/types'

const arg = (name: string, fallback: number): number => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? Number(process.argv[index + 1]) : fallback
}
const GAMES = arg('--games', 8)
const NODES = arg('--nodes', 60_000)
const bookIndex = process.argv.indexOf('--book')
const BOOK = bookIndex >= 0 ? process.argv[bookIndex + 1] : 'master'
if (!['master', 'none', 'both'].includes(BOOK)) {
  throw new Error(`--book attend master, none ou both (reçu « ${BOOK} »).`)
}
const BOOK_FOR_CURRENT = BOOK === 'master' || BOOK === 'both'
const BOOK_FOR_LEGACY = BOOK === 'both'

function randomForSeed(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

/**
 * L'ancien maître, reconstruit : livre d'ouverture puis alpha-bêta à profondeur
 * 4, 3 ou 2 selon la largeur de la position — son barème d'alors. Référence
 * figée : elle ne doit pas suivre les évolutions du niveau, sinon elle cesserait
 * de mesurer quoi que ce soit.
 */
const LEGACY_DEEP_MOVES = 30
const LEGACY_WIDE_MOVES = 48

function legacyMove(position: GamePosition, random: () => number) {
  if (BOOK_FOR_LEGACY) {
    const fromBook = lookupOpeningMove(position, random)
    if (fromBook) return fromBook
  }
  const moves = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  ).length
  const depth = moves <= LEGACY_DEEP_MOVES ? 4 : moves <= LEGACY_WIDE_MOVES ? 3 : 2
  return chooseMinimaxMove(position, { depth, random })?.move ?? null
}

let currentBookHits = 0

function currentMove(position: GamePosition, random: () => number) {
  if (BOOK_FOR_CURRENT) {
    const fromBook = lookupOpeningMove(position, random)
    if (fromBook) {
      currentBookHits += 1
      return fromBook
    }
  }
  return chooseMasterMove(position, { maxNodes: NODES, random })?.move ?? null
}

/**
 * Une partie complète **depuis la grille vide**. Partir de poses aléatoires
 * fabriquerait souvent une position déjà décidée : on ne mesurerait alors que le
 * tirage de l'ouverture. C'est l'aléa de départage, et lui seul, qui distingue
 * deux parties.
 */
function play(currentPlayer: PlayerId, seed: number): GameResult {
  const random = randomForSeed(seed)
  let position = createGamePosition('blue')
  for (let turn = 0; turn < 60; turn += 1) {
    const move =
      position.activePlayer === currentPlayer
        ? currentMove(position, random)
        : legacyMove(position, random)
    if (!move) throw new Error('Le joueur au trait devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, move)
    if (transition.result) return transition.result
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`

process.stderr.write(
  `duel : ${GAMES} parties, ${NODES} nœuds, livre pour ` +
    `${BOOK === 'none' ? 'personne' : BOOK === 'both' ? 'les deux camps' : 'le maître actuel seul'}\n`,
)

let currentWins = 0
let legacyWins = 0
let draws = 0
for (let game = 0; game < GAMES; game += 1) {
  // Les deux couleurs à tour de rôle : le trait ne peut pas expliquer seul le
  // résultat.
  const currentPlayer: PlayerId = game % 2 === 0 ? 'blue' : 'white'
  const result = play(currentPlayer, 1_000 + game * 7_919)
  if (result.winner === currentPlayer) currentWins += 1
  else if (result.winner === null) draws += 1
  else legacyWins += 1
  process.stderr.write(
    `[${elapsed()}] partie ${game + 1}/${GAMES} — maître actuel ${currentWins}, ` +
      `ancien ${legacyWins}, nulles ${draws}\n`,
  )
}

console.log(
  `\nmaître actuel ${currentWins} — ancien ${legacyWins} — nulles ${draws} ` +
    `(sur ${GAMES} parties, ${elapsed()})`,
)

if (BOOK_FOR_CURRENT) {
  console.log(
    `livre consulté avec succès dans ${currentBookHits} partie(s) sur ${GAMES} — ` +
      `les autres opposent deux moteurs identiques et ne disent rien du livre.`,
  )
}
