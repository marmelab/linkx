/**
 * Bilan de la dernière vague d'une IA (plan.md, histoire 16).
 *
 * L'Elo, l'écart et le décompte victoires/nuls/défaites viennent de
 * `historique_elo`, seule table qui les arrête pour une vague. Les défaites
 * **techniques** n'y figurent pas : elles se comptent sur les parties de cette
 * vague-là, qui portent leur motif.
 */
import { isTechnical } from './outcomes'
import type { MyGame } from './games'
import type { BotHistoryRow } from './types'

/**
 * Dernière vague classée d'une IA, dans l'ordre de la vue `classement` : la
 * date, puis l'identifiant. Deux vagues closes dans la même seconde se
 * départagent ainsi toujours pareil.
 *
 * Exportée pour que l'écran sache **quelles** parties lire : sans elle il
 * chargeait toutes les siennes pour n'en compter qu'une vague.
 */
export function lastWaveRow(
  botId: string,
  history: readonly BotHistoryRow[],
): BotHistoryRow | null {
  const rows = history
    .filter((row) => row.bot_id === botId)
    .sort((a, b) => b.cree_le.localeCompare(a.cree_le) || b.id - a.id)
  return rows[0] ?? null
}

export type WaveSummary = {
  waveId: string
  elo: number
  gap: number
  wins: number
  draws: number
  losses: number
  /** Défaites dues à une faute technique, comprises dans `losses`. */
  technical: number
}

export function summarizeLastWave(
  botId: string,
  history: readonly BotHistoryRow[],
  games: readonly MyGame[],
): WaveSummary | null {
  const last = lastWaveRow(botId, history)
  if (!last) return null

  const technical = games.filter(
    (game) =>
      game.botId === botId &&
      game.waveId === last.vague_id &&
      game.outcome === 'perdu' &&
      isTechnical(game.reason),
  ).length

  return {
    waveId: last.vague_id,
    elo: last.elo_apres,
    gap: last.ecart,
    wins: last.victoires,
    draws: last.nuls,
    losses: last.defaites,
    technical,
  }
}
