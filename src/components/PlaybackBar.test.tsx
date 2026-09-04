import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { parseGameTimeline } from '../game/moveNotation'
import type { HistoryEntry } from '../game/types'
import { PlaybackBar } from './PlaybackBar'

/** Douze coups joués, aux bleus de jouer. */
const ONGOING = '4Lr32 3Ir12 3Ir12 3Ir13 4Tr24 4Lr38 3Ir15 15 2r13 2r15 15 2r13'

/** Partie ouverte par les blancs, avec une passe forcée puis un blocage. */
const FORCED_PASS =
  'w 2r16 3Ir17 24 4Ssr12 4Ss4 16 3I5 3Ir16 3Ir19 3L2 4Ssr12 14 18 4Tr32 18 3L8 3Lr12 2r16 4Lsr27 2r18 4Lr18 4Lsr37 -- 4Lr14 3Lr24'

function entriesOf(record: string): HistoryEntry[] {
  const parsed = parseGameTimeline(record)
  if (!parsed.ok) throw new Error(parsed.error.message)
  return parsed.states[parsed.states.length - 1].history
}

function render(record: string, cursor: number): string {
  return renderToStaticMarkup(
    <PlaybackBar
      entries={entriesOf(record)}
      cursor={cursor}
      onSeek={() => {}}
      onStep={() => {}}
    />,
  )
}

describe('barre de lecture', () => {
  const entries = entriesOf(ONGOING)

  it('dit toujours son rang et le total de la partie', () => {
    expect(render(ONGOING, 7)).toContain('Coup 7 sur 12')
    expect(render(ONGOING, 0)).toContain('Coup 0 sur 12')
    expect(render(ONGOING, 12)).toContain('Coup 12 sur 12')
  })

  it('écrit le coup courant dans la notation du document', () => {
    // Septième jeton de la partie, tel qu'il s'écrit dans le lien reçu.
    expect(render(ONGOING, 7)).toContain('3Ir15')
    expect(render(ONGOING, 12)).toContain('2r13')
    // Le début de la partie est une position à part entière.
    expect(render(ONGOING, 0)).toContain('plateau vide')
  })

  it('nomme le tour passé sans le confondre avec un coup', () => {
    const passRank =
      entriesOf(FORCED_PASS).findIndex((entry) => entry.kind === 'pass') + 1

    expect(render(FORCED_PASS, passRank)).toContain('-- (tour passé)')
  })

  it('annonce la lecture seule en toutes lettres, sauf au dernier coup', () => {
    const reading = render(ONGOING, 5)
    expect(reading).toContain('lecture seule')
    expect(reading).toContain('aria-live="polite"')

    expect(render(ONGOING, 12)).not.toContain('lecture seule')
    expect(render(ONGOING, 12)).toContain('dernier coup')
  })

  it('offre les cinq fonctions au clavier, et ferme les issues sans objet', () => {
    const start = render(ONGOING, 0)
    const end = render(ONGOING, 12)

    for (const label of [
      'Aller au début de la partie',
      'Coup précédent',
      'Coup suivant',
      'Aller à la fin de la partie',
      'Rang du coup, de 0 à 12',
    ]) {
      expect(start).toContain(`aria-label="${label}"`)
    }

    // Deux boutons désactivés à chaque bout, jamais quatre au milieu.
    expect([...start.matchAll(/disabled=""/g)]).toHaveLength(2)
    expect([...end.matchAll(/disabled=""/g)]).toHaveLength(2)
    expect([...render(ONGOING, 6).matchAll(/disabled=""/g)]).toHaveLength(0)
  })

  it('règle son curseur sur la partie entière, du plateau vide au dernier coup', () => {
    const markup = render(ONGOING, 3)

    expect(markup).toContain('type="range"')
    expect(markup).toContain('min="0"')
    expect(markup).toContain(`max="${entries.length}"`)
    expect(markup).toContain('value="3"')
  })
})
