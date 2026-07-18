import { BOARD_SIZE } from '../game/types'
import type { Board as BoardType, DropResult, PlayerId, Point } from '../game/types'
import { getCellsOutlinePath } from './pieceGeometry'

type BoardProps = {
  board: BoardType
  ghost: DropResult | null
  ghostPlayer: PlayerId
  winningPath?: Point[]
  /** Pièce à faire briller, le temps que le joueur repère le coup de l'ordi. */
  glowPieceId?: string | null
  /** Visée au pointeur : la colonne survolée porte la pièce, le clic la pose. */
  aiming?: boolean
  onPointColumn?: (column: number | null) => void
  onDropColumn?: (column: number) => void
}

type RenderedPiece = {
  id: string
  player: PlayerId
  cells: Point[]
}

function boardPieces(board: BoardType): RenderedPiece[] {
  const pieces = new Map<string, RenderedPiece>()
  board.forEach((row, y) =>
    row.forEach((cell, x) => {
      if (!cell) return
      const piece = pieces.get(cell.pieceId) ?? {
        id: cell.pieceId,
        player: cell.player,
        cells: [],
      }
      piece.cells.push({ x, y })
      pieces.set(cell.pieceId, piece)
    }),
  )
  return [...pieces.values()]
}

export function Board({
  board,
  ghost,
  ghostPlayer,
  winningPath = [],
  glowPieceId = null,
  aiming = false,
  onPointColumn,
  onDropColumn,
}: BoardProps) {
  const ghostPoints = ghost
    ? ghost.valid
      ? ghost.cells
      : ghost.previewCells
    : []
  const ghostCells = new Set(ghostPoints.map(({ x, y }) => `${x},${y}`))
  const pieces = boardPieces(board)

  return (
    <div className="board-frame">
      <div
        className={`board${aiming ? ' board--aiming' : ''}`}
        role="grid"
        aria-label="Plateau Linkx de 9 lignes par 9 colonnes"
        style={{ '--board-size': BOARD_SIZE } as React.CSSProperties}
        onMouseLeave={aiming ? () => onPointColumn?.(null) : undefined}
      >
        <svg
          className="board-piece-layer"
          viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {pieces.map((piece) => (
            <path
              className={`board-piece board-piece--${piece.player}${piece.id === glowPieceId ? ' board-piece--glowing' : ''}`}
              d={getCellsOutlinePath(piece.cells)}
              key={piece.id}
            />
          ))}
          {ghost && (
            <path
              className={`board-piece board-piece--ghost-${ghostPlayer}${ghost.valid ? '' : ' board-piece--ghost-invalid'}`}
              d={getCellsOutlinePath(ghostPoints)}
            />
          )}
          {winningPath.length > 0 && (
            <path
              className="board-winning-path"
              d={getCellsOutlinePath(winningPath)}
            />
          )}
        </svg>
        {board.map((row, y) => (
          // `display: contents` garde chaque case comme élément direct de la
          // grille CSS : la structure ARIA grille › ligne › cellule devient
          // valide sans changer la mise en page.
          <div
            role="row"
            style={{ display: 'contents' }}
            key={`row-${y}`}
          >
            {row.map((cell, x) => {
              const isGhost = ghostCells.has(`${x},${y}`)
              const classNames = [
                'board-cell',
                cell ? `board-cell--${cell.player}` : '',
              ]
                .filter(Boolean)
                .join(' ')
              return (
                <div
                  className={classNames}
                  role="gridcell"
                  aria-label={`Ligne ${y + 1}, colonne ${x + 1}${cell ? `, ${cell.player === 'blue' ? 'bleu' : 'blanc'}` : ', vide'}${isGhost ? ', aperçu' : ''}`}
                  key={`${x}-${y}`}
                  onMouseEnter={aiming ? () => onPointColumn?.(x) : undefined}
                  onClick={aiming ? () => onDropColumn?.(x) : undefined}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
