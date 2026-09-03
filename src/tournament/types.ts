/**
 * Lignes lues de la plateforme, telles que la base les rend.
 *
 * Les colonnes portent le vocabulaire du **code** — `blue`, `white`, `draw`,
 * `connection`, `timeout`… (migrations `plateforme_tournoi_*`). Aucun de ces
 * mots n'est montré tel quel : leur traduction en français vit dans
 * `outcomes.ts` et `labels.ts`, et nulle part ailleurs.
 */
import type { PlayerId } from '../game/types'

export type BotStatus = 'en_attente' | 'active' | 'sommeil' | 'retiree'

export type GameResult = PlayerId | 'draw'

export type EndReason =
  | 'connection'
  | 'stalemate'
  | 'draw'
  | 'timeout'
  | 'illegal'
  | 'unreachable'
  | 'unreadable-reply'
  | 'interrupted'

/** Les sept motifs de refus d'une notation (`NotationErrorReason`). */
export type RefusalReason =
  | 'syntax'
  | 'exhausted'
  | 'horizontal-bounds'
  | 'overflow'
  | 'unsupported'
  | 'game-over'
  | 'unexpected-pass'

export type LeaderboardRow = {
  rang: number
  nom: string
  elo: number
  parties_classees: number
  statut: BotStatus
  ecart_derniere_vague: number | null
}

export type WaveRow = {
  id: string
  debut: string
  fin: string
  statut: 'planifiee' | 'en_cours' | 'terminee'
}

export type BotRow = {
  id: string
  nom: string
  adresse_service: string
  statut: BotStatus
  elo: number
  parties_classees: number
  vagues_echouees_consecutives: number
  ia_maison: boolean
  cree_le: string
}

export type BotHistoryRow = {
  id: number
  bot_id: string
  vague_id: string
  elo_avant: number
  elo_apres: number
  ecart: number
  victoires: number
  nuls: number
  defaites: number
  cree_le: string
}

export type GameRow = {
  id: string
  vague_id: string | null
  ouverture: string
  bot_bleu: string
  bot_blanc: string
  notation: string
  statut: 'en_attente' | 'en_cours' | 'terminee'
  resultat: GameResult | null
  motif_fin: EndReason | null
  motif_refus: RefusalReason | null
  bot_fautif: string | null
  nombre_coups: number
  cree_le: string
  /** Nom des deux IA, quand les politiques d'accès le rendent — voir `games.ts`. */
  bleu?: { nom: string } | null
  blanc?: { nom: string } | null
}

export type GameEventRow = {
  id: number
  partie_id: string
  rang_coup: number
  bot_id: string
  latence_ms: number | null
  statut_http: number | null
  coup: string | null
  erreur: string | null
}
