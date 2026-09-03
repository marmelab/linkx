import { NavLink, Outlet } from 'react-router'
import { signOut } from './api'
import { TOURNAMENT_PATHS } from './routes'
import { useSession } from './session'

/**
 * Mise en page commune aux quatre écrans : le fond de l'écran d'accueil, une
 * carte élargie dérivée de la sienne, et la barre du jeu pour naviguer.
 *
 * Le retour au jeu est une **ancre**, pas un lien du routeur : elle remet le
 * fragment à `#/`, ce que le point d'entrée écoute pour rendre le jeu et
 * décharger la plateforme.
 */
/** L'écran courant est signalé par un mot souligné, jamais par la seule teinte. */
const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'text-button is-active' : 'text-button'

export function TournamentLayout() {
  const { session } = useSession()

  return (
    <div className="tournament-shell">
      <header className="topbar">
        <a className="mini-brand" href="#/" aria-label="Revenir au jeu">
          <span aria-hidden="true">L×</span> LINKX
        </a>
        <nav className="topbar-actions tournament-nav" aria-label="Tournoi">
          <NavLink className={navClass} to={TOURNAMENT_PATHS.leaderboard}>
            Classement
          </NavLink>
          <NavLink className={navClass} to={TOURNAMENT_PATHS.bots}>
            Mes IA
          </NavLink>
          <NavLink className={navClass} to={TOURNAMENT_PATHS.games}>
            Mes parties
          </NavLink>
          {session ? (
            <button
              type="button"
              className="secondary-button secondary-button--small"
              onClick={() => void signOut()}
            >
              Se déconnecter
            </button>
          ) : (
            <NavLink
              className="secondary-button secondary-button--small"
              to={TOURNAMENT_PATHS.login}
            >
              Se connecter
            </NavLink>
          )}
        </nav>
      </header>

      <main className="setup-screen tournament-screen">
        <section className="setup-card tournament-card">
          <Outlet />
        </section>
      </main>
    </div>
  )
}
