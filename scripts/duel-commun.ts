/**
 * Ce que partagent les duels appariés : ouvertures, tirage graine et
 * statistique. `duel-appariee.ts` oppose deux réglages du maître TS,
 * `duel-go.ts` le maître TS à son portage Go ; le protocole est le même.
 */
import { readFileSync } from 'node:fs'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import { parseGameRecord, serializeMove } from '../src/game/moveNotation'
import { canonicalPosition } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { PlayerId } from '../src/game/types'

// --- Ouvertures --------------------------------------------------------------

export type Opening = { notation: string; position: GamePosition }

export const tokenOf = (move: LegalMove): string =>
  serializeMove({
    shapeId: move.shapeId,
    rotation: move.orientation.rotation,
    flipped: move.orientation.flipped,
    column: move.column,
  })

/** Les premiers coups distincts de bleu, au miroir gauche-droite près. */
export function defaultOpenings(limit: number): Opening[] {
  const blueStart = createGamePosition('blue')
  const seen = new Set<string>()
  const openings: Opening[] = []
  for (const move of enumerateLegalMoves(blueStart.board, blueStart.inventories.blue)) {
    if (openings.length >= limit) break
    const after = simulateLegalMove(blueStart, move)
    if (after.result) continue
    const { key } = canonicalPosition(after.position)
    if (seen.has(key)) continue
    seen.add(key)
    openings.push({ notation: tokenOf(move), position: after.position })
  }
  return openings
}

/** Ouvertures d'un fichier JSONL : chaîne de notation ou objet `{ "notation": "…" }`. */
export function fileOpenings(path: string, limit: number): Opening[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(0, limit)
    .map((line) => {
      const parsed: unknown = JSON.parse(line)
      const notation =
        typeof parsed === 'string' ? parsed : String((parsed as { notation: unknown }).notation)
      const record = parseGameRecord(notation)
      if (!record.ok) throw new Error(`${notation} : ${record.error.message}`)
      const { board, inventories, activePlayer, phase } = record.state
      if (phase !== 'playing') throw new Error(`${notation} : la partie est déjà terminée.`)
      return { notation, position: { board, inventories, activePlayer } }
    })
}

// --- Tirage graine -----------------------------------------------------------

/** mulberry32 : petit générateur déterministe, suffisant pour départager des ex æquo. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Graine **par ouverture et par couleur**, jamais par réglage : voir `duel-appariee.ts`. */
export const seedOf = (seed: number, opening: number, player: PlayerId): number =>
  Math.imul(seed, 0x9e3779b1) ^ Math.imul(opening + 1, 0x85ebca6b) ^ (player === 'white' ? 0x5bd1e995 : 0)

// --- Statistique -------------------------------------------------------------

/** Points de A sur une ouverture : quand A a blanc, puis quand A a bleu. */
export type PairResult = { index: number; notation: string; points: [number, number] }

/**
 * Intervalle de Wilson à 95 % sur la proportion de points de A, partie par
 * partie. Préféré à l'intervalle normal, qui est faux aux petits effectifs.
 */
export function wilson(score: number, games: number): [number, number] {
  if (games === 0) return [0, 1]
  const z = 1.96
  const p = score / games
  const denominator = 1 + (z * z) / games
  const centre = p + (z * z) / (2 * games)
  const spread = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * games)) / games)
  return [(centre - spread) / denominator, (centre + spread) / denominator]
}

/**
 * Test des signes bilatéral sur les ouvertures discordantes. Sur données
 * appariées c'est le test le plus puissant dont on dispose sans hypothèse
 * supplémentaire : il élimine l'effet de couleur.
 */
export function signTest(won: number, lost: number): number {
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

/** Intervalle normal à 95 % sur le score moyen par partie, estimé sur les paires. */
export function pentanomialInterval(pairs: PairResult[]): { mean: number; low: number; high: number } {
  const n = pairs.length
  const scores = pairs.map(({ points }) => (points[0] + points[1]) / 2)
  const mean = scores.reduce((total, score) => total + score, 0) / n
  const variance = n > 1 ? scores.reduce((total, score) => total + (score - mean) ** 2, 0) / (n - 1) : 0
  const spread = 1.96 * Math.sqrt(variance / n)
  return { mean, low: mean - spread, high: mean + spread }
}

const formatP = (p: number) => (p < 0.001 ? p.toExponential(1) : p.toFixed(3))

export const percent = (value: number) => `${(100 * value).toFixed(1)} %`

export function report(pairs: PairResult[], expected: number, a: string, b: string, elapsed: string): string {
  if (pairs.length === 0) return `\n${a} contre ${b} : aucune ouverture achevée (${elapsed})`
  const games = 2 * pairs.length
  const all = pairs.flatMap(({ points }) => points)
  const score = all.reduce((total, points) => total + points, 0)
  const winsA = all.filter((points) => points === 1).length
  const winsB = all.filter((points) => points === 0).length
  const draws = games - winsA - winsB
  const pentanomial = [0, 0, 0, 0, 0]
  for (const { points } of pairs) pentanomial[Math.round(2 * (points[0] + points[1]))] += 1
  const openingsWon = pairs.filter(({ points }) => points[0] + points[1] === 2).length
  const openingsLost = pairs.filter(({ points }) => points[0] + points[1] === 0).length
  const decisive = pairs.filter(({ points }) => points[0] + points[1] !== 1).length
  const [low, high] = wilson(score, games)
  const penta = pentanomialInterval(pairs)
  const conclusive = penta.low > 0.5 || penta.high < 0.5
  return (
    `\n${a} contre ${b} : ${winsA} victoire(s), ${winsB} défaite(s), ${draws} nulle(s) ` +
    `sur ${games} parties, ${pairs.length}/${expected} ouvertures (${elapsed})\n` +
    `score de ${a} : ${percent(score / games)} ` +
    `— intervalle de Wilson à 95 % [${percent(low)}, ${percent(high)}]\n` +
    `pentanomial (paires à 0 / ½ / 1 / 1½ / 2 points pour ${a}) : ${pentanomial.join(' / ')} ` +
    `— intervalle apparié à 95 % [${percent(penta.low)}, ${percent(penta.high)}]\n` +
    `paires qui départagent (score différent de 1) : ${decisive}/${pairs.length} ` +
    `(${percent(decisive / pairs.length)})\n` +
    `ouvertures gagnées des deux couleurs : ${openingsWon} pour ${a}, ` +
    `${openingsLost} pour ${b}, ${pairs.length - openingsWon - openingsLost} indécises ` +
    `— test des signes p = ${formatP(signTest(openingsWon, openingsLost))}\n` +
    (conclusive
      ? penta.low > 0.5
        ? `conclusion : ${a} est plus fort.`
        : `conclusion : ${a} est plus faible.`
      : "conclusion : l'intervalle apparié contient 50 %, la mesure ne tranche pas.")
  )
}
