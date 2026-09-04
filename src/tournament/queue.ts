/**
 * État de ce qui attend d'être arbitré, vu de l'écran d'administration.
 *
 * La file elle-même vit dans `pgmq`, hors de portée d'un client : ses messages
 * ne font de toute façon que désigner des parties, et ce sont les parties qui
 * disent la vérité. On les compte donc directement.
 *
 * Aucun seuil d'immobilité n'est repris ici. Le serveur en a un — il remet en
 * file ce qui n'a pas bougé —, et le recopier en ferait une seconde vérité qui
 * divergerait au premier réglage. L'écran rend l'âge du plus ancien mouvement,
 * qui se juge sans convention partagée.
 */
export type QueueRow = {
  statut: string
  vague_id: string | null
  modifie_le: string
}

export type QueueState = {
  total: number
  /** Prise en charge par un tour d'arbitrage, mais pas encore terminée. */
  running: number
  waiting: number
  /** Parties d'une vague, et parties de qualification, qui n'avancent pas aux mêmes heures. */
  wave: number
  qualifications: number
  /** Dernier mouvement le plus ancien, en millisecondes, ou `null` sans partie. */
  oldestIdleMs: number | null
}

export function summarizeQueue(
  rows: readonly QueueRow[],
  now: number,
): QueueState {
  let running = 0
  let waiting = 0
  let wave = 0
  let qualifications = 0
  let oldest: number | null = null

  for (const row of rows) {
    if (row.statut === 'en_cours') running += 1
    else waiting += 1
    if (row.vague_id === null) qualifications += 1
    else wave += 1

    const touched = Date.parse(row.modifie_le)
    if (!Number.isNaN(touched) && (oldest === null || touched < oldest)) {
      oldest = touched
    }
  }

  return {
    total: rows.length,
    running,
    waiting,
    wave,
    qualifications,
    oldestIdleMs: oldest === null ? null : Math.max(0, now - oldest),
  }
}
