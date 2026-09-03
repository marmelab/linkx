import { describe, expect, it } from 'vitest'
import {
  countdownParts,
  currentWaveWindow,
  formatCountdown,
  formatParisTime,
  nextWaveStart,
  parisInstant,
  waveProgress,
} from './schedule'

/** Un instant lisible dans les tests : « 2026-03-25T12:00:00Z ». */
const at = (iso: string) => Date.parse(iso)

describe('heure de Paris', () => {
  it('place minuit d’hiver à 23 h UTC la veille', () => {
    expect(parisInstant(2026, 1, 15, 0)).toBe(at('2026-01-14T23:00:00Z'))
  })

  it('place minuit d’été à 22 h UTC la veille', () => {
    expect(parisInstant(2026, 7, 15, 0)).toBe(at('2026-07-14T22:00:00Z'))
  })

  it('normalise un jour qui déborde du mois', () => {
    expect(parisInstant(2026, 1, 32, 0)).toBe(parisInstant(2026, 2, 1, 0))
  })
})

describe('prochaine vague', () => {
  it('vise le jeudi 0 h qui suit', () => {
    // Lundi 2026-01-12, midi à Paris.
    expect(nextWaveStart(at('2026-01-12T11:00:00Z'))).toBe(
      at('2026-01-14T23:00:00Z'),
    )
  })

  it('saute la vague en cours une fois qu’elle a commencé', () => {
    const duringWave = at('2026-01-15T03:00:00Z') // jeudi 4 h à Paris
    expect(nextWaveStart(duringWave)).toBe(at('2026-01-21T23:00:00Z'))
  })

  it('franchit le passage à l’heure d’été sans se décaler d’une heure', () => {
    // Le vendredi 27 mars 2026 Paris est en heure d'hiver ; le jeudi visé,
    // le 2 avril, est en heure d'été. L'échéance tombe donc à 22 h UTC.
    expect(nextWaveStart(at('2026-03-27T12:00:00Z'))).toBe(
      at('2026-04-01T22:00:00Z'),
    )
  })

  it('franchit le retour à l’heure d’hiver de la même façon', () => {
    // Dimanche 25 octobre 2026, Paris repasse en heure d'hiver.
    expect(nextWaveStart(at('2026-10-24T12:00:00Z'))).toBe(
      at('2026-10-28T23:00:00Z'),
    )
  })
})

describe('vague en cours', () => {
  it('reconnaît la fenêtre du jeudi matin', () => {
    const window_ = currentWaveWindow(at('2026-01-15T06:00:00Z'))
    expect(window_).not.toBeNull()
    expect(window_?.start).toBe(at('2026-01-14T23:00:00Z'))
    expect(window_?.end).toBe(at('2026-01-15T11:00:00Z'))
  })

  it('la ferme à midi, heure de Paris', () => {
    expect(currentWaveWindow(at('2026-01-15T11:00:00Z'))).toBeNull()
  })

  it('n’en voit aucune un mardi', () => {
    expect(currentWaveWindow(at('2026-01-13T09:00:00Z'))).toBeNull()
  })

  it('affiche l’heure de fin à Paris, pas à celle du visiteur', () => {
    expect(formatParisTime(at('2026-01-15T11:00:00Z'))).toBe('12:00')
  })
})

describe('compte à rebours', () => {
  it('décompose jours, heures et minutes', () => {
    const ms = ((3 * 24 + 4) * 60 + 12) * 60_000
    expect(countdownParts(ms)).toEqual({ days: 3, hours: 4, minutes: 12 })
    expect(formatCountdown(ms)).toBe('3 j 04 h 12 min')
  })

  it('laisse tomber les jours puis les heures quand il n’en reste pas', () => {
    expect(formatCountdown((4 * 60 + 12) * 60_000)).toBe('04 h 12 min')
    expect(formatCountdown(12 * 60_000)).toBe('12 min')
  })

  it('ne descend jamais sous zéro', () => {
    expect(formatCountdown(-5000)).toBe('0 min')
  })
})

describe('avancement d’une vague', () => {
  it('rend une part bornée', () => {
    expect(waveProgress(50, 200)).toBe(0.25)
    expect(waveProgress(300, 200)).toBe(1)
  })

  it('rend null quand le total est inconnu', () => {
    expect(waveProgress(3, 0)).toBeNull()
  })
})
