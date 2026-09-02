import type { Ref } from 'react'
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
  /**
   * Pièce qui vient d'être posée, et qui tombe donc depuis le haut du plateau.
   * Une seule à la fois : les pièces déjà en place ne rejouent pas leur chute
   * quand le plateau se rend à nouveau, ni au chargement d'une position.
   */
  fallingPieceId?: string | null
  /** Visée au pointeur : la colonne survolée porte la pièce, le clic la pose. */
  aiming?: boolean
  /**
   * Cadre du plateau. Il prolonge vers le bas la surface de visée de la bande
   * d'entrée, qui a besoin de ses bords pour savoir si un geste maintenu se
   * termine sur le jeu ou en dehors.
   */
  ref?: Ref<HTMLDivElement>
  onPointColumn?: (column: number | null) => void
  onDropColumn?: (column: number) => void
}

/**
 * Découpe du calque des pièces, en cases au-dessus de la première ligne. Le
 * calque déborde par ailleurs librement — les ombres portées des pièces de bord
 * ont besoin de ce dépassement — mais une pièce qui tombe doit disparaître au
 * bord haut du plateau plutôt que par-dessus son cadre. La valeur vaut à peu
 * près le retrait intérieur du plateau : le biseau des pièces de la première
 * ligne y tient encore, et rien ne franchit la bordure sombre.
 */
const FALL_CLIP_TOP = -0.06

/**
 * Hauteur à ajouter à la chute pour que la pièce parte entièrement hors du
 * calque découpé, ombre portée comprise.
 */
const FALL_CLEARANCE = 0.35

type RenderedPiece = {
  id: string
  player: PlayerId
  cells: Point[]
}

/**
 * Temps que met une pièce à tomber d'une case, en millisecondes. Fixe la
 * gravité, donc la vivacité de toutes les chutes d'un seul réglage.
 */
const FALL_MS_PER_ROOT_CELL = 138

/**
 * Restitution de l'impact : le rebond s'élève à cette fraction de la hauteur
 * tombée. Une pièce lâchée d'une case ne rebondit donc pratiquement pas, une
 * pièce tombée de tout le plateau frappe et repart visiblement.
 */
const FALL_RESTITUTION = 0.012

/**
 * Départ, durée et rebond de la chute d'une pièce dont le bas repose sur
 * `bottom`.
 *
 * Les longueurs sont en **cases** : `.board-piece` est un élément SVG, où une
 * longueur de `transform` s'exprime dans l'espace utilisateur local, ici une
 * case et non un pixel d'écran. La chute garde ainsi la même ampleur relative
 * du plateau de bureau à celui du téléphone.
 *
 * La durée suit la **racine** de la hauteur et rien d'autre, parce que c'est ce
 * que dit `h = ½gt²` : toutes les pièces tombent alors avec la même
 * accélération, quelle que soit la ligne où elles s'arrêtent. Y ajouter une
 * constante — un temps de départ, une durée plancher — reviendrait à donner une
 * gravité plus faible aux pièces qui atterrissent haut, et c'est très visible :
 * elles flottent au lieu de tomber. Le rebond garde une part fixe de la durée,
 * ce qui est cohérent : il dure lui aussi la racine de sa propre hauteur, elle
 * même proportionnelle à la hauteur tombée.
 */
function fallStyle(bottom: number): React.CSSProperties {
  const height = bottom + FALL_CLEARANCE
  return {
    '--fall-from': `${-height}px`,
    '--fall-duration': `${Math.round(FALL_MS_PER_ROOT_CELL * Math.sqrt(height))}ms`,
    '--fall-bounce': `${(-FALL_RESTITUTION * height).toFixed(3)}px`,
  } as React.CSSProperties
}

function boardPieces(
  board: BoardType,
): (RenderedPiece & { outline: string; bottom: number })[] {
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
    bottom: Math.max(...piece.cells.map(({ y }) => y)) + 1,
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
  fallingPieceId = null,
  aiming = false,
  ref,
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
    <div className="board-frame" ref={ref}>
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
          {/* La chute part au-dessus de la première ligne : sans découpe, la
              pièce se peindrait par-dessus la bordure du plateau et le cadre,
              que ce calque déborde volontiers pour laisser passer les ombres. */}
          <defs>
            <clipPath id="board-fall-clip" clipPathUnits="userSpaceOnUse">
              <rect
                x={-BOARD_SIZE}
                y={FALL_CLIP_TOP}
                width={BOARD_SIZE * 3}
                height={BOARD_SIZE * 3}
              />
            </clipPath>
          </defs>
          <g clipPath="url(#board-fall-clip)">
            {pieces.map((piece) => (
              <path
                className={`board-piece board-piece--${piece.player}${piece.id === glowPieceId ? ' board-piece--glowing' : ''}${piece.id === fallingPieceId ? ' board-piece--falling' : ''}`}
                style={piece.id === fallingPieceId ? fallStyle(piece.bottom) : undefined}
                d={piece.outline}
                key={piece.id}
              />
            ))}
            {/* Les reflets viennent après toutes les dalles, jamais entrelacés :
                l'ombre portée d'une pièce doit tomber sur la matière de sa
                voisine, pas sur la lumière qui la nappe. */}
            {pieces.map((piece) => (
              <path
                className={`board-piece-sheen${piece.id === fallingPieceId ? ' board-piece-sheen--falling' : ''}`}
                style={piece.id === fallingPieceId ? fallStyle(piece.bottom) : undefined}
                d={piece.outline}
                key={`sheen-${piece.id}`}
              />
            ))}
          </g>
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
