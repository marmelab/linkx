import { createInitialState, firstAvailableCopy, gameReducer } from './reducer'
import { getOrientation, getUniqueOrientations, pointsKey } from './transforms'
import { SHAPE_IDS } from './types'
import type {
  GameState,
  PlayerId,
  RecordedMove,
  Rotation,
  ShapeId,
} from './types'

/**
 * Notation de partie
 * =================
 *
 * Une partie s'écrit comme une suite de jetons séparés par des espaces :
 *
 *   record   := [ premier ] jeton*
 *   premier  := "b" | "w" | "blue" | "white"     défaut « b », omis à l'écriture
 *   jeton    := coup | passe
 *   coup     := forme [ miroir ] [ rotation ] colonne
 *   forme    := "1" | "2" | "3I" | "3L" | "4S" | "4T" | "4L"
 *   miroir   := "s"                              symétrie, appliquée avant la rotation
 *   rotation := ("r" | "l") ("1" | "2" | "3")    quarts de tour horaires / antihoraires
 *   colonne  := "1".."9"                         colonne d'ancrage, toujours le dernier caractère
 *   passe    := "--"                             tour passé faute de coup légal
 *
 * Les noms de forme reprennent le nombre de cases suivi de la silhouette :
 * `1` mono, `2` domino, `3I` barre de trois, `3L` petit L, `4S` le S/Z,
 * `4T` le T, `4L` le grand L/J.
 *
 * Exemples : `15` mono en colonne 5, `3Ir13` barre de trois debout en colonne 3,
 * `4Lsr27` grand L retourné puis tourné d'un demi-tour, ancré en colonne 7.
 *
 * Canonicité
 * ----------
 * Une géométrie donnée ne possède qu'une seule écriture canonique : celle de
 * l'orientation unique correspondante dans `transforms.ts`, c'est-à-dire la
 * première rencontrée en énumérant d'abord les rotations non retournées. Les
 * écritures redondantes restent acceptées en lecture mais sont ramenées à cette
 * forme : `2r2` devient `2`, `3Ll1` devient `3Lr3`, `3Ls` devient `3Lr2`. Seule
 * la forme canonique est produite à l'écriture, donc `serialize(parse(x)) === x`
 * pour toute partie déjà canonique.
 *
 * Passes
 * ------
 * Une passe est entièrement déterminée par la position : elle est donc
 * facultative en lecture, mais toujours écrite. Un `--` qui ne correspond pas à
 * une passe réellement forcée est refusé.
 */

export const SHAPE_NOTATION: Record<ShapeId, string> = {
  mono: '1',
  domino: '2',
  bar3: '3I',
  smallL: '3L',
  s: '4S',
  t: '4T',
  largeL: '4L',
}

export const PASS_TOKEN = '--'

const SHAPE_BY_TOKEN = new Map<string, ShapeId>(
  SHAPE_IDS.map((shapeId) => [SHAPE_NOTATION[shapeId], shapeId]),
)

const MOVE_PATTERN = /^(1|2|3I|3L|4S|4T|4L)(S?)(?:([RL])([123]))?([1-9])$/i

const FIRST_PLAYER_TOKENS: Record<string, PlayerId | undefined> = {
  b: 'blue',
  blue: 'blue',
  w: 'white',
  white: 'white',
}

const TOKEN_SEPARATOR = /[\s,+]+/

export type NotationErrorReason =
  | 'syntax'
  | 'exhausted'
  | 'horizontal-bounds'
  | 'overflow'
  | 'unsupported'
  | 'game-over'
  | 'unexpected-pass'

const REASON_MESSAGES: Record<NotationErrorReason, string> = {
  syntax: 'notation de coup invalide',
  exhausted: 'cette pièce n’est plus en réserve',
  'horizontal-bounds': 'la pièce sort du plateau sur les côtés',
  overflow: 'la pièce dépasse par le haut du plateau',
  unsupported: 'la pièce laisserait un vide sous elle',
  'game-over': 'la partie est déjà terminée',
  'unexpected-pass': 'aucun tour n’est passé à cet endroit',
}

export type NotationError = {
  /** Rang du jeton fautif, hors indication de premier joueur, à partir de 0. */
  index: number
  token: string
  reason: NotationErrorReason
  message: string
}

export type MoveParseResult =
  | { ok: true; move: RecordedMove }
  | { ok: false; reason: 'syntax' }

export type GameRecordParseResult =
  | { ok: true; state: GameState }
  | { ok: false; error: NotationError }

function notationError(
  index: number,
  token: string,
  reason: NotationErrorReason,
): NotationError {
  return {
    index,
    token,
    reason,
    message: `Coup ${index + 1} (« ${token} ») : ${REASON_MESSAGES[reason]}.`,
  }
}

/**
 * Orientation canonique d'une géométrie : celle que `transforms.ts` conserve en
 * dédupliquant les rotations et miroirs redondants.
 */
function canonicalOrientation(
  shapeId: ShapeId,
  rotation: Rotation,
  flipped: boolean,
): { rotation: Rotation; flipped: boolean } {
  const key = pointsKey(getOrientation(shapeId, rotation, flipped).cells)
  const canonical = getUniqueOrientations(shapeId).find(
    (orientation) => pointsKey(orientation.cells) === key,
  )
  if (!canonical) {
    throw new Error(`Orientation introuvable pour la forme ${shapeId}.`)
  }
  return { rotation: canonical.rotation, flipped: canonical.flipped }
}

/** Lit un jeton de coup isolé et le ramène à son orientation canonique. */
export function parseMove(token: string): MoveParseResult {
  const match = MOVE_PATTERN.exec(token)
  if (!match) return { ok: false, reason: 'syntax' }

  const [, shapeToken, mirrorToken, direction, quarters, columnToken] = match
  const shapeId = SHAPE_BY_TOKEN.get(shapeToken.toUpperCase())
  if (!shapeId) return { ok: false, reason: 'syntax' }

  const turns = quarters ? Number(quarters) : 0
  const clockwise = !direction || direction.toLowerCase() === 'r'
  const rotation = ((clockwise ? turns : 4 - turns) % 4) as Rotation

  return {
    ok: true,
    move: {
      shapeId,
      ...canonicalOrientation(shapeId, rotation, Boolean(mirrorToken)),
      column: Number(columnToken) - 1,
    },
  }
}

/** Écrit un coup dans sa seule forme canonique. */
export function serializeMove(move: RecordedMove): string {
  const { rotation, flipped } = canonicalOrientation(
    move.shapeId,
    move.rotation,
    move.flipped,
  )
  const mirror = flipped ? 's' : ''
  const turn = rotation === 0 ? '' : `r${rotation}`
  return `${SHAPE_NOTATION[move.shapeId]}${mirror}${turn}${move.column + 1}`
}

type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; reason: NotationErrorReason }

/**
 * Rejoue un coup en passant uniquement par les actions du reducer : la légalité,
 * la victoire, les passes et le blocage restent calculés par le moteur.
 */
function applyRecordedMove(state: GameState, move: RecordedMove): ApplyResult {
  const player = state.activePlayer
  const copy = firstAvailableCopy(state, player, move.shapeId)
  if (state.inventories[player][move.shapeId] === 0 || copy === null) {
    return { ok: false, reason: 'exhausted' }
  }

  let next = gameReducer(state, {
    type: 'SELECT_SHAPE',
    player,
    shapeId: move.shapeId,
    copy,
  })
  // Selon l'état courant, SELECT_SHAPE arme la forme ou fait tourner un
  // exemplaire déjà armé : on ajuste depuis l'orientation réellement obtenue.
  const selected = next.selection
  if (!selected || selected.shapeId !== move.shapeId) {
    return { ok: false, reason: 'exhausted' }
  }

  const turns = (move.rotation - selected.rotation + 4) % 4
  for (let turn = 0; turn < turns; turn += 1) {
    next = gameReducer(next, { type: 'ROTATE_SELECTION' })
  }
  if (selected.flipped !== move.flipped) {
    next = gameReducer(next, { type: 'FLIP_SELECTION' })
  }

  next = gameReducer(next, { type: 'DROP_SELECTED_SHAPE', column: move.column })
  if (next.lastEvent?.type === 'invalid') {
    return { ok: false, reason: next.lastEvent.reason }
  }
  return { ok: true, state: next }
}

function lastEntryIsPass(state: GameState): boolean {
  return state.history[state.history.length - 1]?.kind === 'pass'
}

/**
 * Rejoue une partie complète. En cas de refus, rien n'est appliqué : l'appelant
 * reçoit l'index du jeton fautif et la raison structurée du refus.
 */
export function parseGameRecord(source: string): GameRecordParseResult {
  const tokens = source.trim().split(TOKEN_SEPARATOR).filter(Boolean)
  const declared = FIRST_PLAYER_TOKENS[tokens[0]?.toLowerCase() ?? '']
  const firstPlayer = declared ?? 'blue'
  const offset = declared ? 1 : 0

  let state = gameReducer(createInitialState(), {
    type: 'START_GAME',
    firstPlayer,
    mode: 'human',
  })
  let pendingPass = false

  for (let index = offset; index < tokens.length; index += 1) {
    const token = tokens[index]
    const rank = index - offset

    if (token === PASS_TOKEN) {
      if (!pendingPass) {
        return { ok: false, error: notationError(rank, token, 'unexpected-pass') }
      }
      pendingPass = false
      continue
    }

    if (state.phase !== 'playing') {
      return { ok: false, error: notationError(rank, token, 'game-over') }
    }

    const parsed = parseMove(token)
    if (!parsed.ok) {
      return { ok: false, error: notationError(rank, token, parsed.reason) }
    }

    const applied = applyRecordedMove(state, parsed.move)
    if (!applied.ok) {
      return { ok: false, error: notationError(rank, token, applied.reason) }
    }

    state = applied.state
    // Une passe facultative dans le texte est admise ; elle sera réécrite.
    pendingPass = lastEntryIsPass(state)
  }

  return { ok: true, state }
}

/** Écrit la partie portée par un état, dans sa forme canonique. */
export function serializeGameRecord(state: GameState): string {
  const tokens = state.history.map((entry) =>
    entry.kind === 'pass' ? PASS_TOKEN : serializeMove(entry),
  )
  if (state.firstPlayer === 'white') tokens.unshift('w')
  return tokens.join(' ')
}
