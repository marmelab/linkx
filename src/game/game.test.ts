import { describe, expect, it } from 'vitest'
import { getComponents, getLargestZone, hasWinningConnection } from './connectivity'
import { enumerateLegalMoves } from './legalMoves'
import { BASE_SHAPES, createInitialInventory, matrixToPoints } from './pieces'
import { calculateDrop, createEmptyBoard } from './placement'
import { createInitialState, gameReducer } from './reducer'
import { getOrientation, getUniqueOrientations, pointsKey } from './transforms'
import { SHAPE_IDS } from './types'
import type { Board, PlayerId, ShapeId } from './types'

function occupy(
  board: Board,
  points: readonly { x: number; y: number }[],
  player: PlayerId = 'blue',
  shapeId: ShapeId = 'mono',
) {
  for (const { x, y } of points) {
    board[y][x] = { player, shapeId, pieceId: `${player}-${x}-${y}` }
  }
}

describe('pièces et transformations', () => {
  it('contient exactement les sept formes et 42 cases par joueur', () => {
    expect(SHAPE_IDS).toHaveLength(7)
    expect(Object.keys(BASE_SHAPES)).toEqual([...SHAPE_IDS])
    expect(SHAPE_IDS.map((id) => matrixToPoints(BASE_SHAPES[id]).length)).toEqual([
      1, 2, 3, 3, 4, 4, 4,
    ])
    const inventory = createInitialInventory()
    expect(
      Object.values(inventory).reduce<number>((total, count) => total + count, 0),
    ).toBe(14)
    expect(
      SHAPE_IDS.reduce(
        (total, id) => total + matrixToPoints(BASE_SHAPES[id]).length * inventory[id],
        0,
      ),
    ).toBe(42)
  })

  it('génère toutes les orientations uniques normalisées', () => {
    const expected = [1, 2, 2, 4, 4, 4, 8]
    SHAPE_IDS.forEach((shapeId, index) => {
      const orientations = getUniqueOrientations(shapeId)
      expect(orientations).toHaveLength(expected[index])
      expect(new Set(orientations.map(({ cells }) => pointsKey(cells))).size).toBe(
        expected[index],
      )
      expect(
        orientations.every(({ cells }) => cells.every(({ x, y }) => x >= 0 && y >= 0)),
      ).toBe(true)
    })
  })
})

describe('chute et support', () => {
  it('fait tomber mono, domino et barre verticale au fond', () => {
    const board = createEmptyBoard()
    const mono = calculateDrop(board, getOrientation('mono', 0, false), 0)
    const domino = calculateDrop(board, getOrientation('domino', 0, false), 2)
    const barVertical = calculateDrop(board, getOrientation('bar3', 1, false), 5)
    expect(mono).toMatchObject({ valid: true, anchorY: 8 })
    expect(domino).toMatchObject({ valid: true, anchorY: 8 })
    expect(barVertical).toMatchObject({ valid: true, anchorY: 6 })
  })

  it('refuse un dépassement horizontal', () => {
    expect(
      calculateDrop(createEmptyBoard(), getOrientation('bar3', 0, false), 7),
    ).toMatchObject({ valid: false, reason: 'horizontal-bounds' })
  })

  it('refuse un dépassement par le haut dans une colonne bouchée', () => {
    const board = createEmptyBoard()
    occupy(board, Array.from({ length: 8 }, (_, y) => ({ x: 0, y: y + 1 })))
    expect(calculateDrop(board, getOrientation('domino', 1, false), 0)).toMatchObject({
      valid: false,
      reason: 'overflow',
    })
  })

  it('s’arrête au premier obstacle et refuse un pont au-dessus du vide', () => {
    const board = createEmptyBoard()
    occupy(board, [
      { x: 2, y: 8 },
      { x: 4, y: 8 },
    ])
    const drop = calculateDrop(board, getOrientation('bar3', 0, false), 2)
    expect(drop).toMatchObject({ valid: false, reason: 'unsupported' })
    if (!drop.valid) expect(drop.previewCells).toEqual([{ x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }])
  })

  it('refuse un T dont les bras surplombent le vide et accepte sa barre au fond', () => {
    expect(
      calculateDrop(createEmptyBoard(), getOrientation('t', 0, false), 2),
    ).toMatchObject({ valid: false, reason: 'unsupported' })
    expect(
      calculateDrop(createEmptyBoard(), getOrientation('t', 2, false), 2),
    ).toMatchObject({ valid: true })
  })

  it('accepte un surplomb lorsque chaque face inférieure est soutenue', () => {
    const board = createEmptyBoard()
    occupy(board, [
      { x: 2, y: 8 },
      { x: 4, y: 8 },
    ])
    expect(calculateDrop(board, getOrientation('t', 0, false), 2)).toMatchObject({
      valid: true,
      anchorY: 7,
    })
  })
})

describe('coups et reducer', () => {
  it('énumère des coups sur grille vide et ignore les formes épuisées', () => {
    const inventory = createInitialInventory()
    inventory.mono = 0
    const moves = enumerateLegalMoves(createEmptyBoard(), inventory)
    expect(moves.length).toBeGreaterThan(0)
    expect(moves.some(({ shapeId }) => shapeId === 'mono')).toBe(false)
  })

  it('une pose invalide ne consomme rien et ne change pas de joueur', () => {
    let state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      firstPlayer: 'blue',
    })
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'bar3' })
    const board = state.board
    const stateAfter = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 8 })
    expect(stateAfter.activePlayer).toBe('blue')
    expect(stateAfter.inventories.blue.bar3).toBe(2)
    expect(stateAfter.board).toBe(board)
    expect(stateAfter.lastEvent).toMatchObject({ type: 'invalid' })
  })

  it('pose une pièce, décrémente son stock et passe au joueur suivant', () => {
    let state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      firstPlayer: 'blue',
    })
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' })
    state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 4 })
    expect(state.board[8][4]?.player).toBe('blue')
    expect(state.inventories.blue.mono).toBe(1)
    expect(state.activePlayer).toBe('white')
    expect(state.selection).toBeNull()
    expect(state.consecutivePasses).toBe(0)
  })

  it('un second clic sur la sélection la tourne', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'domino' })
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'domino' })
    expect(state.selection?.rotation).toBe(1)
  })

  it('passe automatiquement un joueur sans coup', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    for (const shapeId of SHAPE_IDS) state.inventories.white[shapeId] = 0
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' })
    state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 4 })
    expect(state.phase).toBe('playing')
    expect(state.activePlayer).toBe('blue')
    expect(state.selection?.shapeId).toBe('mono')
    expect(state.consecutivePasses).toBe(1)
    expect(state.lastEvent).toEqual({ type: 'forced-pass', player: 'white' })
  })

  it('termine après deux absences de coup et compare les plus grandes zones', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    for (const player of ['blue', 'white'] as const) {
      for (const shapeId of SHAPE_IDS) state.inventories[player][shapeId] = 0
    }
    state.inventories.blue.mono = 1
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' })
    state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 4 })
    expect(state.phase).toBe('finished')
    expect(state.consecutivePasses).toBe(2)
    expect(state.result).toEqual({
      winner: 'blue',
      reason: 'stalemate',
      largestZones: { blue: 1, white: 0 },
    })
  })
})

describe('connexions', () => {
  it('détecte les connexions horizontales, verticales et diagonales', () => {
    const horizontal = createEmptyBoard()
    occupy(horizontal, Array.from({ length: 9 }, (_, x) => ({ x, y: 8 })))
    expect(hasWinningConnection(horizontal, 'blue')).toBe(true)

    const vertical = createEmptyBoard()
    occupy(vertical, Array.from({ length: 9 }, (_, y) => ({ x: 4, y })))
    expect(hasWinningConnection(vertical, 'blue')).toBe(true)

    const diagonal = createEmptyBoard()
    occupy(diagonal, Array.from({ length: 9 }, (_, value) => ({ x: value, y: value })))
    expect(hasWinningConnection(diagonal, 'blue')).toBe(true)
    expect(getComponents(diagonal, 'blue')).toHaveLength(1)
  })

  it('ne connecte pas deux zones séparées ou de couleurs adverses', () => {
    const board = createEmptyBoard()
    occupy(board, [
      { x: 0, y: 8 },
      { x: 1, y: 8 },
      { x: 3, y: 8 },
      { x: 4, y: 8 },
    ])
    occupy(board, [{ x: 2, y: 8 }], 'white')
    expect(hasWinningConnection(board, 'blue')).toBe(false)
    expect(getLargestZone(board, 'blue')).toBe(2)
  })

  it('le coup qui complète un chemin gagne immédiatement', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    occupy(state.board, Array.from({ length: 8 }, (_, x) => ({ x, y: 8 })))
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' })
    state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 8 })
    expect(state.phase).toBe('finished')
    expect(state.result).toEqual({ winner: 'blue', reason: 'connection' })
  })
})
