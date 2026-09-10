import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AsyncPanel } from './AsyncPanel'
import type { QueryState } from './AsyncPanel'

const state = <T,>(overrides: Partial<QueryState<T>>): QueryState<T> => ({
  data: undefined,
  isError: false,
  isFetching: false,
  error: null,
  refetch: () => {},
  ...overrides,
})

const render = (given: QueryState<string[]>) =>
  renderToStaticMarkup(
    <AsyncPanel state={given}>
      {(data) => <p>{data.length} lignes</p>}
    </AsyncPanel>,
  )

describe('les trois états d’un écran', () => {
  it('annonce le chargement', () => {
    expect(render(state<string[]>({ isFetching: true }))).toContain(
      'Chargement…',
    )
  })

  it('rend une panne réseau avec sa reprise', () => {
    const html = render(
      state<string[]>({ isError: true, error: new Error('Réseau coupé.') }),
    )
    expect(html).toContain('Réseau coupé.')
    expect(html).toContain('Réessayer')
    expect(html).toContain('role="alert"')
  })

  it('passe la main à l’écran dès que la donnée est là', () => {
    expect(render(state({ data: ['a', 'b'] }))).toContain('2 lignes')
  })

  it('garde à l’écran ce qu’il montrait pendant une revalidation', () => {
    expect(render(state({ data: ['a', 'b'], isFetching: true }))).toContain(
      '2 lignes',
    )
  })

  it('dit la panne d’une revalidation plutôt que de laisser croire à jour', () => {
    const html = render(
      state({ data: ['a'], isError: true, error: new Error('Réseau coupé.') }),
    )
    expect(html).toContain('Réessayer')
    expect(html).not.toContain('1 lignes')
  })

  it('montre le chargement le temps d’une reprise demandée', () => {
    const html = render(
      state<string[]>({
        isError: true,
        isFetching: true,
        error: new Error('Réseau coupé.'),
      }),
    )
    expect(html).toContain('Chargement…')
  })
})
