import { describe, expect, it } from 'vitest'
import {
  arbitrerReponse,
  botAuTrait,
  cloturerPartieInterrompue,
  estDefaiteTechnique,
  issueDeLEtat,
  ouvrirPartie,
} from './arbitre.ts'
import type { Appariement, PartieEnCours } from './arbitre.ts'

const APPARIEMENT: Appariement = { bleu: 'ia-bleue', blanc: 'ia-blanche' }

/** Partie gagnée par les bleus au septième coup, `2r13` (voir moveNotation.test.ts). */
const AVANT_VICTOIRE_BLEUE = '4Lr32 4Ss3 4Lr32 3Ir12 3Ir13 3Ir14'

/** Partie ouverte par les blancs, bloquée : les blancs l'emportent à la plus grande zone. */
const AVANT_BLOCAGE =
  'w 2r16 3Ir17 24 4Ssr12 4Ss4 16 3I5 3Ir16 3Ir19 3L2 4Ssr12 14 18 4Tr32 18 3L8 3Lr12 2r16 4Lsr27 2r18 4Lr18 4Lsr37 -- 4Lr14'

/** Le même, arrêté juste avant la passe forcée des blancs. */
const AVANT_PASSE_FORCEE = AVANT_BLOCAGE.split(' ').slice(0, -3).join(' ')

function partie(ouverture: string): PartieEnCours {
  const ouverte = ouvrirPartie(ouverture, APPARIEMENT)
  if (!ouverte.ok) throw new Error(ouverte.erreur.message)
  return ouverte.partie
}

describe('ouverture d’une partie', () => {
  it('ouvre sur un plateau vide et rend la main aux bleus', () => {
    const enCours = partie('')
    expect(enCours.notation).toBe('')
    expect(enCours.etat.phase).toBe('playing')
    expect(botAuTrait(enCours)).toEqual({ couleur: 'blue', bot: 'ia-bleue' })
  })

  it('ouvre sur une ouverture imposée de deux demi-coups', () => {
    const enCours = partie('3I4 15')
    expect(enCours.notation).toBe('3I4 15')
    expect(botAuTrait(enCours)).toEqual({ couleur: 'blue', bot: 'ia-bleue' })
  })

  it('refuse une ouverture illégale en conservant le refus de la notation', () => {
    const ouverte = ouvrirPartie('4S4', APPARIEMENT)
    expect(ouverte.ok).toBe(false)
    if (!ouverte.ok) expect(ouverte.erreur.reason).toBe('unsupported')
  })
})

describe('coup accepté', () => {
  it('applique le coup et rend la notation canonique', () => {
    const resultat = arbitrerReponse(partie('15'), { ok: true, corps: '3Ir17' })
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.partie.notation).toBe('15 3Ir17')
    expect(resultat.issue).toBeNull()
    expect(botAuTrait(resultat.partie)).toEqual({
      couleur: 'blue',
      bot: 'ia-bleue',
    })
  })

  it('tolère les espaces autour du jeton, et rien d’autre', () => {
    const resultat = arbitrerReponse(partie('15'), {
      ok: true,
      corps: '\n  3Ir17\t ',
    })
    expect(resultat.ok).toBe(true)
    if (resultat.ok) expect(resultat.partie.notation).toBe('15 3Ir17')
  })

  it('applique la passe forcée sans jamais appeler l’IA au tour passé', () => {
    const enCours = partie(AVANT_PASSE_FORCEE)
    expect(botAuTrait(enCours)).toEqual({ couleur: 'blue', bot: 'ia-bleue' })

    const resultat = arbitrerReponse(enCours, { ok: true, corps: '4Lsr37' })
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.partie.notation.endsWith('4Lsr37 --')).toBe(true)
    expect(botAuTrait(resultat.partie)).toEqual({
      couleur: 'blue',
      bot: 'ia-bleue',
    })
  })
})

describe('fin de partie', () => {
  it('reconnaît la victoire par connexion', () => {
    const resultat = arbitrerReponse(partie(AVANT_VICTOIRE_BLEUE), {
      ok: true,
      corps: '2r13',
    })
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.issue).toEqual({
      vainqueur: 'blue',
      motif: 'connexion',
      fautif: null,
      couleurFautive: null,
      raisonNotation: null,
      rangCoup: null,
      message: 'Gagné par connexion.',
    })
  })

  it('reconnaît la victoire par blocage, à la plus grande zone', () => {
    const resultat = arbitrerReponse(partie(AVANT_BLOCAGE), {
      ok: true,
      corps: '3Lr24',
    })
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(resultat.issue?.motif).toBe('blocage')
    expect(resultat.issue?.vainqueur).toBe('white')
  })

  it('reconnaît le nul à zones égales', () => {
    const enCours = partie(AVANT_VICTOIRE_BLEUE)
    const nul = issueDeLEtat({
      ...enCours.etat,
      phase: 'finished',
      result: { winner: null, reason: 'draw' },
    })
    expect(nul?.motif).toBe('nul')
    expect(nul?.vainqueur).toBeNull()
  })

  it('ne rend aucune issue tant que la partie continue', () => {
    expect(issueDeLEtat(partie('15').etat)).toBeNull()
  })

  it('clôt en nul technique une partie interrompue à la fin de la vague', () => {
    const issue = cloturerPartieInterrompue()
    expect(issue.motif).toBe('interrompue')
    expect(issue.vainqueur).toBeNull()
    expect(issue.fautif).toBeNull()
    expect(estDefaiteTechnique(issue)).toBe(false)
  })
})

describe('défaites techniques', () => {
  it('fait perdre le hors-délai, à l’IA au trait', () => {
    const resultat = arbitrerReponse(partie('15'), {
      ok: false,
      panne: 'hors-delai',
    })
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issue.motif).toBe('hors-delai')
    expect(resultat.issue.vainqueur).toBe('blue')
    expect(resultat.issue.couleurFautive).toBe('white')
    expect(resultat.issue.fautif).toBe('ia-blanche')
    expect(resultat.issue.rangCoup).toBe(2)
    expect(estDefaiteTechnique(resultat.issue)).toBe(true)
  })

  it('fait perdre le service injoignable', () => {
    const resultat = arbitrerReponse(partie(''), {
      ok: false,
      panne: 'injoignable',
    })
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issue.motif).toBe('injoignable')
    expect(resultat.issue.fautif).toBe('ia-bleue')
    expect(resultat.issue.rangCoup).toBe(1)
  })

  it('fait perdre une réponse vide, multiple ou surabondante', () => {
    for (const corps of ['', '   ', '15 24', '15,24', '15+24', '1'.repeat(40)]) {
      const resultat = arbitrerReponse(partie('15'), { ok: true, corps })
      expect(resultat.ok).toBe(false)
      if (resultat.ok) continue
      expect(resultat.issue.motif).toBe('reponse-illisible')
      expect(resultat.issue.fautif).toBe('ia-blanche')
    }
  })

  it('fait perdre le jeton de passe, même là où la position passe vraiment', () => {
    const enCours = partie(AVANT_PASSE_FORCEE)
    const apres = arbitrerReponse(enCours, { ok: true, corps: '4Lsr37' })
    expect(apres.ok).toBe(true)
    if (!apres.ok) return

    // Les blancs viennent d'être passés : c'est aux bleus, qui ne doivent
    // pourtant jamais répondre `--`.
    const resultat = arbitrerReponse(apres.partie, { ok: true, corps: '--' })
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issue.motif).toBe('illegal')
    expect(resultat.issue.raisonNotation).toBe('unexpected-pass')
    expect(resultat.issue.fautif).toBe('ia-bleue')
  })

  it('conserve le motif exact d’un coup illégal, pour chacun des refus', () => {
    const cas: [string, string, string][] = [
      ['15', 'bonjour', 'syntax'],
      ['15', '3Ir10', 'syntax'],
      ['15 3Ir17 15 3Ir16', '15', 'exhausted'],
      ['15', '3I8', 'horizontal-bounds'],
      ['', '4S4', 'unsupported'],
    ]
    for (const [notation, corps, raison] of cas) {
      const resultat = arbitrerReponse(partie(notation), { ok: true, corps })
      expect(resultat.ok).toBe(false)
      if (resultat.ok) continue
      expect(resultat.issue.motif).toBe('illegal')
      expect(resultat.issue.raisonNotation).toBe(raison)
      expect(resultat.issue.message).toMatch(/^Perdu — coup illégal au coup \d+, /)
    }
  })

  it('désigne toujours l’adversaire comme vainqueur d’une défaite technique', () => {
    const resultat = arbitrerReponse(partie('15'), { ok: true, corps: '3I8' })
    expect(resultat.ok).toBe(false)
    if (resultat.ok) return
    expect(resultat.issue.couleurFautive).toBe('white')
    expect(resultat.issue.vainqueur).toBe('blue')
  })

  it('refuse d’arbitrer une partie déjà terminée', () => {
    const resultat = arbitrerReponse(partie(AVANT_VICTOIRE_BLEUE), {
      ok: true,
      corps: '2r13',
    })
    expect(resultat.ok).toBe(true)
    if (!resultat.ok) return
    expect(() =>
      arbitrerReponse(resultat.partie, { ok: true, corps: '15' }),
    ).toThrow()
  })
})
