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

const PREVIEW_ROTATIONS = {
  mono: 0,
  domino: 0,
  bar3: 0,
  smallL: 0,
  s: 1,
  t: 0,
  largeL: 0,
} as const

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
              className={`piece-button${selected ? ' is-selected' : ''}${count === 0 ? ' is-empty' : ''}`}
              key={shapeId}
              disabled={!active || count === 0}
              aria-pressed={selected}
              aria-label={`${SHAPE_LABELS[shapeId]}, ${count} restante${count > 1 ? 's' : ''}${selected ? '. Cliquer à nouveau pour tourner.' : ''}`}
              onClick={() => onSelect(shapeId)}
            >
              <span className="piece-button__visual">
                {Array.from({ length: 2 }, (_, copy) => (
                  <PieceShape
                    shapeId={shapeId}
                    player={player}
                    rotation={PREVIEW_ROTATIONS[shapeId]}
                    flipped={false}
                    compact
                    unavailable={copy >= count}
                    key={copy}
                  />
                ))}
              </span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}
