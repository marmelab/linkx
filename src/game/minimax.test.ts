import { describe, expect, it } from 'vitest'
import { boardFromText } from './boardText'
import { enumerateLegalMoves } from './legalMoves'
import {
  DIFFICULTY_DEPTHS,
  TERMINAL_SCORE,
  WIDE_POSITION_MOVES,
  chooseMinimaxMove,
  chooseMoveForDifficulty,
  classifyTranspositionBound,
  getAffordableDepth,
  positionKey,
} from './minimax'
import { createInitialInventory } from './pieces'
import { createGamePosition, simulateLegalMove } from './simulation'
import type { GamePosition } from './simulation'
import { DIFFICULTY_IDS, SHAPE_IDS } from './types'
import type {
  GameResult,
  Inventory,
  PlayerId,
  Rotation,
  ShapeId,
} from './types'

const STATISTICAL_GAME_COUNT = 20
const MINIMUM_WIN_RATE = 0.8

/**
 * Bleu tient les colonnes 0 à 6 de la ligne du bas : deux monos supplémentaires
 * le relient au bord droit. Blanc n'a aucune connexion possible, mais sa zone de
 * neuf cases lui donne la victoire en cas de blocage total.
 */
const TWO_MONOS_FROM_WINNING = `
  .........
  .........
  .........
  .........
  .........
  ...WWW...
  ...WWW...
  ...WWW...
  BBBBBBB..
`

function inventoryOf(counts: Partial<Inventory>): Inventory {
  return {
    mono: 0,
    domino: 0,
    bar3: 0,
    smallL: 0,
    s: 0,
    t: 0,
    largeL: 0,
    ...counts,
  }
}

/** Position ci-dessus, blanc sans réserve : bleu enchaîne autant qu'il le peut. */
function positionWithBlueMonos(count: 1 | 2): GamePosition {
  return {
    board: boardFromText(TWO_MONOS_FROM_WINNING, {
      groupOrthogonalComponents: true,
    }),
    inventories: {
      blue: inventoryOf({ mono: count }),
      white: inventoryOf({}),
    },
    activePlayer: 'blue',
  }
}

function randomForSeed(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

function playAgainstRandom(seed: number, aiPlayer: PlayerId): GameResult {
  const random = randomForSeed(seed)
  let position = createGamePosition('blue')

  for (let turn = 0; turn < 40; turn += 1) {
    const move = position.activePlayer === aiPlayer
      ? chooseMinimaxMove(position, { depth: 2 })?.move
      : (() => {
          const moves = enumerateLegalMoves(
            position.board,
            position.inventories[position.activePlayer],
          )
          return moves[Math.floor(random() * moves.length)]
        })()
    if (!move) throw new Error('Le joueur actif devrait disposer d’un coup légal.')

    const transition = simulateLegalMove(position, move)
    if (transition.result) return transition.result
    position = transition.position
  }

  throw new Error('La partie simulée dépasse le nombre maximal de pièces.')
}

function playMove(
  position: GamePosition,
  shapeId: ShapeId,
  rotation: Rotation,
  column: number,
): GamePosition {
  const move = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  ).find(
    (candidate) =>
      candidate.shapeId === shapeId &&
      candidate.orientation.rotation === rotation &&
      !candidate.orientation.flipped &&
      candidate.column === column,
  )
  if (!move) throw new Error('Le coup de préparation devrait être légal.')
  const transition = simulateLegalMove(position, move)
  if (transition.result) throw new Error('La préparation ne doit pas terminer la partie.')
  return transition.position
}

describe('Minimax', () => {
  it('refuse une profondeur invalide', () => {
    expect(() => chooseMinimaxMove(createGamePosition(), { depth: 0 })).toThrow(
      /profondeur Minimax/,
    )
  })

  it('joue immédiatement un coup gagnant', () => {
    let position = createGamePosition('blue')
    position = playMove(position, 'bar3', 0, 0)
    position = playMove(position, 'domino', 1, 0)
    position = playMove(position, 'bar3', 0, 3)
    position = playMove(position, 'domino', 1, 1)
    position = playMove(position, 'domino', 0, 6)
    position = playMove(position, 'mono', 0, 2)

    const decision = chooseMinimaxMove(position, { depth: 2 })
    expect(decision).not.toBeNull()
    if (!decision) return

    expect(simulateLegalMove(position, decision.move).result).toEqual({
      winner: 'blue',
      reason: 'connection',
    })
  })

  it('bloque la connexion immédiate de l’adversaire', () => {
    // Les bleus occupent les colonnes 0 à 7 de la ligne du bas : ils gagnent en
    // atteignant le bord droit par la colonne 8. C'est aux blancs (l'ordi) de jouer.
    const position = createGamePosition('white')
    for (let x = 0; x < 8; x += 1) {
      position.board[8][x] = { player: 'blue', shapeId: 'mono', pieceId: `blue-${x}` }
    }

    const blueThreatens = enumerateLegalMoves(
      position.board,
      position.inventories.blue,
    ).some(
      (move) =>
        simulateLegalMove({ ...position, activePlayer: 'blue' }, move).result?.winner ===
        'blue',
    )
    expect(blueThreatens).toBe(true)

    const decision = chooseMinimaxMove(position, { depth: 2 })
    expect(decision).not.toBeNull()
    if (!decision) return

    const afterAi = simulateLegalMove(position, decision.move)
    const blueStillWins = enumerateLegalMoves(
      afterAi.position.board,
      afterAi.position.inventories.blue,
    ).some(
      (move) => simulateLegalMove(afterAi.position, move).result?.winner === 'blue',
    )
    expect(blueStillWins).toBe(false)
  })

  it('choisit un coup déterministe pour une même position', () => {
    let position = createGamePosition('blue')
    position = playMove(position, 'bar3', 0, 0)
    position = playMove(position, 'domino', 1, 0)
    const first = chooseMinimaxMove(position, { depth: 2 })
    const second = chooseMinimaxMove(position, { depth: 2 })
    expect(second?.move).toEqual(first?.move)
  })

  it('conclut une simulation par un match nul à zones égales', () => {
    const position = createGamePosition('blue')
    position.board[8][0] = { player: 'blue', shapeId: 'mono', pieceId: 'b0' }
    position.board[8][1] = { player: 'blue', shapeId: 'mono', pieceId: 'b1' }
    position.board[8][7] = { player: 'white', shapeId: 'mono', pieceId: 'w7' }
    position.board[8][8] = { player: 'white', shapeId: 'mono', pieceId: 'w8' }
    for (const player of ['blue', 'white'] as const) {
      for (const shapeId of SHAPE_IDS) position.inventories[player][shapeId] = 0
    }
    position.inventories.blue.mono = 1

    const move = enumerateLegalMoves(position.board, position.inventories.blue).find(
      (candidate) => candidate.shapeId === 'mono' && candidate.column === 4,
    )
    expect(move).toBeDefined()
    if (!move) return

    expect(simulateLegalMove(position, move).result).toEqual({
      winner: null,
      reason: 'draw',
      largestZones: { blue: 2, white: 2 },
    })
  })

  it('simule une passe forcée et un blocage total', () => {
    const forcedPass = createGamePosition('blue')
    for (const shapeId of SHAPE_IDS) forcedPass.inventories.white[shapeId] = 0
    const firstMove = enumerateLegalMoves(
      forcedPass.board,
      forcedPass.inventories.blue,
    )[0]
    const passed = simulateLegalMove(forcedPass, firstMove)
    expect(passed.result).toBeNull()
    expect(passed.position.activePlayer).toBe('blue')

    const stalemate = createGamePosition('blue')
    for (const player of ['blue', 'white'] as const) {
      for (const shapeId of SHAPE_IDS) stalemate.inventories[player][shapeId] = 0
    }
    stalemate.inventories.blue.mono = 1
    const lastMove = enumerateLegalMoves(
      stalemate.board,
      stalemate.inventories.blue,
    )[0]

    expect(simulateLegalMove(stalemate, lastMove).result).toEqual({
      winner: 'blue',
      reason: 'stalemate',
      largestZones: { blue: 1, white: 0 },
    })
  })

  it('ne rejoue pas le dernier exemplaire d’une forme déjà consommée', () => {
    // Avec deux monos, bleu relie le bord droit en deux poses consécutives.
    const winnable = chooseMinimaxMove(positionWithBlueMonos(2), { depth: 2 })
    expect(winnable?.score).toBeGreaterThanOrEqual(TERMINAL_SCORE)

    // Avec un seul mono, la même ligne n'existe plus : après sa pose, bleu n'a
    // plus rien à jouer et perd le blocage total au nombre de cases connectées.
    // Un inventaire mal propagé rejouerait le mono et croirait gagner.
    const decision = chooseMinimaxMove(positionWithBlueMonos(1), { depth: 2 })
    expect(decision?.score).toBeLessThanOrEqual(-TERMINAL_SCORE)
  })

  it('énumère les réponses adverses avec la réserve de l’adversaire', () => {
    // Bleu tient les colonnes 0 à 5 du bas : seule sa barre 3, posée en colonne
    // 6, atteint le bord droit. L'ordinateur n'a plus de barre 3 : s'il évaluait
    // les réponses de bleu avec sa propre réserve, il ne verrait pas la menace.
    const position: GamePosition = {
      board: boardFromText(
        `
          .........
          .........
          .........
          .........
          .........
          .........
          .........
          .........
          BBBBBB...
        `,
        { groupOrthogonalComponents: true },
      ),
      inventories: {
        blue: inventoryOf({ mono: 1, bar3: 1 }),
        white: inventoryOf({ mono: 2 }),
      },
      activePlayer: 'white',
    }
    expect(position.inventories.white.bar3).toBe(0)

    const decision = chooseMinimaxMove(position, { depth: 2 })
    expect(decision).not.toBeNull()
    if (!decision) return

    const afterAi = simulateLegalMove(position, decision.move)
    const blueStillWins = enumerateLegalMoves(
      afterAi.position.board,
      afterAi.position.inventories.blue,
    ).some(
      (move) => simulateLegalMove(afterAi.position, move).result?.winner === 'blue',
    )
    expect(blueStillWins).toBe(false)
  })

  it('traite un adversaire sans coup légal comme une passe et enchaîne', () => {
    const position = positionWithBlueMonos(2)
    const decision = chooseMinimaxMove(position, { depth: 2 })
    expect(decision).not.toBeNull()
    if (!decision) return

    // La victoire n'est trouvée que si la recherche rend la main à bleu au lieu
    // de traiter le blanc bloqué comme une impasse ou comme une défaite.
    const afterFirst = simulateLegalMove(position, decision.move)
    expect(afterFirst.result).toBeNull()
    expect(afterFirst.position.activePlayer).toBe('blue')

    const second = chooseMinimaxMove(afterFirst.position, { depth: 1 })
    expect(second).not.toBeNull()
    if (!second) return
    expect(simulateLegalMove(afterFirst.position, second.move).result).toEqual({
      winner: 'blue',
      reason: 'connection',
    })
  })

  it('distingue deux réserves et deux joueurs au trait sur un même plateau', () => {
    const board = boardFromText(TWO_MONOS_FROM_WINNING)
    const inventories = {
      blue: createInitialInventory(),
      white: createInitialInventory(),
    }
    const key = (changed: Partial<GamePosition> = {}, depth = 2) =>
      positionKey({ board, inventories, activePlayer: 'blue', ...changed }, depth)
    const spend = (player: PlayerId, counts: Partial<Inventory>) => ({
      ...inventories,
      [player]: { ...inventories[player], ...counts },
    })
    const reference = key()

    expect(key({ inventories: structuredClone(inventories) })).toBe(reference)
    // Deux monos ou un domino laissent le même plateau : seules les réserves les
    // séparent, sans quoi la table de transposition confondrait les deux nœuds.
    expect(key({ inventories: spend('blue', { mono: 0 }) })).not.toBe(reference)
    expect(key({ inventories: spend('blue', { domino: 1 }) })).not.toBe(reference)
    expect(key({ inventories: spend('white', { largeL: 1 }) })).not.toBe(reference)
    expect(key({ activePlayer: 'white' })).not.toBe(reference)
    expect(key({}, 3)).not.toBe(reference)
  })

  it('classe une borne par rapport à la fenêtre réellement explorée', () => {
    const low = Number.NEGATIVE_INFINITY
    const high = Number.POSITIVE_INFINITY

    // Fenêtre reçue du parent, sans entrée en cache : le score est exact.
    expect(classifyTranspositionBound(45, low, high)).toBe('exact')

    // Même score, mais une entrée « borne basse 50 » a resserré alpha avant la
    // boucle : la recherche n'a alors prouvé que « la valeur vaut au plus 45 ».
    // Classer ce score avec la fenêtre du parent l'enregistrerait comme exact,
    // or une entrée exacte est relue sans regarder la fenêtre de l'appelant.
    expect(classifyTranspositionBound(45, 50, high)).toBe('upper')

    // Symétrique : une entrée « borne haute » resserre bêta avant la boucle.
    expect(classifyTranspositionBound(70, low, 60)).toBe('lower')

    // Une valeur strictement à l'intérieur de la fenêtre resserrée reste exacte.
    expect(classifyTranspositionBound(55, 50, 60)).toBe('exact')
  })

  it('associe à chaque niveau une profondeur strictement croissante', () => {
    const depths = DIFFICULTY_IDS.map((difficulty) => DIFFICULTY_DEPTHS[difficulty])
    expect(depths.every((depth) => Number.isInteger(depth) && depth >= 1)).toBe(true)
    expect(depths).toEqual([...depths].sort((left, right) => left - right))
    expect(new Set(depths).size).toBe(depths.length)
  })

  it('abaisse la profondeur du niveau expert sur une position trop large', () => {
    // Une grille vide offre 95 coups légaux : à profondeur 3, la recherche
    // demande une quinzaine de secondes et figerait l'écran.
    expect(getAffordableDepth('hard', WIDE_POSITION_MOVES + 1)).toBe(2)
    expect(getAffordableDepth('hard', WIDE_POSITION_MOVES)).toBe(DIFFICULTY_DEPTHS.hard)
    // Les niveaux plus tendres tiennent déjà le budget : ils ne sont jamais
    // relevés ni abaissés.
    expect(getAffordableDepth('easy', WIDE_POSITION_MOVES + 50)).toBe(1)
    expect(getAffordableDepth('standard', WIDE_POSITION_MOVES + 50)).toBe(2)
    expect(getAffordableDepth('standard', 1)).toBe(2)
  })

  it('joue le coup du niveau demandé pour le joueur au trait', () => {
    const position = positionWithBlueMonos(2)
    const decision = chooseMoveForDifficulty(position, 'standard')
    const moveCount = enumerateLegalMoves(
      position.board,
      position.inventories[position.activePlayer],
    ).length

    expect(decision?.move).toEqual(
      chooseMinimaxMove(position, {
        depth: getAffordableDepth('standard', moveCount),
      })?.move,
    )
    // Le niveau débutant n'examine que sa propre pose : il voit la victoire
    // immédiate, mais rien au-delà.
    expect(chooseMoveForDifficulty(position, 'easy')?.move).toBeDefined()
  })

  it(
    'gagne statistiquement contre un joueur aléatoire en jouant premier ou second',
    () => {
      let wins = 0
      let losses = 0

      for (let game = 0; game < STATISTICAL_GAME_COUNT; game += 1) {
        const aiPlayer = game % 2 === 0 ? 'blue' : 'white'
        const result = playAgainstRandom(10_000 + game, aiPlayer)
        if (result.winner === aiPlayer) wins += 1
        else if (result.winner !== null) losses += 1
      }

      expect(wins / STATISTICAL_GAME_COUNT).toBeGreaterThanOrEqual(MINIMUM_WIN_RATE)
      expect(wins).toBeGreaterThan(losses)
    },
    30_000,
  )
})
