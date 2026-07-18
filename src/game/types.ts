export const BOARD_SIZE = 9

export const PLAYER_IDS = ['blue', 'white'] as const
export type PlayerId = (typeof PLAYER_IDS)[number]

export const SHAPE_IDS = [
  'mono',
  'domino',
  'bar3',
  'smallL',
  's',
  't',
  'largeL',
] as const

export type ShapeId = (typeof SHAPE_IDS)[number]
export type Rotation = 0 | 1 | 2 | 3
export type Point = { x: number; y: number }

export type Orientation = {
  cells: Point[]
  width: number
  height: number
  rotation: Rotation
  flipped: boolean
}

export type BoardCell = null | {
  player: PlayerId
  pieceId: string
  shapeId: ShapeId
}

export type Board = BoardCell[][]
export type Inventory = Record<ShapeId, 0 | 1 | 2>
export type PlayedCopies = Record<ShapeId, [boolean, boolean]>

export type Selection = {
  shapeId: ShapeId
  copy: 0 | 1
  rotation: Rotation
  flipped: boolean
}

export type GameResult = {
  winner: PlayerId | null
  reason: 'connection' | 'stalemate' | 'draw'
  largestZones?: Record<PlayerId, number>
}

export type InvalidDropReason =
  | 'horizontal-bounds'
  | 'overflow'
  | 'unsupported'

export type DropResult =
  | { valid: true; cells: Point[]; anchorY: number }
  | {
      valid: false
      reason: InvalidDropReason
      previewCells: Point[]
    }

export type GameEvent =
  | { type: 'placed'; player: PlayerId; shapeId: ShapeId }
  | { type: 'forced-pass'; player: PlayerId }
  | { type: 'invalid'; reason: InvalidDropReason }
  | null

export type GameMode = 'human' | 'ai'

/** Coup joué, tel qu'il est rejouable depuis une partie vierge. */
export type RecordedMove = {
  shapeId: ShapeId
  rotation: Rotation
  flipped: boolean
  /** Colonne d'ancrage, c'est-à-dire la colonne de la case la plus à gauche. */
  column: number
}

/**
 * Entrée d'historique. Les joueurs alternent d'une entrée à l'autre : une passe
 * forcée occupe donc sa propre entrée pour que l'alternance reste vraie.
 */
export type HistoryEntry = ({ kind: 'move' } & RecordedMove) | { kind: 'pass' }

export type GameState = {
  phase: 'setup' | 'playing' | 'finished'
  mode: GameMode
  /** Couleur tenue par l'ordinateur, `null` en partie à deux joueurs. */
  aiPlayer: PlayerId | null
  /** Joueur ayant ouvert la partie : point de départ de l'alternance. */
  firstPlayer: PlayerId
  /** Coups et passes déjà joués, dans l'ordre, pour re-sérialiser la partie. */
  history: HistoryEntry[]
  board: Board
  inventories: Record<PlayerId, Inventory>
  playedCopies: Record<PlayerId, PlayedCopies>
  activePlayer: PlayerId
  selection: Selection | null
  consecutivePasses: number
  result: GameResult | null
  lastEvent: GameEvent
  nextPieceId: number
  /** Dernière pièce posée : sert à la mettre en évidence après un coup de l'ordi. */
  lastPlacedPieceId: string | null
}

export type GameAction =
  | { type: 'START_GAME'; firstPlayer: PlayerId; mode?: GameMode }
  | {
      type: 'PLAY_AI_MOVE'
      shapeId: ShapeId
      rotation: Rotation
      flipped: boolean
      column: number
    }
  | { type: 'SELECT_SHAPE'; player: PlayerId; shapeId: ShapeId; copy?: 0 | 1 }
  | { type: 'ROTATE_SELECTION' }
  | { type: 'FLIP_SELECTION' }
  | { type: 'DROP_SELECTED_SHAPE'; column: number }
  | { type: 'RESET_GAME' }
