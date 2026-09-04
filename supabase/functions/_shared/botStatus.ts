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
 * échéant. Trois règles, et rien d'autre :
 *
 * - **`retiree` est terminal.** « Retirer une IA est possible à tout moment »
 *   (histoire 14), depuis n'importe quel état vivant — une IA restée en
 *   qualification faute d'adresse joignable doit pouvoir disparaître, sans quoi
 *   son nom reste réservé à jamais. Mais elle ne revient pas : réactiver, ce
 *   serait revenir sur des classements déjà calculés.
 * - **`sommeil` → `en_attente` est la réactivation** de l'histoire 15, qui
 *   repasse par la qualification de l'histoire 14.
 * - **`en_attente` → `en_attente` est la relance d'une qualification**, et non
 *   un non-événement. Une tentative n'est jamais rejouée d'elle-même — ce serait
 *   harceler une adresse morte à chaque réveil (`wavePlan.ts`) —, et
 *   l'ordonnanceur attend que l'auteur ait touché sa ligne pour en ouvrir une
 *   autre. Sans cette porte, une IA qui ratait sa première qualification y
 *   restait **à jamais** : elle occupait une place sur les dix du compte et
 *   gardait son nom réservé, sans aucun moyen de réessayer.
 *
 * Aucune demande ne mène à `active` : cela reste le verdict de l'ordonnanceur.
 */
export function checkTransition(
  from: BotStatus,
  to: BotStatus,
): { ok: true } | { ok: false; message: string } {
  if (from === 'retiree') {
    return {
      ok: false,
      message:
        'Une IA retirée ne revient pas : déclarez-en une nouvelle si vous voulez la remettre au tournoi.',
    }
  }
  if (to === 'retiree') return { ok: true }
  if (from === 'sommeil' || from === 'en_attente') return { ok: true }
  return {
    ok: false,
    message:
      'Une IA active joue déjà : il n’y a ni qualification à relancer, ni sommeil dont la sortir.',
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

/**
 * Le message dépend de l'état de **départ** : « réactivée » n'a aucun sens pour
 * une IA qui n'a jamais dormi, et l'auteur qui relance une qualification ratée
 * doit lire que c'est bien cela qui se produit.
 */
export function statusMessage(from: BotStatus, to: RequestableStatus): string {
  if (to === 'retiree') {
    return 'IA retirée. Elle sort des appariements dès maintenant ; ses parties passées restent consultables.'
  }
  if (from === 'en_attente') {
    return 'Qualification relancée. Une nouvelle partie contre l’IA de la maison s’ouvrira au prochain réveil, dans la minute.'
  }
  return 'IA réactivée. Elle repasse par la qualification contre l’IA de la maison et reprend au classement qui avait été gelé.'
}
