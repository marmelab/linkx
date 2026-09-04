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
  admin: '/admin',
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
 * Paramètres portés par le fragment, qu'il désigne une route ou qu'il porte la
 * réponse brute du service d'authentification.
 *
 * Deux formes coexistent : `#/connexion?erreur=x`, écrite par le routeur, et
 * `#error=…&error_code=…`, écrite par le service quand il refuse un lien.
 */
function hashParams(hash: string): URLSearchParams {
  const withoutSharp = hash.startsWith('#') ? hash.slice(1) : hash
  const separator = withoutSharp.indexOf('?')
  if (separator !== -1) {
    return new URLSearchParams(withoutSharp.slice(separator + 1))
  }
  return withoutSharp.startsWith('/')
    ? new URLSearchParams()
    : new URLSearchParams(withoutSharp)
}

/** Porte le motif du refus une fois celui-ci ramené sur l'écran de connexion. */
export const AUTH_ERROR_PARAM = 'erreur'

/**
 * Motif du refus d'un lien magique, cherché dans la query string **et** dans le
 * fragment : le service écrit dans les deux, et rien ne garantit les deux.
 * `error_code` donne le motif exploitable (`otp_expired`) ; `error` ne dit que
 * la famille (`access_denied`) et ne sert que de repli.
 */
export function readAuthError(search: string, hash: string): string | null {
  const query = new URLSearchParams(search)
  const fragment = hashParams(hash)
  for (const key of ['error_code', 'error']) {
    const value = query.get(key) ?? fragment.get(key)
    if (value !== null && value !== '') return value
  }
  return null
}

/**
 * Le retour du lien magique est un `?code=` en query string : le flux PKCE le
 * met là, le fragment étant déjà pris par le routage. Il faut donc aussi le
 * reconnaître comme une adresse de tournoi, sans quoi le jeu s'afficherait à la
 * place de l'écran qui a la session à échanger. Un **refus** de lien mérite le
 * même traitement : il ramène sur le document, et c'est encore à la plateforme
 * de le dire.
 */
export function isTournamentLocation(hash: string, search: string): boolean {
  if (new URLSearchParams(search).has('code')) return true
  if (readAuthError(search, hash) !== null) return true
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

/**
 * Ramène un refus de lien magique sur l'écran de connexion, motif conservé.
 *
 * Le service **écrase** le fragment de l'adresse de retour par le sien :
 * `…/#/connexion` revient en `…/?error=…#error=…`. Ce fragment ne désigne plus
 * aucune route, si bien que le routeur retomberait sur le classement et que
 * l'auteur n'apprendrait jamais pourquoi sa connexion a échoué — il croirait
 * son clic sans effet. On remet donc le chemin, et le motif derrière lui.
 *
 * Rend l'adresse inchangée quand il n'y a pas de refus à traduire.
 */
export function normalizeAuthErrorUrl(href: string): string {
  const url = new URL(href)
  const reason = readAuthError(url.search, url.hash)
  if (reason === null) return href
  for (const key of ['error', 'error_code', 'error_description']) {
    url.searchParams.delete(key)
  }
  url.hash = `${TOURNAMENT_PATHS.login}?${new URLSearchParams({
    [AUTH_ERROR_PARAM]: reason,
  })}`
  return url.toString()
}

/**
 * Retire le `code=` du retour de lien magique.
 *
 * La bibliothèque d'authentification ne nettoie l'adresse qu'après un échange
 * **réussi**. Un lien expiré laisserait donc `?code=` en place à jamais :
 * `isTournamentLocation` resterait vrai et « Revenir au jeu » rebondirait sur le
 * classement. `session.ts` appelle donc ceci dès que la première lecture de
 * session a répondu, quel que soit son sort.
 *
 * Rend l'adresse inchangée quand il n'y a rien à retirer.
 */
export function urlWithoutAuthCode(href: string): string {
  const url = new URL(href)
  if (!url.searchParams.has('code')) return href
  url.searchParams.delete('code')
  return url.toString()
}

/** Adresse de retour du lien magique : le document, sur l'écran de connexion. */
export function authRedirectUrl(origin: string, pathname: string): string {
  return `${origin}${pathname}#${TOURNAMENT_PATHS.login}`
}
