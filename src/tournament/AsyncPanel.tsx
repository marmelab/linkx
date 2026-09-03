import type { ReactNode } from 'react'
import type { Async } from './useAsync'

type AsyncPanelProps<T> = {
  state: Async<T>
  children: (data: T) => ReactNode
}

/**
 * Chargement et panne, pour tous les écrans. L'état vide, lui, reste à l'écran
 * qui sait ce qu'il manque — c'est ce que verra le premier visiteur.
 */
export function AsyncPanel<T>({ state, children }: AsyncPanelProps<T>) {
  // Une relecture garde à l'écran ce qui y était : elle ne démonte donc pas la
  // vue, et rien de ce qu'elle portait n'est perdu en route.
  if (state.status === 'loading' && state.data === null) {
    return (
      <p className="tournament-note" aria-live="polite">
        Chargement…
      </p>
    )
  }

  if (state.status === 'error' || state.data === null) {
    return (
      <div className="tournament-note" role="alert">
        <p>
          La plateforme n’a pas répondu. {state.error}
        </p>
        <button
          type="button"
          className="secondary-button secondary-button--small"
          onClick={state.reload}
        >
          Réessayer
        </button>
      </div>
    )
  }

  return <>{children(state.data)}</>
}
