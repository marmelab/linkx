/**
 * « Mes parties » : mise en forme et filtrage, sans React.
 *
 * Une ligne de `parties` est neutre — elle a un bot bleu et un bot blanc. Un
 * auteur, lui, lit sa partie : sa couleur, son adversaire, son issue. C'est
 * cette bascule que fait ce module, et c'est elle qui se teste.
 */
import { openingLabel } from '../../supabase/functions/_shared/openings.ts'
import type { PlayerId } from '../game/types'
import { describeOutcome, outcomeKind } from './outcomes'
import type { OutcomeKind } from './outcomes'
import type { EndReason, GameRow } from './types'

export type MyGame = {
  id: string
  playedAt: string
  waveId: string | null
  opening: string
  openingLabel: string
  botId: string
  color: PlayerId
  opponent: string | null
  outcome: OutcomeKind
  outcomeText: string
  reason: EndReason | null
  moveCount: number
  notation: string
}

/**
 * Nom de l'adversaire. `bots` n'est lisible que de son propriétaire, mais le
 * nom d'une IA est public : `api.ts` le résout par la vue `noms_bots`. Reste
 * `null` si la vue ne connaît pas cette ligne, et l'écran l'écrit alors en
 * toutes lettres plutôt que d'inventer.
 */
function opponentName(row: GameRow, color: PlayerId): string | null {
  const other = color === 'blue' ? row.blanc : row.bleu
  return other?.nom ?? null
}

/** Traduit les lignes brutes du point de vue des IA de l'auteur. */
export function toMyGames(
  rows: readonly GameRow[],
  myBotIds: readonly string[],
): MyGame[] {
  const mine = new Set(myBotIds)
  const games: MyGame[] = []

  for (const row of rows) {
    // Une partie de l'auteur contre lui-même est lue du côté bleu : elle
    // apparaît une fois, comme les autres.
    const color: PlayerId | null = mine.has(row.bot_bleu)
      ? 'blue'
      : mine.has(row.bot_blanc)
        ? 'white'
        : null
    if (color === null) continue

    const input = {
      finished: row.statut === 'terminee',
      result: row.resultat,
      reason: row.motif_fin,
      refusal: row.motif_refus,
      moveCount: row.nombre_coups,
      color,
    }

    games.push({
      id: row.id,
      playedAt: row.cree_le,
      waveId: row.vague_id,
      opening: row.ouverture,
      openingLabel: openingLabel(row.ouverture),
      botId: color === 'blue' ? row.bot_bleu : row.bot_blanc,
      color,
      opponent: opponentName(row, color),
      outcome: outcomeKind(input),
      outcomeText: describeOutcome(input),
      reason: row.motif_fin,
      moveCount: row.nombre_coups,
      notation: row.notation,
    })
  }

  return games
}

export const ANY = 'toutes'

export type GameFilters = {
  botId: string
  waveId: string
  outcome: string
}

export const NO_FILTER: GameFilters = { botId: ANY, waveId: ANY, outcome: ANY }

/** Une partie sans vague est une qualification : elle a sa propre valeur de filtre. */
export const QUALIFICATION = 'qualification'

export function filterGames(
  games: readonly MyGame[],
  filters: GameFilters,
): MyGame[] {
  return games.filter((game) => {
    if (filters.botId !== ANY && game.botId !== filters.botId) return false
    if (filters.waveId !== ANY) {
      const wave = game.waveId ?? QUALIFICATION
      if (wave !== filters.waveId) return false
    }
    if (filters.outcome !== ANY && game.outcome !== filters.outcome) return false
    return true
  })
}

/** Lien de relecture : la notation s'ouvre dans l'écran de jeu, barre comprise. */
export function replayHref(pathname: string, notation: string): string {
  return `${pathname}?moves=${encodeURIComponent(notation)}`
}
