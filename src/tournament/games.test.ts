import { describe, expect, it } from 'vitest'
import { OPENINGS } from '../../supabase/functions/_shared/openings.ts'
import { ANY, filterGames, QUALIFICATION, replayHref, toMyGames } from './games'
import type { GameRow } from './types'

const row = (overrides: Partial<GameRow> = {}): GameRow => ({
  id: 'p1',
  vague_id: 'v1',
  ouverture: '',
  bot_bleu: 'moi',
  bot_blanc: 'autre',
  notation: '15 3Ir13',
  statut: 'terminee',
  resultat: 'blue',
  motif_fin: 'connection',
  motif_refus: null,
  bot_fautif: null,
  nombre_coups: 2,
  cree_le: '2026-09-03T08:00:00Z',
  bleu: { nom: 'Mon IA' },
  blanc: null,
  ...overrides,
})

describe('mes parties, vues de mon côté', () => {
  it('déduit la couleur tenue et l’adversaire', () => {
    const [game] = toMyGames([row()], ['moi'])
    expect(game.color).toBe('blue')
    expect(game.opponent).toBeNull()
    expect(game.outcome).toBe('gagne')
  })

  it('bascule quand mon IA tient les blancs', () => {
    const [game] = toMyGames(
      [row({ bot_bleu: 'autre', bot_blanc: 'moi', blanc: { nom: 'Mon IA' }, bleu: { nom: 'Adverse' } })],
      ['moi'],
    )
    expect(game.color).toBe('white')
    expect(game.opponent).toBe('Adverse')
    expect(game.outcome).toBe('perdu')
    expect(game.outcomeText).toBe('perdu par connexion')
  })

  it('écarte une partie où aucune de mes IA ne joue', () => {
    expect(toMyGames([row()], ['une-autre'])).toEqual([])
  })

  it('nomme l’ouverture imposée, et le plateau vide', () => {
    // Les libellés viennent des débuts canoniques du serveur : le test suit
    // cette source, il ne la recopie pas.
    const [opening] = OPENINGS
    expect(toMyGames([row()], ['moi'])[0].openingLabel).toBe('plateau vide')
    expect(
      toMyGames([row({ ouverture: opening.notation })], ['moi'])[0].openingLabel,
    ).toBe(opening.label)
  })

  it('rend la notation telle quelle pour une ouverture inconnue', () => {
    expect(
      toMyGames([row({ ouverture: '9Zz99' })], ['moi'])[0].openingLabel,
    ).toBe('9Zz99')
  })

  it('ne compte qu’une fois une partie de mon IA contre mon IA', () => {
    const games = toMyGames([row({ bot_blanc: 'moi', blanc: { nom: 'Mon IA' } })], ['moi'])
    expect(games).toHaveLength(1)
    expect(games[0].color).toBe('blue')
  })
})

describe('filtres', () => {
  const games = toMyGames(
    [
      row({ id: 'a', vague_id: 'v1', bot_bleu: 'ia-1', bleu: { nom: 'Un' } }),
      row({
        id: 'b',
        vague_id: 'v2',
        bot_bleu: 'ia-2',
        resultat: 'white',
        bleu: { nom: 'Deux' },
      }),
      row({
        id: 'c',
        vague_id: null,
        bot_bleu: 'ia-1',
        resultat: 'draw',
        motif_fin: 'draw',
        bleu: { nom: 'Un' },
      }),
    ],
    ['ia-1', 'ia-2'],
  )

  it('ne filtre rien par défaut', () => {
    expect(filterGames(games, { botId: ANY, waveId: ANY, outcome: ANY })).toHaveLength(3)
  })

  it('filtre par IA', () => {
    const shown = filterGames(games, { botId: 'ia-1', waveId: ANY, outcome: ANY })
    expect(shown.map((game) => game.id)).toEqual(['a', 'c'])
  })

  it('filtre par vague, et range les qualifications à part', () => {
    expect(
      filterGames(games, { botId: ANY, waveId: 'v2', outcome: ANY }).map((g) => g.id),
    ).toEqual(['b'])
    expect(
      filterGames(games, { botId: ANY, waveId: QUALIFICATION, outcome: ANY }).map(
        (g) => g.id,
      ),
    ).toEqual(['c'])
  })

  it('filtre par issue', () => {
    expect(
      filterGames(games, { botId: ANY, waveId: ANY, outcome: 'perdu' }).map((g) => g.id),
    ).toEqual(['b'])
    expect(
      filterGames(games, { botId: ANY, waveId: ANY, outcome: 'nul' }).map((g) => g.id),
    ).toEqual(['c'])
  })

  it('combine les trois', () => {
    expect(
      filterGames(games, { botId: 'ia-1', waveId: 'v1', outcome: 'gagne' }).map(
        (g) => g.id,
      ),
    ).toEqual(['a'])
  })
})

describe('lien de relecture', () => {
  it('ouvre la notation sur l’écran de jeu, en query string', () => {
    expect(replayHref('/linkx/', '15 3Ir13')).toBe('/linkx/?moves=15%203Ir13')
  })
})
