import { BOARD_SIZE } from '../game/types'
import type { Board as BoardType, DropResult, PlayerId, Point } from '../game/types'
import { Fireworks } from './Fireworks'
import { getCellsOutlinePath } from './pieceGeometry'
import { getWinningTrail } from './winningTrail'
import { PlexiDefs } from './PlexiDefs'

type BoardProps = {
  board: BoardType
  ghost: DropResult | null
  ghostPlayer: PlayerId
  winningPath?: Point[]
  /** Lance le feu d'artifice de fin, une seule fois, à l'annonce du vainqueur. */
  celebrate?: boolean
  /**
   * Cases visées par le conseil, le temps que le joueur les repère. Calque et
   * classes distincts du chemin gagnant : les deux n'ont ni le même sens ni le
   * même moment, et ne doivent pas se partager un rendu.
   */
  hintCells?: Point[]
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

function boardPieces(board: BoardType): (RenderedPiece & { outline: string })[] {
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
  // Le contour sert deux fois — la dalle teintée et le reflet qui la nappe — et
  // reste tracé une seule fois : les deux couches ne peuvent pas se désaligner.
  return [...pieces.values()].map((piece) => ({
    ...piece,
    outline: getCellsOutlinePath(piece.cells),
  }))
}

export function Board({
  board,
  ghost,
  ghostPlayer,
  winningPath = [],
  celebrate = false,
  hintCells = [],
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
  const ghostOutline = getCellsOutlinePath(ghostPoints)
  const pieces = boardPieces(board)
  const trail = getWinningTrail(winningPath)

  return (
    <div className="board-frame">
      {/* Les `url(#…)` de matière portent sur tout le document : ce jeu unique
          sert aussi la réserve et l'aperçu central, qui ont leur propre `<svg>`. */}
      <PlexiDefs />
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
              d={piece.outline}
              key={piece.id}
            />
          ))}
          {/* Les reflets viennent après toutes les dalles, jamais entrelacés :
              l'ombre portée d'une pièce doit tomber sur la matière de sa voisine,
              pas sur la lumière qui la nappe. */}
          {pieces.map((piece) => (
            <path
              className="board-piece-sheen"
              d={piece.outline}
              key={`sheen-${piece.id}`}
            />
          ))}
          {/* Le conseil désigne des cases encore vides : il se pose au-dessus des
              dalles, sans matière ni reflet, et disparaît dès que le joueur agit.
              Il ne peut pas coexister avec le ghost, qui suppose une sélection. */}
          {hintCells.length > 0 && (
            <path className="board-hint" d={getCellsOutlinePath(hintCells)} />
          )}
          {ghost && (
            <>
              <path
                className={`board-piece board-piece--ghost-${ghostPlayer}${ghost.valid ? '' : ' board-piece--ghost-invalid'}`}
                d={ghostOutline}
              />
              <path
                className="board-piece-sheen board-piece-sheen--ghost"
                d={ghostOutline}
              />
            </>
          )}
          {/* La connexion est tracée comme un trajet d'un bord à l'autre, pas
              comme un pavage des cases : le liseré sombre passe devant les
              dalles blanches, le cœur doré devant les bleues, et les deux se
              dessinent d'un même geste grâce à `pathLength`, qui normalise la
              longueur du tracé quels que soient ses détours. */}
          {trail && (
            <g className={`board-trail board-trail--${trail.axis}`}>
              <path className="board-trail__halo" d={trail.d} pathLength={100} />
              <path className="board-trail__line" d={trail.d} pathLength={100} />
            </g>
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
      {/* Posé dans le cadre, donc découpé par lui : la célébration ne peut pas
          déborder sur le panneau de fin, qui reste au-dessus du plateau. */}
      {celebrate && <Fireworks />}
    </div>
  )
}
