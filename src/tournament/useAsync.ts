/**
 * Trois états, jamais deux : chargement, prêt, erreur avec reprise.
 *
 * Le quatrième état — « prêt mais vide » — n'est pas ici : il se lit sur la
 * donnée rendue, et c'est l'écran qui l'écrit, parce qu'un classement vide et
 * une liste d'IA vide ne disent pas la même chose au visiteur.
 */
import { useEffect, useState } from 'react'

export type AsyncStatus = 'loading' | 'ready' | 'error'

export type Async<T> = {
  status: AsyncStatus
  data: T | null
  error: string | null
  reload: () => void
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Erreur inconnue.'
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    status: AsyncStatus
    data: T | null
    error: string | null
  }>({ status: 'loading', data: null, error: null })

  useEffect(() => {
    let cancelled = false
    setState((current) => ({ ...current, status: 'loading', error: null }))
    load()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', data: null, error: messageOf(error) })
        }
      })
    return () => {
      cancelled = true
    }
    // `load` change à chaque rendu : ce sont les dépendances annoncées par
    // l'appelant, et la reprise, qui décident d'une nouvelle lecture.
  }, [attempt, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...state,
    reload: () => setAttempt((value) => value + 1),
  }
}
