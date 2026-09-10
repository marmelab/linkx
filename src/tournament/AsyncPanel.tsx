import type { ReactNode } from 'react'

/**
 * Ce qu'un panneau lit d'une requête, et rien de plus : un `UseQueryResult` s'y
 * range de lui-même, sans que ce module dépende de TanStack Query — ni que son
 * test ait à fabriquer les trente champs d'un résultat complet.
 */
export type QueryState<T> = {
  data: T | undefined
  isError: boolean
  isFetching: boolean
  error: Error | null
  refetch: () => void
}

type AsyncPanelProps<T> = {
  state: QueryState<T>
  children: (data: T) => ReactNode
}

/**
 * Chargement et panne, pour tous les écrans. L'état vide, lui, reste à l'écran
 * qui sait ce qu'il manque — c'est ce que verra le premier visiteur.
 *
 * Une donnée en cache l'emporte sur la revalidation qui la suit : c'est tout
 * l'objet du cache, et c'est ce qui supprime le clignotement d'un écran
 * revisité. Mais pas sur une revalidation **échouée** : une panne se dit,
 * plutôt que de laisser croire à jour ce qui ne l'est plus.
 */
export function AsyncPanel<T>({ state, children }: AsyncPanelProps<T>) {
  if (!state.isError && state.data !== undefined) return <>{children(state.data)}</>

  // Une reprise en cours reste un chargement, y compris après un clic sur
  // « Réessayer » : il doit se voir.
  if (state.isError && !state.isFetching) {
    // « N'a pas répondu » serait faux d'un refus d'accès, qui a bel et bien
    // répondu. Le panneau dit donc ce qu'il sait — la lecture a échoué — et
    // laisse le message du service à sa propre ligne, en second.
    return (
      <div className="tournament-note" role="alert">
        <p>Cette lecture n’a pas abouti.</p>
        {state.error && (
          <p className="tournament-error">
            {state.error.message || 'Erreur inconnue.'}
          </p>
        )}
        <button
          type="button"
          className="secondary-button secondary-button--small"
          onClick={state.refetch}
        >
          Réessayer
        </button>
      </div>
    )
  }

  return (
    <p className="tournament-note" aria-live="polite">
      Chargement…
    </p>
  )
}
