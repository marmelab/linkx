import { useState } from 'react'
import { DEFAULT_DIFFICULTY, DIFFICULTY_IDS } from '../game/types'
import type { Difficulty } from '../game/types'

const STORAGE_KEY = 'linkx.difficulty'

/**
 * Le stockage est indisponible en navigation privée sur certains moteurs, et
 * sa seule lecture lève quand les cookies sont bloqués. Chaque accès est donc
 * gardé : sans stockage, le niveau vaut pour la session en cours et rien de
 * plus. La préférence n'est qu'un confort, elle ne doit jamais casser l'écran.
 */
function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

const isDifficulty = (value: unknown): value is Difficulty =>
  DIFFICULTY_IDS.includes(value as Difficulty)

/**
 * Une valeur absente, altérée ou écrite par une version antérieure ne doit pas
 * atteindre la recherche : elle est ignorée au profit du défaut. C'est la même
 * discipline que pour une position lue dans l'URL — rien de ce qui vient du
 * dehors n'est cru sur parole.
 */
export function readStoredDifficulty(): Difficulty {
  try {
    const stored = getStorage()?.getItem(STORAGE_KEY)
    return isDifficulty(stored) ? stored : DEFAULT_DIFFICULTY
  } catch {
    return DEFAULT_DIFFICULTY
  }
}

export function writeStoredDifficulty(difficulty: Difficulty): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, difficulty)
  } catch {
    // Stockage plein ou refusé : le choix reste valable pour cette session.
  }
}

/**
 * Même forme que `useState`, à ceci près que la valeur initiale vient du
 * stockage et que chaque choix y retourne. L'écran de départ se remonte à
 * chaque retour au menu ; sans cela le niveau repartirait du défaut à chaque
 * partie.
 */
export function useStoredDifficulty() {
  const [difficulty, setDifficulty] = useState<Difficulty>(readStoredDifficulty)

  const choose = (next: Difficulty) => {
    setDifficulty(next)
    writeStoredDifficulty(next)
  }

  return [difficulty, choose] as const
}
