import { describe, expect, it } from 'vitest'
import { RestError, UNIQUE_VIOLATION, createRest } from './rest.ts'

type Seen = { url: string; init: RequestInit }

function stub(response: Response): { rest: ReturnType<typeof createRest>; seen: Seen[] } {
  const seen: Seen[] = []
  const rest = createRest({
    url: 'https://projet.supabase.co/',
    serviceKey: 'cle-de-service',
    fetch: (url, init = {}) => {
      seen.push({ url, init })
      return Promise.resolve(response.clone())
    },
  })
  return { rest, seen }
}

function ok(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

describe('client PostgREST', () => {
  it('porte la clé de service et enlève la barre finale de l’adresse', async () => {
    const { rest, seen } = stub(ok([{ id: 'a' }]))
    await rest.select('bots?select=id')
    expect(seen[0].url).toBe('https://projet.supabase.co/rest/v1/bots?select=id')
    const headers = seen[0].init.headers as Record<string, string>
    expect(headers.apikey).toBe('cle-de-service')
    expect(headers.authorization).toBe('Bearer cle-de-service')
  })

  it('ne rend rien et n’appelle rien sur une insertion vide', async () => {
    const { rest, seen } = stub(ok([]))
    expect(await rest.insert('parties', [])).toEqual([])
    expect(seen).toHaveLength(0)
  })

  it('demande la représentation seulement quand des colonnes sont voulues', async () => {
    const { rest, seen } = stub(ok([{ id: 'a' }]))
    await rest.insert('parties', [{ x: 1 }], { returning: 'id' })
    expect(seen[0].url).toContain('parties?select=id')
    expect((seen[0].init.headers as Record<string, string>).prefer)
      .toBe('return=representation')

    await rest.insert('parties', [{ x: 1 }])
    expect((seen[1].init.headers as Record<string, string>).prefer)
      .toBe('return=minimal')
  })

  it('rend le code SQL d’un refus, pour distinguer un doublon d’une panne', async () => {
    const { rest } = stub(
      new Response(
        JSON.stringify({ code: UNIQUE_VIOLATION, message: 'clé dupliquée' }),
        { status: 409 },
      ),
    )
    await expect(rest.insert('vagues', [{ debut: 'x' }])).rejects.toMatchObject({
      code: UNIQUE_VIOLATION,
      status: 409,
    })
    await expect(rest.insert('vagues', [{ debut: 'x' }])).rejects.toBeInstanceOf(
      RestError,
    )
  })

  it('accepte un corps vide, que PostgREST rend en écriture muette', async () => {
    const { rest } = stub(new Response(null, { status: 204 }))
    expect(await rest.update('parties', 'id=eq.1', { statut: 'terminee' }))
      .toEqual([])
  })
})
