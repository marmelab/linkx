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
    expect(markup).toContain('<feMorphology')
    expect(markup).toContain('filter="url(#board-outline-blue)"')
    expect(markup).not.toContain('board-cell--winning')
  })
})
