import { describe, expect, it } from 'vitest'
import { readTournamentConfig } from './config'
import {
  authRedirectUrl,
  isTournamentLocation,
  normalizeAuthCallbackUrl,
  normalizeAuthErrorUrl,
  pathFromHash,
  readAuthError,
  urlWithoutAuthCode,
} from './routes'

describe('adresse d’un écran de tournoi', () => {
  it('lit le chemin porté par le fragment', () => {
    expect(pathFromHash('#/mes-parties?ia=42')).toBe('/mes-parties')
    expect(pathFromHash('')).toBe('/')
  })

  it('reconnaît les cinq écrans, et eux seuls', () => {
    for (const path of [
      '#/classement',
      '#/connexion',
      '#/mes-ia',
      '#/mes-parties',
      '#/admin',
    ]) {
      expect(isTournamentLocation(path, '')).toBe(true)
    }
    expect(isTournamentLocation('', '')).toBe(false)
    expect(isTournamentLocation('#/', '?moves=15%203Ir13')).toBe(false)
  })

  it('traite le retour du lien magique comme une adresse de tournoi', () => {
    expect(isTournamentLocation('', '?code=abc123')).toBe(true)
  })

  it('traite un refus de lien comme une adresse de tournoi', () => {
    // Sans cela, le jeu s'afficherait et l'échec resterait muet.
    expect(
      isTournamentLocation('#error=access_denied', '?error_code=otp_expired'),
    ).toBe(true)
    expect(isTournamentLocation('#error=access_denied&sb=', '')).toBe(true)
  })
})

describe('refus d’un lien magique', () => {
  it('lit le motif de la query string comme du fragment', () => {
    expect(readAuthError('?error_code=otp_expired', '')).toBe('otp_expired')
    expect(readAuthError('', '#error_code=otp_expired&sb=')).toBe('otp_expired')
  })

  it('préfère le motif précis à la famille', () => {
    expect(readAuthError('?error=access_denied&error_code=otp_expired', '')).toBe(
      'otp_expired',
    )
  })

  it('retombe sur la famille quand elle est seule', () => {
    expect(readAuthError('?error=access_denied', '')).toBe('access_denied')
  })

  it('ne voit pas de refus là où il n’y en a pas', () => {
    expect(readAuthError('', '#/connexion')).toBeNull()
    expect(readAuthError('?moves=15%203Ir13', '#/')).toBeNull()
  })

  it('ne relit pas le motif qu’il a lui-même posé', () => {
    // Sans quoi la remise en forme se rejouerait sans fin sur son résultat.
    expect(readAuthError('', '#/connexion?erreur=otp_expired')).toBeNull()
  })

  it('ramène le refus sur l’écran de connexion, motif conservé', () => {
    const url = new URL(
      normalizeAuthErrorUrl(
        'https://exemple.fr/linkx/?error=access_denied&error_code=otp_expired' +
          '&error_description=Email+link+is+invalid+or+has+expired' +
          '#error=access_denied&error_code=otp_expired&sb=',
      ),
    )
    expect(url.hash).toBe('#/connexion?erreur=otp_expired')
    expect(url.search).toBe('')
  })

  it('conserve les paramètres étrangers au refus', () => {
    const url = new URL(
      normalizeAuthErrorUrl('https://exemple.fr/?moves=15%203Ir13&error_code=otp_expired'),
    )
    expect(url.searchParams.get('moves')).toBe('15 3Ir13')
    expect(url.hash).toBe('#/connexion?erreur=otp_expired')
  })

  it('ne touche pas à une adresse sans refus', () => {
    const href = 'https://exemple.fr/linkx/#/mes-ia'
    expect(normalizeAuthErrorUrl(href)).toBe(href)
  })

  it('est stable : remettre en forme deux fois ne change rien', () => {
    const une = normalizeAuthErrorUrl('https://exemple.fr/?error_code=otp_expired')
    expect(normalizeAuthErrorUrl(une)).toBe(une)
  })
})

describe('retour du lien magique', () => {
  it('laisse intacte une adresse dont le code est déjà en query string', () => {
    const href = 'https://exemple.fr/linkx/?code=abc#/connexion'
    expect(normalizeAuthCallbackUrl(href)).toBe(href)
  })

  it('ramène en query string un code accroché au fragment', () => {
    const url = new URL(
      normalizeAuthCallbackUrl('https://exemple.fr/linkx/#/connexion?code=abc'),
    )
    expect(url.searchParams.get('code')).toBe('abc')
    expect(url.hash).toBe('#/connexion')
  })

  it('conserve les autres paramètres du fragment', () => {
    const url = new URL(
      normalizeAuthCallbackUrl('https://exemple.fr/#/mes-parties?ia=7&code=abc'),
    )
    expect(url.searchParams.get('code')).toBe('abc')
    expect(url.hash).toBe('#/mes-parties?ia=7')
  })

  it('ne touche à rien sans code', () => {
    const href = 'https://exemple.fr/linkx/#/mes-ia'
    expect(normalizeAuthCallbackUrl(href)).toBe(href)
  })

  it('retire le code, y compris quand l’échange a échoué', () => {
    // Un lien expiré laisse le code en place : la bibliothèque ne nettoie
    // qu'après un échange réussi, et `isTournamentLocation` resterait vrai.
    const cleaned = urlWithoutAuthCode(
      'https://exemple.fr/linkx/?code=perime#/connexion',
    )
    expect(cleaned).toBe('https://exemple.fr/linkx/#/connexion')
    expect(isTournamentLocation('', new URL(cleaned).search)).toBe(false)
  })

  it('conserve les autres paramètres de la query string', () => {
    expect(
      urlWithoutAuthCode('https://exemple.fr/linkx/?moves=15&code=abc#/'),
    ).toBe('https://exemple.fr/linkx/?moves=15#/')
  })

  it('ne touche pas à une adresse sans code', () => {
    const href = 'https://exemple.fr/linkx/#/classement'
    expect(urlWithoutAuthCode(href)).toBe(href)
  })

  it('renvoie sur l’écran de connexion, jamais sur une autre origine', () => {
    expect(authRedirectUrl('https://exemple.fr', '/linkx/')).toBe(
      'https://exemple.fr/linkx/#/connexion',
    )
  })
})

describe('configuration de la plateforme', () => {
  it('n’existe qu’avec ses deux variables', () => {
    expect(readTournamentConfig({})).toBeNull()
    expect(readTournamentConfig({ VITE_SUPABASE_URL: 'https://x.fr' })).toBeNull()
    expect(
      readTournamentConfig({ VITE_SUPABASE_URL: '  ', VITE_SUPABASE_ANON_KEY: 'k' }),
    ).toBeNull()
  })

  it('rend les deux valeurs, débarrassées de leurs espaces', () => {
    expect(
      readTournamentConfig({
        VITE_SUPABASE_URL: ' https://x.fr ',
        VITE_SUPABASE_ANON_KEY: ' clef ',
      }),
    ).toEqual({ url: 'https://x.fr', anonKey: 'clef' })
  })
})
