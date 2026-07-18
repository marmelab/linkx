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
import { calculateDrop } from './game/placement'
import { createInitialState, gameReducer } from './game/reducer'
import { getOrientation } from './game/transforms'
import type { InvalidDropReason, PlayerId } from './game/types'

const DROP_MESSAGES: Record<InvalidDropReason, string> = {
  'horizontal-bounds': 'Cette orientation dépasse du plateau.',
  overflow: 'La colonne est bouchée : la pièce dépasse en haut.',
  unsupported: 'Pose impossible : un vide resterait sous la pièce.',
}

function App() {
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState)
  const [firstPlayer, setFirstPlayer] = useState<PlayerId>('blue')
  const [hoveredColumn, setHoveredColumn] = useState<number | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)

  const orientation = state.selection
    ? getOrientation(
        state.selection.shapeId,
        state.selection.rotation,
        state.selection.flipped,
      )
    : null

  const ghost = useMemo(
    () =>
      hoveredColumn !== null && orientation
        ? calculateDrop(state.board, orientation, hoveredColumn)
        : null,
    [hoveredColumn, orientation, state.board],
  )

  useEffect(() => {
    setHoveredColumn(null)
  }, [state.activePlayer, state.selection?.shapeId])

  useEffect(() => {
    if (state.phase !== 'playing') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!state.selection) return
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select')) return
      if (event.key.toLowerCase() === 'r' || event.key.startsWith('Arrow')) {
        event.preventDefault()
        dispatch({ type: 'ROTATE_SELECTION' })
      }
      if (
        event.key.toLowerCase() === 'f' &&
        FLIPPABLE_SHAPES.includes(state.selection.shapeId)
      ) {
        event.preventDefault()
        dispatch({ type: 'FLIP_SELECTION' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [state.phase, state.selection])

  if (state.phase === 'setup') {
    return (
      <>
        <SetupPanel
          firstPlayer={firstPlayer}
          onChange={setFirstPlayer}
          onStart={() => dispatch({ type: 'START_GAME', firstPlayer })}
          onShowRules={() => setRulesOpen(true)}
        />
        {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
      </>
    )
  }

  const ghostMessage = ghost
    ? ghost.valid
      ? `Pose possible en colonne ${hoveredColumn! + 1}. Cliquez pour jouer.`
      : DROP_MESSAGES[ghost.reason]
    : null
  const canFlip =
    state.selection && FLIPPABLE_SHAPES.includes(state.selection.shapeId)

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
        <PieceTray
          player="blue"
          inventory={state.inventories.blue}
          active={state.phase === 'playing' && state.activePlayer === 'blue'}
          selection={state.activePlayer === 'blue' ? state.selection : null}
          onSelect={(shapeId) => dispatch({ type: 'SELECT_SHAPE', player: 'blue', shapeId })}
        />

        <section className="play-area">
          <GameStatus
            activePlayer={state.activePlayer}
            selection={state.selection}
            event={state.lastEvent}
            ghostMessage={ghostMessage}
          />

          <div className="selection-controls">
            {state.selection && orientation ? (
              <>
                <span className="selected-piece-card">
                  <PieceShape orientation={orientation} player={state.activePlayer} compact />
                </span>
                <button type="button" className="control-button" onClick={() => dispatch({ type: 'ROTATE_SELECTION' })}>
                  <span aria-hidden="true">↻</span> Tourner <kbd>R</kbd>
                </button>
                <button
                  type="button"
                  className="control-button"
                  disabled={!canFlip}
                  onClick={() => dispatch({ type: 'FLIP_SELECTION' })}
                >
                  <span aria-hidden="true">⇄</span> Retourner <kbd>F</kbd>
                </button>
              </>
            ) : (
              <span className="selection-placeholder">Sélectionnez une forme pour afficher les entrées</span>
            )}
          </div>

          <DropZone
            enabled={state.phase === 'playing' && Boolean(state.selection)}
            hoveredColumn={hoveredColumn}
            invalid={Boolean(ghost && !ghost.valid)}
            onHover={setHoveredColumn}
            onDrop={(column) => dispatch({ type: 'DROP_SELECTED_SHAPE', column })}
          />
          <Board board={state.board} ghost={ghost} ghostPlayer={state.activePlayer} />
          <p className="board-caption"><span aria-hidden="true">✦</span> Reliez gauche–droite ou haut–bas. Les diagonales comptent.</p>
        </section>

        <PieceTray
          player="white"
          inventory={state.inventories.white}
          active={state.phase === 'playing' && state.activePlayer === 'white'}
          selection={state.activePlayer === 'white' ? state.selection : null}
          onSelect={(shapeId) => dispatch({ type: 'SELECT_SHAPE', player: 'white', shapeId })}
        />
      </div>

      {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
      {state.phase === 'finished' && state.result && (
        <GameOverPanel result={state.result} onReset={() => dispatch({ type: 'RESET_GAME' })} />
      )}
    </main>
  )
}

export default App
