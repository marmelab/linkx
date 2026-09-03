import { describe, expect, it } from 'vitest'
import {
  PARTIES_MAX_PAR_IA,
  construireCalendrier,
  ouverturesParPaire,
  tirerOuvertures,
} from './calendrier.ts'
import type { Calendrier, PartiePrevue } from './calendrier.ts'
import { OUVERTURES } from './ouvertures.ts'

function bots(nombre: number): string[] {
  return Array.from({ length: nombre }, (_, i) => `ia-${String(i).padStart(2, '0')}`)
}

function clePaire(partie: PartiePrevue): string {
  return [partie.bleu, partie.blanc].sort().join('/')
}

function partiesParIa(calendrier: Calendrier): Map<string, number> {
  const total = new Map<string, number>()
  for (const partie of calendrier.parties) {
    total.set(partie.bleu, (total.get(partie.bleu) ?? 0) + 1)
    total.set(partie.blanc, (total.get(partie.blanc) ?? 0) + 1)
  }
  return total
}

describe('nombre d’ouvertures imposées', () => {
  it('prend le plus grand k tel que (n − 1) × (2 + 2k) ≤ 100', () => {
    expect(ouverturesParPaire(5, 99)).toBe(11)
    expect(ouverturesParPaire(6, 99)).toBe(9)
    expect(ouverturesParPaire(12, 99)).toBe(3)
    expect(ouverturesParPaire(26, 99)).toBe(1)
    expect(ouverturesParPaire(51, 99)).toBe(0)
  })

  it('reste borné par le nombre de débuts canoniques disponibles', () => {
    expect(ouverturesParPaire(2, 99)).toBe(49)
    expect(ouverturesParPaire(2, OUVERTURES.length)).toBe(OUVERTURES.length)
    expect(ouverturesParPaire(3, OUVERTURES.length)).toBe(OUVERTURES.length)
  })

  it('vaut zéro dès que l’aller-retour à plateau vide suffit', () => {
    expect(ouverturesParPaire(60, 99)).toBe(0)
    expect(ouverturesParPaire(200, 99)).toBe(0)
  })

  it('vaut zéro sans rencontre possible', () => {
    expect(ouverturesParPaire(0, 99)).toBe(0)
    expect(ouverturesParPaire(1, 99)).toBe(0)
  })
})

describe('cas limites du calendrier', () => {
  it('ne prévoit aucune partie sans IA', () => {
    expect(construireCalendrier([], 'vague-1').parties).toEqual([])
  })

  it('ne prévoit aucune partie pour une IA seule active', () => {
    const calendrier = construireCalendrier(['solo'], 'vague-1')
    expect(calendrier.parties).toEqual([])
    expect(calendrier.ouverturesParPaire).toBe(0)
  })

  it('fait jouer deux IA l’une contre l’autre, couleurs équilibrées', () => {
    const calendrier = construireCalendrier(['a', 'b'], 'vague-1')
    const attendu = 2 + 2 * calendrier.ouverturesParPaire
    expect(calendrier.parties).toHaveLength(attendu)
    expect(
      calendrier.parties.filter((partie) => partie.bleu === 'a'),
    ).toHaveLength(attendu / 2)
  })

  it('dédoublonne les identifiants reçus', () => {
    const calendrier = construireCalendrier(['a', 'b', 'a'], 'vague-1')
    expect(calendrier.parties.every((partie) => partie.bleu !== partie.blanc)).toBe(
      true,
    )
    expect(new Set(calendrier.parties.map(clePaire))).toEqual(new Set(['a/b']))
  })

  it('ne dépend pas de l’ordre dans lequel les IA sont fournies', () => {
    const direct = construireCalendrier(['c', 'a', 'b'], 'vague-1')
    const inverse = construireCalendrier(['b', 'c', 'a'], 'vague-1')
    expect(inverse).toEqual(direct)
  })
})

describe.each([5, 6, 12])('vague à %i IA', (nombre) => {
  const liste = bots(nombre)
  const calendrier = construireCalendrier(liste, 'vague-2026-09-03')
  const paires = new Map<string, PartiePrevue[]>()
  for (const partie of calendrier.parties) {
    const cle = clePaire(partie)
    paires.set(cle, [...(paires.get(cle) ?? []), partie])
  }

  it('fait se rencontrer chaque paire, et elles seules', () => {
    expect(paires.size).toBe((nombre * (nombre - 1)) / 2)
  })

  it('joue le bon nombre de parties par paire', () => {
    const attendu = 2 + 2 * calendrier.ouverturesParPaire
    for (const parties of paires.values()) expect(parties).toHaveLength(attendu)
  })

  it('joue autant de parties dans chaque couleur, dans chaque paire', () => {
    for (const parties of paires.values()) {
      const [premier] = [parties[0].bleu, parties[0].blanc].sort()
      const enBleu = parties.filter((partie) => partie.bleu === premier)
      expect(enBleu).toHaveLength(parties.length / 2)
    }
  })

  it('joue exactement deux parties à plateau vide par paire', () => {
    for (const parties of paires.values()) {
      const vides = parties.filter((partie) => partie.ouverture === '')
      expect(vides).toHaveLength(2)
      expect(new Set(vides.map((partie) => partie.bleu)).size).toBe(2)
    }
  })

  it('ne répète jamais une ouverture imposée dans une paire', () => {
    for (const parties of paires.values()) {
      const imposees = parties
        .filter((partie) => partie.ouverture !== '')
        .map((partie) => partie.ouverture)
      expect(new Set(imposees).size).toBe(imposees.length / 2)
      for (const notation of new Set(imposees)) {
        expect(imposees.filter((autre) => autre === notation)).toHaveLength(2)
      }
    }
  })

  it('n’impose que des ouvertures du jeu canonique', () => {
    const connues = new Set(OUVERTURES.map((ouverture) => ouverture.notation))
    for (const partie of calendrier.parties) {
      if (partie.ouverture !== '') expect(connues.has(partie.ouverture)).toBe(true)
    }
  })

  it('laisse chaque IA sous la centaine de parties, et aucune sans adversaire', () => {
    const total = partiesParIa(calendrier)
    expect(total.size).toBe(nombre)
    for (const compte of total.values()) {
      expect(compte).toBeLessThanOrEqual(PARTIES_MAX_PAR_IA)
      expect(compte).toBeGreaterThan(0)
    }
  })

  it('redonne le même calendrier à graine égale, un autre à graine différente', () => {
    expect(construireCalendrier(liste, 'vague-2026-09-03')).toEqual(calendrier)
    const autre = construireCalendrier(liste, 'vague-2026-09-10')
    expect(autre.ouverturesParPaire).toBe(calendrier.ouverturesParPaire)
    expect(autre).not.toEqual(calendrier)
  })
})

describe('nombre impair d’IA', () => {
  it('n’exempte personne : toutes contre toutes n’apparie pas par ronde', () => {
    for (const nombre of [3, 5, 7, 9]) {
      const calendrier = construireCalendrier(bots(nombre), 'vague-1')
      const total = partiesParIa(calendrier)
      expect(total.size).toBe(nombre)
      const comptes = new Set(total.values())
      expect(comptes.size).toBe(1)
    }
  })
})

describe('tirage des ouvertures', () => {
  it('ne dépend que de la graine et de l’identité de la paire', () => {
    const a = tirerOuvertures('vague-1', 'ia-a', 'ia-b', 4)
    expect(tirerOuvertures('vague-1', 'ia-b', 'ia-a', 4)).toEqual(a)
    expect(tirerOuvertures('vague-2', 'ia-a', 'ia-b', 4)).not.toEqual(a)
    expect(tirerOuvertures('vague-1', 'ia-a', 'ia-c', 4)).not.toEqual(a)
  })

  it('rend des ouvertures distinctes, et jamais plus qu’il n’en existe', () => {
    const tirees = tirerOuvertures('vague-1', 'ia-a', 'ia-b', 99)
    expect(tirees).toHaveLength(OUVERTURES.length)
    expect(new Set(tirees.map((ouverture) => ouverture.notation)).size).toBe(
      OUVERTURES.length,
    )
  })

  it('ne tire rien quand on ne lui demande rien', () => {
    expect(tirerOuvertures('vague-1', 'ia-a', 'ia-b', 0)).toEqual([])
  })
})
