import { describe, expect, it } from 'vitest'
import { readTournamentConfig } from './config'
import {
  authRedirectUrl,
  isTournamentLocation,
  normalizeAuthCallbackUrl,
  pathFromHash,
  urlWithoutAuthCode,
} from './routes'

describe('adresse d’un écran de tournoi', () => {
  it('lit le chemin porté par le fragment', () => {
    expect(pathFromHash('#/mes-parties?ia=42')).toBe('/mes-parties')
    expect(pathFromHash('')).toBe('/')
  })

  it('reconnaît les quatre écrans, et eux seuls', () => {
    for (const path of ['#/classement', '#/connexion', '#/mes-ia', '#/mes-parties']) {
      expect(isTournamentLocation(path, '')).toBe(true)
    }
    expect(isTournamentLocation('', '')).toBe(false)
    expect(isTournamentLocation('#/', '?moves=15%203Ir13')).toBe(false)
  })

  it('traite le retour du lien magique comme une adresse de tournoi', () => {
    expect(isTournamentLocation('', '?code=abc123')).toBe(true)
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
