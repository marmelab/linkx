/**
 * Transitions de statut qu'un auteur peut demander sur son IA (histoires 14 et
 * 15), et ce que chacune écrit.
 *
 * Pur, donc éprouvé par le Vitest du dépôt : `update-bot` ne porte que le
 * transport — identité, lecture de la ligne, écriture conditionnelle.
 */

export type BotStatus = 'en_attente' | 'active' | 'sommeil' | 'retiree'

/** Les deux seuls statuts qu'un auteur peut demander. */
export type RequestableStatus = 'retiree' | 'en_attente'

export const REQUESTABLE: readonly RequestableStatus[] = ['retiree', 'en_attente']

export function isRequestable(asked: string): asked is RequestableStatus {
  return (REQUESTABLE as readonly string[]).includes(asked)
}

/**
 * Ce qu'une transition demandée vaut, et pourquoi elle est refusée le cas
 * échéant. Deux règles, et rien d'autre :
 *
 * - **`retiree` est terminal.** « Retirer une IA est possible à tout moment »
 *   (histoire 14), depuis n'importe quel état vivant — une IA restée en
 *   qualification faute d'adresse joignable doit pouvoir disparaître, sans quoi
 *   son nom reste réservé à jamais. Mais elle ne revient pas : réactiver, ce
 *   serait revenir sur des classements déjà calculés.
 * - **`en_attente` ne s'atteint que depuis `sommeil`.** C'est la réactivation
 *   de l'histoire 15, qui repasse par la qualification de l'histoire 14. Aucune
 *   demande ne mène à `active` : cela reste le verdict de l'ordonnanceur.
 */
export function checkTransition(
  from: BotStatus,
  to: BotStatus,
): { ok: true } | { ok: false; message: string } {
  if (from === to) {
    return { ok: false, message: 'Cette IA est déjà dans cet état.' }
  }
  if (from === 'retiree') {
    return {
      ok: false,
      message:
        'Une IA retirée ne revient pas : déclarez-en une nouvelle si vous voulez la remettre au tournoi.',
    }
  }
  if (to === 'retiree') return { ok: true }
  if (from === 'sommeil') return { ok: true }
  return {
    ok: false,
    message:
      'Seule une IA en sommeil se réactive : celle-ci ne l’est pas, il n’y a rien à relancer.',
  }
}

/**
 * Colonnes écrites par une transition acceptée.
 *
 * L'Elo n'est **jamais** touché : une IA réactivée reprend le classement qui
 * avait été gelé à sa mise en sommeil (histoire 15). Le compteur de vagues
 * échouées, lui, repart de zéro à la réactivation — il a rempli son office en
 * prononçant le sommeil, et le laisser à trois rendormirait l'IA à son **premier**
 * échec de vague, avant même qu'elle ait eu sa chance.
 */
export function statusUpdate(status: RequestableStatus): Record<string, unknown> {
  return status === 'en_attente'
    ? { statut: status, vagues_echouees_consecutives: 0 }
    : { statut: status }
}

export const STATUS_MESSAGES: Record<RequestableStatus, string> = {
  retiree:
    'IA retirée. Elle sort des appariements dès maintenant ; ses parties passées restent consultables.',
  en_attente:
    'IA réactivée. Elle repasse par la qualification contre l’IA de la maison et reprend au classement qui avait été gelé.',
}
