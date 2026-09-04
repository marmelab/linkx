import { describe, expect, it } from 'vitest'
import {
  civilTimeAt,
  dayKey,
  instantOfCivilTime,
  isWaveOver,
  isoWeekday,
  nextWaveStart,
  waveWindowAt,
} from './waveWindow.ts'

/**
 * 2026 change d'heure le dimanche 29 mars et le dimanche 25 octobre. Ce sont
 * les deux jours où un décalage codé en dur se trompe, et où un calcul mené sur
 * une estimation non relue tombe du mauvais côté de la bascule.
 */
const SPRING_FORWARD = '2026-03-29'
const FALL_BACK = '2026-10-25'

function at(iso: string): Date {
  return new Date(iso)
}

const HOURS_12 = 12 * 3_600_000

describe('heure murale de Paris', () => {
  it('lit l’heure d’hiver et l’heure d’été sans décalage écrit en dur', () => {
    expect(civilTimeAt(at('2026-01-15T12:00:00Z')).hour).toBe(13)
    expect(civilTimeAt(at('2026-07-15T12:00:00Z')).hour).toBe(14)
  })

  it('reconstruit l’instant d’une heure murale, des deux côtés d’une bascule', () => {
    const winter = { year: 2026, month: 3, day: 29, hour: 1, minute: 0, second: 0 }
    expect(instantOfCivilTime(winter).toISOString()).toBe('2026-03-29T00:00:00.000Z')
    const summer = { year: 2026, month: 3, day: 29, hour: 4, minute: 0, second: 0 }
    expect(instantOfCivilTime(summer).toISOString()).toBe('2026-03-29T02:00:00.000Z')
  })

  it('numérote les jours sans dépendre de la locale', () => {
    expect(isoWeekday({ year: 2026, month: 9, day: 3, hour: 0, minute: 0, second: 0 }))
      .toBe(4)
    expect(isoWeekday({ year: 2026, month: 3, day: 29, hour: 0, minute: 0, second: 0 }))
      .toBe(7)
  })
})

describe('un jeudi ordinaire', () => {
  it('encadre la vague d’été de 22 h UTC à 10 h UTC', () => {
    const window = waveWindowAt(at('2026-09-03T08:00:00Z'))
    expect(window.inWindow).toBe(true)
    expect(window.waveDay).toBe('2026-09-03')
    expect(window.start.toISOString()).toBe('2026-09-02T22:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-09-03T10:00:00.000Z')
  })

  it('encadre la vague d’hiver de 23 h UTC à 11 h UTC', () => {
    const window = waveWindowAt(at('2026-12-03T08:00:00Z'))
    expect(window.inWindow).toBe(true)
    expect(window.waveDay).toBe('2026-12-03')
    expect(window.start.toISOString()).toBe('2026-12-02T23:00:00.000Z')
    expect(window.end.toISOString()).toBe('2026-12-03T11:00:00.000Z')
  })

  it('s’ouvre à minuit pile et se ferme à midi pile', () => {
    const opening = waveWindowAt(at('2026-09-02T22:00:00Z'))
    expect(opening.inWindow).toBe(true)
    expect(opening.start.toISOString()).toBe('2026-09-02T22:00:00.000Z')

    const lastMinute = waveWindowAt(at('2026-09-03T09:59:59Z'))
    expect(lastMinute.inWindow).toBe(true)
    expect(lastMinute.waveDay).toBe('2026-09-03')

    const noon = waveWindowAt(at('2026-09-03T10:00:00Z'))
    expect(noon.inWindow).toBe(false)
    expect(noon.waveDay).toBe('2026-09-10')
  })

  it('garde le même jour de vague d’un bout à l’autre de la fenêtre', () => {
    const days = new Set<string>()
    for (let minute = 0; minute < 12 * 60; minute += 7) {
      const instant = new Date(Date.parse('2026-09-02T22:00:00Z') + minute * 60_000)
      const window = waveWindowAt(instant)
      expect(window.inWindow).toBe(true)
      days.add(window.waveDay)
    }
    expect([...days]).toEqual(['2026-09-03'])
  })
})

describe('les deux changements d’heure de l’année', () => {
  it('vise le bon jeudi depuis la nuit du passage à l’heure d’été', () => {
    const before = waveWindowAt(at(`${SPRING_FORWARD}T00:30:00Z`))
    const after = waveWindowAt(at(`${SPRING_FORWARD}T01:30:00Z`))
    expect(before.waveDay).toBe('2026-04-02')
    expect(after.waveDay).toBe('2026-04-02')
    expect(before.start.toISOString()).toBe('2026-04-01T22:00:00.000Z')
    expect(after.start.toISOString()).toBe('2026-04-01T22:00:00.000Z')
  })

  it('vise le bon jeudi depuis la nuit du retour à l’heure d’hiver', () => {
    const before = waveWindowAt(at(`${FALL_BACK}T00:30:00Z`))
    const after = waveWindowAt(at(`${FALL_BACK}T01:30:00Z`))
    expect(before.waveDay).toBe('2026-10-29')
    expect(after.waveDay).toBe('2026-10-29')
    expect(before.start.toISOString()).toBe('2026-10-28T23:00:00.000Z')
    expect(after.start.toISOString()).toBe('2026-10-28T23:00:00.000Z')
  })

  it('donne une vague de douze heures de part et d’autre de chaque bascule', () => {
    const thursdays = [
      '2026-03-26T06:00:00Z',
      '2026-04-02T06:00:00Z',
      '2026-10-22T06:00:00Z',
      '2026-10-29T06:00:00Z',
    ]
    for (const instant of thursdays) {
      const window = waveWindowAt(at(instant))
      expect(window.inWindow).toBe(true)
      expect(window.end.getTime() - window.start.getTime()).toBe(HOURS_12)
    }
  })

  it('décale bien l’ouverture d’une heure entre les deux régimes', () => {
    expect(waveWindowAt(at('2026-10-22T06:00:00Z')).start.toISOString())
      .toBe('2026-10-21T22:00:00.000Z')
    expect(waveWindowAt(at('2026-10-29T06:00:00Z')).start.toISOString())
      .toBe('2026-10-28T23:00:00.000Z')
  })
})

describe('vague suivante et fin de fenêtre', () => {
  it('saute d’une semaine quand on est déjà dans la fenêtre', () => {
    expect(nextWaveStart(at('2026-09-03T08:00:00Z')).toISOString())
      .toBe('2026-09-09T22:00:00.000Z')
  })

  it('vise le jeudi à venir depuis n’importe quel autre jour', () => {
    // Vendredi, samedi, dimanche et mercredi visent tous le même jeudi.
    for (const instant of [
      '2026-09-04T08:00:00Z',
      '2026-09-05T08:00:00Z',
      '2026-09-06T08:00:00Z',
      '2026-09-09T08:00:00Z',
    ]) {
      expect(nextWaveStart(at(instant)).toISOString())
        .toBe('2026-09-09T22:00:00.000Z')
    }
  })

  it('déclare la vague finie à midi, pas avant', () => {
    const window = waveWindowAt(at('2026-09-03T08:00:00Z'))
    expect(isWaveOver(at('2026-09-03T09:59:59Z'), window)).toBe(false)
    expect(isWaveOver(at('2026-09-03T10:00:00Z'), window)).toBe(true)
  })

  it('nomme un jour de vague au format AAAA-MM-JJ', () => {
    expect(dayKey({ year: 2026, month: 1, day: 8, hour: 0, minute: 0, second: 0 }))
      .toBe('2026-01-08')
  })
})
