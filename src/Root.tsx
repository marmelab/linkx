import { lazy, Suspense, useSyncExternalStore } from 'react'
import App from './App'
import { tournamentEnabled } from './tournament/config'
import { isTournamentLocation } from './tournament/routes'

/**
 * Le morceau du tournoi n'est téléchargé qu'à la demande : react-router, le
 * client Supabase et les quatre écrans vivent dans un fragment séparé, si bien
 * que le jeu garde le bundle qu'il avait — installable, jouable hors ligne,
 * sans compte et sans appel réseau (plan.md, « Hors périmètre »).
 */
const TournamentApp = lazy(() => import('./tournament/TournamentApp'))

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  window.addEventListener('popstate', listener)
  return () => {
    window.removeEventListener('hashchange', listener)
    window.removeEventListener('popstate', listener)
  }
}

/** L'instantané est la décision elle-même : une valeur simple, comparable. */
function readIsTournament(): boolean {
  return (
    tournamentEnabled &&
    isTournamentLocation(window.location.hash, window.location.search)
  )
}

/**
 * Aiguillage minimal, hors routeur : le jeu reste la page par défaut, et rien
 * de la plateforme n'est chargé tant que le fragment ne la désigne pas. Les
 * navigations internes du routeur passent par `pushState`, qui n'émet aucun de
 * ces deux événements : elles ne repassent donc jamais par ici.
 */
export function Root() {
  const tournament = useSyncExternalStore(
    subscribe,
    readIsTournament,
    readIsTournament,
  )

  if (tournament) {
    return (
      <Suspense
        fallback={
          <main className="setup-screen">
            <p className="setup-card">Chargement du tournoi…</p>
          </main>
        }
      >
        <TournamentApp />
      </Suspense>
    )
  }

  return <App />
}
