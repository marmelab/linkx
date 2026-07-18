import type { GameEvent, PlayerId } from '../game/types'

type GameStatusProps = {
  activePlayer: PlayerId
  event: GameEvent
  ghostMessage: string | null
  /** Vrai pendant que l'ordinateur cherche son coup. */
  thinking?: boolean
  /**
   * Vrai pendant la recherche du conseil, peinte avant que celle-ci démarre. Le
   * bandeau n'en porte que l'état d'attente : la commande elle-même vit avec les
   * autres commandes de coup, dans la zone de la pièce sélectionnée.
   */
  hintPending?: boolean
}

const NAMES: Record<PlayerId, string> = { blue: 'bleus', white: 'blancs' }

export function GameStatus({
  activePlayer,
  event,
  ghostMessage,
  thinking = false,
  hintPending = false,
}: GameStatusProps) {
  let message: string | null = null

  if (event?.type === 'forced-pass') {
    message = `Aucun coup pour les ${NAMES[event.player]} : tour passé automatiquement.`
  } else if (event?.type === 'invalid') {
    message = 'Pose refusée.'
  }
  if (ghostMessage) message = ghostMessage
  if (hintPending) message = 'Recherche du meilleur coup…'
  if (thinking) message = 'L’ordinateur réfléchit…'

  return (
    <div
      className={`game-status game-status--${activePlayer}${thinking ? ' game-status--thinking' : ''}`}
      aria-live="polite"
    >
      {/* Deux flèches, une seule visible : la mise en page décide laquelle. Sur
          trois colonnes la réserve active est sur un côté, en une colonne elle
          est empilée sous le plateau. */}
      <span className="turn-arrow turn-arrow--aside" aria-hidden="true">
        {activePlayer === 'blue' ? '←' : '→'}
      </span>
      <span className="turn-arrow turn-arrow--below" aria-hidden="true">
        ↓
      </span>
      {/* Le changement de joueur vit dans le texte annoncé, pas dans un
          aria-label : muter un aria-label ne déclenche pas d'annonce. La
          permutation des réserves étant purement visuelle, l'annonce dit aussi
          laquelle des deux devient jouable. */}
      <p className="visually-hidden">
        Tour des {NAMES[activePlayer]} : leur réserve devient la réserve active.
      </p>
      {message && <p>{message}</p>}
    </div>
  )
}
