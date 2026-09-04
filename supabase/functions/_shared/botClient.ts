/**
 * Appel d'une IA distante : le seul endroit du dépôt qui parle à un service
 * d'auteur (histoire 14, contrat public dans `docs/protocole-ia.md`).
 *
 * Le module **transporte, il n'arbitre pas** : il rend le jeton reçu sans jamais
 * le confronter aux règles, ce travail revenant à `referee.ts`. Il n'a donc que
 * trois issues d'échec, celles qui se constatent sans connaître le jeu.
 *
 * `fetch` et l'horloge sont **injectés**, comme `engineSearch.ts` injecte son
 * `options.now` : c'est ce qui rend le module testable sans réseau, signature
 * comprise.
 */
import type { BotReply, OutcomeReason } from './referee.ts'
import type { PlayerId } from '../../../src/game/types.ts'

/** Version du dialogue, `protocol` dans le corps de la requête. */
export const PROTOCOL_VERSION = 1

/** Délai annoncé à l'IA et appliqué à l'appel, en millisecondes. */
export const MOVE_DEADLINE_MS = 6000

/**
 * Un corps de réponse légitime tient en une vingtaine d'octets. La borne est
 * large pour les services bavards, et surtout **finie** : sans elle, un service
 * hostile tiendrait la plateforme sur un flux sans fin jusqu'au délai.
 */
export const MAX_REPLY_BYTES = 8192

/** Ce que le journal d'une partie conserve du corps reçu. */
const MAX_SNIPPET_LENGTH = 500

export type BotCallFailure = Extract<
  OutcomeReason,
  'timeout' | 'unreachable' | 'unreadable-reply'
>

export type BotCallRequest = {
  /** Adresse déjà validée par `checkBotAddress`. */
  address: string
  /** Secret de signature de l'IA, remis à son auteur à l'inscription. */
  secret: string
  gameId: string
  color: PlayerId
  /** Notation de la partie depuis son début ; vide sur un plateau nu. */
  record: string
  deadlineMs?: number
}

/**
 * En-têtes tels qu'ils sont partis. Rendus avec le résultat plutôt que
 * reconstruits par l'appelant : les recalculer ailleurs dupliquerait la
 * signature, et la copie finirait par mentir sur l'appel réel.
 *
 * `null` quand **rien n'est parti** — un échec constaté avant l'appel. Le
 * distinguer d'un jeu d'en-têtes vide oblige chaque construction à dire lequel
 * des deux elle est.
 */
export type SentHeaders = Record<string, string>

export type BotCallResult =
  | {
    ok: true
    /** Jeton rendu par l'IA, espaces retirés. Sa légalité n'est pas jugée ici. */
    move: string
    latencyMs: number
    status: number
    snippet: string
    headers: SentHeaders
  }
  | {
    ok: false
    failure: BotCallFailure
    latencyMs: number
    /** Code HTTP obtenu, ou `null` si la connexion n'a rien rendu. */
    status: number | null
    snippet: string
    headers: SentHeaders | null
    /** Motif technique, destiné au journal de la partie. */
    detail: string
  }

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type BotCallDeps = {
  fetch: FetchLike
  /** Horloge en millisecondes ; `Date.now` en production. */
  now: () => number
  maxReplyBytes?: number
}

const encoder = new TextEncoder()

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/**
 * HMAC-SHA256 de `<timestamp>.<corps>`, en hexadécimal. Web Crypto suffit : ni
 * dépendance externe, ni implémentation maison d'une primitive.
 */
export async function signPayload(
  secret: string,
  timestampSeconds: number,
  body: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(`${timestampSeconds}.${body}`),
  )
  return toHex(new Uint8Array(mac))
}

/** Corps exact envoyé à l'IA, et signé tel quel. */
export function buildRequestBody(
  request: BotCallRequest,
  deadlineMs: number,
): string {
  return JSON.stringify({
    protocol: PROTOCOL_VERSION,
    game: request.gameId,
    color: request.color,
    record: request.record,
    deadline_ms: deadlineMs,
  })
}

type BoundedBody = { ok: true; text: string } | { ok: false }

async function readBounded(
  response: Response,
  maxBytes: number,
): Promise<BoundedBody> {
  if (!response.body) return { ok: true, text: '' }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false }
    }
    chunks.push(value)
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(joined) }
}

function snippetOf(text: string): string {
  return text.length > MAX_SNIPPET_LENGTH
    ? text.slice(0, MAX_SNIPPET_LENGTH)
    : text
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Appelle une IA et rend le jeton reçu, ou le motif d'échec. La latence est
 * celle réellement observée, mesurée sur l'horloge injectée et rendue même en
 * cas d'échec : c'est elle que le journal de la partie affiche à l'auteur.
 */
export async function callBot(
  request: BotCallRequest,
  deps: BotCallDeps,
): Promise<BotCallResult> {
  const deadlineMs = request.deadlineMs ?? MOVE_DEADLINE_MS
  const maxReplyBytes = deps.maxReplyBytes ?? MAX_REPLY_BYTES
  const body = buildRequestBody(request, deadlineMs)

  const startedAt = deps.now()
  const timestamp = Math.floor(startedAt / 1000)
  const signature = await signPayload(request.secret, timestamp, body)
  const elapsed = () => Math.max(0, Math.round(deps.now() - startedAt))

  const sentHeaders: SentHeaders = {
    'content-type': 'application/json; charset=utf-8',
    accept: 'application/json',
    'X-Linkx-Timestamp': String(timestamp),
    'X-Linkx-Signature': `sha256=${signature}`,
  }

  const signal = AbortSignal.timeout(deadlineMs)
  const failed = (
    failure: BotCallFailure,
    status: number | null,
    detail: string,
    snippet = '',
  ): BotCallResult => ({
    ok: false,
    failure,
    latencyMs: elapsed(),
    status,
    snippet,
    headers: sentHeaders,
    detail,
  })

  let response: Response
  try {
    response = await deps.fetch(request.address, {
      method: 'POST',
      headers: sentHeaders,
      body,
      signal,
      // Une redirection contournerait le contrôle d'adresse : elle ramènerait
      // l'appel sur une machine que `checkBotAddress` n'a jamais vue.
      redirect: 'error',
    })
  } catch (error) {
    return signal.aborted
      ? failed('timeout', null, `pas de réponse en ${deadlineMs} ms`)
      : failed('unreachable', null, describeError(error))
  }

  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {})
    return failed(
      'unreachable',
      response.status,
      `code HTTP ${response.status}`,
    )
  }

  let bounded: BoundedBody
  try {
    bounded = await readBounded(response, maxReplyBytes)
  } catch (error) {
    return signal.aborted
      ? failed('timeout', response.status, `réponse incomplète en ${deadlineMs} ms`)
      : failed('unreachable', response.status, describeError(error))
  }
  if (!bounded.ok) {
    return failed(
      'unreadable-reply',
      response.status,
      `corps de plus de ${maxReplyBytes} octets`,
    )
  }

  const snippet = snippetOf(bounded.text)
  let payload: unknown
  try {
    payload = JSON.parse(bounded.text)
  } catch {
    return failed(
      'unreadable-reply',
      response.status,
      'corps JSON illisible',
      snippet,
    )
  }

  const move = (payload as { move?: unknown } | null)?.move
  if (typeof move !== 'string' || move.trim() === '') {
    return failed(
      'unreadable-reply',
      response.status,
      'champ « move » absent ou non textuel',
      snippet,
    )
  }

  return {
    ok: true,
    move: move.trim(),
    latencyMs: elapsed(),
    status: response.status,
    snippet,
    headers: sentHeaders,
  }
}

/**
 * Passe le résultat à l'arbitre. Un corps illisible lui est présenté **vide**,
 * la forme que `judgeReply` refuse déjà sous `unreadable-reply` : c'est lui, et
 * lui seul, qui nomme l'issue de la partie.
 */
export function toBotReply(result: BotCallResult): BotReply {
  if (result.ok) return { ok: true, body: result.move }
  if (result.failure === 'unreadable-reply') return { ok: true, body: '' }
  return { ok: false, failure: result.failure, detail: result.detail }
}
