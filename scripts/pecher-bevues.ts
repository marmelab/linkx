/**
 * Fouille de bévues : fabrique la suite tactique que le dépôt n'a pas.
 *
 * Le maître ne se juge bien que sur des positions où il se trompe, et
 * `engineSearch.test.ts` n'en connaît qu'une poignée, tirées d'une seule partie
 * perdue. Ce script en produit d'autres sans qu'aucun humain ait à jouer : le
 * moteur au budget du jeu joue contre lui-même, et un moteur **beaucoup plus
 * riche** arbitre chacun de ses coups. Là où l'écart de jugement dépasse le
 * seuil, la position devient un cas de test, avec le coup attendu.
 *
 * Une position que l'arbitre **résout** est écartée : tous les coups y valent
 * la même chose — perdu, ou gagné — et l'écart mesuré ne dirait plus que
 * l'imprécision du moteur mesuré face à une partie déjà jouée.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/pecher-bevues.ts
 *
 * Options : --nodes N (moteur mesuré, défaut 60 000) · --strong N (arbitre,
 * défaut 600 000) · --seuil N (écart de score retenu, défaut 900, soit près
 * d'un cran d'axe principal) · --games M (défaut 3).
 *
 * **L'arbitre juge les deux coups à la même aune** : son propre meilleur coup
 * d'un côté, le coup joué de l'autre, ce dernier noté en cherchant la position
 * qui en résulte et en retournant le score. C'est le procédé de
 * `scripts/audit-livre.ts`, et il vaut ici pour la même raison — comparer deux
 * coups suppose un juge unique, sans quoi on mesure l'écart entre deux juges.
 *
 * La sortie est en notation de `moveNotation.ts` : chaque ligne se recolle dans
 * un test ou dans une URL `?moves=`.
 */
import { MATE_THRESHOLD, chooseMasterMove } from '../src/game/engineSearch'
import type { LegalMove } from '../src/game/legalMoves'
import { serializeMove } from '../src/game/moveNotation'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import { canonicalPosition } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const WEAK = arg('--nodes', 60_000)
const STRONG = arg('--strong', 600_000)
const THRESHOLD = arg('--seuil', 900)
const GAMES = arg('--games', 3)

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`

const token = (move: LegalMove): string =>
  serializeMove({
    shapeId: move.shapeId,
    rotation: move.orientation.rotation,
    flipped: move.orientation.flipped,
    column: move.column,
  })

const sameMove = (a: LegalMove, b: LegalMove): boolean =>
  a.cells.length === b.cells.length &&
  a.cells.every((cell, i) => cell.x === b.cells[i].x && cell.y === b.cells[i].y)

/**
 * Note un coup avec l'arbitre : on le joue, on cherche la position qui en
 * résulte, et l'on retourne le score — celui-ci étant rendu du point de vue du
 * joueur au trait, qui est désormais l'adversaire.
 */
function judge(position: GamePosition, move: LegalMove): number {
  const next = simulateLegalMove(position, move)
  if (next.result) {
    if (next.result.winner === null) return 0
    return next.result.winner === position.activePlayer ? 1e6 : -1e6
  }
  const reply = chooseMasterMove(next.position, { maxNodes: STRONG })
  if (!reply) return 0
  // Une passe forcée laisse le trait au même joueur : le score est alors déjà
  // de son point de vue et ne se retourne pas.
  return next.position.activePlayer === position.activePlayer
    ? reply.score
    : -reply.score
}

const blueStart = createGamePosition('blue')
const seen = new Set<string>()
const findings: string[] = []
let openings = 0

process.stderr.write(
  `fouille de bévues : ${GAMES} partie(s), moteur ${WEAK} nœuds, arbitre ${STRONG}, seuil ${THRESHOLD}\n`,
)

for (const opening of enumerateLegalMoves(blueStart.board, blueStart.inventories.blue)) {
  if (openings >= GAMES) break
  const after = simulateLegalMove(blueStart, opening)
  if (after.result) continue
  const { key } = canonicalPosition(after.position)
  if (seen.has(key)) continue
  seen.add(key)
  openings += 1

  let position = after.position
  const record: string[] = [token(opening)]
  for (let turn = 0; turn < 60; turn += 1) {
    const weak = chooseMasterMove(position, { maxNodes: WEAK })?.move
    if (!weak) break
    const strong = chooseMasterMove(position, { maxNodes: STRONG })
    // Une position déjà perdue ne peut pas se jouer mal : tous les coups y
    // perdent, et l'écart mesuré ne dirait alors que l'imprécision de l'arbitre.
    const decided = strong !== null && Math.abs(strong.score) > MATE_THRESHOLD
    if (strong && !decided && !sameMove(weak, strong.move)) {
      const gap = strong.score - judge(position, weak)
      if (gap >= THRESHOLD) {
        findings.push(
          `${record.join(' ')}  →  joué ${token(weak)}, attendu ${token(strong.move)} ` +
            `(écart ${gap}, demi-coup ${record.length + 1})`,
        )
        process.stderr.write(`[${elapsed()}] bévue au demi-coup ${record.length + 1}, écart ${gap}\n`)
      }
    }

    const player = position.activePlayer
    const transition = simulateLegalMove(position, weak)
    record.push(token(weak))
    if (transition.result) break
    // Une passe forcée occupe sa propre entrée d'historique : sans elle, la
    // notation ne se rejouerait pas.
    if (transition.position.activePlayer === player) record.push('--')
    position = transition.position
  }
  process.stderr.write(`[${elapsed()}] partie ${openings}/${GAMES} : ${record.length} entrée(s)\n`)
}

console.log(
  findings.length === 0
    ? `aucune bévue au-dessus de ${THRESHOLD} (${elapsed()}).`
    : `${findings.length} bévue(s) au-dessus de ${THRESHOLD} (${elapsed()}) :\n\n${findings.join('\n')}`,
)
