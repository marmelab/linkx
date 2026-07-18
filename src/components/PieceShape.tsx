import { getOrientation } from '../game/transforms'
import type { Orientation, PlayerId, Rotation, ShapeId } from '../game/types'

type PieceShapeProps = {
  shapeId?: ShapeId
  player: PlayerId
  orientation?: Orientation
  rotation?: Rotation
  flipped?: boolean
  compact?: boolean
}

export function PieceShape({
  shapeId,
  player,
  orientation,
  rotation = 0,
  flipped = false,
  compact = false,
}: PieceShapeProps) {
  const shown = orientation ?? getOrientation(shapeId!, rotation, flipped)
  const occupied = new Set(shown.cells.map(({ x, y }) => `${x},${y}`))

  return (
    <span
      className={`piece-shape piece-shape--${player}${compact ? ' piece-shape--compact' : ''}`}
      style={{
        gridTemplateColumns: `repeat(${shown.width}, var(--piece-cell))`,
        gridTemplateRows: `repeat(${shown.height}, var(--piece-cell))`,
      }}
      aria-hidden="true"
    >
      {Array.from({ length: shown.width * shown.height }, (_, index) => {
        const x = index % shown.width
        const y = Math.floor(index / shown.width)
        return (
          <span
            className={occupied.has(`${x},${y}`) ? 'piece-shape__cell' : ''}
            key={`${x}-${y}`}
          />
        )
      })}
    </span>
  )
}

