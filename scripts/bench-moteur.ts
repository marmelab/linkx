/**
 * Banc du moteur : coût de chaque itération, profondeur réellement jouée, et
 * part du budget qui ne produit rien.
 *
 * Aucune mesure de force ici — c'est le rôle de `duel-appariee.ts`. Ce banc
 * répond à une question de rendement : **le maître a six secondes, qu'en
 * fait-il ?** La réponse tient dans trois colonnes. `prof.` est la profondeur du
 * dernier palier achevé dans le budget, la seule qui soit jouée. `répond` est le
 * moment où il rend son coup. `perdu` est le temps passé sur un palier trop cher
 * pour finir, et dont le résultat est jeté : c'est du budget dépensé pour rien.
 *
 * Le facteur de croissance `×` dit ce qu'il faudrait gagner pour monter d'un
 * palier. Toute optimisation se juge là : elle doit soit accélérer le débit,
 * soit faire baisser ce facteur.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/bench-moteur.ts
 *
 * Options : --budget MS (défaut 6 000, celui du worker) · --plies "1,5,9" ·
 * --ceiling MS (défaut 20 000 : on cesse d'approfondir une position dès qu'un
 * palier dépasse cette durée, sans quoi le banc tournerait des heures sur
 * l'ouverture).
 *
 * Les paliers sont mesurés **au plafond de nœuds**, donc sans jamais lire
 * l'horloge à l'intérieur de la recherche : chaque palier va à son terme et son
 * coût est celui d'un palier complet, pas celui d'un palier interrompu. Les
 * positions viennent de `referenceGame.ts`, figée : c'est ce qui permet de
 * comparer deux versions du moteur sur exactement les mêmes positions.
 */
import { createEnginePosition, loadPosition } from '../src/game/engineBoard'
import { evaluate, searchMasterTopMoves } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import {
  REFERENCE_GAME_LENGTH,
  referencePositionAfter,
} from '../src/game/referenceGame'
import type { GamePosition } from '../src/game/simulation'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}
const text = (name: string): string | null => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : null
}

const BUDGET_MS = arg('--budget', 6_000)
const CEILING_MS = arg('--ceiling', 20_000)

process.stderr.write('partie de référence figée\n')
const game: GamePosition[] = Array.from(
  { length: REFERENCE_GAME_LENGTH },
  (_, index) => referencePositionAfter(index),
)

const requested = text('--plies')
const plies = (
  requested
    ? requested.split(',').map((value) => Number(value.trim()))
    : game.map((_, index) => index + 1).filter((ply) => ply % 4 === 1)
).filter((ply) => ply >= 1 && ply <= game.length)

type Step = { depth: number; nodes: number; ms: number; score: number; exact: boolean }

/** Coût de chaque palier, mesuré isolément et au plafond de nœuds. */
function profile(position: GamePosition): Step[] {
  const steps: Step[] = []
  for (let depth = 1; depth <= 40; depth += 1) {
    const before = Date.now()
    const search = searchMasterTopMoves(position, {
      maxDepth: depth,
      maxNodes: Number.MAX_SAFE_INTEGER,
      allowOddDepth: true,
    })
    const ms = Date.now() - before
    if (!search) break
    steps.push({ depth, nodes: search.nodes, ms, score: search.score, exact: search.exact })
    if (search.exact || ms > CEILING_MS) break
  }
  return steps
}

/**
 * Profondeur que le maître jouerait dans ce budget, quand il rend son coup, et
 * temps dépensé pour rien.
 *
 * `step.ms` est **cumulatif** : chaque palier est mesuré depuis la profondeur 1,
 * exactement comme le fait l'approfondissement itératif. Atteindre la
 * profondeur d coûte donc `steps[d].ms`, pas la somme des paliers.
 *
 * On reproduit ensuite la règle de `searchMasterTopMoves` : tous les paliers
 * comptent, et l'on ne s'engage dans le suivant que si le coût observé du
 * dernier, multiplié par sa croissance, tient dans ce qui reste. S'engager quand
 * même et ne pas finir, c'est le temps perdu.
 */
function played(
  steps: Step[],
  budgetMs: number,
): { step: Step | null; answeredMs: number; wasted: number; growth: number } {
  let chosen: Step | null = null
  let previousSpent = 0
  let previousMs = 0
  let stopped = false
  for (const step of steps) {
    if (step.ms > budgetMs) break
    chosen = step
    if (step.exact) {
      stopped = true
      break
    }
    const spent = step.ms - previousMs
    const growth = previousSpent > 0 ? Math.max(2, spent / previousSpent) : 4
    previousSpent = spent
    previousMs = step.ms
    if (step.ms + spent * growth > budgetMs) {
      stopped = true
      break
    }
  }
  if (!chosen) return { step: null, answeredMs: budgetMs, wasted: budgetMs, growth: 0 }
  const next = steps[steps.indexOf(chosen) + 1] ?? null
  // Engagé dans le palier suivant sans le finir : tout ce qui y passe est perdu.
  const wasted = stopped ? 0 : Math.min(budgetMs, next ? next.ms : budgetMs) - chosen.ms
  return {
    step: chosen,
    answeredMs: chosen.ms + Math.max(0, wasted),
    wasted: Math.max(0, wasted),
    growth: next && chosen.ms > 0 ? next.ms / chosen.ms : 0,
  }
}

const rows: string[] = []
const detail: string[] = []
for (const ply of plies) {
  const position = game[ply - 1]
  const moves = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  ).length
  const steps = profile(position)
  const { step, answeredMs, wasted, growth } = played(steps, BUDGET_MS)
  const deepest = steps[steps.length - 1]

  rows.push(
    String(ply).padStart(9) +
      String(moves).padStart(7) +
      String(step?.depth ?? 0).padStart(7) +
      (step?.exact ? ' exact' : '      ') +
      `${(answeredMs / 1000).toFixed(1)} s`.padStart(9) +
      `${(wasted / 1000).toFixed(1)} s`.padStart(8) +
      `${growth ? `×${growth.toFixed(1)}` : '—'}`.padStart(7) +
      Math.round(deepest.nodes / Math.max(deepest.ms / 1000, 1e-9))
        .toLocaleString('fr-FR')
        .padStart(10),
  )
  detail.push(
    `demi-coup ${ply} : ` +
      steps
        .map((s) => `p${s.depth} ${(s.ms / 1000).toFixed(2)}s/${s.score}`)
        .join('  '),
  )
  process.stderr.write(`${detail[detail.length - 1]}\n`)
}

// Coût de l'évaluation seule : tant que la plupart des nœuds sont des feuilles,
// c'est lui qui plafonne le débit. Mesuré sur la position médiane du banc.
const middle = game[plies[Math.floor(plies.length / 2)] - 1]
const enginePosition = loadPosition(createEnginePosition(), middle)
const EVAL_ROUNDS = 100_000
const evalStart = Date.now()
let sink = 0
for (let i = 0; i < EVAL_ROUNDS; i += 1) sink += evaluate(enginePosition)
// Le cumul est consommé ici : sans cela, rien n'interdit au moteur JavaScript
// de supprimer la boucle entière et de mesurer zéro.
if (!Number.isFinite(sink)) throw new Error('évaluation non finie')
const evalSeconds = (Date.now() - evalStart) / 1000

console.log(
  `\nbanc du maître — budget ${BUDGET_MS} ms · partie de référence de ${game.length} position(s)\n\n` +
    'demi-coup  coups  prof.    répond   perdu      ×       n/s\n' +
    rows.join('\n') +
    '\n\npaliers (durée/score)\n' +
    detail.join('\n') +
    `\n\névaluation : ${((evalSeconds * 1e6) / EVAL_ROUNDS).toFixed(1)} µs par appel, ` +
    `${Math.round(EVAL_ROUNDS / evalSeconds).toLocaleString('fr-FR')} appels/s ` +
    `— plafond théorique du débit si chaque nœud évaluait.`,
)
