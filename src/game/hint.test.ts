import { describe, expect, it } from 'vitest'
import { boardFromText } from './boardText'
import { canOfferHint, chooseHint } from './hint'
import type { Hint } from './hint'
import { enumerateLegalMoves } from './legalMoves'
import type { LegalMove } from './legalMoves'
import { createInitialState, gameReducer } from './reducer'
import { simulateLegalMove } from './simulation'
import type { GamePosition } from './simulation'
import type { GameState, Inventory } from './types'

/**
 * Bleu tient les colonnes 0 à 6 de la ligne du bas et touche donc déjà le bord
 * gauche. Un domino couché en colonne 7 comble les deux dernières cases et
 * relie les deux bords : le conseil doit voir cette victoire immédiate.
 *
 * Les réserves restent minuscules dans tous les cas de ce fichier : le conseil
 * cherche à la profondeur la plus grande, et c'est le nombre de coups légaux qui
 * fait le temps de recherche.
 */
const BLUE_ONE_MOVE_FROM_WINNING = `
  .........
  .........
  .........
  .........
  .........
  .........
  .........
  .........
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

function winnablePosition(blue: Partial<Inventory> = { domino: 1 }): GamePosition {
  return {
    board: boardFromText(BLUE_ONE_MOVE_FROM_WINNING, {
      groupOrthogonalComponents: true,
    }),
    inventories: { blue: inventoryOf(blue), white: inventoryOf({ mono: 1 }) },
    activePlayer: 'blue',
  }
}

/** Le coup légal désigné par un conseil, ce qui vérifie aussi qu'il en est un. */
function legalMoveForHint(position: GamePosition, hint: Hint): LegalMove {
  const move = enumerateLegalMoves(
    position.board,
    position.inventories[position.activePlayer],
  ).find(
    (candidate) =>
      candidate.shapeId === hint.shapeId &&
      candidate.orientation.rotation === hint.rotation &&
      candidate.orientation.flipped === hint.flipped &&
      candidate.column === hint.column,
  )
  if (!move) throw new Error('Le conseil devrait désigner un coup légal.')
  return move
}

/**
 * Partie en cours avec une sélection déjà armée, posée sur la position
 * ci-dessus. C'est l'état complet que la demande de conseil ne doit pas toucher.
 */
function playingStateWithSelection(): GameState {
  const started = gameReducer(createInitialState(), {
    type: 'START_GAME',
    firstPlayer: 'blue',
    mode: 'human',
  })
  const selected = gameReducer(started, {
    type: 'SELECT_SHAPE',
    player: 'blue',
    shapeId: 'domino',
    copy: 0,
  })
  expect(selected.selection).not.toBeNull()

  return {
    ...selected,
    board: boardFromText(BLUE_ONE_MOVE_FROM_WINNING, {
      groupOrthogonalComponents: true,
    }),
    inventories: { blue: inventoryOf({ domino: 1 }), white: inventoryOf({ mono: 1 }) },
  }
}

describe('conseil au joueur au trait', () => {
  it('propose le coup qui gagne immédiatement', () => {
    const position = winnablePosition()
    const hint = chooseHint(position)
    expect(hint).not.toBeNull()
    if (!hint) return

    const move = legalMoveForHint(position, hint)
    // Les cases annoncées sont celles de la chute : l'interface peut les montrer
    // telles quelles, sans refaire le calcul d'atterrissage.
    expect(hint.cells).toEqual(move.cells)
    expect(simulateLegalMove(position, move).result).toEqual({
      winner: 'blue',
      reason: 'connection',
    })
  })

  it('ne modifie ni la grille, ni l’inventaire, ni le joueur actif, ni la sélection', () => {
    const state = playingStateWithSelection()
    const before = structuredClone(state)

    const hint = chooseHint({
      board: state.board,
      inventories: state.inventories,
      activePlayer: state.activePlayer,
    })
    expect(hint).not.toBeNull()

    // Un conseil ne passe par aucune action du reducer : rien de l'état de la
    // partie ne doit bouger, pas même la pièce déjà sélectionnée.
    expect(state).toEqual(before)
    expect(state.board).toEqual(before.board)
    expect(state.inventories).toEqual(before.inventories)
    expect(state.activePlayer).toBe(before.activePlayer)
    expect(state.selection).toEqual(before.selection)
  })

  it('rend le même conseil sur une même position', () => {
    const position = winnablePosition()
    expect(chooseHint(position)).toEqual(chooseHint(position))

    // Deux positions équivalentes construites séparément, donc sans mémoire
    // partagée : le conseil ne dépend que de ce qu'il reçoit.
    expect(chooseHint(winnablePosition())).toEqual(chooseHint(winnablePosition()))
  })

  it('ne propose qu’une forme encore en réserve', () => {
    // Le domino est épuisé : la seule forme disponible est la barre de trois.
    const position = winnablePosition({ bar3: 1 })
    expect(position.inventories.blue.domino).toBe(0)

    const hint = chooseHint(position)
    expect(hint).not.toBeNull()
    if (!hint) return

    expect(hint.shapeId).toBe('bar3')
    expect(position.inventories.blue[hint.shapeId]).toBeGreaterThan(0)
  })

  it('ne rend aucun conseil quand le joueur au trait n’a plus de coup', () => {
    const position = winnablePosition({})
    expect(chooseHint(position)).toBeNull()
  })

  it('n’est pas proposé pendant le tour de l’ordinateur', () => {
    const aiTurn = {
      phase: 'playing',
      activePlayer: 'white',
      aiPlayer: 'white',
    } as const
    expect(canOfferHint(aiTurn)).toBe(false)

    // Le même adversaire, mais c'est à l'humain de décider : le conseil revient.
    expect(canOfferHint({ ...aiTurn, activePlayer: 'blue' })).toBe(true)
    // Partie à deux joueurs : les deux couleurs sont tenues par des humains.
    expect(
      canOfferHint({ phase: 'playing', activePlayer: 'white', aiPlayer: null }),
    ).toBe(true)
    // Hors d'une partie en cours, il n'y a plus rien à conseiller.
    expect(canOfferHint({ ...aiTurn, activePlayer: 'blue', phase: 'finished' })).toBe(
      false,
    )
    expect(canOfferHint({ ...aiTurn, activePlayer: 'blue', phase: 'setup' })).toBe(
      false,
    )
  })
})
