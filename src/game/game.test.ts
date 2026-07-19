import { describe, expect, it } from 'vitest'
import {
  getComponents,
  getLargestZone,
  getWinningPath,
  hasWinningConnection,
} from './connectivity'
import { enumerateLegalMoves } from './legalMoves'
import { BASE_SHAPES, createInitialInventory, matrixToPoints } from './pieces'
import { aimedColumn, calculateDrop, createEmptyBoard } from './placement'
import { createInitialState, gameReducer } from './reducer'
import { getOrientation, getUniqueOrientations, pointsKey } from './transforms'
import { DEFAULT_DIFFICULTY, SHAPE_IDS } from './types'
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

  it('centre la pièce visée sur la colonne pointée', () => {
    // Barre 3 visée en colonne 4 : elle couvre 3, 4 et 5.
    expect(aimedColumn(4, 3)).toBe(3)
    // Mono : la colonne pointée est exactement la colonne occupée.
    expect(aimedColumn(4, 1)).toBe(4)
    // Largeur paire : le centre penche à gauche, sans ambiguïté.
    expect(aimedColumn(4, 2)).toBe(4)
  })

  it('retient la pièce visée contre les bords du plateau', () => {
    expect(aimedColumn(0, 3)).toBe(0)
    expect(aimedColumn(8, 3)).toBe(6)
    expect(aimedColumn(8, 1)).toBe(8)
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

  it('sélectionne chaque forme dans la même orientation que sa réserve', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 's' })
    expect(state.selection?.rotation).toBe(1)
  })

  it('permet de choisir séparément les deux exemplaires d’une forme', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    state = gameReducer(state, {
      type: 'SELECT_SHAPE',
      player: 'blue',
      shapeId: 'domino',
      copy: 0,
    })
    state = gameReducer(state, {
      type: 'SELECT_SHAPE',
      player: 'blue',
      shapeId: 'domino',
      copy: 1,
    })
    expect(state.selection).toMatchObject({ shapeId: 'domino', copy: 1, rotation: 0 })
  })

  it('marque comme joué l’exemplaire réellement sélectionné', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    state = gameReducer(state, {
      type: 'SELECT_SHAPE',
      player: 'blue',
      shapeId: 'mono',
      copy: 1,
    })
    state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 4 })
    expect(state.playedCopies.blue.mono).toEqual([false, true])
    expect(state.inventories.blue.mono).toBe(1)
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

  it('conclut par un match nul quand les plus grandes zones sont à égalité', () => {
    let state = gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })
    for (const player of ['blue', 'white'] as const) {
      for (const shapeId of SHAPE_IDS) state.inventories[player][shapeId] = 0
    }
    occupy(state.board, [{ x: 0, y: 8 }, { x: 1, y: 8 }], 'blue')
    occupy(state.board, [{ x: 7, y: 8 }, { x: 8, y: 8 }], 'white')
    state.inventories.blue.mono = 1
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' })
    // La case isolée en (4, 8) laisse la plus grande zone bleue à 2, comme la blanche.
    state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 4 })
    expect(state.phase).toBe('finished')
    expect(state.result).toEqual({
      winner: null,
      reason: 'draw',
      largestZones: { blue: 2, white: 2 },
    })
  })
})

describe('gardes du reducer', () => {
  const started = () =>
    gameReducer(createInitialState(), { type: 'START_GAME', firstPlayer: 'blue' })

  it('ignore une sélection hors phase de jeu', () => {
    const setup = createInitialState()
    expect(
      gameReducer(setup, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' }),
    ).toBe(setup)
  })

  it('ignore la sélection du joueur inactif', () => {
    const state = started()
    expect(
      gameReducer(state, { type: 'SELECT_SHAPE', player: 'white', shapeId: 'mono' }),
    ).toBe(state)
  })

  it('ignore la sélection d’une forme épuisée', () => {
    const state = started()
    state.inventories.blue.mono = 0
    expect(
      gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' }),
    ).toBe(state)
  })

  it('ignore la sélection d’un exemplaire déjà joué', () => {
    const state = started()
    state.playedCopies.blue.mono = [true, false]
    expect(
      gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono', copy: 0 }),
    ).toBe(state)
  })

  it('retourne la sélection et l’ignore sans sélection', () => {
    let state = started()
    expect(gameReducer(state, { type: 'FLIP_SELECTION' })).toBe(state)
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 's' })
    const flipped = gameReducer(state, { type: 'FLIP_SELECTION' })
    expect(flipped.selection?.flipped).toBe(true)
  })

  // Le joueur retourne ce qu'il voit, pas la forme de base : depuis une rotation
  // impaire, garder la rotation telle quelle renverrait une tout autre pièce.
  it('retourne l’orientation affichée, quelle que soit la rotation', () => {
    let state = started()
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'largeL' })
    for (let turn = 0; turn < 4; turn += 1) {
      const before = state.selection!
      const shown = getOrientation(before.shapeId, before.rotation, before.flipped)
      const after = gameReducer(state, { type: 'FLIP_SELECTION' }).selection!
      expect(pointsKey(getOrientation(after.shapeId, after.rotation, after.flipped).cells)).toBe(
        pointsKey(shown.cells.map(({ x, y }) => ({ x: -x, y }))),
      )
      state = gameReducer(state, { type: 'ROTATE_SELECTION' })
    }
  })

  it('ignore une rotation sans sélection', () => {
    const state = started()
    expect(gameReducer(state, { type: 'ROTATE_SELECTION' })).toBe(state)
  })

  it('ignore une pose sans sélection', () => {
    const state = started()
    expect(gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 4 })).toBe(state)
  })

  it('ignore un coup de l’ordinateur dont les exemplaires sont épuisés', () => {
    let state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      firstPlayer: 'white',
      mode: 'ai',
    })
    state.playedCopies.white.mono = [true, true]
    expect(
      gameReducer(state, {
        type: 'PLAY_AI_MOVE',
        shapeId: 'mono',
        rotation: 0,
        flipped: false,
        column: 3,
      }),
    ).toBe(state)
  })

  it('réinitialise entièrement la partie', () => {
    let state = started()
    state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' })
    state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 4 })
    expect(gameReducer(state, { type: 'RESET_GAME' })).toEqual(createInitialState())
  })
})

describe('partie contre l’ordinateur', () => {
  const startAi = (firstPlayer: PlayerId = 'white') =>
    gameReducer(createInitialState(), {
      type: 'START_GAME',
      firstPlayer,
      mode: 'ai',
    })

  it('confie les blancs à l’ordinateur', () => {
    const state = startAi()
    expect(state.mode).toBe('ai')
    expect(state.aiPlayer).toBe('white')
  })

  it('reste en mode deux joueurs par défaut', () => {
    const state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      firstPlayer: 'blue',
    })
    expect(state.mode).toBe('human')
    expect(state.aiPlayer).toBeNull()
  })

  it('retient le niveau choisi au lancement de la partie', () => {
    const state = gameReducer(createInitialState(), {
      type: 'START_GAME',
      firstPlayer: 'white',
      mode: 'ai',
      difficulty: 'hard',
    })
    expect(state.difficulty).toBe('hard')

    // Sans choix explicite, la partie démarre au niveau par défaut, et une
    // nouvelle partie repart de ce même niveau.
    expect(startAi().difficulty).toBe(DEFAULT_DIFFICULTY)
    expect(gameReducer(state, { type: 'RESET_GAME' }).difficulty).toBe(DEFAULT_DIFFICULTY)
  })

  it('pose la pièce de l’ordinateur, consomme un exemplaire et rend la main', () => {
    let state = startAi()
    state = gameReducer(state, {
      type: 'PLAY_AI_MOVE',
      shapeId: 'mono',
      rotation: 0,
      flipped: false,
      column: 3,
    })
    expect(state.board[8][3]?.player).toBe('white')
    expect(state.inventories.white.mono).toBe(1)
    expect(state.playedCopies.white.mono).toEqual([true, false])
    expect(state.activePlayer).toBe('blue')
    // La sélection ne survit pas au coup de l'ordi : elle est propre au joueur.
    expect(state.selection).toBeNull()
    expect(state.lastPlacedPieceId).toBe('white-1')
  })

  it('consomme le second exemplaire au coup suivant', () => {
    let state = startAi()
    for (const column of [3, 5]) {
      state = gameReducer(state, {
        type: 'PLAY_AI_MOVE',
        shapeId: 'mono',
        rotation: 0,
        flipped: false,
        column,
      })
      state = gameReducer(state, { type: 'SELECT_SHAPE', player: 'blue', shapeId: 'mono' })
      state = gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 0 })
    }
    expect(state.inventories.white.mono).toBe(0)
    expect(state.playedCopies.white.mono).toEqual([true, true])
  })

  it('ignore un coup de l’ordinateur hors de son tour', () => {
    const state = startAi('blue')
    expect(
      gameReducer(state, {
        type: 'PLAY_AI_MOVE',
        shapeId: 'mono',
        rotation: 0,
        flipped: false,
        column: 3,
      }),
    ).toBe(state)
  })

  it('ignore une pose manuelle pendant le tour de l’ordinateur', () => {
    let state = startAi()
    state = { ...state, selection: { shapeId: 'mono', copy: 0, rotation: 0, flipped: false } }
    expect(gameReducer(state, { type: 'DROP_SELECTED_SHAPE', column: 3 })).toBe(state)
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
    expect(getWinningPath(diagonal, 'blue')).toEqual(
      Array.from({ length: 9 }, (_, value) => ({ x: value, y: value })),
    )
  })

  it('reconstruit un chemin gagnant vertical du haut vers le bas', () => {
    const board = createEmptyBoard()
    occupy(board, Array.from({ length: 9 }, (_, y) => ({ x: 4, y })))
    const path = getWinningPath(board, 'blue')
    expect(path).toHaveLength(9)
    expect(path[0]).toEqual({ x: 4, y: 0 })
    expect(path[path.length - 1]).toEqual({ x: 4, y: 8 })
    expect(path.every(({ x }) => x === 4)).toBe(true)
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
