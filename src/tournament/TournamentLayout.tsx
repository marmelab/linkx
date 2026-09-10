import { skipToken, useQuery } from '@tanstack/react-query'
import type { UseQueryResult } from '@tanstack/react-query'
import { NavLink, Outlet } from 'react-router'
import { isAdministrator, signOut } from './api'
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

/**
 * Ce que la mise en page établit une fois pour les écrans qu'elle enveloppe.
 * Le droit d'administration en fait partie : elle en a besoin pour son entrée
 * de navigation, et l'écran d'administration pour se garder — une seule lecture
 * sert les deux.
 */
export type TournamentContext = {
  admin: UseQueryResult<boolean>
}

export function TournamentLayout() {
  const { session } = useSession()
  const admin = useQuery({
    queryKey: ['administrateur', session?.user.id],
    queryFn: session ? isAdministrator : skipToken,
  })

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
          {/* Des écrans qui n'ont rien à montrer sans session : les proposer ne
              mènerait qu'à l'écran de connexion. Ils apparaissent une fois la
              session lue, plutôt que de s'afficher puis de disparaître.
              Le droit d'administration est lié à la même condition : une
              relecture garde sa valeur précédente le temps de répondre, si bien
              qu'à la déconnexion l'entrée « Admin » survivrait à la session. */}
          {session && (
            <>
              <NavLink className={navClass} to={TOURNAMENT_PATHS.bots}>
                Mes IA
              </NavLink>
              <NavLink className={navClass} to={TOURNAMENT_PATHS.games}>
                Mes parties
              </NavLink>
              {admin.data === true && (
                <NavLink className={navClass} to={TOURNAMENT_PATHS.admin}>
                  Admin
                </NavLink>
              )}
            </>
          )}
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

      {/* Une vérification qui n'a pas abouti se dit, sans quoi un
          administrateur croirait avoir perdu ses droits en ne voyant plus son
          entrée. La phrase reste muette sur qui en a : elle ne parle que de la
          lecture. */}
      {admin.isError && !admin.isFetching && (
        <p className="tournament-shell__notice" role="alert">
          Vos droits n’ont pas pu être vérifiés.{' '}
          <button
            type="button"
            className="secondary-button secondary-button--small"
            onClick={() => void admin.refetch()}
          >
            Réessayer
          </button>
        </p>
      )}

      <main className="setup-screen tournament-screen">
        <section className="setup-card tournament-card">
          <Outlet context={{ admin } satisfies TournamentContext} />
        </section>
      </main>
    </div>
  )
}
