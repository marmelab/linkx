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

export type Selection = {
  shapeId: ShapeId
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

export type GameState = {
  phase: 'setup' | 'playing' | 'finished'
  board: Board
  inventories: Record<PlayerId, Inventory>
  activePlayer: PlayerId
  selection: Selection | null
  consecutivePasses: number
  result: GameResult | null
  lastEvent: GameEvent
  nextPieceId: number
}

export type GameAction =
  | { type: 'START_GAME'; firstPlayer: PlayerId }
  | { type: 'SELECT_SHAPE'; player: PlayerId; shapeId: ShapeId }
  | { type: 'ROTATE_SELECTION' }
  | { type: 'FLIP_SELECTION' }
  | { type: 'DROP_SELECTED_SHAPE'; column: number }
  | { type: 'RESET_GAME' }

