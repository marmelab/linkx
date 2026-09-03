import { describe, expect, it } from 'vitest'
import {
  CLASSEMENT_INITIAL,
  COEFFICIENT_ETABLI,
  COEFFICIENT_RODAGE,
  PARTIES_DE_RODAGE,
  appliquerVague,
  coefficient,
  ecartEcrit,
  esperance,
} from './elo.ts'
import type { ClassementBot, PartieClassee } from './elo.ts'

function depart(
  entrees: Record<string, [classement: number, parties: number]>,
): Map<string, ClassementBot> {
  return new Map(
    Object.entries(entrees).map(([bot, [classement, partiesClassees]]) => [
      bot,
      { classement, partiesClassees },
    ]),
  )
}

function partie(
  bleu: string,
  blanc: string,
  vainqueur: PartieClassee['vainqueur'],
): PartieClassee {
  return { bleu, blanc, vainqueur }
}

function bilan(resultat: ReturnType<typeof appliquerVague>, bot: string) {
  const trouve = resultat.bilans.find((entree) => entree.bot === bot)
  if (!trouve) throw new Error(`Bilan manquant pour ${bot}.`)
  return trouve
}

describe('barème', () => {
  it('part à 1200 et applique 40 puis 20', () => {
    expect(CLASSEMENT_INITIAL).toBe(1200)
    expect(PARTIES_DE_RODAGE).toBe(10)
    expect(coefficient(0)).toBe(COEFFICIENT_RODAGE)
    expect(coefficient(9)).toBe(COEFFICIENT_RODAGE)
    expect(coefficient(10)).toBe(COEFFICIENT_ETABLI)
    expect(coefficient(500)).toBe(COEFFICIENT_ETABLI)
    expect(COEFFICIENT_RODAGE).toBeGreaterThan(COEFFICIENT_ETABLI)
  })

  it('donne une espérance d’une demie entre égaux', () => {
    expect(esperance(1200, 1200)).toBe(0.5)
    expect(esperance(1400, 1000)).toBeCloseTo(0.909, 3)
  })

  it('écrit l’écart avec son signe', () => {
    expect(ecartEcrit(18)).toBe('+18')
    expect(ecartEcrit(-7)).toBe('−7')
    expect(ecartEcrit(0)).toBe('=')
  })
})

describe('application d’une vague', () => {
  it('classe une IA inconnue à 1200', () => {
    const resultat = appliquerVague(new Map(), [partie('a', 'b', 'blue')])
    expect(bilan(resultat, 'a').avant).toBe(1200)
    expect(bilan(resultat, 'a').apres).toBe(1220)
    expect(bilan(resultat, 'b').apres).toBe(1180)
  })

  it('compte un nul pour une demi-victoire de chacun', () => {
    const resultat = appliquerVague(new Map(), [partie('a', 'b', null)])
    expect(bilan(resultat, 'a').ecart).toBe(0)
    expect(bilan(resultat, 'b').ecart).toBe(0)
    expect(bilan(resultat, 'a').nuls).toBe(1)
    expect(bilan(resultat, 'b').nuls).toBe(1)
  })

  it('applique le coefficient établi à une IA rodée', () => {
    const resultat = appliquerVague(depart({ a: [1200, 30], b: [1200, 30] }), [
      partie('a', 'b', 'blue'),
    ])
    expect(bilan(resultat, 'a').apres).toBe(1210)
    expect(bilan(resultat, 'b').apres).toBe(1190)
  })

  it('lit le coefficient à l’ouverture de la vague, pas sur un compteur qui monte', () => {
    const parties = [
      partie('jeune', 'rodee', 'blue'),
      partie('rodee', 'jeune', 'blue'),
      partie('jeune', 'rodee', 'blue'),
      partie('rodee', 'jeune', 'blue'),
      partie('jeune', 'rodee', 'blue'),
    ]
    const resultat = appliquerVague(
      depart({ jeune: [1200, 9], rodee: [1200, 40] }),
      parties,
    )

    // Référence : coefficient figé sur tout la vague, 40 pour la jeune IA.
    let noteJeune = 1200
    let noteRodee = 1200
    for (const jeu of parties) {
      const jeuneEnBleu = jeu.bleu === 'jeune'
      const attenduJeune = esperance(noteJeune, noteRodee)
      const obtenuJeune =
        jeu.vainqueur === null ? 0.5 : (jeu.vainqueur === 'blue') === jeuneEnBleu ? 1 : 0
      noteJeune += COEFFICIENT_RODAGE * (obtenuJeune - attenduJeune)
      noteRodee += COEFFICIENT_ETABLI * (attenduJeune - obtenuJeune)
    }

    expect(bilan(resultat, 'jeune').apres).toBe(Math.round(noteJeune))
    expect(bilan(resultat, 'rodee').apres).toBe(Math.round(noteRodee))
    expect(bilan(resultat, 'jeune').partiesClassees).toBe(14)
  })

  it('tient le compte des victoires, nuls et défaites', () => {
    const resultat = appliquerVague(new Map(), [
      partie('a', 'b', 'blue'),
      partie('b', 'a', 'blue'),
      partie('a', 'b', null),
      partie('a', 'b', 'white'),
    ])
    const a = bilan(resultat, 'a')
    expect([a.victoires, a.nuls, a.defaites]).toEqual([1, 1, 2])
    const b = bilan(resultat, 'b')
    expect([b.victoires, b.nuls, b.defaites]).toEqual([2, 1, 1])
    expect(a.partiesClassees).toBe(4)
  })

  it('prend les parties dans leur ordre chronologique', () => {
    const parties = [
      partie('a', 'b', 'blue'),
      partie('a', 'c', 'white'),
      partie('b', 'c', 'blue'),
    ]
    const direct = appliquerVague(new Map(), parties)
    const permute = appliquerVague(new Map(), [parties[2], parties[0], parties[1]])
    expect(bilan(permute, 'c').apres).not.toBe(bilan(direct, 'c').apres)
  })

  it('rend exactement les mêmes valeurs à la relecture', () => {
    const parties = [
      partie('a', 'b', 'blue'),
      partie('b', 'c', null),
      partie('c', 'a', 'blue'),
      partie('a', 'b', 'white'),
      partie('c', 'b', null),
    ]
    const debut = depart({ a: [1250, 12], b: [1180, 3], c: [1200, 0] })
    const premier = appliquerVague(debut, parties)
    const second = appliquerVague(debut, parties)
    expect(second.bilans).toEqual(premier.bilans)
    expect([...second.classements]).toEqual([...premier.classements])
    // Le calcul ne consomme pas ses entrées.
    expect([...debut]).toEqual([
      ['a', { classement: 1250, partiesClassees: 12 }],
      ['b', { classement: 1180, partiesClassees: 3 }],
      ['c', { classement: 1200, partiesClassees: 0 }],
    ])
  })

  it('rend des classements entiers', () => {
    const resultat = appliquerVague(depart({ a: [1250, 12], b: [1180, 3] }), [
      partie('a', 'b', 'blue'),
      partie('b', 'a', null),
    ])
    for (const { classement } of resultat.classements.values()) {
      expect(Number.isInteger(classement)).toBe(true)
    }
  })

  it('laisse intacts les classements des IA qui n’ont pas joué', () => {
    const resultat = appliquerVague(
      depart({ a: [1250, 12], b: [1180, 3], absente: [1300, 40] }),
      [partie('a', 'b', 'blue')],
    )
    expect(resultat.classements.get('absente')).toEqual({
      classement: 1300,
      partiesClassees: 40,
    })
    expect(resultat.bilans.map((entree) => entree.bot)).toEqual(['a', 'b'])
  })

  it('ne change rien sur une vague sans rencontre', () => {
    const debut = depart({ solo: [1234, 20] })
    const resultat = appliquerVague(debut, [])
    expect(resultat.bilans).toEqual([])
    expect([...resultat.classements]).toEqual([...debut])
  })
})
