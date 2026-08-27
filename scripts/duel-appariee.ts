/**
 * Duel apparié entre deux réglages du moteur, à ouverture imposée.
 *
 * C'est l'instrument de décision : aucune modification de la recherche ou de
 * l'évaluation n'est conservée si elle ne se mesure pas ici au-dessus du bruit.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/duel-appariee.ts --a impair --b pair
 *
 * Options : --a NOM · --b NOM (voir `VARIANTS`) · --nodes N (défaut 120 000,
 * l'ordre de grandeur du budget worker) · --nodes-a N · --nodes-b N pour donner
 * des budgets différents aux deux arms · --openings M (défaut 24, soit 48
 * parties).
 *
 * **Protocole.** Chaque ouverture imposée de bleu donne **deux** parties, une
 * par attribution des couleurs, si bien qu'aucun avantage de couleur ne peut
 * être pris pour une différence de force. Les deux arms sont bornés au même
 * nombre de nœuds — jamais au temps, qui rendrait la mesure dépendante de la
 * charge de la machine — et ne tirent rien au sort : à ouverture donnée, la
 * partie est entièrement déterminée par les deux réglages.
 *
 * **Volume.** Un tour d'anticipation supplémentaire vaut environ 65 à 70 % de
 * score. Le distinguer du hasard demande une quarantaine de parties appariées ;
 * c'est ce qui manquait aux mesures à huit parties dont le dépôt tirait ses
 * conclusions. L'intervalle de Wilson affiché en fin de run dit si la
 * différence tient : tant qu'il contient 50 %, la mesure ne conclut pas.
 */
import { chooseMasterMove } from '../src/game/engineSearch'
import type { MasterSearchOptions } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import { canonicalPosition } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { PlayerId } from '../src/game/types'

/**
 * Réglages comparables. En ajouter un plutôt que de modifier le moteur à la
 * volée : c'est ce qui rend une mesure rejouable des mois plus tard.
 */
const VARIANTS: Record<string, MasterSearchOptions> = {
  courant: {},
  'courant-bis': {},
  impair: { allowOddDepth: true, reduce: false },
  pair: { allowOddDepth: false, reduce: false },
  'sans-reduction': { reduce: false },
  'avec-reduction': { reduce: true },
  partiel: { keepPartial: true },
  'sans-partiel': { keepPartial: false },
  'axe2-1': { secondaryAxisWeight: 1 },
  'axe2-3': { secondaryAxisWeight: 3 },
  'axe2-5': { secondaryAxisWeight: 5 },
}

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const name = (flag: string, fallback: string): string => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const NODES = arg('--nodes', 120_000)
// Budgets distincts : opposer un moteur à lui-même avec plus de nœuds dit si
// c'est la profondeur ou le jugement qui borne sa force. Sans cette mesure, on
// optimise la recherche sans savoir si elle est le facteur limitant.
const NODES_A = arg('--nodes-a', NODES)
const NODES_B = arg('--nodes-b', NODES)
const LIMIT = arg('--openings', 24)
const A = name('--a', 'courant')
const B = name('--b', 'pair')
for (const variant of [A, B]) {
  if (!VARIANTS[variant]) {
    throw new Error(`Réglage inconnu : ${variant}. Connus : ${Object.keys(VARIANTS).join(', ')}`)
  }
}

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)}s`

/** Une partie entière, chaque camp jouant avec son propre réglage. */
function play(start: GamePosition, sides: Record<PlayerId, string>): PlayerId | null {
  let position = start
  for (let turn = 0; turn < 60; turn += 1) {
    const variant = sides[position.activePlayer]
    const options = VARIANTS[variant]
    const move = chooseMasterMove(position, {
      ...options,
      maxNodes: variant === A ? NODES_A : NODES_B,
    })?.move
    if (!move) throw new Error('Le joueur au trait devrait disposer d’un coup légal.')
    const transition = simulateLegalMove(position, move)
    if (transition.result) return transition.result.winner ?? null
    position = transition.position
  }
  throw new Error('La partie simulée dépasse le nombre maximal de poses.')
}

/**
 * Intervalle de Wilson à 95 % sur la proportion de points de A. Préféré à
 * l'intervalle normal, qui est faux aux petits effectifs — précisément le
 * régime où l'on travaille ici.
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

const blueStart = createGamePosition('blue')
const seen = new Set<string>()
let score = 0
let games = 0
let winsA = 0
let winsB = 0
let draws = 0
let openings = 0
// Statistique appariée : par ouverture, A marque 0, 1 ou 2 points sur les deux
// attributions de couleurs. Une ouverture à 1 partout ne dit rien — c'est la
// couleur qui a décidé, pas le réglage. Seules les ouvertures **discordantes**
// portent de l'information, et le test des signes ne compte que celles-là.
let openingsWon = 0
let openingsLost = 0

process.stderr.write(
  `duel apparié : ${A} (${NODES_A} nœuds) contre ${B} (${NODES_B} nœuds), ${LIMIT} ouvertures\n`,
)

for (const opening of enumerateLegalMoves(blueStart.board, blueStart.inventories.blue)) {
  if (openings >= LIMIT) break
  const after = simulateLegalMove(blueStart, opening)
  if (after.result) continue
  const { key } = canonicalPosition(after.position)
  if (seen.has(key)) continue
  seen.add(key)
  openings += 1

  // Les deux attributions de couleurs sur la même ouverture : c'est l'appariement.
  const outcomes: string[] = []
  for (const aPlays of ['white', 'blue'] as const) {
    const other = aPlays === 'white' ? 'blue' : 'white'
    const winner = play(after.position, { [aPlays]: A, [other]: B } as Record<PlayerId, string>)
    games += 1
    if (winner === null) {
      draws += 1
      score += 0.5
      outcomes.push(`${A} en ${aPlays} : nulle`)
    } else if (winner === aPlays) {
      winsA += 1
      score += 1
      outcomes.push(`${A} en ${aPlays} : gagne`)
    } else {
      winsB += 1
      outcomes.push(`${A} en ${aPlays} : perd`)
    }
  }
  const pair = outcomes.filter((outcome) => outcome.endsWith('gagne')).length
  if (pair === 2) openingsWon += 1
  else if (pair === 0) openingsLost += 1

  process.stderr.write(`[${elapsed()}] ouverture ${openings}/${LIMIT} — ${outcomes.join(' · ')}\n`)
}

/**
 * Test des signes bilatéral sur les ouvertures discordantes. Sur données
 * appariées c'est le test le plus puissant dont on dispose sans hypothèse
 * supplémentaire : il élimine l'effet de couleur, qui domine ici les résultats
 * et écrase l'intervalle de Wilson calculé partie par partie.
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

const [low, high] = wilson(score, games)
const conclusive = low > 0.5 || high < 0.5
console.log(
  `\n${A} contre ${B} : ${winsA} victoire(s), ${winsB} défaite(s), ${draws} nulle(s) ` +
    `sur ${games} parties (${elapsed()})\n` +
    `score de ${A} : ${((100 * score) / games).toFixed(1)} % ` +
    `— intervalle de Wilson à 95 % [${(100 * low).toFixed(1)} %, ${(100 * high).toFixed(1)} %]\n` +
    `ouvertures gagnées des deux couleurs : ${openingsWon} pour ${A}, ` +
    `${openingsLost} pour ${B}, ${openings - openingsWon - openingsLost} indécises ` +
    `— test des signes p = ${signTest(openingsWon, openingsLost).toFixed(3)}\n` +
    (conclusive
      ? low > 0.5
        ? `conclusion : ${A} est plus fort.`
        : `conclusion : ${A} est plus faible.`
      : "conclusion : l'intervalle contient 50 %, la mesure ne tranche pas."),
)
