/**
 * IA de la maison — l'adversaire du jeu exposé comme bot de tournoi.
 *
 * Contrat public : `docs/protocole-ia.md`. Cette fonction en est l'exemple
 * canonique, elle ne doit donc s'en écarter sur aucun point. Elle ne porte que
 * du transport : lire et authentifier la requête, enfiler la recherche, rendre
 * un jeton. Les règles restent dans `src/game/`.
 */
import { chooseBotMove } from './botMove.ts'
import {
  MAX_DEADLINE_MS,
  SearchQueueFullError,
  enqueueSearch,
  pendingSearches,
} from './searchQueue.ts'
import { ALLOW_UNSIGNED_ENV, SECRET_ENV, verifySignature } from './signature.ts'
import type { PlayerId } from '../../../src/game/types.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** Délai annoncé par le protocole, employé quand la requête n'en donne aucun. */
const DEFAULT_DEADLINE_MS = 6_000

/** Version du dialogue que cette IA connaît ; une autre ne la fait pas échouer. */
const KNOWN_PROTOCOL = 1

const secret = Deno.env.get(SECRET_ENV)
const allowUnsigned = Deno.env.get(ALLOW_UNSIGNED_ENV) === '1'
if (!secret) {
  console.error(
    allowUnsigned
      ? `bot-linkx : ${SECRET_ENV} absent et ${ALLOW_UNSIGNED_ENV} posée, appels non signés acceptés — développement seulement.`
      : `bot-linkx : ${SECRET_ENV} absent, tous les appels sont refusés.`,
  )
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function refuse(status: number, message: string, extra: object = {}): Response {
  return json({ error: message, ...extra }, status)
}

function readColor(value: unknown): PlayerId | null | undefined {
  if (value === undefined || value === null) return null
  if (value === 'blue' || value === 'white') return value
  return undefined
}

/**
 * Délai annoncé par l'appelant. Le plafond est appliqué par `enqueueSearch`,
 * pour qui ce délai n'est pas une promesse mais le critère d'admission.
 */
function readDeadline(value: unknown): number {
  const asked = typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_DEADLINE_MS
  return Math.min(asked, MAX_DEADLINE_MS)
}

Deno.serve(async (request: Request): Promise<Response> => {
  const startedAt = Date.now()
  if (request.method !== 'POST') {
    return refuse(405, 'Utiliser POST.')
  }

  const rawBody = await request.text()
  const verdict = await verifySignature(request.headers, rawBody, secret, {
    allowUnsigned,
  })
  if (!verdict.ok) return refuse(401, verdict.message)

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return refuse(400, 'Corps JSON illisible.')
  }
  if (typeof payload !== 'object' || payload === null) {
    return refuse(400, 'Le corps doit être un objet JSON.')
  }

  const body = payload as Record<string, unknown>
  if (body.protocol !== undefined && body.protocol !== KNOWN_PROTOCOL) {
    console.warn(`bot-linkx : version de protocole inconnue (${body.protocol}).`)
  }

  const record = body.record
  if (typeof record !== 'string') {
    return refuse(400, 'Champ « record » manquant ou non textuel.')
  }
  const color = readColor(body.color)
  if (color === undefined) {
    return refuse(400, 'Champ « color » : « blue » ou « white » attendu.')
  }
  const deadlineMs = readDeadline(body.deadline_ms)
  const game = typeof body.game === 'string' ? body.game : '?'

  const queuedAhead = pendingSearches()
  let result: ReturnType<typeof chooseBotMove>
  let budgetUsedMs = 0
  try {
    result = await enqueueSearch(
      (budgetMs) => {
        budgetUsedMs = budgetMs
        return chooseBotMove(record, color, budgetMs)
      },
      deadlineMs,
      startedAt,
    )
  } catch (error) {
    if (error instanceof SearchQueueFullError) {
      console.warn(`bot-linkx : ${game} refusé, ${error.queuedAhead} en file.`)
      return refuse(
        503,
        'Trop de recherches en attente pour tenir le délai annoncé.',
        { queued: error.queuedAhead },
      )
    }
    throw error
  }

  if (!result.ok) {
    switch (result.failure) {
      case 'notation':
        return refuse(400, 'Notation de partie invalide.', {
          reason: result.error.reason,
          index: result.error.index,
          token: result.error.token,
        })
      case 'finished':
        return refuse(409, 'La partie est déjà terminée.')
      case 'wrong-color':
        return refuse(409, 'La couleur annoncée n’est pas celle du joueur au trait.', {
          expected: result.expected,
        })
      case 'no-move':
        return refuse(409, 'Aucun coup légal : ce tour est une passe forcée.')
      case 'self-illegal':
        // Impossible tant que la recherche et l'arbitre partagent `src/game/`.
        console.error(
          `bot-linkx : coup rejeté par notre propre arbitre (${result.token}, ${result.error.reason}).`,
        )
        return refuse(500, 'Coup calculé refusé par le contrôle de légalité.')
    }
  }

  const elapsedMs = Date.now() - startedAt
  console.log(
    `bot-linkx ${game} ${result.activePlayer} → ${result.move} ` +
      `(${elapsedMs} ms, budget ${budgetUsedMs} ms, ${result.exploredNodes} nœuds, ` +
      `${queuedAhead} devant, signature ${verdict.checked ? 'vérifiée' : 'ignorée'})`,
  )
  return json({ move: result.move })
})
