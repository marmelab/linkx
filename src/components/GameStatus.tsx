import { SHAPE_LABELS } from '../game/pieces'
import type { GameEvent, PlayerId, Selection } from '../game/types'

type GameStatusProps = {
  activePlayer: PlayerId
  selection: Selection | null
  event: GameEvent
  ghostMessage: string | null
}

const NAMES: Record<PlayerId, string> = { blue: 'bleus', white: 'blancs' }

export function GameStatus({
  activePlayer,
  selection,
  event,
  ghostMessage,
}: GameStatusProps) {
  let message = selection
    ? `${SHAPE_LABELS[selection.shapeId]} · ${selection.rotation * 90}°${selection.flipped ? ' · retournée' : ''}`
    : 'Choisissez une pièce dans votre réserve'

  if (event?.type === 'forced-pass') {
    message = `Aucun coup pour les ${NAMES[event.player]} : tour passé automatiquement.`
  } else if (event?.type === 'invalid') {
    message = 'Pose refusée. Choisissez une autre colonne ou orientation.'
  }
  if (ghostMessage) message = ghostMessage

  return (
    <div className={`game-status game-status--${activePlayer}`} aria-live="polite">
      <div>
        <span className="status-eyebrow">Tour en cours</span>
        <h1>Aux {NAMES[activePlayer]}</h1>
      </div>
      <p>{message}</p>
    </div>
  )
}

