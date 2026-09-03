import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS } from '../game/types'
import { SetupPanel } from './SetupPanel'

const render = () =>
  renderToStaticMarkup(<SetupPanel onStart={() => {}} onShowRules={() => {}} />)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('choix du niveau de l’ordinateur', () => {
  const markup = render()

  it('propose un niveau pour chaque force disponible', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      expect(markup).toContain(`value="${difficulty}"`)
    }
  })

  it('présélectionne le niveau par défaut', () => {
    expect(markup).toContain(`value="${DEFAULT_DIFFICULTY}" selected=""`)
  })

  it('présélectionne le niveau retenu de la partie précédente', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'hard',
      setItem: () => {},
    })

    expect(render()).toContain('value="hard" selected=""')
  })

  it('nomme le choix pour les lecteurs d’écran', () => {
    expect(markup).toContain('for="difficulty"')
    expect(markup).toContain('id="difficulty"')
  })
})

describe('entrée du tournoi des IA', () => {
  /**
   * L'entrée est décidée au chargement du module, sur les variables du build :
   * il faut donc réimporter le panneau après les avoir posées.
   */
  const renderWith = async (env: Record<string, string>) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.resetModules()
    const module = await import('./SetupPanel')
    return renderToStaticMarkup(
      <module.SetupPanel onStart={() => {}} onShowRules={() => {}} />,
    )
  }

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('s’affiche au même rang que les deux modes de jeu', async () => {
    const html = await renderWith({
      VITE_SUPABASE_URL: 'https://exemple.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'clef-publique',
    })
    expect(html).toContain('Tournoi des IA')
    expect(html).toContain('class="mode-button mode-button--tournament"')
    expect(html).toContain('href="#/classement"')
  })

  it('disparaît quand la plateforme n’est pas configurée', async () => {
    const html = await renderWith({
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_ANON_KEY: '',
    })
    expect(html).not.toContain('Tournoi des IA')
    // Le jeu, lui, reste entier.
    expect(html).toContain('À deux joueurs')
    expect(html).toContain('Contre l’ordinateur')
  })
})
