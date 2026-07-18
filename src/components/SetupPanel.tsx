import { useState } from 'react'
import { DEFAULT_DIFFICULTY } from '../game/types'
import type { Difficulty, GameMode } from '../game/types'

type SetupPanelProps = {
  onStart: (mode: GameMode, difficulty: Difficulty) => void
  onShowRules: () => void
}

const MODES: { id: GameMode; label: string; hint: string; icon: string }[] = [
  {
    id: 'human',
    label: 'À deux joueurs',
    hint: 'Chacun son tour sur le même écran.',
    icon: '👥',
  },
  {
    id: 'ai',
    label: 'Contre l’ordinateur',
    hint: 'Vous jouez les bleus, l’ordinateur les blancs.',
    icon: '🤖',
  },
]

const DIFFICULTIES: { id: Difficulty; label: string }[] = [
  { id: 'easy', label: 'Débutant' },
  { id: 'standard', label: 'Confirmé' },
  { id: 'hard', label: 'Expert' },
]

export function SetupPanel({ onStart, onShowRules }: SetupPanelProps) {
  const [difficulty, setDifficulty] = useState<Difficulty>(DEFAULT_DIFFICULTY)

  return (
    <main className="setup-screen">
      <section className="setup-card">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="overline">Jeu de connexion</p>
        <h1 className="game-title">LINKX</h1>
        <p className="setup-intro">
          Faites tomber vos pièces et reliez deux bords opposés avant votre adversaire.
          Les diagonales comptent.
        </p>

        <div className="mode-choice">
          {MODES.map((mode) => (
            <button
              type="button"
              className={`mode-button mode-button--${mode.id}`}
              onClick={() => onStart(mode.id, difficulty)}
              key={mode.id}
            >
              <span className="mode-icon" aria-hidden="true">
                {mode.icon}
              </span>
              <span className="mode-text">
                <strong>{mode.label}</strong>
                <small>{mode.hint}</small>
              </span>
              <span className="mode-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>

        {/* Le niveau n'est lu qu'au lancement d'une partie contre l'ordinateur :
            le choix reste donc à côté des deux modes, sans écran intermédiaire. */}
        <p className="setup-note">
          <label htmlFor="difficulty">Niveau de l’ordinateur : </label>
          <select
            id="difficulty"
            value={difficulty}
            onChange={(event) => setDifficulty(event.target.value as Difficulty)}
            // Le rendu natif de la liste est minuscule à côté du reste de la
            // carte : ces deux valeurs lui rendent une cible tactile utilisable.
            style={{ padding: '0.3rem 0.35rem', fontSize: '0.95rem' }}
          >
            {DIFFICULTIES.map((level) => (
              <option value={level.id} key={level.id}>
                {level.label}
              </option>
            ))}
          </select>
        </p>

        <p className="setup-note">La couleur qui commence est tirée au sort.</p>

        <button type="button" className="text-button" onClick={onShowRules}>
          Lire les règles
        </button>
      </section>
    </main>
  )
}
