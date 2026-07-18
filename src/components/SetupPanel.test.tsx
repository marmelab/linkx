import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS } from '../game/types'
import { SetupPanel } from './SetupPanel'

describe('choix du niveau de l’ordinateur', () => {
  const markup = renderToStaticMarkup(
    <SetupPanel onStart={() => {}} onShowRules={() => {}} />,
  )

  it('propose un niveau pour chaque force disponible', () => {
    for (const difficulty of DIFFICULTY_IDS) {
      expect(markup).toContain(`value="${difficulty}"`)
    }
  })

  it('présélectionne le niveau par défaut', () => {
    expect(markup).toContain(`value="${DEFAULT_DIFFICULTY}" selected=""`)
  })

  it('nomme le choix pour les lecteurs d’écran', () => {
    expect(markup).toContain('for="difficulty"')
    expect(markup).toContain('id="difficulty"')
  })
})
