import { enumerateLegalMoves } from './legalMoves'
import type { LegalMove } from './legalMoves'
import { createInitialInventory } from './pieces'
import type { GamePosition } from './simulation'
import { BOARD_SIZE, SHAPE_IDS } from './types'
import type { Board, PlayerId } from './types'
import { OPENING_BOOK } from './openingBook.data'

/**
 * Livre d'ouverture
 * =================
 *
 * En début de partie le plateau offre 60 à 95 coups légaux : à ce facteur de
 * branchement, le maître ne tient que la profondeur 2 en direct, trop courte
 * pour distinguer un bon coup d'un coup perdant (cf. `plan.md`). Le livre lève
 * cette limite : ses coups sont calculés **hors ligne** à profondeur 5+ par
 * `scripts/generate-opening-book.ts`, puis lus instantanément ici.
 *
 * Une entrée couvre une position où c'est au tour de l'IA de jouer son **premier
 * ou deuxième** coup. Au-delà, le plateau s'est assez resserré pour que la
 * recherche en direct suffise.
 *
 * Symétrie : seule la **symétrie gauche-droite** est une symétrie du jeu, car la
 * gravité fixe un bas. On ne réduit donc les positions que par ce miroir — pas
 * par les rotations ni le miroir haut-bas, qui changeraient le sens de la chute.
 */

const N = BOARD_SIZE
const INITIAL_PIECE_COUNT = SHAPE_IDS.reduce(
  (total, shapeId) => total + createInitialInventory()[shapeId],
  0,
)

/** Un coup stocké : les indices `y * N + x` de ses cases, triés, en repère canonique. */
type StoredMove = number[]
/** Chaque position (clé canonique) pointe vers ses meilleurs coups ex æquo. */
export type OpeningBook = Record<string, StoredMove[]>

function mirrorIndex(index: number): number {
  const x = index % N
  const y = (index - x) / N
  return y * N + (N - 1 - x)
}

function boardString(board: Board, mirror: boolean): string {
  let out = ''
  for (let y = 0; y < N; y += 1) {
    for (let x = 0; x < N; x += 1) {
      const cell = board[y][mirror ? N - 1 - x : x]
      out += cell ? (cell.player === 'blue' ? 'B' : 'W') : '.'
    }
  }
  return out
}

function inventoryDigits(position: GamePosition): string {
  // Invariant par miroir : refléter le plateau ne change aucun compte de pièce.
  return (['blue', 'white'] as const)
    .map((player) => SHAPE_IDS.map((shapeId) => position.inventories[player][shapeId]).join(''))
    .join('')
}

function movesPlayedBy(position: GamePosition, player: PlayerId): number {
  const remaining = SHAPE_IDS.reduce(
    (total, shapeId) => total + position.inventories[player][shapeId],
    0,
  )
  return INITIAL_PIECE_COUNT - remaining
}

/**
 * Nombre de coups déjà posés par le joueur au trait au-delà duquel le livre ne
 * s'applique plus. À 1, il couvre ses deux premiers coups.
 *
 * Source **unique** du périmètre du livre : la lecture s'en sert pour sortir
 * sans construire de clé, et `scripts/generate-opening-book.ts` pour ne pas
 * écrire des entrées que la lecture refuserait. Les deux doivent bouger
 * ensemble, sinon la génération produit des entrées mortes.
 */
export const BOOK_MAX_PLAYED_MOVES = 1

/** Vrai quand cette position est dans le périmètre du livre. */
export function isWithinBookRange(position: GamePosition): boolean {
  return movesPlayedBy(position, position.activePlayer) <= BOOK_MAX_PLAYED_MOVES
}

/**
 * Clé de recherche d'une position, et si le miroir gauche-droite a été appliqué
 * pour l'obtenir. La forme canonique est celle des deux orientations dont la
 * chaîne de plateau est la plus petite ; la clé y ajoute réserves et joueur au
 * trait, tous deux invariants par miroir.
 */
export function canonicalPosition(position: GamePosition): {
  key: string
  mirror: boolean
} {
  const plain = boardString(position.board, false)
  const mirrored = boardString(position.board, true)
  const mirror = mirrored < plain
  return {
    key: `${position.activePlayer}|${inventoryDigits(position)}|${mirror ? mirrored : plain}`,
    mirror,
  }
}

/**
 * Coup du livre pour cette position, ou `null` si elle n'y figure pas — la
 * recherche en direct prend alors le relais. `random` départage les meilleurs
 * ex æquo comme ailleurs dans le domaine ; absent, le premier l'emporte et le
 * choix reste déterministe (ce qui convient au conseil).
 */
export function lookupOpeningMove(
  position: GamePosition,
  random?: () => number,
  book: OpeningBook = OPENING_BOOK,
): LegalMove | null {
  // Garde rapide : passé le périmètre du livre, inutile de construire une clé.
  if (!isWithinBookRange(position)) return null

  const { key, mirror } = canonicalPosition(position)
  const moves = book[key]
  if (!moves || moves.length === 0) return null

  const stored =
    random && moves.length > 1
      ? moves[Math.min(Math.floor(random() * moves.length), moves.length - 1)]
      : moves[0]
  const wanted = new Set(mirror ? stored.map(mirrorIndex) : stored)

  // On retrouve le vrai coup légal dont les cases coïncident : il porte forme,
  // orientation et colonne exactes, sans avoir à transformer l'orientation.
  for (const move of enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  )) {
    if (
      move.cells.length === wanted.size &&
      move.cells.every(({ x, y }) => wanted.has(y * N + x))
    ) {
      return move
    }
  }
  // Donnée incohérente avec le plateau (ne devrait pas arriver) : repli recherche.
  return null
}
