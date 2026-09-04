import { describe, expect, it } from 'vitest'
import { MAX_TIMESTAMP_AGE_S, verifySignature } from './signature.ts'

const SECRET = 'secret-de-signature'
const BODY = '{"protocol":1,"record":"","color":"blue"}'
const NOW_S = 1_800_000_000

async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  )
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function signedHeaders(timestamp = NOW_S, secret = SECRET): Promise<Headers> {
  return new Headers({
    'x-linkx-timestamp': String(timestamp),
    'x-linkx-signature': `sha256=${await sign(secret, timestamp, BODY)}`,
  })
}

describe('vérification de la signature', () => {
  it('accepte un appel correctement signé', async () => {
    const verdict = await verifySignature(
      await signedHeaders(),
      BODY,
      SECRET,
      { nowSeconds: NOW_S },
    )
    expect(verdict).toEqual({ ok: true, checked: true })
  })

  it('refuse une signature calculée avec un autre secret', async () => {
    const verdict = await verifySignature(
      await signedHeaders(NOW_S, 'autre-secret'),
      BODY,
      SECRET,
      { nowSeconds: NOW_S },
    )
    expect(verdict.ok).toBe(false)
  })

  it('refuse un horodatage hors fenêtre, donc un appel rejoué', async () => {
    const stale = NOW_S - MAX_TIMESTAMP_AGE_S - 1
    const verdict = await verifySignature(
      await signedHeaders(stale),
      BODY,
      SECRET,
      { nowSeconds: NOW_S },
    )
    expect(verdict.ok).toBe(false)
  })

  it('refuse un appel non signé', async () => {
    const verdict = await verifySignature(new Headers(), BODY, SECRET, {
      nowSeconds: NOW_S,
    })
    expect(verdict.ok).toBe(false)
  })

  it('refuse tout appel quand aucun secret n’est configuré', async () => {
    const verdict = await verifySignature(
      await signedHeaders(),
      BODY,
      undefined,
      { nowSeconds: NOW_S },
    )
    expect(verdict.ok).toBe(false)
  })

  it('n’accepte un appel non signé que sous la variable de développement', async () => {
    const verdict = await verifySignature(new Headers(), BODY, undefined, {
      allowUnsigned: true,
      nowSeconds: NOW_S,
    })
    expect(verdict).toEqual({ ok: true, checked: false })
  })
})
