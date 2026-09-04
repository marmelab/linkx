/**
 * Le vocabulaire de la base en français, à un seul endroit.
 *
 * `resultat`, `motif_fin` et `motif_refus` portent les mots du code — `blue`,
 * `draw`, `timeout`, `unsupported`… Rien de tout cela ne s'affiche : une issue
 * est une **phrase**, « gagné par connexion », « perdu — hors délai au coup 14 »
 * (plan.md, histoire 16). Toute la traduction vit ici ; aucun écran ne compose
 * la sienne.
 */
import type { PlayerId } from '../game/types'
import type { BotStatus, EndReason, GameResult, RefusalReason } from './types'

export const COLOR_LABELS: Record<PlayerId, string> = {
  blue: 'bleu',
  white: 'blanc',
}

export const STATUS_LABELS: Record<BotStatus, string> = {
  en_attente: 'en qualification',
  active: 'active',
  sommeil: 'en sommeil',
  retiree: 'retirée',
}

/** Les sept motifs de refus d'une notation, dans les termes de l'auteur d'une IA. */
export const REFUSAL_LABELS: Record<RefusalReason, string> = {
  syntax: 'syntaxe invalide',
  exhausted: 'pièce épuisée',
  'horizontal-bounds': 'débordement latéral',
  overflow: 'débordement par le haut',
  unsupported: 'support insuffisant',
  'game-over': 'partie déjà terminée',
  'unexpected-pass': 'passe non forcée',
}

/** Fautes techniques : elles nomment un coupable et un rang de coup. */
const TECHNICAL_LABELS = {
  timeout: 'hors délai',
  illegal: 'coup illégal',
  unreachable: 'service injoignable',
  'unreadable-reply': 'réponse illisible',
} as const

type TechnicalReason = keyof typeof TECHNICAL_LABELS

export function isTechnical(reason: EndReason | null): reason is TechnicalReason {
  return reason !== null && reason in TECHNICAL_LABELS
}

/** Trois issues filtrables, du point de vue de l'IA de l'auteur. */
export type OutcomeKind = 'gagne' | 'perdu' | 'nul' | 'en_cours'

export const OUTCOME_LABELS: Record<OutcomeKind, string> = {
  gagne: 'gagnée',
  perdu: 'perdue',
  nul: 'nulle',
  en_cours: 'en cours',
}

export type OutcomeInput = {
  finished: boolean
  result: GameResult | null
  reason: EndReason | null
  refusal: RefusalReason | null
  /**
   * Nombre de coups joués. Le rang du coup fautif est le suivant : la partie
   * s'arrête sur la réponse qui n'a jamais été jouée, et la base ne conserve
   * pas le `moveNumber` de l'arbitre.
   */
  moveCount: number
  color: PlayerId
}

export function outcomeKind(input: OutcomeInput): OutcomeKind {
  if (!input.finished || input.result === null) return 'en_cours'
  if (input.result === 'draw') return 'nul'
  return input.result === input.color ? 'gagne' : 'perdu'
}

/**
 * L'issue en toutes lettres, du point de vue de l'IA de l'auteur. Jamais un
 * symbole, jamais une couleur seule : c'est la phrase qui porte l'information.
 */
export function describeOutcome(input: OutcomeInput): string {
  const kind = outcomeKind(input)
  if (kind === 'en_cours') return 'en cours'

  const reason = input.reason
  // **Le nul se lit avant la faute technique.** `resultat` et `motif_fin` sont
  // deux colonnes indépendantes de `parties` : rien n'interdit un nul portant un
  // motif technique, et la branche technique l'aurait alors annoncé « perdu »
  // sur une ligne que le filtre « Issue = nulle » vient de retenir.
  if (kind === 'nul') {
    if (reason === 'interrupted') return 'nul technique — vague terminée'
    if (isTechnical(reason)) {
      return `nul technique — ${TECHNICAL_LABELS[reason]} au coup ${input.moveCount + 1}`
    }
    return 'nul par blocage, zones égales'
  }

  if (isTechnical(reason)) {
    const rank = input.moveCount + 1
    const detail =
      reason === 'illegal' && input.refusal
        ? `, ${REFUSAL_LABELS[input.refusal]}`
        : ''
    // Une faute technique désigne son coupable : c'est le perdant, toujours.
    const who = kind === 'gagne' ? ' de l’adversaire' : ''
    const verb = kind === 'gagne' ? 'gagné' : 'perdu'
    return `${verb} — ${TECHNICAL_LABELS[reason]}${who} au coup ${rank}${detail}`
  }

  if (reason === 'stalemate') {
    return kind === 'gagne'
      ? 'gagné par blocage, à la plus grande zone'
      : 'perdu par blocage, à la plus petite zone'
  }
  const verb = kind === 'gagne' ? 'gagné' : 'perdu'
  if (reason === 'connection') return `${verb} par connexion`
  return verb
}
