/**
 * Classement public : ordre d'affichage et écriture de l'écart.
 *
 * Le rang vient de la vue `classement`, qui l'établit en base ; l'écran ne le
 * recalcule pas — ce serait une seconde définition à tenir d'accord. Il se
 * contente de rendre l'ordre déterministe, PostgREST ne garantissant pas celui
 * d'une colonne de fenêtrage, et d'écrire l'écart avec son signe.
 */
import type { LeaderboardRow } from './types'

/** Rang croissant, puis nom : deux ex æquo se lisent toujours dans le même ordre. */
export function orderLeaderboard(
  rows: readonly LeaderboardRow[],
): LeaderboardRow[] {
  return [...rows].sort(
    (a, b) =>
      a.rang - b.rang ||
      b.elo - a.elo ||
      a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }),
  )
}

/**
 * « +18 », « −7 », « = » : le signe est **écrit**, jamais porté par la seule
 * couleur. Le moins est un vrai signe moins (U+2212), pas un trait d'union.
 * Une IA qui n'a encore joué aucune vague n'a pas d'écart : « — ».
 */
export function formatGap(gap: number | null): string {
  if (gap === null || Number.isNaN(gap)) return '—'
  if (gap === 0) return '='
  return gap > 0 ? `+${gap}` : `−${Math.abs(gap)}`
}
