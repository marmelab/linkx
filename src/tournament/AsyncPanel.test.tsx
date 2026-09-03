import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AsyncPanel } from './AsyncPanel'
import type { Async } from './useAsync'

const state = <T,>(overrides: Partial<Async<T>>): Async<T> => ({
  status: 'loading',
  data: null,
  error: null,
  reload: () => {},
  ...overrides,
})

const render = (given: Async<string[]>) =>
  renderToStaticMarkup(
    <AsyncPanel state={given}>
      {(data) => <p>{data.length} lignes</p>}
    </AsyncPanel>,
  )

describe('les trois états d’un écran', () => {
  it('annonce le chargement', () => {
    expect(render(state<string[]>({}))).toContain('Chargement…')
  })

  it('rend une panne réseau avec sa reprise', () => {
    const html = render(
      state<string[]>({ status: 'error', error: 'Réseau coupé.' }),
    )
    expect(html).toContain('Réseau coupé.')
    expect(html).toContain('Réessayer')
    expect(html).toContain('role="alert"')
  })

  it('passe la main à l’écran dès que la donnée est là', () => {
    expect(render(state({ status: 'ready', data: ['a', 'b'] }))).toContain(
      '2 lignes',
    )
  })

  it('traite une donnée absente comme une panne, jamais comme un vide', () => {
    expect(
      render(state<string[]>({ status: 'ready', data: null })),
    ).toContain('Réessayer')
  })
})
