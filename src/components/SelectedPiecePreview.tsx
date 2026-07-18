import { useLayoutEffect, useRef, useState } from 'react'
import { PieceShape } from './PieceShape'
import { getTurnKind } from './pieceTurn'
import type { TurnKind } from './pieceTurn'
import type { Orientation, PlayerId, Selection } from '../game/types'

/** Mouvement joué, et jeton qui le rejoue au quart de tour suivant. */
type Turn = { kind: TurnKind; nonce: number }

type SelectedPiecePreviewProps = {
  selection: Selection
  orientation: Orientation
  player: PlayerId
  onRotate: () => void
  onFlip: () => void
}

/**
 * La pièce sélectionnée, montrée en grand. C'est aussi une commande de
 * proximité : agir dessus tourne la pièce, l'action secondaire la retourne.
 * L'aperçu reste masqué aux lecteurs d'écran, qui ont les boutons.
 */
export function SelectedPiecePreview({
  selection,
  orientation,
  player,
  onRotate,
  onFlip,
}: SelectedPiecePreviewProps) {
  const [turn, setTurn] = useState<Turn | null>(null)
  const shown = useRef(selection)

  // Effet de mise en page et non effet différé : l'animation est posée avant la
  // peinture, si bien que l'orientation d'arrivée n'est jamais peinte une image
  // à sa place avant de repartir en arrière.
  useLayoutEffect(() => {
    const previous = shown.current
    shown.current = selection
    const kind = getTurnKind(previous, selection)
    // Le compteur est indispensable : deux quarts de tour de suite portent la
    // même classe, et sans changement de clé le second ne rejouerait rien.
    setTurn((current) => (kind ? { kind, nonce: (current?.nonce ?? 0) + 1 } : null))
  }, [selection])

  return (
    <div
      className="selected-piece-preview"
      aria-hidden="true"
      onClick={onRotate}
      onContextMenu={(event) => {
        event.preventDefault()
        onFlip()
      }}
    >
      <div
        key={turn?.nonce ?? 0}
        className={`piece-turn${turn ? ` piece-turn--${turn.kind}` : ''}`}
      >
        <PieceShape orientation={orientation} player={player} />
      </div>
    </div>
  )
}
