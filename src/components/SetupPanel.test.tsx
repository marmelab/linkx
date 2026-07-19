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
