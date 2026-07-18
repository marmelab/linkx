import { useEffect, useRef } from 'react'
import type { GameResult, PlayerId } from '../game/types'

type GameOverPanelProps = {
  result: GameResult
  onReset: () => void
}

const NAMES: Record<PlayerId, string> = { blue: 'bleus', white: 'blancs' }

export function GameOverPanel({ result, onReset }: GameOverPanelProps) {
  // Le panneau remplace la barre de statut : sans déplacer le focus, le clavier
  // retomberait sur <body> quand les commandes de pose disparaissent, et le
  // résultat ne serait pas lu.
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  const title = result.winner
    ? `Victoire des ${NAMES[result.winner]} !`
    : 'Match nul'
  const explanation =
    result.reason === 'connection'
      ? 'Une zone continue relie deux bords opposés.'
      : result.reason === 'stalemate'
        ? 'Plus aucun coup légal. La plus grande zone l’emporte.'
        : 'Plus aucun coup légal et les plus grandes zones sont à égalité.'

  return (
    <section className={`game-over-panel game-over-panel--${result.winner ?? 'draw'}`} aria-labelledby="game-over-title" aria-live="assertive">
      <span className="winner-medal" aria-hidden="true">✦</span>
      <div className="game-over-copy">
        <h2 id="game-over-title" tabIndex={-1} ref={titleRef}>{title}</h2>
        <p>{explanation}</p>
      </div>
      {result.largestZones && (
        <div className="score-grid" aria-label="Scores des plus grandes zones">
          <span>Bleus <strong>{result.largestZones.blue}</strong></span>
          <span>Blancs <strong>{result.largestZones.white}</strong></span>
        </div>
      )}
      <button type="button" className="primary-button" onClick={onReset}>
        Rejouer
      </button>
    </section>
  )
}
