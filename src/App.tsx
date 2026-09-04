import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import './App.css'
import { Board } from './components/Board'
import { DropZone } from './components/DropZone'
import { GameOverPanel } from './components/GameOverPanel'
import { GameStatus } from './components/GameStatus'
import { PieceTray } from './components/PieceTray'
import { PlaybackBar } from './components/PlaybackBar'
import { RulesPanel } from './components/RulesPanel'
import { SelectedPiecePreview } from './components/SelectedPiecePreview'
import { SetupPanel } from './components/SetupPanel'
import { SharePositionButton } from './components/SharePositionButton'
import { FLIPPABLE_SHAPES } from './game/pieces'
import { getWinningPath } from './game/connectivity'
import { aimedColumn, calculateDrop } from './game/placement'
import { createInitialState, firstAvailableCopy, gameReducer } from './game/reducer'
import { canOfferHint, chooseHint } from './game/hint'
import type { Hint } from './game/hint'
import { getOrientation } from './game/transforms'
import { createGameStateFromSearch, loadedGameState } from './game/queryState'
import {
  extendPlayback,
  isReplaying,
  lastRank,
  playbackState,
  seekPlayback,
  startPlayback,
  stepPlayback,
} from './components/playback'
import type { Playback } from './components/playback'
import { useAiMove } from './components/useAiMove'
import { usePointerHasHover } from './components/usePointerHasHover'
import { BOARD_SIZE, PLAYER_IDS } from './game/types'
import type {
  Difficulty,
  GameMode,
  GameState,
  InvalidDropReason,
  PlayerId,
} from './game/types'

const DROP_MESSAGES: Record<InvalidDropReason, string> = {
  'horizontal-bounds': 'Cette orientation dépasse du plateau.',
  overflow: 'La colonne est bouchée : la pièce dépasse en haut.',
  unsupported: 'Pose impossible : un vide resterait sous la pièce.',
}

/** Laisse le temps d'afficher « réfléchit… » et de suivre le coup de l'ordi. */
const AI_THINKING_DELAY = 500
const AI_GLOW_DURATION = 2400
/**
 * La recherche du conseil est synchrone : ce délai n'existe que pour laisser le
 * navigateur peindre l'état d'attente avant de lui rendre la main. Il reste bien
 * plus court que celui de l'ordinateur, qui sert lui à cadencer la partie.
 */
const HINT_THINKING_DELAY = 90

function App() {
  const [loaded] = useState(() => {
    try {
      return createGameStateFromSearch(window.location.search)
    } catch (error) {
      console.error('Impossible de charger la grille depuis l’URL.', error)
      return null
    }
  })
  const [state, dispatch] = useReducer(gameReducer, loaded, (game) =>
    game ? loadedGameState(game) : createInitialState(),
  )
  // La barre de lecture n'existe **que** pour une partie venue d'une notation,
  // et elle existe alors dès le premier rendu : sa hauteur est acquise au
  // chargement, elle ne se montre ni ne se cache en cours de partie.
  const [playback, setPlayback] = useState<Playback | null>(() =>
    loaded?.source === 'moves' ? startPlayback(loaded.states) : null,
  )
  // La partie lue se poursuit au dernier coup : un coup joué allonge la suite et
  // laisse le curseur à la fin. Une nouvelle partie, elle, sort de la lecture.
  //
  // Ajusté **pendant le rendu**, et non par un effet : `fallingPieceId` vient de
  // `playback.falling`, qui doit donc porter la pièce dès le premier rendu qui la
  // montre. Reporté à un effet, il valait encore `null` au commit du coup — la
  // pièce se peignait à sa place d'arrivée avant de tomber, si bien qu'une partie
  // ouverte par `?moves=` puis poursuivie n'avait pas la chute des autres. React
  // reprend le rendu aussitôt, sans rien peindre entre les deux.
  const [seenState, setSeenState] = useState(state)
  if (state !== seenState) {
    setSeenState(state)
    setPlayback((current) => (current ? extendPlayback(current, state) : null))
  }
  const { request: requestAiMove, cancel: cancelAiMove } = useAiMove()
  const [pointedColumn, setPointedColumn] = useState<number | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [glowPieceId, setGlowPieceId] = useState<string | null>(null)
  // Le conseil est rattaché à l'état exact pour lequel il a été demandé, jamais
  // à un drapeau que le temps pourrait désynchroniser. Toute action produit un
  // nouvel état : la demande en cours et le conseil affiché cessent alors de
  // correspondre et disparaissent d'eux-mêmes, sans qu'aucun effet n'ait à
  // courir après. Une action refusée, elle, renvoie l'état inchangé et laisse
  // donc le conseil en place — c'est bien ce qu'on veut, rien ne s'est passé.
  const [hintRequest, setHintRequest] = useState<GameState | null>(null)
  const [hintResult, setHintResult] = useState<{
    state: GameState
    hint: Hint | null
  } | null>(null)
  const pointerHasHover = usePointerHasHover()
  // La bande de visée a besoin des bords du plateau : un geste maintenu y garde
  // sa cible, et c'est en sortant de cette surface qu'on renonce à poser.
  const boardFrame = useRef<HTMLDivElement>(null)
  const hintPending = hintRequest === state
  // Hors du dernier coup, le plateau est en lecture seule : `view` est la
  // position lue, sans pièce en main, et `state` reste la partie vivante — celle
  // qui se poursuivra dès le retour à la fin. Les deux ne font qu'un au dernier
  // rang, si bien que tout le rendu peut lire `view` sans rien changer au jeu.
  const replaying = playback !== null && isReplaying(playback)
  const hasPlayback = playback !== null
  const view = useMemo(
    () => (playback ? playbackState(playback, state) : state),
    [playback, state],
  )
  const hint = !replaying && hintResult?.state === state ? hintResult.hint : null

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
  const hintAvailable = !replaying && canOfferHint(state)

  const orientation = view.selection
    ? getOrientation(
        view.selection.shapeId,
        view.selection.rotation,
        view.selection.flipped,
      )
    : null

  // La colonne pointée porte le centre de la pièce, et la pièce reste toujours
  // entièrement sur le plateau : c'est la position que le ghost montre et celle
  // que la pose utilise.
  const columnFor = (pointer: number) =>
    orientation ? aimedColumn(pointer, orientation.width) : null
  const dropColumn = pointedColumn === null ? null : columnFor(pointedColumn)
  const aiming = view.phase === 'playing' && Boolean(view.selection)

  const ghost = useMemo(
    () =>
      dropColumn !== null && orientation
        ? calculateDrop(view.board, orientation, dropColumn)
        : null,
    [dropColumn, orientation, view.board],
  )

  const winningPath = useMemo(
    () =>
      view.result?.reason === 'connection' && view.result.winner
        ? getWinningPath(view.board, view.result.winner)
        : [],
    [view.board, view.result],
  )

  useEffect(() => {
    setPointedColumn(null)
  }, [view.activePlayer, view.selection?.shapeId])

  // Tour de l'ordinateur. La recherche part dans un worker quand le navigateur
  // en offre un (voir `useAiMove`), sinon elle reste synchrone et bloque
  // brièvement le rendu — d'où le délai, qui laisse d'abord peindre le message
  // d'attente. Le nettoyage annule la recherche : si le joueur agit entre-temps,
  // l'état a changé et la réponse ne le concerne plus.
  useEffect(() => {
    if (!aiTurn) return
    let cancelled = false
    const timer = setTimeout(() => {
      void requestAiMove(
        {
          board: state.board,
          inventories: state.inventories,
          activePlayer: state.activePlayer,
        },
        state.difficulty,
      ).then((move) => {
        if (cancelled || !move) return
        dispatch({ type: 'PLAY_AI_MOVE', ...move })
      })
    }, AI_THINKING_DELAY)
    return () => {
      cancelled = true
      clearTimeout(timer)
      cancelAiMove()
    }
  }, [
    aiTurn,
    cancelAiMove,
    requestAiMove,
    state.activePlayer,
    state.board,
    state.difficulty,
    state.inventories,
  ])

  // Même contrainte que le tour de l'ordinateur : la recherche est synchrone et
  // bloque brièvement le rendu, d'où le délai qui laisse d'abord peindre l'état
  // d'attente. Le plafond adaptatif de la recherche borne le pire cas.
  //
  // Si le joueur agit pendant la recherche, l'état change, la demande cesse de
  // le désigner et le nettoyage annule le calcul avant qu'il ne parte.
  useEffect(() => {
    if (hintRequest !== state) return
    const timer = setTimeout(() => {
      setHintResult({
        state,
        hint: chooseHint({
          board: state.board,
          inventories: state.inventories,
          activePlayer: state.activePlayer,
        }),
      })
      setHintRequest(null)
    }, HINT_THINKING_DELAY)
    return () => clearTimeout(timer)
  }, [hintRequest, state])

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

  // Les flèches pilotent le curseur **dès qu'aucune pièce n'est en main**, et
  // non pendant la seule lecture : au chargement d'un `?moves=` le curseur est à
  // la fin et rien n'est sélectionné, si bien qu'une condition sur la lecture
  // rendait ← inerte tant qu'on n'avait pas cliqué ◀ à la souris — la touche
  // n'ouvrait jamais ce qu'elle était censée parcourir. La visée de colonne
  // garde la priorité quand une pièce est en main : les deux ne se disputent
  // donc jamais la touche.
  useEffect(() => {
    if (!hasPlayback || aiming) return
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, select')) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setPlayback((current) => current && seekPlayback(current, current.cursor - 1))
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        setPlayback((current) => current && stepPlayback(current))
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasPlayback, aiming])

  useEffect(() => {
    if (view.phase !== 'playing') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!view.selection) return
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
        // La flèche de colonne pose déjà par son propre clic : poser ici en plus
        // jouerait deux pièces d'un seul appui quand la sélection est conservée.
        // Le garde ne vise qu'elle : ailleurs — sur la pièce de réserve qui
        // garde le focus après sa sélection, par exemple — Entrée doit poser.
        if (target.closest('.drop-zone')) return
        event.preventDefault()
        dispatch({ type: 'DROP_SELECTED_SHAPE', column: dropColumn })
        return
      }
      if (key === 'r' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        dispatch({ type: 'ROTATE_SELECTION' })
      }
      if (key === 'f' && FLIPPABLE_SHAPES.includes(view.selection.shapeId)) {
        event.preventDefault()
        dispatch({ type: 'FLIP_SELECTION' })
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dropColumn, view.phase, view.selection])

  if (view.phase === 'setup') {
    return (
      <>
        <SetupPanel onStart={startGame} onShowRules={() => setRulesOpen(true)} />
        {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
      </>
    )
  }

  // Le refus n'est pas peint : l'aperçu rouge le dit déjà. Il reste **annoncé**,
  // une couleur n'existant pas pour qui ne voit pas l'écran.
  const ghostRefusal = ghost
    ? ghost.valid
      ? null
      : DROP_MESSAGES[ghost.reason]
    : null
  const canFlip =
    view.selection && FLIPPABLE_SHAPES.includes(view.selection.shapeId)
  // La réserve du joueur actif est rendue en premier. En une seule colonne elle
  // se place donc juste sous le plateau et l'alternance des deux réserves
  // signale le changement de tour ; l'ordre du DOM reste celui qu'on lit à
  // l'écran. Sur bureau, `grid-column` les repose à gauche et à droite.
  const trayOrder: PlayerId[] =
    view.activePlayer === 'white' ? ['white', 'blue'] : ['blue', 'white']
  // La réserve met en évidence l'exemplaire qui sera effectivement consommé,
  // celui-là même que la pose choisirait pour la forme conseillée.
  const hintCopy = hint
    ? firstAvailableCopy(state, state.activePlayer, hint.shapeId)
    : null
  const trayHint =
    hint && hintCopy !== null ? { shapeId: hint.shapeId, copy: hintCopy } : null

  return (
    <main className="game-shell">
      <header className="topbar">
        <button className="mini-brand" type="button" onClick={() => dispatch({ type: 'RESET_GAME' })} aria-label="Revenir au début">
          <span aria-hidden="true">L×</span> LINKX
        </button>
        <div className="topbar-actions">
          <button type="button" className="text-button" onClick={() => setRulesOpen(true)}>Règles</button>
          <SharePositionButton state={state} />
          <button type="button" className="secondary-button secondary-button--small" onClick={() => dispatch({ type: 'RESET_GAME' })}>Nouvelle partie</button>
        </div>
      </header>

      <div className="game-layout">
        <section className="play-area">
          {/* Au-dessus de la bande réservée à la pièce en main, jamais en
              dessous : le bord haut du plateau ne doit pas bouger d'un pixel
              quand le curseur se déplace. */}
          {playback && (
            <PlaybackBar
              entries={playback.states[lastRank(playback)].history}
              cursor={playback.cursor}
              onSeek={(cursor) =>
                setPlayback((current) => current && seekPlayback(current, cursor))
              }
              onStep={() => setPlayback((current) => current && stepPlayback(current))}
            />
          )}
          {/* Bandeau et aperçu de sélection sont empilés au bureau et côte à
              côte en une colonne : ce conteneur laisse la mise en page choisir
              sans changer l'ordre, qui reste celui du geste — la pièce en main
              se montre au-dessus du plateau, du côté par lequel elle tombe. */}
          <div className="play-head">
            <div className="play-banner">
              {view.phase === 'finished' && view.result ? (
                <GameOverPanel result={view.result} onReset={() => dispatch({ type: 'RESET_GAME' })} />
              ) : (
                <GameStatus
                  activePlayer={view.activePlayer}
                  event={view.lastEvent}
                  ghostRefusal={ghostRefusal}
                  thinking={aiTurn}
                  hintPending={hintPending}
                />
              )}
            </div>

            <div className="selection-stage">
              {/* La commande s'efface tant que son conseil est peint : le
                  surlignage tient alors lieu de réponse, et le bouton revient de
                  lui-même à l'action suivante, qui efface ce surlignage. Elle ne
                  dépend pas de la sélection : c'est justement sans pièce en main
                  qu'on ne sait pas laquelle prendre. */}
              {hintAvailable && !hint && (
                <button
                  type="button"
                  className="control-button control-button--hint"
                  aria-label="Conseil"
                  title="Conseil"
                  disabled={hintPending}
                  onClick={() => setHintRequest(state)}
                >
                  <span aria-hidden="true">💡</span>
                </button>
              )}
              {view.phase === 'playing' && view.selection && (
                <>
                  {/* Raccourci de proximité : la pièce elle-même tourne au clic
                      et se retourne au clic droit, sans aller jusqu'aux boutons.
                      Ceux-ci restent la commande découvrable. */}
                  <SelectedPiecePreview
                    selection={view.selection}
                    orientation={orientation!}
                    player={view.activePlayer}
                    onRotate={() => dispatch({ type: 'ROTATE_SELECTION' })}
                    onFlip={() => {
                      if (canFlip) dispatch({ type: 'FLIP_SELECTION' })
                    }}
                  />
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
          </div>

          {aiming ? (
            <DropZone
              enabled
              silent={pointerHasHover}
              surface={boardFrame}
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
          {/* En lecture, seul le pas en avant fait tomber une pièce : tout autre
              déplacement du curseur substitue la position. */}
          <Board
            ref={boardFrame}
            board={view.board}
            ghost={view.phase === 'playing' ? ghost : null}
            ghostPlayer={view.activePlayer}
            winningPath={winningPath}
            celebrate={view.phase === 'finished' && Boolean(view.result?.winner)}
            hintCells={hint?.cells ?? []}
            glowPieceId={glowPieceId}
            fallingPieceId={playback ? playback.falling : state.lastPlacedPieceId}
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
            inventory={view.inventories[player]}
            playedCopies={view.playedCopies[player]}
            active={view.phase === 'playing' && view.activePlayer === player && !aiTurn && !replaying}
            selection={view.activePlayer === player ? view.selection : null}
            hint={view.activePlayer === player ? trayHint : null}
            onSelect={(shapeId, copy) => dispatch({ type: 'SELECT_SHAPE', player, shapeId, copy })}
          />
        ))}
      </div>

      {rulesOpen && <RulesPanel onClose={() => setRulesOpen(false)} />}
    </main>
  )
}

export default App
