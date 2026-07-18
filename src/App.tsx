import { useEffect, useMemo, useReducer, useState } from 'react'
import './App.css'
import { Board } from './components/Board'
import { DropZone } from './components/DropZone'
import { GameOverPanel } from './components/GameOverPanel'
import { GameStatus } from './components/GameStatus'
import { PieceShape } from './components/PieceShape'
import { PieceTray } from './components/PieceTray'
import { RulesPanel } from './components/RulesPanel'
import { SetupPanel } from './components/SetupPanel'
import { FLIPPABLE_SHAPES } from './game/pieces'
import { getWinningPath } from './game/connectivity'
import { aimedColumn, calculateDrop } from './game/placement'
import { createInitialState, gameReducer } from './game/reducer'
import { getOrientation } from './game/transforms'
import { createGameStateFromSearch } from './game/queryState'
import { chooseMoveForDifficulty } from './game/minimax'
import { usePointerHasHover } from './components/usePointerHasHover'
import { BOARD_SIZE, PLAYER_IDS } from './game/types'
import type { Difficulty, GameMode, InvalidDropReason, PlayerId } from './game/types'

const DROP_MESSAGES: Record<InvalidDropReason, string> = {
  'horizontal-bounds': 'Cette orientation dépasse du plateau.',
  overflow: 'La colonne est bouchée : la pièce dépasse en haut.',
  unsupported: 'Pose impossible : un vide resterait sous la pièce.',
}

/** Laisse le temps d'afficher « réfléchit… » et de suivre le coup de l'ordi. */
const AI_THINKING_DELAY = 500
const AI_GLOW_DURATION = 2400

function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => {
    try {
      return createGameStateFromSearch(window.location.search) ?? createInitialState()
    } catch (error) {
      console.error('Impossible de charger la grille depuis l’URL.', error)
      return createInitialState()
    }
  })
  const [pointedColumn, setPointedColumn] = useState<number | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [glowPieceId, setGlowPieceId] = useState<string | null>(null)
  const pointerHasHover = usePointerHasHover()

  const startGame = (mode: GameMode, difficulty: Difficulty) =>
    dispatch({
      type: 'START_GAME',
      // Le tirage au sort remplace le choix manuel du premier joueur.
      firstPlayer: PLAYER_IDS[Math.floor(Math.random() * PLAYER_IDS.length)],
      mode,
      difficulty,
    })

  const aiTurn =
    state.phase === 'playing' && state.activePlayer === state.aiPlayer

  const orientation = state.selection
    ? getOrientation(
        state.selection.shapeId,
        state.selection.rotation,
        state.selection.flipped,
      )
    : null

  // La colonne pointée porte le centre de la pièce, et la pièce reste toujours
  // entièrement sur le plateau : c'est la position que le ghost montre et celle
  // que la pose utilise.
  const columnFor = (pointer: number) =>
    orientation ? aimedColumn(pointer, orientation.width) : null
  const dropColumn = pointedColumn === null ? null : columnFor(pointedColumn)
  const aiming = state.phase === 'playing' && Boolean(state.selection)

  const ghost = useMemo(
    () =>
      dropColumn !== null && orientation
        ? calculateDrop(state.board, orientation, dropColumn)
        : null,
    [dropColumn, orientation, state.board],
  )

  const winningPath = useMemo(
    () =>
      state.result?.reason === 'connection' && state.result.winner
        ? getWinningPath(state.board, state.result.winner)
        : [],
    [state.board, state.result],
  )

  useEffect(() => {
    setPointedColumn(null)
  }, [state.activePlayer, state.selection?.shapeId])

  // Tour de l'ordinateur : la recherche est synchrone et bloque brièvement le
  // rendu, d'où le délai qui laisse d'abord peindre le message d'attente.
  useEffect(() => {
    if (!aiTurn) return
    const timer = setTimeout(() => {
      const decision = chooseMoveForDifficulty(
        {
          board: state.board,
          inventories: state.inventories,
          activePlayer: state.activePlayer,
        },
        state.difficulty,
      )
      if (!decision) return
      const { shapeId, orientation, column } = decision.move
      dispatch({
        type: 'PLAY_AI_MOVE',
        shapeId,
        rotation: orientation.rotation,
        flipped: orientation.flipped,
        column,
      })
    }, AI_THINKING_DELAY)
    return () => clearTimeout(timer)
  }, [aiTurn, state.activePlayer, state.board, state.difficulty, state.inventories])

  // La pièce de l'ordinateur brille un moment : sans cela, le plateau change
  // tout seul et le joueur ne voit pas ce qui vient d'être posé.
  const aiPlacedPieceId =
    state.aiPlayer && state.lastPlacedPieceId?.startsWith(`${state.aiPlayer}-`)
      ? state.lastPlacedPieceId
      : null

  useEffect(() => {
    if (!aiPlacedPieceId) return
    setGlowPieceId(aiPlacedPieceId)
    const timer = setTimeout(() => setGlowPieceId(null), AI_GLOW_DURATION)
    return () => clearTimeout(timer)
  }, [aiPlacedPieceId])

  useEffect(() => {
    if (state.phase !== 'playing') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!state.selection) return
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select')) return
      const key = event.key.toLowerCase()

      // Sans flèches à l'écran, le clavier doit suffire : ← → visent une
      // colonne, ↑ ↓ tournent, Entrée pose.
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const step = event.key === 'ArrowLeft' ? -1 : 1
        setPointedColumn((column) => {
          const next = (column ?? Math.floor(BOARD_SIZE / 2)) + (column === null ? 0 : step)
          return Math.min(Math.max(next, 0), BOARD_SIZE - 1)
        })
        return
      }
      if ((event.key === 'Enter' || event.key === ' ') && dropColumn !== null) {
        event.preventDefault()
        dispatch({ type: 'DROP_SELECTED_SHAPE', column: dropColumn })
        return
      }
      if (key === 'r' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        dispatch({ type: 'ROTATE_SELECTION' })
      }
      if (key === 'f' && FLIPPABLE_SHAPES.includes(state.selection.shapeId)) {
        event.preventDefault()
        dispatch({ type: 'FLIP_SELECTION' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dropColumn, state.phase, state.selection])

  if (state.phase === 'setup') {
    return (
      <>
        <SetupPanel onStart={startGame} onShowRules={() => setRulesOpen(true)} />
        {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
      </>
    )
  }

  const ghostMessage = ghost
    ? ghost.valid
      ? null
      : DROP_MESSAGES[ghost.reason]
    : null
  const canFlip =
    state.selection && FLIPPABLE_SHAPES.includes(state.selection.shapeId)
  // La réserve du joueur actif est rendue en premier. En une seule colonne elle
  // se place donc juste sous le plateau et l'alternance des deux réserves
  // signale le changement de tour ; l'ordre du DOM reste celui qu'on lit à
  // l'écran. Sur bureau, `grid-column` les repose à gauche et à droite.
  const trayOrder: PlayerId[] =
    state.activePlayer === 'white' ? ['white', 'blue'] : ['blue', 'white']

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="mini-brand" type="button" onClick={() => dispatch({ type: 'RESET_GAME' })} aria-label="Revenir au début">
          <span aria-hidden="true">L×</span> LINKX
        </button>
        <div className="topbar-actions">
          <button type="button" className="text-button" onClick={() => setRulesOpen(true)}>Règles</button>
          <button type="button" className="secondary-button secondary-button--small" onClick={() => dispatch({ type: 'RESET_GAME' })}>Nouvelle partie</button>
        </div>
      </header>

      <div className="game-layout">
        <section className="play-area">
          <div className="play-banner">
            {state.phase === 'finished' && state.result ? (
              <GameOverPanel result={state.result} onReset={() => dispatch({ type: 'RESET_GAME' })} />
            ) : (
              <GameStatus
                activePlayer={state.activePlayer}
                event={state.lastEvent}
                ghostMessage={ghostMessage}
                thinking={aiTurn}
              />
            )}
          </div>

          <div className="selection-stage">
            {state.phase === 'playing' && state.selection && (
              <>
                {/* Raccourci de proximité : la pièce elle-même tourne au clic
                    et se retourne au clic droit, sans aller jusqu'aux boutons.
                    Ceux-ci restent la commande découvrable, et cet aperçu reste
                    masqué aux lecteurs d'écran pour ne pas les dupliquer. */}
                <div
                  className="selected-piece-preview"
                  aria-hidden="true"
                  onClick={() => dispatch({ type: 'ROTATE_SELECTION' })}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    if (canFlip) dispatch({ type: 'FLIP_SELECTION' })
                  }}
                >
                  <PieceShape
                    orientation={orientation!}
                    player={state.activePlayer}
                  />
                </div>
                <div className="selection-controls">
                  <button
                    type="button"
                    className="control-button"
                    aria-label="Tourner la pièce"
                    onClick={() => dispatch({ type: 'ROTATE_SELECTION' })}
                  >
                    <span aria-hidden="true">↻</span>
                  </button>
                  <button
                    type="button"
                    className="control-button"
                    aria-label="Retourner la pièce"
                    disabled={!canFlip}
                    onClick={() => dispatch({ type: 'FLIP_SELECTION' })}
                  >
                    <span aria-hidden="true">⇄</span>
                  </button>
                </div>
              </>
            )}
          </div>

          {aiming ? (
            <DropZone
              enabled
              hoveredColumn={pointedColumn}
              invalid={Boolean(ghost && !ghost.valid)}
              silent={pointerHasHover}
              onHover={setPointedColumn}
              onDrop={(column) => {
                const target = columnFor(column)
                if (target !== null) {
                  dispatch({ type: 'DROP_SELECTED_SHAPE', column: target })
                }
              }}
            />
          ) : (
            <div className="drop-zones-spacer" aria-hidden="true" />
          )}
          <Board
            board={state.board}
            ghost={state.phase === 'playing' ? ghost : null}
            ghostPlayer={state.activePlayer}
            winningPath={winningPath}
            glowPieceId={glowPieceId}
            aiming={aiming && pointerHasHover}
            onPointColumn={setPointedColumn}
            onDropColumn={(column) => {
              const target = columnFor(column)
              if (target !== null) {
                dispatch({ type: 'DROP_SELECTED_SHAPE', column: target })
              }
            }}
          />
        </section>

        {trayOrder.map((player) => (
          <PieceTray
            key={player}
            player={player}
            inventory={state.inventories[player]}
            playedCopies={state.playedCopies[player]}
            active={state.phase === 'playing' && state.activePlayer === player && !aiTurn}
            selection={state.activePlayer === player ? state.selection : null}
            onSelect={(shapeId, copy) => dispatch({ type: 'SELECT_SHAPE', player, shapeId, copy })}
          />
        ))}
      </div>

      {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
    </main>
  )
}

export default App
