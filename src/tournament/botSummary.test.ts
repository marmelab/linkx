import { describe, expect, it } from 'vitest'
import { summarizeLastWave } from './botSummary'
import { toMyGames } from './games'
import type { BotHistoryRow, GameRow } from './types'

let nextId = 1

const history = (
  vague: string,
  cree_le: string,
  overrides: Partial<BotHistoryRow> = {},
): BotHistoryRow => ({
  id: nextId++,
  bot_id: 'moi',
  vague_id: vague,
  elo_avant: 1200,
  elo_apres: 1218,
  ecart: 18,
  victoires: 6,
  nuls: 1,
  defaites: 3,
  cree_le,
  ...overrides,
})

const game = (overrides: Partial<GameRow>): GameRow => ({
  id: 'p',
  vague_id: 'v2',
  ouverture: '',
  bot_bleu: 'moi',
  bot_blanc: 'autre',
  notation: '',
  statut: 'terminee',
  resultat: 'white',
  motif_fin: 'timeout',
  motif_refus: null,
  bot_fautif: 'moi',
  nombre_coups: 13,
  cree_le: '2026-09-03T08:00:00Z',
  ...overrides,
})

describe('bilan de la dernière vague', () => {
  const rows = [history('v1', '2026-08-27T12:00:00Z'), history('v2', '2026-09-03T12:00:00Z')]

  it('départage deux vagues closes à la même seconde par leur identifiant', () => {
    const meme = '2026-09-03T12:00:00Z'
    const summary = summarizeLastWave(
      'moi',
      [history('v1', meme, { elo_apres: 1100 }), history('v2', meme, { elo_apres: 1218 })],
      [],
    )
    expect(summary?.waveId).toBe('v2')
  })

  it('retient la vague la plus récente', () => {
    const summary = summarizeLastWave('moi', rows, [])
    expect(summary?.waveId).toBe('v2')
    expect(summary?.elo).toBe(1218)
    expect(summary?.gap).toBe(18)
    expect(summary?.wins).toBe(6)
  })

  it('compte les défaites techniques de cette vague-là', () => {
    const games = toMyGames(
      [
        game({ id: 'a' }),
        game({ id: 'b', motif_fin: 'unreachable' }),
        // Perdue, mais au jeu : elle n'est pas technique.
        game({ id: 'c', motif_fin: 'connection', bot_fautif: null }),
        // Technique, mais dans la vague précédente.
        game({ id: 'd', vague_id: 'v1' }),
      ],
      ['moi'],
    )
    expect(summarizeLastWave('moi', rows, games)?.technical).toBe(2)
  })

  it('ne rend aucun bilan à une IA qui n’a jamais joué de vague', () => {
    expect(summarizeLastWave('inconnue', rows, [])).toBeNull()
  })
})
