/**
 * Ce que ce test prouve : **fermé par défaut**. Sous Vitest il n'y a pas de
 * `Deno`, donc pas de variable d'environnement, donc aucune des deux entrées
 * d'essai n'existe — exactement la situation d'un projet distant, où elles ne
 * sont jamais posées. Le reste du dépôt se comporte alors comme si ce module
 * n'était pas là.
 */
import { describe, expect, it } from 'vitest'
import { essaiInstant, essaiTarget, readJsonBody } from './essaiLocal.ts'

describe('essaiTarget', () => {
  it('ne dérive aucune adresse sans variable d’environnement', () => {
    expect(essaiTarget('bot-alpha.essai.linkx')).toBeNull()
    expect(essaiTarget('exemple.test')).toBeNull()
  })
})

describe('essaiInstant', () => {
  it('ignore l’instant demandé sans variable d’environnement', () => {
    expect(essaiInstant({ maintenant: '2026-09-10T00:05:00+02:00' })).toBeNull()
  })

  it('ignore un corps sans instant', () => {
    expect(essaiInstant(null)).toBeNull()
    expect(essaiInstant({})).toBeNull()
  })
})

describe('readJsonBody', () => {
  it('rend le corps JSON', async () => {
    const request = new Request('https://exemple.test/', {
      method: 'POST',
      body: JSON.stringify({ source: 'pg_cron' }),
    })
    expect(await readJsonBody(request)).toEqual({ source: 'pg_cron' })
  })

  it('rend null sur un corps absent ou illisible', async () => {
    const vide = new Request('https://exemple.test/', { method: 'POST' })
    expect(await readJsonBody(vide)).toBeNull()
    const casse = new Request('https://exemple.test/', {
      method: 'POST',
      body: '{ pas du JSON',
    })
    expect(await readJsonBody(casse)).toBeNull()
  })
})
