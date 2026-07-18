import { BOARD_SIZE } from '../game/types'

type DropZoneProps = {
  enabled: boolean
  hoveredColumn: number | null
  invalid: boolean
  /**
   * Sans flèches : la bande reste une surface de visée alignée sur les colonnes,
   * pour approcher la grille par le haut même lorsqu'elle est pleine. La pièce
   * qui suit le pointeur tient alors lieu d'indication.
   */
  silent?: boolean
  onHover: (column: number | null) => void
  onDrop: (column: number) => void
}

export function DropZone({
  enabled,
  hoveredColumn,
  invalid,
  silent = false,
  onHover,
  onDrop,
}: DropZoneProps) {
  return (
    <div
      className={`drop-zones${silent ? ' drop-zones--silent' : ''}`}
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
          onBlur={() => onHover(null)}
          onClick={() => onDrop(column)}
        >
          {!silent && (
            <span className="drop-arrow" aria-hidden="true">↓</span>
          )}
        </button>
      ))}
    </div>
  )
}
