import { BOARD_SIZE } from '../game/types'

type DropZoneProps = {
  enabled: boolean
  hoveredColumn: number | null
  invalid: boolean
  onHover: (column: number | null) => void
  onDrop: (column: number) => void
}

export function DropZone({
  enabled,
  hoveredColumn,
  invalid,
  onHover,
  onDrop,
}: DropZoneProps) {
  return (
    <div
      className="drop-zones"
      aria-label="Colonnes d’entrée"
      onMouseLeave={() => onHover(null)}
    >
      {Array.from({ length: BOARD_SIZE }, (_, column) => (
        <button
          type="button"
          className={`drop-zone${hoveredColumn === column ? ' is-hovered' : ''}${hoveredColumn === column && invalid ? ' is-invalid' : ''}`}
          key={column}
          disabled={!enabled}
          aria-label={`Faire tomber la pièce depuis la colonne ${column + 1}`}
          onMouseEnter={() => onHover(column)}
          onFocus={() => onHover(column)}
          onClick={() => onDrop(column)}
        >
          <span>{column + 1}</span>
          <span className="drop-arrow" aria-hidden="true">↓</span>
        </button>
      ))}
    </div>
  )
}

