/**
 * Adresse du service de tournoi, lue une fois au chargement.
 *
 * Sans ces deux variables — le cas d'un dépôt cloné et d'un build sans secrets —
 * la plateforme n'existe pas : l'entrée du tournoi disparaît de l'écran
 * d'accueil et le jeu se comporte comme avant, sans réseau ni erreur console.
 * C'est le seul endroit qui décide, et il est pur pour être testable.
 */
export type TournamentConfig = {
  url: string
  anonKey: string
}

export function readTournamentConfig(
  env: Record<string, unknown>,
): TournamentConfig | null {
  const url = typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL.trim() : ''
  const anonKey =
    typeof env.VITE_SUPABASE_ANON_KEY === 'string'
      ? env.VITE_SUPABASE_ANON_KEY.trim()
      : ''
  if (url === '' || anonKey === '') return null
  return { url, anonKey }
}

export const tournamentConfig = readTournamentConfig(import.meta.env)

export const tournamentEnabled = tournamentConfig !== null
