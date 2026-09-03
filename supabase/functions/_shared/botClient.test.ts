import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildRequestBody,
  callBot,
  MAX_REPLY_BYTES,
  MOVE_DEADLINE_MS,
  PROTOCOL_VERSION,
  signPayload,
  toBotReply,
} from './botClient.ts'
import type { BotCallDeps, BotCallRequest, FetchLike } from './botClient.ts'

const REQUEST: BotCallRequest = {
  address: 'https://ia.exemple.fr/coup',
  secret: 'secret-de-lauteur',
  gameId: '9f1c-0000',
  color: 'blue',
  record: '4Lsr21 4Ss3',
}

/** Horloge injectée : premier appel à l'émission, second à la réception. */
function clock(...values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)]
}

type Call = { url: string; init: RequestInit }

function recorder(reply: () => Response | Promise<Response>): {
  fetch: FetchLike
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    fetch: (url, init) => {
      calls.push({ url, init })
      return Promise.resolve(reply())
    },
  }
}

function deps(fetchImpl: FetchLike, ...times: number[]): BotCallDeps {
  return { fetch: fetchImpl, now: clock(...times) }
}

function jsonReply(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('appel réussi', () => {
  it('rend le coup, la latence observée et le code HTTP', async () => {
    const { fetch } = recorder(() => jsonReply('{"move":"  4Lsr27 "}'))
    const result = await callBot(
      REQUEST,
      deps(fetch, 1_756_900_000_000, 1_756_900_000_250),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.move).toBe('4Lsr27')
    expect(result.latencyMs).toBe(250)
    expect(result.status).toBe(200)
  })

  it('compose le corps du protocole et l’envoie tel quel', async () => {
    const { fetch, calls } = recorder(() => jsonReply('{"move":"15"}'))
    await callBot(REQUEST, deps(fetch, 1_756_900_000_000))

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(REQUEST.address)
    expect(calls[0].init.method).toBe('POST')
    // Une redirection ramènerait l'appel hors de l'adresse contrôlée.
    expect(calls[0].init.redirect).toBe('error')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      protocol: PROTOCOL_VERSION,
      game: REQUEST.gameId,
      color: 'blue',
      record: REQUEST.record,
      deadline_ms: MOVE_DEADLINE_MS,
    })
  })

  it('ne juge pas la légalité : un jeton absurde est rendu tel quel', async () => {
    const { fetch } = recorder(() => jsonReply('{"move":"9Z9"}'))
    const result = await callBot(REQUEST, deps(fetch, 0, 5))
    expect(result.ok && result.move).toBe('9Z9')
  })
})

describe('signature', () => {
  it('signe « timestamp.corps » et se recalcule chez l’auteur', async () => {
    const { fetch, calls } = recorder(() => jsonReply('{"move":"15"}'))
    await callBot(REQUEST, deps(fetch, 1_756_900_000_400))

    const headers = calls[0].init.headers as Record<string, string>
    const body = String(calls[0].init.body)
    expect(headers['X-Linkx-Timestamp']).toBe('1756900000')
    expect(body).toBe(buildRequestBody(REQUEST, MOVE_DEADLINE_MS))

    // Vérification par un autre chemin que celui du module : c'est ce qu'un
    // auteur d'IA écrira de son côté.
    const attendu = createHmac('sha256', REQUEST.secret)
      .update(`1756900000.${body}`)
      .digest('hex')
    expect(headers['X-Linkx-Signature']).toBe(`sha256=${attendu}`)
  })

  it('rend la même empreinte que Web Crypto sur un corps accentué', async () => {
    const body = '{"move":"é"}'
    const hex = await signPayload('clé secrète', 42, body)
    expect(hex).toBe(
      createHmac('sha256', 'clé secrète').update(`42.${body}`).digest('hex'),
    )
  })
})

describe('échecs', () => {
  it('rend « timeout » quand le service ne répond pas dans le délai', async () => {
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('délai dépassé', 'TimeoutError'))
        })
      })
    const result = await callBot(
      { ...REQUEST, deadlineMs: 20 },
      deps(fetchImpl, 0, 21),
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe('timeout')
    expect(result.status).toBeNull()
    expect(result.latencyMs).toBe(21)
  })

  it('rend « unreachable » sur une erreur de connexion', async () => {
    const fetchImpl: FetchLike = () =>
      Promise.reject(new TypeError('error sending request'))
    const result = await callBot(REQUEST, deps(fetchImpl, 0, 12))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe('unreachable')
    expect(result.detail).toContain('error sending request')
  })

  it('rend « unreachable » sur un code HTTP autre que 200', async () => {
    const { fetch } = recorder(() => jsonReply('{"move":"15"}', 503))
    const result = await callBot(REQUEST, deps(fetch, 0, 30))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe('unreachable')
    expect(result.status).toBe(503)
    expect(result.detail).toBe('code HTTP 503')
  })

  it('rend « unreadable-reply » sur un corps qui n’est pas du JSON', async () => {
    const { fetch } = recorder(() => new Response('4Lsr27', { status: 200 }))
    const result = await callBot(REQUEST, deps(fetch, 0, 8))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe('unreadable-reply')
    expect(result.snippet).toBe('4Lsr27')
  })

  it('rend « unreadable-reply » quand « move » manque ou n’est pas un texte', async () => {
    for (const body of ['{"coup":"15"}', '{"move":42}', '{"move":"  "}', 'null']) {
      const { fetch } = recorder(() => jsonReply(body))
      const result = await callBot(REQUEST, deps(fetch, 0, 4))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.failure).toBe('unreadable-reply')
    }
  })

  it('coupe un corps démesuré au lieu de l’avaler', async () => {
    const enorme = `{"move":"${'x'.repeat(MAX_REPLY_BYTES * 2)}"}`
    const { fetch } = recorder(() => jsonReply(enorme))
    const result = await callBot(REQUEST, deps(fetch, 0, 40))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure).toBe('unreadable-reply')
    expect(result.detail).toContain('octets')
    expect(result.snippet).toBe('')
  })
})

describe('passage à l’arbitre', () => {
  it('transmet le jeton reçu', () => {
    expect(
      toBotReply({
        ok: true,
        move: '4Lsr27',
        latencyMs: 12,
        status: 200,
        snippet: '',
      }),
    ).toEqual({ ok: true, body: '4Lsr27' })
  })

  it('présente un corps illisible comme une réponse vide, que l’arbitre refuse', () => {
    expect(
      toBotReply({
        ok: false,
        failure: 'unreadable-reply',
        latencyMs: 12,
        status: 200,
        snippet: 'bonjour',
        detail: 'corps JSON illisible',
      }),
    ).toEqual({ ok: true, body: '' })
  })

  it('transmet les échecs de transport sous leur motif', () => {
    expect(
      toBotReply({
        ok: false,
        failure: 'timeout',
        latencyMs: 6000,
        status: null,
        snippet: '',
        detail: 'pas de réponse en 6000 ms',
      }),
    ).toEqual({
      ok: false,
      failure: 'timeout',
      detail: 'pas de réponse en 6000 ms',
    })
  })
})
