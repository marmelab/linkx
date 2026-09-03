/**
 * Adressage des écrans de la plateforme, en **mode hash**.
 *
 * GitHub Pages sert des fichiers statiques : `/linkx/classement` rendrait une
 * 404 au rechargement, alors que `/linkx/#/classement` retombe toujours sur
 * `index.html`. Le fragment porte donc la route, et la query string reste au
 * jeu — `?moves=` continue d'ouvrir une partie sur l'écran de jeu.
 *
 * Module pur, sans React ni `window` : c'est lui que le point d'entrée
 * interroge pour savoir s'il doit charger le morceau du tournoi.
 */
export const TOURNAMENT_PATHS = {
  leaderboard: '/classement',
  login: '/connexion',
  bots: '/mes-ia',
  games: '/mes-parties',
} as const

export type TournamentPath =
  (typeof TOURNAMENT_PATHS)[keyof typeof TOURNAMENT_PATHS]

const PATHS: readonly string[] = Object.values(TOURNAMENT_PATHS)

/** Chemin porté par le fragment, sans son `#` ni sa query string. */
export function pathFromHash(hash: string): string {
  const withoutSharp = hash.startsWith('#') ? hash.slice(1) : hash
  const path = withoutSharp.split('?')[0]
  return path.startsWith('/') ? path : `/${path}`
}

/**
 * Le retour du lien magique est un `?code=` en query string : le flux PKCE le
 * met là, le fragment étant déjà pris par le routage. Il faut donc aussi le
 * reconnaître comme une adresse de tournoi, sans quoi le jeu s'afficherait à la
 * place de l'écran qui a la session à échanger.
 */
export function isTournamentLocation(hash: string, search: string): boolean {
  if (new URLSearchParams(search).has('code')) return true
  const path = pathFromHash(hash)
  return PATHS.some((known) => path === known || path.startsWith(`${known}/`))
}

/**
 * Ramène un `code=` égaré dans le fragment vers la query string.
 *
 * Le service d'authentification ajoute le code à l'adresse de retour ; selon
 * qu'il la traite comme une URL ou comme une chaîne, il rend
 * `…/?code=abc#/connexion` ou `…/#/connexion?code=abc`. Le client Supabase ne
 * lit que la query string : la seconde forme laisserait la session non échangée,
 * sans rien dire. On normalise donc avant de créer le client.
 *
 * Rend l'adresse inchangée quand il n'y a rien à déplacer.
 */
export function normalizeAuthCallbackUrl(href: string): string {
  const url = new URL(href)
  if (url.searchParams.has('code')) return href
  const separator = url.hash.indexOf('?')
  if (separator === -1) return href

  const inHash = new URLSearchParams(url.hash.slice(separator + 1))
  const code = inHash.get('code')
  if (!code) return href

  inHash.delete('code')
  url.searchParams.set('code', code)
  const rest = inHash.toString()
  url.hash = url.hash.slice(0, separator) + (rest === '' ? '' : `?${rest}`)
  return url.toString()
}

/** Adresse de retour du lien magique : le document, sur l'écran de connexion. */
export function authRedirectUrl(origin: string, pathname: string): string {
  return `${origin}${pathname}#${TOURNAMENT_PATHS.login}`
}
