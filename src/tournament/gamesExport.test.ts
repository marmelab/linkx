import { describe, expect, it } from 'vitest'
import { buildGamesExport, gamesExportFileName } from './gamesExport'
import type { MyGame } from './games'

const INSTANT = new Date('2026-09-10T14:35:07.512Z')

function partie(partial: Partial<MyGame> = {}): MyGame {
  return {
    id: 'partie-1',
    playedAt: '2026-09-10T12:00:00Z',
    waveId: 'vague-1',
    opening: '4Lsr21',
    openingLabel: 'grand L debout à droite',
    botId: 'ia-1',
    color: 'blue',
    opponent: 'Adversaire',
    outcome: 'gagne',
    outcomeText: 'gagné par connexion',
    reason: 'connection',
    moveCount: 18,
    notation: '4Lsr21 4Ss3 3Ir11',
    ...partial,
  }
}

describe('export des parties', () => {
  it('porte la notation et le camp tenu, de quoi rejouer la partie', () => {
    // Sans la couleur, une notation ne dit pas qui a gagné pour l'auteur.
    const [exportee] = buildGamesExport([partie()], new Map(), INSTANT).parties
    expect(exportee.notation).toBe('4Lsr21 4Ss3 3Ir11')
    expect(exportee.couleur).toBe('blue')
    expect(exportee.nombre_coups).toBe(18)
  })

  it('nomme l’IA quand on la connaît, et l’avoue sinon', () => {
    const nommee = buildGamesExport(
      [partie()],
      new Map([['ia-1', 'Mon programme']]),
      INSTANT,
    )
    expect(nommee.parties[0].ia_nom).toBe('Mon programme')

    const inconnue = buildGamesExport([partie()], new Map(), INSTANT)
    expect(inconnue.parties[0].ia_nom).toBeNull()
  })

  it('exporte exactement les parties reçues, dans leur ordre', () => {
    // C'est l'écran qui a filtré : l'export ne retranche ni ne réordonne rien.
    const games = [partie({ id: 'a' }), partie({ id: 'b' }), partie({ id: 'c' })]
    const resultat = buildGamesExport(games, new Map(), INSTANT)
    expect(resultat.parties.map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })

  it('rend une liste vide sans échouer', () => {
    const vide = buildGamesExport([], new Map(), INSTANT)
    expect(vide.parties).toEqual([])
    expect(vide.format).toBe('linkx-parties')
  })

  it('date le fichier à la seconde, sans caractère interdit', () => {
    const nom = gamesExportFileName(INSTANT)
    expect(nom).toBe('linkx-parties-2026-09-10-14-35-07.json')
    expect(nom).not.toMatch(/[:]/)
  })
})
