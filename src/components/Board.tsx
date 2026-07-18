import { BOARD_SIZE } from '../game/types'
import type { Board as BoardType, DropResult, PlayerId, Point } from '../game/types'
import { getJoinedCellBounds } from './pieceGeometry'

type BoardProps = {
  board: BoardType
  ghost: DropResult | null
  ghostPlayer: PlayerId
  winningPath?: Point[]
}

type RenderedPiece = {
  id: string
  player: PlayerId
  cells: Point[]
}

type OutlineFilterProps = {
  id: string
  color: string
  radius: number
}

function OutlineFilter({ id, color, radius }: OutlineFilterProps) {
  return (
    <filter
      id={id}
      x="-0.15"
      y="-0.15"
      width="9.3"
      height="9.3"
      filterUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      <feMorphology
        in="SourceAlpha"
        operator="dilate"
        radius={radius}
        result="expanded"
      />
      <feFlood floodColor={color} result="outline-color" />
      <feComposite
        in="outline-color"
        in2="expanded"
        operator="in"
        result="outline"
      />
      <feMerge>
        <feMergeNode in="outline" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  )
}

function cellsPath(cells: readonly Point[]): string {
  const occupied = new Set(cells.map(({ x, y }) => `${x},${y}`))
  const isOccupied = (x: number, y: number) => occupied.has(`${x},${y}`)

  return cells
    .map(({ x, y }) => {
      const { left, right, top, bottom } = getJoinedCellBounds(
        x,
        y,
        isOccupied,
      )
      return `M ${left} ${top} H ${right} V ${bottom} H ${left} Z`
    })
    .join(' ')
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

export function Board({ board, ghost, ghostPlayer, winningPath = [] }: BoardProps) {
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
        className="board"
        role="grid"
        aria-label="Plateau Linkx de 9 lignes par 9 colonnes"
        style={{ '--board-size': BOARD_SIZE } as React.CSSProperties}
      >
        <svg
          className="board-piece-layer"
          viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            <OutlineFilter
              id="board-outline-blue"
              color="#0a479f"
              radius={0.025}
            />
            <OutlineFilter
              id="board-outline-white"
              color="#747d8b"
              radius={0.04}
            />
            <OutlineFilter
              id="board-outline-ghost-blue"
              color="#125cbf"
              radius={0.035}
            />
            <OutlineFilter
              id="board-outline-ghost-white"
              color="#5f6877"
              radius={0.035}
            />
            <OutlineFilter
              id="board-outline-ghost-invalid"
              color="#d9363e"
              radius={0.035}
            />
          </defs>
          {pieces.map((piece) => (
            <path
              className={`board-piece board-piece--${piece.player}`}
              d={cellsPath(piece.cells)}
              filter={`url(#board-outline-${piece.player})`}
              key={piece.id}
            />
          ))}
          {ghost && (
            <path
              className={`board-piece board-piece--ghost-${ghostPlayer}${ghost.valid ? '' : ' board-piece--ghost-invalid'}`}
              d={cellsPath(ghostPoints)}
              filter={`url(#board-outline-${ghost.valid ? `ghost-${ghostPlayer}` : 'ghost-invalid'})`}
            />
          )}
          {winningPath.length > 0 && (
            <path
              className="board-winning-path"
              d={cellsPath(winningPath)}
            />
          )}
        </svg>
        {board.flatMap((row, y) =>
          row.map((cell, x) => {
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
              />
            )
          }),
        )}
      </div>
    </div>
  )
}
