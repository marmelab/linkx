import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createEmptyBoard } from '../game/placement'
import { Board } from './Board'

describe('surlignage du chemin gagnant', () => {
  it('superpose un contour SVG sans remplacer le remplissage bleu', () => {
    const board = createEmptyBoard()
    const winningPath = Array.from({ length: 9 }, (_, x) => ({ x, y: 8 }))
    for (const { x, y } of winningPath) {
      board[y][x] = {
        player: 'blue',
        pieceId: `blue-${x}`,
        shapeId: 'mono',
      }
    }

    const markup = renderToStaticMarkup(
      <Board
        board={board}
        ghost={null}
        ghostPlayer="blue"
        winningPath={winningPath}
      />,
    )

    expect(markup).toContain('board-piece--blue')
    expect(markup).toContain('board-winning-path')
    expect(markup).not.toContain('board-cell--winning')
    // Le surlignage reste le stroke de la silhouette fusionnée. La matière
    // plexiglas des pièces passe bien par un filtre, mais le chemin gagnant ne
    // doit en porter aucun : il ne peindrait plus par-dessus sans les teinter.
    const highlight = markup.match(/<path[^>]*board-winning-path[^>]*>/)?.[0]
    expect(highlight).toBeDefined()
    expect(highlight).not.toContain('filter')
  })
})
