import { describe, expect, it } from 'vitest'
import {
  authorizePlatformCall,
  forceAsked,
  fromPlatform,
  readJsonBody,
  sameSecret,
} from './platformAuth.ts'

const KEY = 'cle-de-service-0123456789'

function requestWith(authorization: string | null): Request {
  return new Request('https://exemple.test/', {
    headers: authorization === null ? {} : { authorization },
  })
}

describe('comparaison de la clé de service', () => {
  it('accepte la clé exacte et refuse toute autre', () => {
    expect(sameSecret(KEY, KEY)).toBe(true)
    expect(sameSecret(`${KEY}x`, KEY)).toBe(false)
    expect(sameSecret(KEY.slice(0, -1), KEY)).toBe(false)
    expect(sameSecret(`${KEY.slice(0, -1)}X`, KEY)).toBe(false)
  })

  it('refuse quand la clé attendue est vide', () => {
    expect(sameSecret('', '')).toBe(false)
  })
})

describe('appel venu de la plateforme', () => {
  it('reconnaît le jeton porteur, quelle que soit la casse du préfixe', () => {
    expect(fromPlatform(requestWith(`Bearer ${KEY}`), KEY)).toBe(true)
    expect(fromPlatform(requestWith(`bearer ${KEY}`), KEY)).toBe(true)
  })

  it('refuse un autre jeton, ou l’absence d’en-tête', () => {
    expect(fromPlatform(requestWith('Bearer jeton-de-visiteur'), KEY)).toBe(false)
    expect(fromPlatform(requestWith(null), KEY)).toBe(false)
  })

  it('refuse tout appel quand la clé attendue manque', () => {
    expect(fromPlatform(requestWith('Bearer '), '')).toBe(false)
  })
})

/* Déclenchement à la main, par un administrateur --------------------------- */

const URL_BASE = 'https://projet.test'
const ANON = 'cle-anonyme'
const ADMIN = '11111111-2222-3333-4444-555555555555'
const SIMPLE = '99999999-8888-7777-6666-555555555555'

/**
 * Faux service : `/auth/v1/user` rend l'identité du porteur connu, et
 * `/rest/v1/administrateurs` la seule ligne de l'administrateur. Les appels
 * sont enregistrés pour prouver ce qui a été demandé, et à qui.
 */
function fakeService(sessions: Record<string, string>) {
  const calls: string[] = []
  const fetchLike = async (input: string, init?: RequestInit) => {
    calls.push(input)
    if (input.startsWith(`${URL_BASE}/auth/v1/user`)) {
      const bearer = String(
        (init?.headers as Record<string, string>)?.authorization ?? '',
      ).replace(/^Bearer\s+/i, '')
      const id = sessions[bearer]
      return id === undefined
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify({ id }), { status: 200 })
    }
    if (input.includes('/rest/v1/administrateurs')) {
      const found = input.includes(`utilisateur_id=eq.${ADMIN}`)
      return new Response(JSON.stringify(found ? [{ utilisateur_id: ADMIN }] : []), {
        status: 200,
      })
    }
    throw new Error(`appel inattendu : ${input}`)
  }
  return { calls, fetch: fetchLike }
}

function callWith(authorization: string): Request {
  return new Request('https://projet.test/functions/v1/scheduler', {
    method: 'POST',
    headers: { authorization },
  })
}

const options = (fetchLike: ReturnType<typeof fakeService>['fetch']) => ({
  supabaseUrl: URL_BASE,
  anonKey: ANON,
  serviceKey: KEY,
  fetch: fetchLike,
})

describe('autorisation d’un appel de plateforme', () => {
  it('reconnaît la clé de service sans toucher au réseau', async () => {
    const service = fakeService({})
    const caller = await authorizePlatformCall(
      callWith(`Bearer ${KEY}`),
      options(service.fetch),
    )
    expect(caller).toEqual({ kind: 'service' })
    expect(service.calls).toEqual([])
  })

  it('reconnaît un administrateur à sa session', async () => {
    const service = fakeService({ 'jeton-admin': ADMIN })
    const caller = await authorizePlatformCall(
      callWith('Bearer jeton-admin'),
      options(service.fetch),
    )
    expect(caller).toEqual({ kind: 'admin', userId: ADMIN })
    // L'identité vient du service d'authentification, jamais du jeton décodé.
    expect(service.calls[0]).toBe(`${URL_BASE}/auth/v1/user`)
  })

  it('refuse un authentifié qui n’est pas administrateur', async () => {
    const service = fakeService({ 'jeton-simple': SIMPLE })
    expect(
      await authorizePlatformCall(
        callWith('Bearer jeton-simple'),
        options(service.fetch),
      ),
    ).toBeNull()
  })

  it('refuse un inconnu exactement de la même façon', async () => {
    const service = fakeService({})
    expect(
      await authorizePlatformCall(
        callWith('Bearer jeton-inventé'),
        options(service.fetch),
      ),
    ).toBeNull()
    expect(
      await authorizePlatformCall(
        new Request('https://projet.test/functions/v1/scheduler', { method: 'POST' }),
        options(service.fetch),
      ),
    ).toBeNull()
  })

  it('refuse quand la table des administrateurs est illisible', async () => {
    const enPanne = async (input: string) =>
      input.startsWith(`${URL_BASE}/auth/v1/user`)
        ? new Response(JSON.stringify({ id: ADMIN }), { status: 200 })
        : new Response('{"message":"panne"}', { status: 503 })
    expect(
      await authorizePlatformCall(callWith('Bearer jeton-admin'), options(enPanne)),
    ).toBeNull()
  })

  it('ne va pas chercher un identifiant qui n’est pas un UUID', async () => {
    const service = fakeService({ 'jeton-tordu': '1; drop table bots' })
    expect(
      await authorizePlatformCall(
        callWith('Bearer jeton-tordu'),
        options(service.fetch),
      ),
    ).toBeNull()
    expect(service.calls.some((call) => call.includes('administrateurs'))).toBe(false)
  })
})

describe('option force', () => {
  it('n’est honorée que d’un administrateur', () => {
    expect(forceAsked({ force: true }, { kind: 'admin', userId: ADMIN })).toBe(true)
    expect(forceAsked({ force: true }, { kind: 'service' })).toBe(false)
  })

  it('reste fermée sans demande explicite', () => {
    const admin = { kind: 'admin', userId: ADMIN } as const
    expect(forceAsked(null, admin)).toBe(false)
    expect(forceAsked({}, admin)).toBe(false)
    expect(forceAsked({ force: 'oui' }, admin)).toBe(false)
    expect(forceAsked({ force: 1 }, admin)).toBe(false)
  })
})

describe('corps JSON d’une requête', () => {
  it('rend le corps, ou null s’il est absent ou illisible', async () => {
    const avec = new Request('https://exemple.test/', {
      method: 'POST',
      body: JSON.stringify({ force: true }),
    })
    expect(await readJsonBody(avec)).toEqual({ force: true })
    expect(
      await readJsonBody(new Request('https://exemple.test/', { method: 'POST' })),
    ).toBeNull()
    expect(
      await readJsonBody(
        new Request('https://exemple.test/', { method: 'POST', body: '{ cassé' }),
      ),
    ).toBeNull()
  })
})
