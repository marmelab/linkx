import type { GameEvent, PlayerId } from '../game/types'

type GameStatusProps = {
  activePlayer: PlayerId
  event: GameEvent
  /**
   * Motif du refus que montre l'aperçu de chute. Il est **annoncé et non
   * peint** : l'aperçu rouge le dit déjà à qui voit l'écran, et l'écrire à côté
   * doublait une information immédiate.
   */
  ghostRefusal: string | null
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
  ghostRefusal,
  thinking = false,
  hintPending = false,
}: GameStatusProps) {
  let message: string | null = null
  // Ce qui se voit déjà à l'écran se dit sans s'écrire : le refus n'existe que
  // pour l'annonce, tandis qu'un tour passé ou une attente n'ont aucune
  // traduction visuelle et restent peints.
  let announcement: string | null = ghostRefusal

  if (event?.type === 'forced-pass') {
    message = `Aucun coup pour les ${NAMES[event.player]} : tour passé automatiquement.`
  } else if (event?.type === 'invalid' && !announcement) {
    announcement = 'Pose refusée.'
  }
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
      {announcement && <p className="visually-hidden">{announcement}</p>}
      {message && <p>{message}</p>}
    </div>
  )
}
