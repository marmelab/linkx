import { useCallback, useEffect, useRef } from 'react'
import type { AiMove, AiRequest, AiResponse } from '../aiWorker'
import { MASTER_WORKER_BUDGET_MS, chooseMoveForDifficulty } from '../game/minimax'
import type { GamePosition } from '../game/simulation'
import type { Difficulty } from '../game/types'

/**
 * Coup de l'ordinateur, cherché hors du fil principal quand c'est possible.
 *
 * La recherche du maître se compte en secondes, et sur le fil principal
 * ce temps est exactement celui pendant lequel l'écran ne répond plus. C'est ce
 * plafond, et non l'algorithme, qui bornait sa force : le niveau bascule au-delà
 * d'environ 60 000 positions examinées, que 2,5 s sur le fil principal
 * n'atteignent pas. Dans un worker, l'attente ne fige rien et le budget passe
 * confortablement le seuil.
 *
 * **Repli.** Un worker indisponible — moteur ancien, fragment non mis en cache
 * hors ligne, erreur de chargement — ne casse pas la partie : on retombe sur la
 * recherche synchrone, c'est-à-dire sur le comportement d'avant. La force
 * baisse, le jeu continue.
 *
 * **Annulation.** Un worker par recherche, terminé dès la réponse ou dès que le
 * joueur change l'état. Aucune réponse périmée ne peut donc atteindre le
 * reducer, et une recherche abandonnée cesse réellement de consommer du temps —
 * ce qu'un simple drapeau ne ferait pas.
 */

function searchOnThisThread(
  position: GamePosition,
  difficulty: Difficulty,
): AiMove | null {
  const decision = chooseMoveForDifficulty(position, difficulty, Math.random)
  if (!decision) return null
  return {
    shapeId: decision.move.shapeId,
    rotation: decision.move.orientation.rotation,
    flipped: decision.move.orientation.flipped,
    column: decision.move.column,
  }
}

export type AiMoveSearch = {
  request: (
    position: GamePosition,
    difficulty: Difficulty,
  ) => Promise<AiMove | null>
  cancel: () => void
}

export function useAiMove(): AiMoveSearch {
  const workerRef = useRef<Worker | null>(null)
  // Une fois le worker jugé indisponible, on ne retente pas à chaque coup.
  const unsupportedRef = useRef(false)

  const cancel = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  const request = useCallback(
    (position: GamePosition, difficulty: Difficulty): Promise<AiMove | null> => {
      cancel()
      if (unsupportedRef.current) {
        return Promise.resolve(searchOnThisThread(position, difficulty))
      }

      let worker: Worker
      try {
        worker = new Worker(new URL('../aiWorker.ts', import.meta.url), {
          type: 'module',
        })
      } catch {
        unsupportedRef.current = true
        return Promise.resolve(searchOnThisThread(position, difficulty))
      }

      workerRef.current = worker
      return new Promise<AiMove | null>((resolve) => {
        const finish = (move: AiMove | null) => {
          worker.terminate()
          if (workerRef.current === worker) workerRef.current = null
          resolve(move)
        }
        worker.onmessage = (event: MessageEvent<AiResponse>) => {
          // Le worker rend `null` s'il n'a pas pu chercher ; refaire le calcul
          // ici rend soit le coup, soit le même `null` s'il n'y a aucun coup
          // légal — les deux cas se traitent donc sans les distinguer.
          finish(event.data.move ?? searchOnThisThread(position, difficulty))
        }
        worker.onerror = () => {
          unsupportedRef.current = true
          finish(searchOnThisThread(position, difficulty))
        }
        const message: AiRequest = {
          id: 0,
          position,
          difficulty,
          budgetMs: MASTER_WORKER_BUDGET_MS,
        }
        worker.postMessage(message)
      })
    },
    [cancel],
  )

  return { request, cancel }
}
