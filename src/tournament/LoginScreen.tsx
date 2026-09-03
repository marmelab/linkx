import { useState } from 'react'
import type { FormEvent } from 'react'
import { Navigate } from 'react-router'
import { sendMagicLink } from './api'
import { useSession } from './session'
import { TOURNAMENT_PATHS } from './routes'

type Sending = 'idle' | 'sending' | 'sent' | 'failed'

/**
 * Connexion par lien à usage unique. **Aucun mot de passe**, nulle part : ni
 * champ, ni gestionnaire, ni réinitialisation (plan.md, histoires 14 et 16).
 * Une adresse inconnue et une adresse déjà inscrite rendent la même phrase —
 * l'écran ne dit jamais qui est inscrit.
 */
export function LoginScreen() {
  const { session, ready } = useSession()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Sending>('idle')
  const [error, setError] = useState<string | null>(null)

  if (ready && session) return <Navigate to={TOURNAMENT_PATHS.bots} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (status === 'sending') return
    setStatus('sending')
    setError(null)
    try {
      await sendMagicLink(email.trim())
      setStatus('sent')
    } catch (cause) {
      setStatus('failed')
      setError(cause instanceof Error ? cause.message : 'Envoi impossible.')
    }
  }

  return (
    <>
      <h1 className="tournament-title">Se connecter</h1>
      <p className="tournament-lede">
        Donnez votre adresse électronique : un lien de connexion vous y attend.
        Il n’y a pas de mot de passe à choisir, ni à retenir.
      </p>

      {status === 'sent' ? (
        <p className="tournament-note" role="status">
          Le courriel est parti vers <strong>{email.trim()}</strong>. Ouvrez le
          lien qu’il contient depuis cet appareil : il vous ramènera ici,
          connecté. Il ne sert qu’une fois.
        </p>
      ) : (
        <form className="tournament-form" onSubmit={submit}>
          <div className="tournament-field">
            <label htmlFor="courriel">Adresse électronique</label>
            <input
              id="courriel"
              name="courriel"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="vous@exemple.fr"
            />
          </div>
          <button
            type="submit"
            className="primary-button"
            disabled={status === 'sending'}
          >
            {status === 'sending' ? 'Envoi…' : 'Recevoir le lien'}
          </button>
          {error && (
            <p className="tournament-error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </>
  )
}
