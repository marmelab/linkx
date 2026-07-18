import { INITIAL_ROTATIONS, SHAPE_LABELS } from '../game/pieces'
import { PieceShape } from './PieceShape'
import { SHAPE_IDS } from '../game/types'
import type { Inventory, PlayedCopies, PlayerId, Selection, ShapeId } from '../game/types'

type PieceTrayProps = {
  player: PlayerId
  inventory: Inventory
  playedCopies: PlayedCopies
  active: boolean
  selection: Selection | null
  /** Exemplaire conseillé, mis en évidence jusqu'à la prochaine action. */
  hint?: { shapeId: ShapeId; copy: 0 | 1 } | null
  onSelect: (shapeId: ShapeId, copy: 0 | 1) => void
}

const PLAYER_NAMES: Record<PlayerId, string> = {
  blue: 'Bleus',
  white: 'Blancs',
}

export function PieceTray({
  player,
  inventory,
  playedCopies,
  active,
  selection,
  hint = null,
  onSelect,
}: PieceTrayProps) {
  return (
    <aside
      className={`piece-tray piece-tray--${player}`}
      aria-label={`Réserve des ${PLAYER_NAMES[player].toLowerCase()}`}
    >
      <div className="piece-list">
        {SHAPE_IDS.map((shapeId) => {
          const count = inventory[shapeId]
          return (
            <div
              className="piece-row"
              key={shapeId}
              role="group"
              aria-label={`${SHAPE_LABELS[shapeId]}, ${count} restante${count > 1 ? 's' : ''}`}
            >
              {([0, 1] as const).map((copy) => {
                const available = !playedCopies[shapeId][copy]
                const selected =
                  active &&
                  available &&
                  selection?.shapeId === shapeId &&
                  selection.copy === copy
                const hinted =
                  active &&
                  available &&
                  hint?.shapeId === shapeId &&
                  hint.copy === copy
                return available ? (
                  <button
                    type="button"
                    className={`piece-button${selected ? ' is-selected' : ''}${hinted ? ' piece-button--hinted' : ''}`}
                    disabled={!active}
                    aria-pressed={selected}
                    aria-label={`${SHAPE_LABELS[shapeId]}, exemplaire ${copy + 1}${hinted ? '. Pièce conseillée.' : ''}${selected ? '. Cliquer à nouveau pour tourner.' : ''}`}
                    onClick={() => onSelect(shapeId, copy)}
                    key={copy}
                  >
                    <PieceShape
                      shapeId={shapeId}
                      player={player}
                      rotation={INITIAL_ROTATIONS[shapeId]}
                      compact
                    />
                  </button>
                ) : (
                  <span
                    className="piece-button piece-button--unavailable"
                    aria-hidden="true"
                    key={copy}
                  >
                    <PieceShape
                      shapeId={shapeId}
                      player={player}
                      rotation={INITIAL_ROTATIONS[shapeId]}
                      compact
                      unavailable
                    />
                  </span>
                )
              })}
            </div>
          )
        })}
      </div>
    </aside>
  )
}
