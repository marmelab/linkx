import { BOARD_SIZE } from '../game/types'
import type { Board as BoardType, DropResult, PlayerId } from '../game/types'

type BoardProps = {
  board: BoardType
  ghost: DropResult | null
  ghostPlayer: PlayerId
}

export function Board({ board, ghost, ghostPlayer }: BoardProps) {
  const ghostCells = new Set(
    (ghost
      ? ghost.valid
        ? ghost.cells
        : ghost.previewCells
      : []
    ).map(({ x, y }) => `${x},${y}`),
  )

  return (
    <div className="board-frame">
      <div className="edge-label edge-label--top">HAUT</div>
      <div className="edge-label edge-label--left">GAUCHE</div>
      <div
        className="board"
        role="grid"
        aria-label="Plateau Linkx de 9 lignes par 9 colonnes"
        style={{ '--board-size': BOARD_SIZE } as React.CSSProperties}
      >
        {board.flatMap((row, y) =>
          row.map((cell, x) => {
            const isGhost = ghostCells.has(`${x},${y}`)
            const classNames = [
              'board-cell',
              cell ? `board-cell--${cell.player}` : '',
              isGhost ? `board-cell--ghost-${ghostPlayer}` : '',
              isGhost && ghost && !ghost.valid ? 'board-cell--ghost-invalid' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div
                className={classNames}
                role="gridcell"
                aria-label={`Ligne ${y + 1}, colonne ${x + 1}${cell ? `, ${cell.player === 'blue' ? 'bleu' : 'blanc'}` : ', vide'}${isGhost ? ', aperçu' : ''}`}
                key={`${x}-${y}`}
              />
            )
          }),
        )}
      </div>
      <div className="edge-label edge-label--right">DROITE</div>
      <div className="edge-label edge-label--bottom">BAS</div>
    </div>
  )
}

