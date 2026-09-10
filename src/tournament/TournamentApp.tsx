import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createHashRouter, Navigate, RouterProvider } from 'react-router'
import { AdminScreen } from './AdminScreen'
import { LeaderboardScreen } from './LeaderboardScreen'
import { LoginScreen } from './LoginScreen'
import { MyBotsScreen } from './MyBotsScreen'
import { MyGamesScreen } from './MyGamesScreen'
import { normalizeAuthErrorUrl, TOURNAMENT_PATHS } from './routes'
import { TournamentLayout } from './TournamentLayout'

// Avant la création du routeur, qui lit l'adresse aussitôt : un lien magique
// refusé revient sur un fragment qui ne désigne aucune route, et retomberait
// donc sur le classement, sans un mot sur l'échec.
const normalized = normalizeAuthErrorUrl(window.location.href)
if (normalized !== window.location.href) {
  window.history.replaceState(null, '', normalized)
}

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
      { path: 'admin', element: <AdminScreen /> },
      {
        path: '*',
        element: <Navigate to={TOURNAMENT_PATHS.leaderboard} replace />,
      },
    ],
  },
])

/**
 * Le magasin des lectures, tenu hors du routeur : il survit donc au démontage
 * d'un écran, et c'est de là que vient l'affichage immédiat au retour.
 *
 * Rien n'y est tenu pour frais : chaque montage relit, et c'est la réponse
 * précédente qui occupe l'écran en attendant la nouvelle. Ce n'est pas un cache
 * qui dispenserait de demander — un classement d'il y a deux minutes serait
 * périmé —, seulement de quoi ne plus montrer un écran vide.
 *
 * Et **aucune reprise automatique** : les écrans en offrent une, explicite, et
 * trois tentatives silencieuses ne feraient que retarder l'aveu de la panne.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

export default function TournamentApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}
