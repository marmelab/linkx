import { describe, expect, it } from 'vitest'
import { enumerateLegalMoves } from './legalMoves'
import { chooseMasterMove } from './engineSearch'
import { lookupOpeningMove } from './openingBook'
import { chooseMinimaxMove, chooseMoveForDifficulty } from './minimax'
import { createGamePosition, simulateLegalMove } from './simulation'
import type { GamePosition } from './simulation'
import type { Difficulty, GameResult, PlayerId } from './types'

/**
 * Duel entre deux profondeurs de recherche. Une partie complète à profondeur 3
 * demande plusieurs secondes : la suite entière dure une trentaine de secondes,
 * hors budget de `npm test`. Elle ne s'exécute donc que sur demande :
 *
 * ```bash
 * LINKX_DEPTH_DUEL=1 npx vitest run src/game/depthDuel.test.ts
 * ```
 */
const ENABLED = process.env.LINKX_DEPTH_DUEL === '1'

/** Poses aléatoires d'ouverture : elles écartent les parties d'une même racine. */
const OPENING_PLIES = 8
const OPENINGS = 8

function randomForSeed(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

function openingPosition(seed: number): GamePosition | null {
  const random = randomForSeed(seed)
  let position = createGamePosition('blue')
  for (let ply = 0; ply < OPENING_PLIES; ply += 1) {
    const moves = enumerateLegalMoves(
      position.board,
      position.inventories[position.activePlayer],
    )
    if (moves.length === 0) return null
    const transition = simulateLegalMove(
      position,
      moves[Math.floor(random() * moves.length)],
    )
    if (transition.result) return null
    position = transition.position
  }
  return position
}

function playGame(
  start: GamePosition,
  depths: Record<PlayerId, number>,
): GameResult {
  let position = start
  for (let turn = 0; turn < 60; turn += 1) {
    const decision = chooseMinimaxMove(position, {
      depth: depths[position.activePlayer],
    })
    if (!decision) throw new Error('Le joueur actif devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, decision.move)
    if (transition.result) return transition.result
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

describe.skipIf(!ENABLED)('duel entre profondeurs', () => {
  it(
    'la profondeur 3 gagne plus souvent que la profondeur 2',
    () => {
      let deepWins = 0
      let shallowWins = 0
      let draws = 0

      for (let opening = 1; opening <= OPENINGS; opening += 1) {
        const start = openingPosition(9_000 + opening * 53)
        if (!start) continue
        // Chaque ouverture est jouée deux fois, les couleurs échangées : le
        // trait ne peut pas expliquer à lui seul le résultat.
        for (const deepPlayer of ['blue', 'white'] as PlayerId[]) {
          const result = playGame(start, {
            blue: deepPlayer === 'blue' ? 3 : 2,
            white: deepPlayer === 'white' ? 3 : 2,
          })
          if (result.winner === deepPlayer) deepWins += 1
          else if (result.winner === null) draws += 1
          else shallowWins += 1
        }
      }

      // Mesure de référence sur ces mêmes ouvertures : 11 victoires, 4 défaites
      // et 1 nulle en 30 s. La marge est nette sans être écrasante, l'avantage
      // d'un demi-coup d'anticipation restant modeste devant le bruit de
      // l'heuristique.
      expect(deepWins).toBeGreaterThan(shallowWins)
      expect(deepWins + shallowWins + draws).toBe(OPENINGS * 2)
    },
    120_000,
  )
})

/** Une partie où chaque joueur joue à son propre niveau, plafond adaptatif compris. */
function playDifficultyGame(
  start: GamePosition,
  difficulties: Record<PlayerId, Difficulty>,
): GameResult {
  let position = start
  for (let turn = 0; turn < 60; turn += 1) {
    const decision = chooseMoveForDifficulty(
      position,
      difficulties[position.activePlayer],
    )
    if (!decision) throw new Error('Le joueur actif devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, decision.move)
    if (transition.result) return transition.result
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

/**
 * Duel entre niveaux réels — plafond adaptatif compris, sinon la profondeur 4
 * jouerait l'ouverture à 95 coups et chaque pose demanderait des minutes. Le
 * maître est un cran plus profond que l'expert sur presque tout le jeu (depth 4
 * jusqu'à 30 coups, depth 3 jusqu'à 48), mais un demi-coup d'anticipation de plus
 * ne garantit pas un meilleur coup à chaque position — seulement en moyenne. On
 * n'exige donc que « au moins aussi fort », le critère d'acceptation de `plan.md`.
 */
describe.skipIf(!ENABLED)('duel entre niveaux', () => {
  it(
    'le niveau maître fait au moins aussi bien que l’expert',
    () => {
      let masterWins = 0
      let expertWins = 0

      for (let opening = 1; opening <= OPENINGS; opening += 1) {
        const start = openingPosition(9_000 + opening * 53)
        if (!start) continue
        for (const masterPlayer of ['blue', 'white'] as PlayerId[]) {
          const result = playDifficultyGame(start, {
            blue: masterPlayer === 'blue' ? 'master' : 'hard',
            white: masterPlayer === 'white' ? 'master' : 'hard',
          })
          if (result.winner === masterPlayer) masterWins += 1
          else if (result.winner !== null) expertWins += 1
        }
      }

      expect(masterWins).toBeGreaterThanOrEqual(expertWins)
    },
    240_000,
  )
})

/**
 * Duel du maître contre son propre passé.
 *
 * Le maître ne se règle plus en profondeur : il a son propre moteur. Pour que le
 * gain reste vérifiable, on **reconstruit ici l'ancien maître** — livre
 * d'ouverture puis alpha-bêta à profondeur 4/3/2 selon la largeur de la
 * position, exactement son barème d'alors — et on le fait jouer contre le
 * nouveau. C'est une référence figée : elle ne doit pas suivre les évolutions du
 * niveau, sinon elle cesserait de mesurer quoi que ce soit.
 *
 * **Depuis la grille vide.** Les duels ci-dessus partent de huit poses
 * aléatoires, ce qui écarte les parties d'une même racine mais fabrique souvent
 * une position **déjà décidée** : mesurée ainsi, une recherche huit fois plus
 * fournie ne bat la même recherche que 19 à 13. Depuis la grille vide, où chaque
 * camp choisit son ouverture, les mêmes moteurs donnent 21 à 3. C'est la
 * variation de l'aléa de départage, et non un préfixe aléatoire, qui doit
 * distinguer deux parties.
 */
const LEGACY_MASTER_DEEP_MOVES = 30
const LEGACY_MASTER_WIDE_MOVES = 48

function legacyMasterMove(position: GamePosition, random: () => number) {
  const fromBook = lookupOpeningMove(position, random)
  if (fromBook) return fromBook
  const moves = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  ).length
  const depth =
    moves <= LEGACY_MASTER_DEEP_MOVES ? 4 : moves <= LEGACY_MASTER_WIDE_MOVES ? 3 : 2
  return chooseMinimaxMove(position, { depth, random })?.move ?? null
}

function playMasterAgainstLegacy(
  currentPlayer: PlayerId,
  seed: number,
  nodes: number,
): GameResult {
  const random = randomForSeed(seed)
  let position = createGamePosition('blue')
  for (let turn = 0; turn < 60; turn += 1) {
    const move =
      position.activePlayer === currentPlayer
        ? (chooseMasterMove(position, { maxNodes: nodes, random })?.move ?? null)
        : legacyMasterMove(position, random)
    if (!move) throw new Error('Le joueur actif devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, move)
    if (transition.result) return transition.result
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

describe.skipIf(!ENABLED)('duel du maître contre son propre passé', () => {
  it(
    'le maître actuel bat nettement l’ancien',
    () => {
      const GAMES = 8
      let currentWins = 0
      let legacyWins = 0

      for (let game = 0; game < GAMES; game += 1) {
        // Les deux couleurs à tour de rôle : le trait ne peut pas expliquer
        // seul le résultat.
        const currentPlayer: PlayerId = game % 2 === 0 ? 'blue' : 'white'
        const result = playMasterAgainstLegacy(
          currentPlayer,
          1_000 + game * 7_919,
          60_000,
        )
        if (result.winner === currentPlayer) currentWins += 1
        else if (result.winner !== null) legacyWins += 1
      }

      // Mesure de référence sur ces graines : 24 victoires sur 24 parties.
      //
      // 60 000 nœuds n'est pas un chiffre rond : c'est le seuil mesuré à partir
      // duquel le nouveau moteur domine. En deçà (30 000 et 45 000 nœuds), il ne
      // fait que 5 à 3 — la profondeur atteinte dans l'ouverture retombe alors
      // au niveau de l'ancien barème. C'est ce seuil qui fixe le budget du
      // niveau. Le critère reste plus lâche que la mesure, huit parties étant
      // bruitées.
      expect(currentWins).toBeGreaterThan(legacyWins * 2)
    },
    600_000,
  )
})
