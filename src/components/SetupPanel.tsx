import type { PlayerId } from '../game/types'

type SetupPanelProps = {
  firstPlayer: PlayerId
  onChange: (player: PlayerId) => void
  onStart: () => void
  onShowRules: () => void
}

export function SetupPanel({
  firstPlayer,
  onChange,
  onStart,
  onShowRules,
}: SetupPanelProps) {
  return (
    <main className="setup-screen">
      <section className="setup-card">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="overline">Jeu de connexion · 2 joueurs</p>
        <h1 className="game-title">LINKX</h1>
        <p className="setup-intro">
          Faites tomber vos pièces et reliez deux bords opposés avant votre adversaire.
          Les diagonales comptent.
        </p>

        <fieldset className="first-player">
          <legend>Qui commence ?</legend>
          <p>Dans la règle physique, le plus jeune joueur commence.</p>
          <div className="player-choice">
            {(['blue', 'white'] as const).map((player) => (
              <button
                type="button"
                className={`choice-button choice-button--${player}${firstPlayer === player ? ' is-selected' : ''}`}
                aria-pressed={firstPlayer === player}
                onClick={() => onChange(player)}
                key={player}
              >
                <span className="choice-disc" aria-hidden="true" />
                {player === 'blue' ? 'Les bleus' : 'Les blancs'}
              </button>
            ))}
          </div>
        </fieldset>

        <button type="button" className="primary-button" onClick={onStart}>
          Commencer la partie <span aria-hidden="true">→</span>
        </button>
        <button type="button" className="text-button" onClick={onShowRules}>
          Lire les règles
        </button>
      </section>
    </main>
  )
}

