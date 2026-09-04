/**
 * File d'attente à un seul poste.
 *
 * `engineSearch` n'est pas réentrant : sa table de transposition, ses coups
 * tueurs et sa position de travail sont des variables de module, remises à zéro
 * à chaque appel. Deux recherches simultanées dans le même isolate se
 * corrompent et rendent un coup calculé sur la mauvaise position. Une fonction
 * edge servant plusieurs requêtes à la fois, les recherches sont enchaînées par
 * une chaîne de promesses : chacune attend que la précédente ait rendu la main.
 *
 * Attendre son tour consomme le délai annoncé par la plateforme. Un appel n'est
 * donc admis que si la file devant lui laisse encore de quoi chercher avant son
 * échéance ; sinon il est **refusé immédiatement** (503), ce qui vaut mieux
 * qu'une réponse hors délai que l'arbitre jettera de toute façon.
 */

/**
 * Budget visé quand le temps ne manque pas, bien en deçà des 2 s de processeur.
 *
 * Valeur **mesurée**, pas supposée. Le runtime ne réutilise pas son isolate
 * d'une requête simultanée à l'autre : vingt appels de front, c'est vingt
 * recherches en parallèle sur les mêmes cœurs, et le temps de processeur d'une
 * requête gonfle d'autant. Sur ce banc — vingt appels simultanés, trois lots de
 * vingt —, un budget de 1 000 ms fait couper 26 réponses sur 60 par
 * `WORKER_LIMIT` ; à 700 ms, quatre lots sur cinq passent sans une seule
 * coupure. La recherche convergeant en 640 ms environ sur la position
 * d'ouverture, la plus large du jeu, ce palier ne coûte pratiquement pas de
 * force.
 */
export const TARGET_BUDGET_MS = 700

/** En deçà, la recherche ne vaut plus la peine d'être lancée. */
export const MIN_BUDGET_MS = 200

/** Analyse, sérialisation, contrôle de légalité et aller-retour réseau. */
export const RESPONSE_MARGIN_MS = 400

/**
 * Délai annoncé maximal retenu, quoi que l'appelant demande.
 *
 * Le délai n'est pas une simple promesse faite à l'appelant : c'est **lui** qui
 * décide de l'admission ci-dessous. Un appelant qui annonce dix fois le délai du
 * protocole se ferait admettre dix fois plus loin dans la file, et le refus
 * d'admission — qui existe pour ne pas répondre hors délai — ne protégerait plus
 * rien. La plateforme n'annonce jamais plus de six secondes.
 */
export const MAX_DEADLINE_MS = 6_000

export class SearchQueueFullError extends Error {
  constructor(readonly queuedAhead: number) {
    super(`File pleine : ${queuedAhead} recherche(s) déjà en attente.`)
    this.name = 'SearchQueueFullError'
  }
}

let tail: Promise<unknown> = Promise.resolve()
let queued = 0

/** Nombre de recherches en cours ou en attente. Exposé pour les journaux. */
export function pendingSearches(): number {
  return queued
}

/**
 * Temps de recherche accordé à un appel qui démarre maintenant, compte tenu de
 * ce qu'il a déjà passé dans la file.
 */
export function affordableBudgetMs(remainingMs: number): number {
  return Math.max(
    MIN_BUDGET_MS,
    Math.min(TARGET_BUDGET_MS, remainingMs - RESPONSE_MARGIN_MS),
  )
}

/**
 * Enfile une recherche synchrone. `task` reçoit le budget calculé à l'instant
 * où son tour vient, et non à l'inscription : une file qui s'est vidée plus
 * vite que prévu rend son temps à l'appel suivant.
 */
export function enqueueSearch<T>(
  task: (budgetMs: number) => T,
  deadlineMs: number,
  startedAt: number = Date.now(),
): Promise<T> {
  const deadline = Math.min(deadlineMs, MAX_DEADLINE_MS)
  const projectedWaitMs = queued * TARGET_BUDGET_MS
  if (projectedWaitMs + MIN_BUDGET_MS + RESPONSE_MARGIN_MS > deadline) {
    return Promise.reject(new SearchQueueFullError(queued))
  }

  queued += 1
  const run = tail.then(() =>
    task(affordableBudgetMs(deadline - (Date.now() - startedAt))),
  )
  // La queue ne doit jamais porter de rejet : un échec ne bloque pas la suite.
  tail = run.catch(() => undefined)
  return run.finally(() => {
    queued -= 1
  })
}
