import type { GameResult, PlayerId } from '../game/types'

type GameOverPanelProps = {
  result: GameResult
  onReset: () => void
}

const NAMES: Record<PlayerId, string> = { blue: 'bleus', white: 'blancs' }

export function GameOverPanel({ result, onReset }: GameOverPanelProps) {
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
    <div className="modal-backdrop" role="presentation">
      <section className="game-over-panel" role="dialog" aria-modal="true" aria-labelledby="game-over-title">
        <span className={`winner-medal winner-medal--${result.winner ?? 'draw'}`} aria-hidden="true">✦</span>
        <p className="overline">Partie terminée</p>
        <h2 id="game-over-title">{title}</h2>
        <p>{explanation}</p>
        {result.largestZones && (
          <div className="score-grid">
            <span>Bleus <strong>{result.largestZones.blue}</strong></span>
            <span>Blancs <strong>{result.largestZones.white}</strong></span>
          </div>
        )}
        <button type="button" className="primary-button" onClick={onReset} autoFocus>
          Nouvelle partie
        </button>
      </section>
    </div>
  )
}

