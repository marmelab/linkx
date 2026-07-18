import type { GameEvent, PlayerId } from '../game/types'

type GameStatusProps = {
  activePlayer: PlayerId
  event: GameEvent
  ghostMessage: string | null
  /** Vrai pendant que l'ordinateur cherche son coup. */
  thinking?: boolean
}

const NAMES: Record<PlayerId, string> = { blue: 'bleus', white: 'blancs' }

export function GameStatus({
  activePlayer,
  event,
  ghostMessage,
  thinking = false,
}: GameStatusProps) {
  let message: string | null = null

  if (event?.type === 'forced-pass') {
    message = `Aucun coup pour les ${NAMES[event.player]} : tour passé automatiquement.`
  } else if (event?.type === 'invalid') {
    message = 'Pose refusée.'
  }
  if (ghostMessage) message = ghostMessage
  if (thinking) message = 'L’ordinateur réfléchit…'

  return (
    <div
      className={`game-status game-status--${activePlayer}${thinking ? ' game-status--thinking' : ''}`}
      aria-live="polite"
    >
      <span className="turn-arrow" aria-hidden="true">
        {activePlayer === 'blue' ? '←' : '→'}
      </span>
      {/* Le changement de joueur vit dans le texte annoncé, pas dans un
          aria-label : muter un aria-label ne déclenche pas d'annonce. */}
      <p className="visually-hidden">Tour des {NAMES[activePlayer]}</p>
      {message && <p>{message}</p>}
    </div>
  )
}
