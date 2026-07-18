import { SHAPE_LABELS } from '../game/pieces'
import { PieceShape } from './PieceShape'
import { SHAPE_IDS } from '../game/types'
import type { Inventory, PlayerId, Selection, ShapeId } from '../game/types'

type PieceTrayProps = {
  player: PlayerId
  inventory: Inventory
  active: boolean
  selection: Selection | null
  onSelect: (shapeId: ShapeId) => void
}

const PLAYER_NAMES: Record<PlayerId, string> = {
  blue: 'Bleus',
  white: 'Blancs',
}

export function PieceTray({
  player,
  inventory,
  active,
  selection,
  onSelect,
}: PieceTrayProps) {
  return (
    <aside
      className={`piece-tray piece-tray--${player}${active ? ' is-active' : ''}`}
      aria-label={`Réserve des ${PLAYER_NAMES[player].toLowerCase()}`}
    >
      <div className="tray-heading">
        <span className="player-dot" aria-hidden="true" />
        <div>
          <span className="tray-kicker">Réserve</span>
          <h2>{PLAYER_NAMES[player]}</h2>
        </div>
        {active && <span className="turn-chip">À vous</span>}
      </div>

      <div className="piece-list">
        {SHAPE_IDS.map((shapeId) => {
          const selected = active && selection?.shapeId === shapeId
          const count = inventory[shapeId]
          return (
            <button
              type="button"
              className={`piece-button${selected ? ' is-selected' : ''}`}
              key={shapeId}
              disabled={!active || count === 0}
              aria-pressed={selected}
              aria-label={`${SHAPE_LABELS[shapeId]}, ${count} restante${count > 1 ? 's' : ''}${selected ? '. Cliquer à nouveau pour tourner.' : ''}`}
              onClick={() => onSelect(shapeId)}
            >
              <span className="piece-button__visual">
                <PieceShape
                  shapeId={shapeId}
                  player={player}
                  rotation={selected ? selection.rotation : 0}
                  flipped={selected ? selection.flipped : false}
                  compact
                />
              </span>
              <span className="piece-button__name">{SHAPE_LABELS[shapeId]}</span>
              <span className="piece-count">×{count}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

