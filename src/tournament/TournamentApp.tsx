import { createHashRouter, Navigate, RouterProvider } from 'react-router'
import { LeaderboardScreen } from './LeaderboardScreen'
import { LoginScreen } from './LoginScreen'
import { MyBotsScreen } from './MyBotsScreen'
import { MyGamesScreen } from './MyGamesScreen'
import { TOURNAMENT_PATHS } from './routes'
import { TournamentLayout } from './TournamentLayout'

/**
 * Routeur **de fragment** : GitHub Pages sert des fichiers statiques, et
 * `/linkx/classement` rendrait une 404 au rechargement. La query string reste
 * libre pour le jeu, dont `?moves=` ouvre une partie sur l'écran de plateau.
 *
 * Ce module est la cible du `React.lazy` du point d'entrée : react-router et le
 * client Supabase ne sont téléchargés qu'ici, jamais avec le jeu.
 */
const router = createHashRouter([
  {
    path: '/',
    element: <TournamentLayout />,
    children: [
      {
        index: true,
        element: <Navigate to={TOURNAMENT_PATHS.leaderboard} replace />,
      },
      { path: 'classement', element: <LeaderboardScreen /> },
      { path: 'connexion', element: <LoginScreen /> },
      { path: 'mes-ia', element: <MyBotsScreen /> },
      { path: 'mes-parties', element: <MyGamesScreen /> },
      {
        path: '*',
        element: <Navigate to={TOURNAMENT_PATHS.leaderboard} replace />,
      },
    ],
  },
])

export default function TournamentApp() {
  return <RouterProvider router={router} />
}
