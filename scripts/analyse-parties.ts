/**
 * Banc d'hypothèses stratégiques, jugées sur les parties réellement jouées par
 * les IA de la plateforme de tournoi.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/analyse-parties.ts parties.csv
 *
 * Options : --plies 6,10 (instantanés de milieu de partie, en demi-coups) ·
 * --out rapport.md (sinon le rapport part sur la sortie standard).
 *
 * Le CSV est l'export de la table `parties` (colonnes `bot_bleu`, `bot_blanc`,
 * `notation`, `resultat`, `motif_fin`…). Il ne se versionne pas : il nomme les
 * IA des auteurs.
 *
 * **À force égale.** Une caractéristique qui accompagne la victoire ne dit rien
 * si ce sont les meilleures IA qui la présentent : on jugerait l'IA, pas la
 * stratégie. Chaque test compare donc le score observé au score **attendu** d'un
 * modèle de Bradley-Terry — une force par IA plus l'avantage du premier coup —
 * ajusté sur toutes les parties. Le z rendu est `Σ(o − p) / √Σ p(1 − p)` : ce que
 * la caractéristique rapporte **au-delà** de la force de qui la joue.
 *
 * **Sans fuite.** Les caractéristiques de position se lisent sur un instantané
 * de milieu de partie, jamais sur la position finale, où le gagnant possède par
 * construction le chemin gagnant. Une partie déjà finie à l'instantané en est
 * exclue.
 *
 * **Tests multiples.** Les p-valeurs de tous les tests confirmatoires sont
 * corrigées par Holm ; la carte des cases, exploratoire, a son propre seuil de
 * Bonferroni.
 *
 * Ajouter une hypothèse, c'est ajouter une entrée à `HYPOTHESES`.
 */
import { writeFileSync } from 'node:fs'
import { getComponents, getLargestZone } from '../src/game/connectivity'
import { getConnectionScore } from '../src/game/evaluation'
import { SHAPE_NOTATION } from '../src/game/moveNotation'
import { BOARD_SIZE, SHAPE_IDS } from '../src/game/types'
import type { Board, GameState, PlayerId } from '../src/game/types'
import {
  axisDistance,
  bestAxis,
  caps,
  cellsOf,
  comparativeTest,
  contacts,
  diagonalOnlyLinks,
  finiteOr,
  loadContext,
  other,
  residualTest,
  scoreOf,
  sigmoid,
  snapshot,
  twoSided,
  winningAxes,
} from './parties-tournoi'
import type { Context, Game, Test } from './parties-tournoi'

const argument = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const csvPath =
  process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--')) ??
  'Supabase Snippet Fetch All Parties.csv'
const PLIES = (argument('--plies') ?? '6,10').split(',').map(Number)
const OUT = argument('--out')

const zone = (x: number): string => (x <= 1 || x >= 7 ? 'bord (1-2, 8-9)' : x === 2 || x === 6 ? 'intermédiaire (3, 7)' : 'centre (4-6)')

// ---------------------------------------------------------------- hypothèses

type Section = { title: string; statement: string; tests: Test[]; notes: string[] }

type Hypothesis = { id: string; title: string; statement: string; run: (ctx: Context) => Omit<Section, 'title' | 'statement'> }

const pct = (x: number): string => `${(100 * x).toFixed(1)} %`

const HYPOTHESES: Hypothesis[] = [
  {
    id: 'H1',
    title: 'Axe de connexion : gauche-droite ou haut-bas',
    statement:
      "La gravité remplit le plateau par le bas : relier gauche et droite devrait être plus facile que relier haut et bas, et viser l'horizontale devrait payer.",
    run: (ctx) => {
      const axes = ctx.games.map(winningAxes).filter((a) => a !== null)
      const h = axes.filter((a) => a.horizontal && !a.vertical).length
      const v = axes.filter((a) => a.vertical && !a.horizontal).length
      const both = axes.filter((a) => a.vertical && a.horizontal).length
      const z = (h - (h + v) / 2) / Math.sqrt((h + v) / 4)
      const tests: Test[] = [
        {
          hypothesis: 'H1',
          measure: 'victoires horizontales parmi les victoires à un seul axe (attendu 50 %)',
          n: h + v,
          observed: h / (h + v),
          expected: 0.5,
          z,
          p: twoSided(z),
        },
      ]
      for (const ply of PLIES) {
        const games = ctx.games.filter((g) => snapshot(g, ply))
        const axis = (vertical: boolean) => (g: Game, side: PlayerId) =>
          -finiteOr(axisDistance(snapshot(g, ply)!.board, side, vertical, false), 20)
        tests.push(
          comparativeTest(ctx, 'H1', `@${ply} : le camp le plus proche de l'horizontale (distance H − V la plus petite)`, games, (g, side) =>
            axis(false)(g, side) - axis(true)(g, side),
          ),
          comparativeTest(ctx, 'H1', `@${ply} : distance horizontale la plus courte`, games, axis(false)),
          comparativeTest(ctx, 'H1', `@${ply} : distance verticale la plus courte`, games, axis(true)),
        )
      }
      const length = (horizontal: boolean): number => {
        const plies = ctx.games
          .filter((g) => {
            const a = winningAxes(g)
            return a && a.horizontal === horizontal && a.vertical === !horizontal
          })
          .map((g) => g.final.history.length)
          .sort((a, b) => a - b)
        return plies[plies.length >> 1]
      }
      const early = ctx.games.filter((g) => winningAxes(g)?.vertical && g.final.history.length <= 8).length
      return {
        tests,
        notes: [
          `${h} victoires horizontales, ${v} verticales, ${both} par les deux axes à la fois, sur ${axes.length} connexions.`,
          `Durée médiane : ${length(true)} demi-coups pour une horizontale, ${length(false)} pour une verticale ; ${early} verticales conclues en 8 demi-coups ou moins.`,
        ],
      }
    },
  },
  {
    id: 'H2',
    title: 'Avantage du premier coup',
    statement: 'Bleu, qui ouvre toujours, gagne plus souvent que blanc.',
    run: (ctx) => {
      const test = (label: string, games: Game[]): Test => {
        const o = games.reduce((s, g) => s + g.blueScore, 0)
        const n = games.length
        const z = (o - n / 2) / Math.sqrt(n / 4)
        return { hypothesis: 'H2', measure: label, n, observed: o / n, expected: 0.5, z, p: twoSided(z) }
      }
      const imposed = ctx.games.filter((g) => !g.moves[0]?.firstFree)
      const free = ctx.games.filter((g) => g.moves[0]?.firstFree)
      return {
        tests: [
          test('score de bleu, toutes parties', ctx.games),
          test('score de bleu, ouverture libre', free),
          test('score de bleu, ouverture imposée', imposed),
        ],
        notes: [],
      }
    },
  },
  {
    id: 'H3',
    title: "Grosses pièces d'abord",
    statement:
      "Occuper vite de la surface — les pièces de quatre en ouverture — donne l'initiative ; commencer petit la perd.",
    run: (ctx) => {
      const tests: Test[] = []
      const cellsFirst = (g: Game, side: PlayerId): number | null => {
        const own = g.moves.filter((m) => m.player === side).slice(0, 4)
        return own.length === 4 && g.states.length > 9 ? own.reduce((s, m) => s + m.cells.length, 0) : null
      }
      tests.push(comparativeTest(ctx, 'H3', 'cases posées en 4 premiers coups (plus de surface)', ctx.games, cellsFirst))
      for (const shape of SHAPE_IDS) {
        const picks = ctx.games.flatMap((game) =>
          game.moves.filter((m) => m.firstFree && m.shapeId === shape).map((m) => ({ game, side: m.player })),
        )
        if (picks.length >= 20)
          tests.push(residualTest(ctx, 'H3', `premier coup libre en ${SHAPE_NOTATION[shape]}`, picks))
      }
      return { tests, notes: [] }
    },
  },
  {
    id: 'H4',
    title: 'Petites pièces pour la fin',
    statement:
      "Garder monos et dominos en réserve préserve la souplesse : ils bouchent un trou, achèvent une connexion ou évitent d'être bloqué.",
    run: (ctx) => {
      const tests: Test[] = []
      for (const ply of PLIES) {
        const games = ctx.games.filter((g) => snapshot(g, ply))
        tests.push(
          comparativeTest(ctx, 'H4', `@${ply} : monos et dominos encore en réserve`, games, (g, side) => {
            const inv = snapshot(g, ply)!.inventories[side]
            return inv.mono + inv.domino
          }),
        )
      }
      const stalemates = ctx.games.filter((g) => g.reason === 'stalemate')
      tests.push(
        comparativeTest(ctx, 'H4', 'blocage : cases posées en tout (le camp qui a pu jouer le plus)', stalemates, (g, side) =>
          cellsOf(g.final.board, side).length,
        ),
      )
      // Pièce du coup gagnant, rapportée à la fréquence de chaque forme dans
      // les coups tardifs qui n'ont pas gagné.
      const late = ctx.games.flatMap((g) => g.moves.filter((m) => m.ply >= 10))
      const winning = ctx.games
        .filter((g) => g.reason === 'connection')
        .map((g) => g.moves[g.moves.length - 1])
      const notes = ['Forme du coup gagnant (lift = fréquence au coup gagnant / fréquence dans les coups tardifs, demi-coup ≥ 10) :', '']
      notes.push('| forme | coups gagnants | lift |', '| --- | ---: | ---: |')
      for (const shape of SHAPE_IDS) {
        const w = winning.filter((m) => m.shapeId === shape).length / winning.length
        const l = late.filter((m) => m.shapeId === shape).length / late.length
        notes.push(`| ${SHAPE_NOTATION[shape]} | ${pct(w)} | ${(w / l).toFixed(2)} |`)
      }
      return { tests, notes }
    },
  },
  {
    id: 'H5',
    title: 'Centre ou bords',
    statement:
      'Le centre du plateau ouvre les deux axes et raccourcit les deux demi-chemins ; les bords ne servent qu\'à conclure.',
    run: (ctx) => {
      const tests: Test[] = []
      for (const ply of PLIES) {
        const games = ctx.games.filter((g) => snapshot(g, ply))
        tests.push(
          comparativeTest(ctx, 'H5', `@${ply} : part de ses cases dans les colonnes centrales 4-6`, games, (g, side) => {
            const cells = cellsOf(snapshot(g, ply)!.board, side)
            return cells.length ? cells.filter(({ x }) => x >= 3 && x <= 5).length / cells.length : null
          }),
        )
      }
      for (const label of ['bord (1-2, 8-9)', 'intermédiaire (3, 7)', 'centre (4-6)']) {
        const picks = ctx.games.flatMap((game) =>
          game.moves
            .filter((m) => m.firstFree)
            .filter((m) => zone(Math.round(m.cells.reduce((s, c) => s + c.x, 0) / m.cells.length)) === label)
            .map((m) => ({ game, side: m.player })),
        )
        tests.push(residualTest(ctx, 'H5', `premier coup libre centré en ${label}`, picks))
      }
      return { tests, notes: [] }
    },
  },
  {
    id: 'H6',
    title: 'Tenir le fond',
    statement: 'Le fond est la seule ligne qui ne se refuse jamais : y prendre de la place tôt prépare une horizontale imprenable.',
    run: (ctx) => ({
      tests: PLIES.map((ply) =>
        comparativeTest(ctx, 'H6', `@${ply} : cases sur la ligne du fond`, ctx.games.filter((g) => snapshot(g, ply)), (g, side) =>
          cellsOf(snapshot(g, ply)!.board, side).filter(({ y }) => y === BOARD_SIZE - 1).length,
        ),
      ),
      notes: [],
    }),
  },
  {
    id: 'H7',
    title: 'Monter haut',
    statement: 'Empiler haut menace la verticale et domine les colonnes ; rester à plat laisse le dessus à l\'adversaire.',
    run: (ctx) => ({
      tests: PLIES.map((ply) =>
        comparativeTest(ctx, 'H7', `@${ply} : hauteur moyenne de ses cases`, ctx.games.filter((g) => snapshot(g, ply)), (g, side) => {
          const cells = cellsOf(snapshot(g, ply)!.board, side)
          return cells.length ? cells.reduce((s, { y }) => s + (BOARD_SIZE - 1 - y), 0) / cells.length : null
        }),
      ),
      notes: [],
    }),
  },
  {
    id: 'H8',
    title: 'Une seule zone plutôt que plusieurs',
    statement: 'Construire une zone unique et compacte vaut mieux que semer des îlots qu\'il faudra relier.',
    run: (ctx) => ({
      tests: PLIES.flatMap((ply) => {
        const games = ctx.games.filter((g) => snapshot(g, ply))
        return [
          comparativeTest(ctx, 'H8', `@${ply} : taille de la plus grande zone`, games, (g, side) =>
            getLargestZone(snapshot(g, ply)!.board, side),
          ),
          comparativeTest(ctx, 'H8', `@${ply} : moins de zones distinctes`, games, (g, side) =>
            -getComponents(snapshot(g, ply)!.board, side).length,
          ),
        ]
      }),
      notes: [],
    }),
  },
  {
    id: 'H9',
    title: 'Les liens diagonaux',
    statement:
      'Un lien en diagonale franchit deux fois plus de terrain par case et ne se coupe pas : les exploiter devrait payer.',
    run: (ctx) => ({
      tests: PLIES.map((ply) =>
        comparativeTest(ctx, 'H9', `@${ply} : liens purement diagonaux`, ctx.games.filter((g) => snapshot(g, ply)), (g, side) =>
          diagonalOnlyLinks(snapshot(g, ply)!.board, side),
        ),
      ),
      notes: [],
    }),
  },
  {
    id: 'H10',
    title: 'Jouer au contact',
    statement:
      "Coller à l'adversaire, et surtout se poser sur ses pièces, gêne ses chemins plus que construire à l'écart.",
    run: (ctx) => ({
      tests: PLIES.flatMap((ply) => {
        const games = ctx.games.filter((g) => snapshot(g, ply))
        return [
          comparativeTest(ctx, 'H10', `@${ply} : cases au contact de l'adversaire`, games, (g, side) =>
            contacts(snapshot(g, ply)!.board, side),
          ),
          comparativeTest(ctx, 'H10', `@${ply} : cases posées sur une case adverse`, games, (g, side) =>
            caps(snapshot(g, ply)!.board, side),
          ),
        ]
      }),
      notes: [],
    }),
  },
  {
    id: 'H11',
    title: "L'évaluation du moteur, avec et sans gravité",
    statement:
      "La distance de connexion du moteur compte une case vide pour 1 où qu'elle soit. Une case haut perchée ne s'atteint pourtant qu'après avoir comblé sa colonne : une distance pondérée par la gravité devrait mieux prédire le vainqueur.",
    run: (ctx) => {
      const tests: Test[] = []
      for (const ply of PLIES) {
        const games = ctx.games.filter((g) => snapshot(g, ply))
        const margin = (distance: (b: Board, s: PlayerId) => number) => (g: Game, side: PlayerId) => {
          const b = snapshot(g, ply)!.board
          return finiteOr(distance(b, other(side)), 20) - finiteOr(distance(b, side), 20)
        }
        tests.push(
          comparativeTest(ctx, 'H11', `@${ply} : avance à la distance du moteur`, games, margin((b, s) => getConnectionScore(b, s))),
          comparativeTest(ctx, 'H11', `@${ply} : avance à la distance pondérée par la gravité`, games, margin((b, s) => bestAxis(b, s, true))),
        )
      }
      return {
        tests,
        notes: [
          'Comparer les z des deux distances au même instantané : celle qui prédit le mieux, à force égale, est la meilleure évaluation. Les n diffèrent, les égalités étant exclues.',
        ],
      }
    },
  },
]

// ---------------------------------------------------------------- multivarié

/**
 * Caractéristiques de position jugées ensemble. Les tests un à un ne disent
 * pas laquelle porte l'effet quand deux vont de pair — poser beaucoup de
 * surface tôt, c'est aussi garder ses petites pièces. La régression les
 * départage : chaque coefficient est l'effet d'une caractéristique **les autres
 * tenues fixes**, toujours à force égale.
 */
const FEATURES: { name: string; value: (s: GameState, side: PlayerId) => number }[] = [
  { name: 'cases posées', value: (s, side) => cellsOf(s.board, side).length },
  { name: 'monos + dominos en réserve', value: (s, side) => s.inventories[side].mono + s.inventories[side].domino },
  {
    name: 'part des colonnes 4-6',
    value: (s, side) => {
      const cells = cellsOf(s.board, side)
      return cells.length ? cells.filter(({ x }) => x >= 3 && x <= 5).length / cells.length : 0
    },
  },
  { name: 'cases sur le fond', value: (s, side) => cellsOf(s.board, side).filter(({ y }) => y === BOARD_SIZE - 1).length },
  {
    name: 'hauteur moyenne',
    value: (s, side) => {
      const cells = cellsOf(s.board, side)
      return cells.length ? cells.reduce((t, { y }) => t + (BOARD_SIZE - 1 - y), 0) / cells.length : 0
    },
  },
  { name: 'plus grande zone', value: (s, side) => getLargestZone(s.board, side) },
  { name: 'nombre de zones', value: (s, side) => getComponents(s.board, side).length },
  { name: 'liens diagonaux', value: (s, side) => diagonalOnlyLinks(s.board, side) },
  { name: "cases au contact de l'adversaire", value: (s, side) => contacts(s.board, side) },
  { name: 'cases posées sur l\'adversaire', value: (s, side) => caps(s.board, side) },
  { name: 'distance horizontale', value: (s, side) => finiteOr(axisDistance(s.board, side, false, false), 20) },
  { name: 'distance verticale', value: (s, side) => finiteOr(axisDistance(s.board, side, true, false), 20) },
  { name: 'distance du moteur', value: (s, side) => finiteOr(getConnectionScore(s.board, side), 20) },
  { name: 'distance pondérée par la gravité', value: (s, side) => finiteOr(bestAxis(s.board, side, true), 20) },
]

function solve(matrix: number[][], vector: number[]): { x: number[]; inverse: number[][] } {
  const n = vector.length
  const a = matrix.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)), vector[i]])
  for (let col = 0; col < n; col += 1) {
    let pivot = col
    for (let r = col + 1; r < n; r += 1) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r
    ;[a[col], a[pivot]] = [a[pivot], a[col]]
    const d = a[col][col]
    for (let c = 0; c < a[col].length; c += 1) a[col][c] /= d
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue
      const f = a[r][col]
      for (let c = 0; c < a[r].length; c += 1) a[r][c] -= f * a[col][c]
    }
  }
  return { x: a.map((row) => row[2 * n]), inverse: a.map((row) => row.slice(n, 2 * n)) }
}

function multivariate(ctx: Context, ply: number): string[] {
  const rows: { x: number[]; y: number; offset: number }[] = []
  for (const g of ctx.games) {
    const s = snapshot(g, ply)
    if (!s) continue
    rows.push({
      x: FEATURES.map((f) => f.value(s, 'blue') - f.value(s, 'white')),
      y: g.blueScore,
      offset: Math.log(ctx.expectedBlue(g) / (1 - ctx.expectedBlue(g))),
    })
  }
  const k = FEATURES.length
  const sd = FEATURES.map((_, j) => {
    const m = rows.reduce((t, r) => t + r.x[j], 0) / rows.length
    return Math.sqrt(rows.reduce((t, r) => t + (r.x[j] - m) ** 2, 0) / rows.length) || 1
  })
  for (const r of rows) r.x = r.x.map((v, j) => v / sd[j])
  const ridge = 1
  let beta = new Array<number>(k).fill(0)
  let inverse: number[][] = []
  for (let iteration = 0; iteration < 25; iteration += 1) {
    const gradient = beta.map((b) => -ridge * b)
    const hessian = beta.map((_, i) => beta.map((__, j) => (i === j ? ridge : 0)))
    for (const r of rows) {
      const p = sigmoid(r.offset + r.x.reduce((t, v, j) => t + v * beta[j], 0))
      const w = p * (1 - p)
      for (let i = 0; i < k; i += 1) {
        gradient[i] += (r.y - p) * r.x[i]
        for (let j = 0; j < k; j += 1) hessian[i][j] += w * r.x[i] * r.x[j]
      }
    }
    const step = solve(hessian, gradient)
    beta = beta.map((b, i) => b + step.x[i])
    inverse = step.inverse
  }
  const lines = [
    `### À ${ply} demi-coups (${rows.length} parties)`,
    '',
    "Coefficient par écart type de la différence bleu − blanc, en logit, au-delà du modèle de force. Positif : en avoir plus que l'adversaire fait gagner.",
    '',
    '| caractéristique | coefficient | z |',
    '| --- | ---: | ---: |',
  ]
  const order = FEATURES.map((f, j) => ({ f, b: beta[j], z: beta[j] / Math.sqrt(inverse[j][j]) })).sort(
    (a, b) => Math.abs(b.z) - Math.abs(a.z),
  )
  for (const { f, b, z } of order)
    lines.push(`| ${f.name} | ${b >= 0 ? '+' : ''}${b.toFixed(2)} | ${z >= 0 ? '+' : ''}${z.toFixed(1)}${Math.abs(z) >= 3 ? ' **' : ''} |`)
  lines.push('', '`**` : |z| ≥ 3.')
  return lines
}

// ---------------------------------------------------------------- carte

/** Posséder cette case à l'instantané gagne-t-il plus que la force ne le dit ? */
function cellMap(ctx: Context, ply: number): string[] {
  const lines = [`Carte des cases à ${ply} demi-coups : z de l'écart au modèle de force pour le camp qui possède la case.`, '']
  const bonferroni = 3.2
  lines.push('```text', `      ${Array.from({ length: BOARD_SIZE }, (_, x) => `  c${x + 1} `).join('')}`)
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    const cols: string[] = []
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const picks = ctx.games.flatMap((game) => {
        const s = snapshot(game, ply)
        const owner = s?.board[y][x]?.player
        return owner ? [{ game, side: owner }] : []
      })
      if (picks.length < 30) {
        cols.push('   .  ')
        continue
      }
      const { z } = residualTest(ctx, 'carte', '', picks)
      cols.push(`${z >= 0 ? '+' : ''}${z.toFixed(1)}${Math.abs(z) >= bonferroni ? '*' : ' '}`.padStart(6))
    }
    lines.push(`l${y + 1}${y === BOARD_SIZE - 1 ? ' fond' : '     '}${cols.join('')}`)
  }
  lines.push('```', '', `\`*\` : |z| ≥ ${bonferroni}, seuil de Bonferroni pour 81 cases. \`.\` : moins de 30 parties.`)
  return lines
}

// ---------------------------------------------------------------- rapport

function holm(tests: Test[]): void {
  const sorted = [...tests].sort((a, b) => a.p - b.p)
  let running = 0
  sorted.forEach((t, i) => {
    running = Math.max(running, Math.min(1, (sorted.length - i) * t.p))
    t.adjusted = running
  })
}

function verdict(t: Test): string {
  if ((t.adjusted ?? 1) >= 0.05) return 'non concluant'
  return t.z > 0 ? '**confirmé**' : '**inverse**'
}

function main(): void {
  const ctx = loadContext(csvPath)
  const { games, skipped, strength, firstMove } = ctx
  const sections: Section[] = HYPOTHESES.map((h) => ({ title: `${h.id} — ${h.title}`, statement: h.statement, ...h.run(ctx) }))
  holm(sections.flatMap((s) => s.tests))

  const out: string[] = ['# Analyse des parties du tournoi', '']
  out.push(
    `${games.length} parties jouées jusqu'au bout, lues dans \`${csvPath}\`. Écartées : ${
      Object.entries(skipped).map(([k, v]) => `${v} × ${k}`).join(', ') || 'aucune'
    }.`,
    '',
    `Modèle de force : ${strength.size} IA, avantage du premier coup ${firstMove >= 0 ? '+' : ''}${firstMove.toFixed(2)} en logit (${pct(sigmoid(firstMove))} entre deux IA de même force). Instantanés : ${PLIES.join(', ')} demi-coups.`,
    '',
    "Lecture : **observé** est le score du camp retenu par la mesure, **attendu** celui que sa seule force lui prédisait. z > 0 : la caractéristique rapporte au-delà de la force. Verdict sur la p-valeur corrigée par Holm, au seuil de 5 %.",
    '',
  )
  for (const s of sections) {
    out.push(`## ${s.title}`, '', `*Hypothèse.* ${s.statement}`, '')
    out.push('| mesure | n | observé | attendu | z | p (Holm) | verdict |', '| --- | ---: | ---: | ---: | ---: | ---: | --- |')
    for (const t of s.tests)
      out.push(
        `| ${t.measure} | ${t.n} | ${pct(t.observed)} | ${pct(t.expected)} | ${t.z.toFixed(2)} | ${t.adjusted!.toPrecision(2)} | ${verdict(t)} |`,
      )
    if (s.notes.length) out.push('', ...s.notes)
    out.push('')
  }
  out.push('## Effets propres, toutes caractéristiques ensemble', '')
  for (const ply of PLIES) out.push(...multivariate(ctx, ply), '')
  out.push('## Carte des cases (exploratoire)', '')
  for (const ply of PLIES) out.push(...cellMap(ctx, ply), '')
  out.push('## Force des IA', '', '| IA | parties | score | force (logit) |', '| --- | ---: | ---: | ---: |')
  const played = new Map<string, { n: number; score: number }>()
  for (const g of games)
    for (const side of ['blue', 'white'] as const) {
      const entry = played.get(g.bots[side]) ?? { n: 0, score: 0 }
      entry.n += 1
      entry.score += scoreOf(g, side)
      played.set(g.bots[side], entry)
    }
  for (const [bot, s] of [...strength].sort((a, b) => b[1] - a[1])) {
    const p = played.get(bot)!
    out.push(`| ${bot.slice(0, 8)} | ${p.n} | ${pct(p.score / p.n)} | ${s.toFixed(2)} |`)
  }

  const report = out.join('\n') + '\n'
  if (OUT) writeFileSync(OUT, report)
  else process.stdout.write(report)
}

main()
