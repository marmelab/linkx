import { describe, expect, it } from 'vitest'
import { boardFromText, boardToText, rowsFromBoardText } from './boardText'

const EMPTY_ROWS = [
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
  '.........',
]

describe('représentation textuelle d’une grille', () => {
  it('accepte les mêmes lignes B/W/. que les tests d’évaluation', () => {
    const rows = [...EMPTY_ROWS]
    rows[7] = '.BB...W..'
    const source = rows.join('\n')

    expect(boardToText(boardFromText(source))).toBe(source)
  })

  it('accepte des lignes séparées par des slashs dans une query string', () => {
    const rows = [...EMPTY_ROWS]
    rows[8] = 'BBB...WWW'

    expect(rowsFromBoardText(rows.join('/'))).toEqual(rows)
  })

  it('accepte aussi une chaîne compacte de 81 caractères', () => {
    const rows = [...EMPTY_ROWS]
    rows[4] = '....B....'

    expect(rowsFromBoardText(rows.join(''))).toEqual(rows)
  })

  it('regroupe les voisins orthogonaux de même couleur pour le rendu', () => {
    const rows = [...EMPTY_ROWS]
    rows[7] = '.BB......'
    rows[8] = '.B.......'
    const board = boardFromText(rows.join('/'), {
      groupOrthogonalComponents: true,
    })

    expect(board[7][1]?.pieceId).toBe(board[7][2]?.pieceId)
    expect(board[7][1]?.pieceId).toBe(board[8][1]?.pieceId)
  })

  it('refuse les dimensions et symboles invalides', () => {
    expect(() => rowsFromBoardText('.........')).toThrow(/9 × 9/)
    expect(() =>
      rowsFromBoardText([...EMPTY_ROWS.slice(0, 8), '....X....'].join('/')),
    ).toThrow(/Symbole/)
  })
})
