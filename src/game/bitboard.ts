import { BOARD_SIZE } from './types'

/**
 * Plateau de bits
 * ===============
 *
 * Les 81 cases du plateau tiennent **exactement** dans trois mots de 27 bits :
 * trois lignes par mot, neuf bits par ligne, la case `(x, y)` au bit `y * 9 + x`
 * du mot `y / 3`. C'est ce qui rend le découpage utile — aucun bit perdu, aucun
 * masque de bord à appliquer aux mots — et c'est aussi ce qui l'attache à un
 * plateau de neuf, ce que le module vérifie au chargement plutôt que de le
 * supposer.
 *
 * L'intérêt est le voisinage. Un parcours case par case visite huit voisines par
 * case ; ici la même dilatation s'écrit en quatre décalages pour **tout le
 * plateau à la fois**. Deux propriétés du découpage l'y aident : le décalage
 * horizontal ne franchit jamais de mot, puisqu'on efface d'abord la colonne de
 * sortie et que le bit de tête de chaque mot devient nul ; et le décalage
 * vertical d'une ligne vaut neuf bits, soit un tiers de mot, donc une seule
 * retenue par mot.
 *
 * Source **unique** de ce découpage. `engineBoard.ts` s'en sert pour les zones
 * connexes, `engineSearch.ts` pour les distances de connexion ; ni l'un ni
 * l'autre ne redéfinit de décalage.
 */

const N = BOARD_SIZE
const CELLS = N * N
/** Nombre de mots d'un plateau, et bits utiles de chacun : 3 × 27 = 81. */
export const LIMBS = 3
const LIMB_BITS = 27
export const LIMB_MASK = (1 << LIMB_BITS) - 1
/** Décalage d'une ligne, et ce qu'une ligne déborde du mot voisin. */
const ROW_SHIFT = N
const LIMB_CARRY = LIMB_BITS - ROW_SHIFT

if (CELLS !== LIMBS * LIMB_BITS) {
  throw new Error('Le plateau de bits suppose 81 cases en trois mots de 27 bits.')
}

/** Mot portant une case, et bit de cette case dans ce mot. */
export const CELL_LIMB = new Int8Array(CELLS)
export const CELL_BIT = new Int32Array(CELLS)
for (let cell = 0; cell < CELLS; cell += 1) {
  CELL_LIMB[cell] = (cell / LIMB_BITS) | 0
  CELL_BIT[cell] = 1 << cell % LIMB_BITS
}

/** Plateau de bits des cases satisfaisant un prédicat. */
export function maskOf(inside: (x: number, y: number) => boolean): Int32Array {
  const limbs = new Int32Array(LIMBS)
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      if (!inside(x, y)) continue
      const cell = y * N + x
      limbs[CELL_LIMB[cell]] |= CELL_BIT[cell]
    }
  }
  return limbs
}

export const EDGE_LEFT = maskOf((x) => x === 0)
export const EDGE_RIGHT = maskOf((x) => x === N - 1)
export const EDGE_TOP = maskOf((_x, y) => y === 0)
export const EDGE_BOTTOM = maskOf((_x, y) => y === N - 1)

const INNER_EAST = maskOf((x) => x !== N - 1)
const INNER_WEST = maskOf((x) => x !== 0)
const EAST_0 = INNER_EAST[0]
const EAST_1 = INNER_EAST[1]
const EAST_2 = INNER_EAST[2]
const WEST_0 = INNER_WEST[0]
const WEST_1 = INNER_WEST[1]
const WEST_2 = INNER_WEST[2]

// Résultat de `boxOf`, à lire avant l'appel suivant. Trois variables de module
// plutôt qu'un tableau exporté : les boucles de ce fichier les lisent des
// dizaines de milliers de fois par seconde, et seul ce fichier les lit.
let box0 = 0
let box1 = 0
let box2 = 0

/**
 * Dilate un ensemble d'un cran dans les huit directions, lui-même compris.
 *
 * Étalement horizontal d'abord, vertical ensuite : la boîte 3 × 3 est le produit
 * des deux, ce qui coûte quatre décalages au lieu de huit.
 */
function boxOf(a0: number, a1: number, a2: number): void {
  const h0 = a0 | ((a0 & EAST_0) << 1) | ((a0 & WEST_0) >>> 1)
  const h1 = a1 | ((a1 & EAST_1) << 1) | ((a1 & WEST_1) >>> 1)
  const h2 = a2 | ((a2 & EAST_2) << 1) | ((a2 & WEST_2) >>> 1)
  box0 =
    h0 |
    ((h0 << ROW_SHIFT) & LIMB_MASK) |
    (h0 >>> ROW_SHIFT) |
    ((h1 << LIMB_CARRY) & LIMB_MASK)
  box1 =
    h1 |
    ((h1 << ROW_SHIFT) & LIMB_MASK) |
    (h1 >>> ROW_SHIFT) |
    (h0 >>> LIMB_CARRY) |
    ((h2 << LIMB_CARRY) & LIMB_MASK)
  box2 =
    h2 |
    ((h2 << ROW_SHIFT) & LIMB_MASK) |
    (h2 >>> ROW_SHIFT) |
    (h1 >>> LIMB_CARRY)
}

/** Résultat de `floodFrom` : la composante atteinte. */
export const FLOOD = new Int32Array(LIMBS)

/**
 * Composante connexe — voisinage à huit — de `within` atteignable depuis
 * `seed`. `seed` doit être inclus dans `within`.
 */
export function floodFrom(
  seed0: number,
  seed1: number,
  seed2: number,
  within0: number,
  within1: number,
  within2: number,
): void {
  let reached0 = seed0
  let reached1 = seed1
  let reached2 = seed2
  let front0 = seed0
  let front1 = seed1
  let front2 = seed2
  while ((front0 | front1 | front2) !== 0) {
    boxOf(front0, front1, front2)
    front0 = box0 & within0 & ~reached0
    front1 = box1 & within1 & ~reached1
    front2 = box2 & within2 & ~reached2
    reached0 |= front0
    reached1 |= front1
    reached2 |= front2
  }
  FLOOD[0] = reached0
  FLOOD[1] = reached1
  FLOOD[2] = reached2
}

/** Nombre de bits à un d'un mot. */
export function popcount(value: number): number {
  let v = value - ((value >>> 1) & 0x55555555)
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333)
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

/**
 * Couches de distance d'un parcours 0-1, en plateaux de bits.
 *
 * Le décor : deux ensembles de cases franchissables, celles qui ne coûtent rien
 * (`free` valant zéro pas) et celles qui coûtent un pas ; tout le reste est
 * infranchissable. La couche `d` est alors ce qu'on atteint en franchissant
 * exactement `d` cases à un pas, saturé par les cases gratuites. C'est le
 * résultat d'une file à deux bouts, obtenu sans file ni case à case.
 *
 * On s'arrête **au bord d'arrivée** et on renvoie sa distance, ou `-1` s'il est
 * hors d'atteinte. Les couches au-delà ne serviraient à rien.
 *
 * `layers` reçoit `LIMBS` mots par couche, la couche `d` à l'indice `d * LIMBS`.
 */
export const MAX_LAYERS = CELLS + 1

/** Tampon de couches à la taille voulue par `fillLayers`. */
export function createLayers(): Int32Array {
  return new Int32Array(MAX_LAYERS * LIMBS)
}

let free0 = 0
let free1 = 0
let free2 = 0
let step0 = 0
let step1 = 0
let step2 = 0

/**
 * Fixe le terrain des parcours suivants : cases gratuites et cases à un pas.
 * Les axes d'une même position les partagent, on ne les repasse donc pas.
 */
export function setTerrain(
  gratis0: number,
  gratis1: number,
  gratis2: number,
  paid0: number,
  paid1: number,
  paid2: number,
): void {
  free0 = gratis0
  free1 = gratis1
  free2 = gratis2
  step0 = paid0
  step1 = paid1
  step2 = paid2
}

export function fillLayers(
  entry: Int32Array,
  exit: Int32Array,
  layers: Int32Array,
): number {
  const exit0 = exit[0]
  const exit1 = exit[1]
  const exit2 = exit[2]

  let l0 = entry[0] & free0
  let l1 = entry[1] & free1
  let l2 = entry[2] & free2
  let v0 = l0
  let v1 = l1
  let v2 = l2
  let f0 = l0
  let f1 = l1
  let f2 = l2
  while ((f0 | f1 | f2) !== 0) {
    boxOf(f0, f1, f2)
    f0 = box0 & free0 & ~v0
    f1 = box1 & free1 & ~v1
    f2 = box2 & free2 & ~v2
    v0 |= f0
    v1 |= f1
    v2 |= f2
    l0 |= f0
    l1 |= f1
    l2 |= f2
  }
  layers[0] = l0
  layers[1] = l1
  layers[2] = l2
  if (((l0 & exit0) | (l1 & exit1) | (l2 & exit2)) !== 0) return 0

  // Le bord d'entrée est une porte à un pas, même sans voisine gratuite.
  let pending0 = entry[0] & step0
  let pending1 = entry[1] & step1
  let pending2 = entry[2] & step2

  for (let depth = 1; depth < MAX_LAYERS; depth += 1) {
    boxOf(l0, l1, l2)
    let n0 = ((box0 & step0) | pending0) & ~v0
    let n1 = ((box1 & step1) | pending1) & ~v1
    let n2 = ((box2 & step2) | pending2) & ~v2
    pending0 = 0
    pending1 = 0
    pending2 = 0
    if ((n0 | n1 | n2) === 0) return -1
    v0 |= n0
    v1 |= n1
    v2 |= n2
    f0 = n0
    f1 = n1
    f2 = n2
    while ((f0 | f1 | f2) !== 0) {
      boxOf(f0, f1, f2)
      f0 = box0 & free0 & ~v0
      f1 = box1 & free1 & ~v1
      f2 = box2 & free2 & ~v2
      v0 |= f0
      v1 |= f1
      v2 |= f2
      n0 |= f0
      n1 |= f1
      n2 |= f2
    }
    const slot = depth * LIMBS
    layers[slot] = n0
    layers[slot + 1] = n1
    layers[slot + 2] = n2
    if (((n0 & exit0) | (n1 & exit1) | (n2 & exit2)) !== 0) return depth
    l0 = n0
    l1 = n1
    l2 = n2
  }
  return -1
}
