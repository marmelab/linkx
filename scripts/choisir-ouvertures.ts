/**
 * Choix mesuré des débuts canoniques imposés aux vagues (histoire 15).
 *
 * Une ouverture imposée n'a d'intérêt que si elle laisse la partie **à jouer**.
 * L'appariement — chaque ouverture jouée deux fois, couleurs échangées —
 * neutralise un déséquilibre modéré, mais il ne rachète pas une ouverture
 * perdante d'office : sur une position déjà décidée, les deux camps jouent la
 * même fin forcée et la rencontre ne mesure plus rien. Ce script remplace donc
 * le choix à la main par une mesure.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/choisir-ouvertures.ts
 *
 * Options : --depth N (défaut 6, **pair**) · --nodes N (garde-fou, défaut
 * 20 000 000) · --keep N (défaut 16) · --seuil N (défaut 1 100).
 *
 * **Déterminisme.** La recherche s'arrête sur un **nombre de nœuds**, jamais sur
 * l'horloge — même raison que le conseil du jeu (`MASTER_HINT_NODES`) : une
 * mesure qui dépend de la vitesse de la machine ne se rejoue pas. Le plafond de
 * nœuds n'est ici qu'un garde-fou ; c'est le plafond de **profondeur** qui
 * arrête réellement chaque recherche, de sorte que tous les candidats sont jugés
 * au même palier. Aucun tirage au sort n'intervient.
 *
 * Ce qu'on mesure
 * ---------------
 * La valeur d'une ouverture de bleu, c'est la valeur de la position **après la
 * meilleure réponse de blanc** : imposer un début laisse à l'adversaire le choix
 * de sa riposte, et c'est celle-là qu'il jouera. On mesure donc, pour chaque
 * premier coup, la position obtenue en y ajoutant la réponse du **livre**
 * (`openingBook.data.ts`, profondeur 9) — deux paliers de plus que ce que la
 * recherche en direct atteint dans l'ouverture. Le livre couvre les **50**
 * ouvertures distinctes, sans exception : c'est ce qui rend la méthode possible.
 *
 * Deux conséquences :
 *
 * - une ouverture d'**un** demi-coup et son prolongement de **deux** demi-coups
 *   par la réponse du livre désignent la même position mesurée, au signe près.
 *   Retenir les deux dans la liste, ce serait compter deux fois la même mesure ;
 *   le script ne rend donc que des débuts d'un demi-coup, dont la valeur est
 *   déjà celle de la suite forte. Un début de deux demi-coups bâti sur une
 *   *autre* réponse imposerait une position que blanc a déjà gâchée : l'inverse
 *   de ce qu'on cherche.
 * - la position mesurée compte **autant de pièces des deux couleurs**, et la
 *   profondeur paire fait que la feuille aussi. C'est indispensable : un palier
 *   de plus retourne la parité du matériel à la feuille et déplace la lecture de
 *   quelque 1 700 points — la même ouverture, mesurée un demi-coup plus tôt, se
 *   lit 1 660 points plus bas pour le même camp. `TEMPO`, calibré en milieu de
 *   partie, ne referme pas cet écart-là dans l'ouverture. **On ne compare donc
 *   que des mesures de même parité**, sur des positions à matériel égal.
 *
 * Le zéro de l'échelle est **mesuré**, pas supposé : quelques positions témoins
 * invariantes par « miroir gauche-droite plus échange des couleurs » — donc sans
 * avantage structurel pour aucune couleur — sont passées à la même profondeur au
 * début du script. Ce qu'elles lisent est le zéro auquel le seuil s'applique.
 *
 * **Symétrie.** `canonicalPosition` replie déjà le miroir gauche-droite — la
 * seule symétrie du jeu, la gravité fixant un bas — et rend la clé de la forme
 * repliée. Deux ouvertures images l'une de l'autre partagent cette clé : elles
 * ne sont mesurées qu'une fois. Des deux notations possibles, on retient celle
 * qui diversifie le mieux les colonnes de la liste finale.
 */
import { MATE_THRESHOLD, TEMPO, searchMasterTopMoves } from '../src/game/engineSearch'
import { enumerateLegalMoves } from '../src/game/legalMoves'
import type { LegalMove } from '../src/game/legalMoves'
import {
  parseGameRecord,
  serializeGameRecord,
  serializeMove,
} from '../src/game/moveNotation'
import { canonicalPosition, lookupOpeningMove } from '../src/game/openingBook'
import { createGamePosition, simulateLegalMove } from '../src/game/simulation'
import type { GamePosition } from '../src/game/simulation'
import type { ShapeId } from '../src/game/types'

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}

const DEPTH = arg('--depth', 6)
const NODES = arg('--nodes', 20_000_000)
const KEEP = arg('--keep', 16)

/**
 * Le seuil est **un cran d'axe principal**, l'unité de l'évaluation : le
 * potentiel de connexion pèse `PRIMARY_AXIS_WEIGHT` (11) par case de distance
 * sur l'axe dominant, multiplié par `CONNECTION_WEIGHT` (100). Gagner une case
 * sur le plus court chemin d'un joueur vaut donc 1 100 points — devant les 300
 * points d'un cran de second axe, les 30 points d'une case de largeur de chemin
 * et les 20 à 80 points d'une case de plus grande zone.
 *
 * C'est le plus petit avantage qui en soit vraiment un, et il vaut déjà 1,3 fois
 * le trait (`TEMPO` = 819). En deçà, ni l'un ni l'autre ne tient la position :
 * c'est tout ce qu'on demande à une ouverture imposée, l'appariement se
 * chargeant du reste. Au-delà commence ce que l'appariement ne rachète plus.
 */
const SEUIL = arg('--seuil', 1_100)

/**
 * Règle de diversité : ni une forme ni une colonne d'ancrage ne prend plus du
 * **quart** de la liste. Seize ouvertures toutes en mono au centre ne
 * mesureraient qu'une seule chose ; à l'autre bout, un quota plus serré ferait
 * descendre la liste plus bas dans le classement pour rien — à trois par forme,
 * elle s'arrête à quatorze faute de candidats équilibrés dans les formes rares.
 */
const MAX_PAR_FORME = Math.ceil(KEEP / 4)
const MAX_PAR_COLONNE = Math.ceil(KEEP / 4)

if (DEPTH % 2 !== 0) {
  throw new Error('--depth doit être pair : la feuille doit compter autant de pièces des deux couleurs.')
}

// --- Mesure ------------------------------------------------------------------

type Balance = {
  /** Score du joueur au trait, corrigé du décalage de tempo du palier. */
  score: number
  /** Vrai quand la recherche a prouvé une issue : la position est décidée. */
  decided: boolean
  depth: number
  nodes: number
}

let maxNodes = 0
let truncated = 0

function measure(position: GamePosition, depth: number): Balance {
  const search = searchMasterTopMoves(position, {
    maxDepth: depth,
    maxNodes: NODES,
    allowOddDepth: true,
  })
  if (!search) throw new Error('le joueur au trait devrait disposer d’un coup légal')
  maxNodes = Math.max(maxNodes, search.nodes)
  if (search.depth !== depth) truncated += 1
  return {
    score: search.score - (search.depth % 2 === 0 ? TEMPO : -TEMPO),
    decided: Math.abs(search.score) > MATE_THRESHOLD,
    depth: search.depth,
    nodes: search.nodes,
  }
}

function positionOf(notation: string): GamePosition {
  const parsed = parseGameRecord(notation)
  if (!parsed.ok) throw new Error(`${notation} : ${parsed.error.message}`)
  const { board, inventories, activePlayer } = parsed.state
  return { board, inventories, activePlayer }
}

/**
 * Positions témoins : chacune est sa propre image par miroir gauche-droite suivi
 * d'un échange des couleurs, donc aucune couleur n'y détient d'avantage
 * structurel. Ce qu'elles lisent est le zéro de l'échelle à cette profondeur.
 */
const CONTROLS = ['11 19', '12 18', '13 17', '14 16', '21 28', '2r11 2r19']

// --- Libellés ----------------------------------------------------------------

const SHAPE_LABELS: Record<ShapeId, string> = {
  mono: 'mono',
  domino: 'domino',
  bar3: 'barre',
  smallL: 'petit L',
  s: 'S',
  t: 'T',
  largeL: 'grand L',
}

function moveLabel(move: LegalMove): string {
  const { width, height, flipped } = move.orientation
  const lying = width === height ? '' : width > height ? ' couché' : ' debout'
  const zone = move.column <= 2 ? 'à gauche' : move.column <= 5 ? 'au centre' : 'à droite'
  return `${SHAPE_LABELS[move.shapeId]}${lying}${flipped ? ' retourné' : ''} ${zone}`
}

// --- Candidats ---------------------------------------------------------------

const tokenOf = (move: LegalMove): string =>
  serializeMove({
    shapeId: move.shapeId,
    rotation: move.orientation.rotation,
    flipped: move.orientation.flipped,
    column: move.column,
  })

/** Une écriture possible d'une même mesure : l'ouverture, ou son image miroir. */
type Variant = { notation: string; move: LegalMove }

type Candidate = {
  variants: Variant[]
  /** Réponse du livre, profondeur 9, jouée avant la mesure. */
  reply: LegalMove
  balance: Balance
  /** Même mesure deux paliers plus bas, pour dire si le verdict tient. */
  shallow: Balance
}

const started = Date.now()
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(0)} s`

const start = createGamePosition('blue')
const firstMoves = enumerateLegalMoves(start.board, start.inventories.blue)

const groups = new Map<string, { variants: Variant[]; position: GamePosition }>()
for (const move of firstMoves) {
  const after = simulateLegalMove(start, move)
  if (after.result) continue
  const { key } = canonicalPosition(after.position)
  const known = groups.get(key)
  if (known) known.variants.push({ notation: tokenOf(move), move })
  else groups.set(key, { variants: [{ notation: tokenOf(move), move }], position: after.position })
}

process.stderr.write(
  `${firstMoves.length} premiers coups légaux, ${groups.size} positions distinctes au miroir près.\n` +
    `mesure à profondeur ${DEPTH}, plafond ${NODES.toLocaleString('fr-FR')} nœuds, seuil ${SEUIL}.\n\n`,
)

const controls = CONTROLS.map((notation) => ({
  notation,
  balance: measure(positionOf(notation), DEPTH),
}))
const zero = Math.round(
  controls.reduce((total, control) => total + control.balance.score, 0) / controls.length,
)
process.stderr.write(
  `[${elapsed()}] zéro mesuré sur ${controls.length} positions témoins : ${zero} ` +
    `(${controls.map((control) => control.balance.score).join(', ')})\n\n`,
)

const candidates: Candidate[] = []
let missingFromBook = 0
let index = 0

for (const { variants, position } of groups.values()) {
  index += 1
  const reply = lookupOpeningMove(position)
  if (!reply) {
    missingFromBook += 1
    process.stderr.write(`[${elapsed()}] ${variants[0].notation} — absente du livre, écartée\n`)
    continue
  }
  const after = simulateLegalMove(position, reply)
  if (after.result) {
    process.stderr.write(
      `[${elapsed()}] ${variants[0].notation} — la réponse du livre termine la partie, écartée\n`,
    )
    continue
  }

  const balance = measure(after.position, DEPTH)
  const shallow = measure(after.position, DEPTH - 2)
  candidates.push({ variants, reply, balance, shallow })
  process.stderr.write(
    `[${elapsed()}] ${index}/${groups.size} ${variants[0].notation} ${tokenOf(reply)} : ` +
      `${balance.score - zero} (profondeur ${DEPTH - 2} : ${shallow.score - zero})\n`,
  )
}

// --- Tri, écarts et sélection ------------------------------------------------

const shapeCount = new Map<ShapeId, number>()
const columnCount = new Map<number, number>()

/**
 * Des deux écritures d'une même mesure — l'ouverture et son image miroir —,
 * celle dont la colonne d'ancrage est la moins servie par la liste déjà retenue.
 */
function representative(candidate: Candidate): Variant {
  return [...candidate.variants].sort(
    (a, b) =>
      (columnCount.get(a.move.column) ?? 0) - (columnCount.get(b.move.column) ?? 0) ||
      a.notation.localeCompare(b.notation),
  )[0]
}

const ranked = [...candidates].sort(
  (a, b) => Math.abs(a.balance.score - zero) - Math.abs(b.balance.score - zero),
)

const rows: { notation: string; reply: string; score: number; shallow: number; reason: string }[] = []
const kept: { notation: string; move: LegalMove; score: number }[] = []
let flipped = 0

for (const candidate of ranked) {
  const score = candidate.balance.score - zero
  const shallow = candidate.shallow.score - zero
  if ((Math.abs(score) <= SEUIL) !== (Math.abs(shallow) <= SEUIL)) flipped += 1

  const variant = representative(candidate)
  const shape = variant.move.shapeId
  const column = variant.move.column
  // L'ordre des motifs de rejet est celui du compte rendu : une ouverture
  // déséquilibrée doit être comptée comme telle, et non comme « au-delà des
  // seize » au seul motif que la liste était déjà pleine quand son tour est venu.
  let reason: string
  if (candidate.balance.decided) reason = 'position décidée'
  else if (Math.abs(score) > SEUIL) reason = `déséquilibrée (> ${SEUIL})`
  else if ((shapeCount.get(shape) ?? 0) >= MAX_PAR_FORME)
    reason = `quota de forme (${MAX_PAR_FORME} par forme)`
  else if ((columnCount.get(column) ?? 0) >= MAX_PAR_COLONNE)
    reason = `quota de colonne (${MAX_PAR_COLONNE} par colonne)`
  else if (kept.length >= KEEP) reason = `au-delà des ${KEEP} retenues`
  else reason = 'retenue'

  if (reason === 'retenue') {
    shapeCount.set(shape, (shapeCount.get(shape) ?? 0) + 1)
    columnCount.set(column, (columnCount.get(column) ?? 0) + 1)
    kept.push({ notation: variant.notation, move: variant.move, score })
  }
  rows.push({
    notation: variant.notation,
    reply: tokenOf(candidate.reply),
    score,
    shallow,
    reason,
  })
}

/**
 * Libellés définitifs. Deux ouvertures de même forme et de même zone ne se
 * distinguent que par leur colonne : dans ce cas seulement, les **deux** la
 * portent — un libellé qualifié en face d'un libellé nu se lirait comme une
 * exception plutôt que comme une distinction.
 */
const shared = new Map<string, number>()
for (const entry of kept) {
  const base = moveLabel(entry.move)
  shared.set(base, (shared.get(base) ?? 0) + 1)
}
const labelled = kept.map((entry) => {
  const base = moveLabel(entry.move)
  const label = (shared.get(base) ?? 0) > 1 ? `${base}, colonne ${entry.move.column + 1}` : base
  return { ...entry, label }
})

// --- Sortie ------------------------------------------------------------------

const pad = (text: string, width: number) => text.padEnd(width)
const signed = (value: number) => `${value >= 0 ? '+' : ''}${value}`

console.log(
  `\nzéro de l'échelle, mesuré sur ${controls.length} positions témoins à profondeur ${DEPTH} : ` +
    `${signed(zero)} points\n` +
    controls.map((control) => `  ${pad(control.notation, 12)}${signed(control.balance.score)}`).join('\n'),
)

console.log(
  `\ncandidats — score de l'ouvreur après la réponse du livre, corrigé du tempo ` +
    `et du zéro ; positif = l'ouvreur est mieux\n`,
)
console.log(
  `${pad('ouverture', 11)}${pad('réponse', 10)}${pad(`prof. ${DEPTH}`, 10)}` +
    `${pad(`prof. ${DEPTH - 2}`, 10)}verdict`,
)
for (const row of rows) {
  console.log(
    pad(row.notation, 11) +
      pad(row.reply, 10) +
      pad(signed(row.score), 10) +
      pad(signed(row.shallow), 10) +
      row.reason,
  )
}

const rejected = new Map<string, number>()
for (const row of rows) {
  if (row.reason === 'retenue') continue
  rejected.set(row.reason, (rejected.get(row.reason) ?? 0) + 1)
}

console.log(
  `\nseuil : |score| ≤ ${SEUIL} points, soit un cran d'axe principal, ` +
    `1,3 fois le trait (TEMPO = ${TEMPO}).`,
)
console.log(
  `${candidates.length} ouvertures mesurées, ${missingFromBook} absentes du livre, ` +
    `${truncated} recherches tronquées par le plafond de nœuds ` +
    `(pire recherche : ${maxNodes.toLocaleString('fr-FR')} nœuds).`,
)
console.log(
  `robustesse : ${flipped} ouverture(s) sur ${candidates.length} changent de côté du seuil ` +
    `entre les profondeurs ${DEPTH - 2} et ${DEPTH}.`,
)
console.log('écartées :')
for (const [reason, count] of [...rejected].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count} — ${reason}`)
}

console.log('\nliste retenue, prête à recopier dans supabase/functions/_shared/openings.ts :\n')
for (const { notation, label, score } of labelled) {
  console.log(`  { notation: '${notation}', label: '${label}' }, // ${signed(score)}`)
}

// Une notation retenue doit se relire et se réécrire à l'identique : c'est la
// canonicité qu'exige `openings.ts`, vérifiée ici plutôt que découverte en test.
for (const { notation } of labelled) {
  const parsed = parseGameRecord(notation)
  if (!parsed.ok || serializeGameRecord(parsed.state) !== notation) {
    throw new Error(`notation non canonique : ${notation}`)
  }
}

const worst = kept.reduce((max, entry) => Math.max(max, Math.abs(entry.score)), 0)
console.log(
  `\nconclusion : ${kept.length} ouvertures retenues sur ${candidates.length} mesurées, ` +
    `${new Set(kept.map((entry) => entry.move.shapeId)).size} formes et ` +
    `${new Set(kept.map((entry) => entry.move.column)).size} colonnes distinctes, ` +
    `aucune décidée et toutes à moins de ${worst} points de l'égalité — ` +
    `moins d'un cran d'axe principal, là où l'appariement fait le reste (${elapsed()}).`,
)
