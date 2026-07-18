import type { GameEvent, PlayerId } from '../game/types'

type GameStatusProps = {
  activePlayer: PlayerId
  event: GameEvent
  ghostMessage: string | null
}

const NAMES: Record<PlayerId, string> = { blue: 'bleus', white: 'blancs' }

export function GameStatus({
  activePlayer,
  event,
  ghostMessage,
}: GameStatusProps) {
  let message: string | null = null

  if (event?.type === 'forced-pass') {
    message = `Aucun coup pour les ${NAMES[event.player]} : tour passé automatiquement.`
  } else if (event?.type === 'invalid') {
    message = 'Pose refusée.'
  }
  if (ghostMessage) message = ghostMessage

  return (
    <div
      className={`game-status game-status--${activePlayer}`}
      aria-label={`Tour des ${NAMES[activePlayer]}`}
      aria-live="polite"
    >
      <span className="turn-arrow" aria-hidden="true">
        {activePlayer === 'blue' ? '←' : '→'}
      </span>
      {message && <p>{message}</p>}
    </div>
  )
}
