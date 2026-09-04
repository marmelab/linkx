import { describe, expect, it } from 'vitest'
import { fromPlatform, sameSecret } from './platformAuth.ts'

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
