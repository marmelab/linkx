/**
 * Fenêtre horaire d'une vague : le jeudi de 0 h à 12 h, heure de Paris
 * (histoire 15).
 *
 * Le cron tourne en UTC et Paris change d'heure deux fois par an : **aucun
 * décalage n'est écrit en dur**. La seule source de vérité est la base de
 * fuseaux du moteur, interrogée par `Intl.DateTimeFormat`. Le jour de la
 * semaine se déduit ensuite de la date civile par arithmétique, jamais du
 * libellé rendu par une locale.
 *
 * Module pur : aucune horloge implicite, l'instant est toujours passé en
 * argument.
 */

export const WAVE_TIME_ZONE = 'Europe/Paris'
/** Jeudi, au sens ISO : 1 = lundi … 7 = dimanche. */
export const WAVE_WEEKDAY = 4
export const WAVE_START_HOUR = 0
export const WAVE_END_HOUR = 12

const MS_PER_DAY = 86_400_000

/** Date et heure civiles dans un fuseau, telles qu'une horloge murale les lit. */
export type CivilTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export type WaveWindow = {
  /** Vrai si l'instant tombe dans la fenêtre de jeu d'une vague. */
  inWindow: boolean
  /** Jeudi concerné, en `AAAA-MM-JJ` de Paris : identité stable d'une vague. */
  waveDay: string
  /** Ouverture de la vague — celle en cours, ou la prochaine à venir. */
  start: Date
  /** Fin de cette même vague, midi à Paris. */
  end: Date
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone)
  if (cached) return cached
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // `hour12: false` rend « 24 » à minuit sur certains moteurs ; `h23` non.
    hourCycle: 'h23',
  })
  formatters.set(timeZone, created)
  return created
}

/** Heure murale d'un instant, dans le fuseau demandé. */
export function civilTimeAt(
  instant: Date,
  timeZone: string = WAVE_TIME_ZONE,
): CivilTime {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type)
    if (!found) throw new Error(`Champ « ${type} » absent du fuseau ${timeZone}.`)
    return Number(found.value)
  }
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  }
}

/** Décalage du fuseau à cet instant, en millisecondes (positif à l'est). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const civil = civilTimeAt(instant, timeZone)
  const asUtc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
    instant.getUTCMilliseconds(),
  )
  return asUtc - instant.getTime()
}

/**
 * Instant correspondant à une heure murale. Le décalage se lit sur une première
 * estimation puis se relit sur le résultat : c'est le second passage qui rend
 * juste la nuit d'un changement d'heure, où l'estimation tombe du mauvais côté
 * de la bascule.
 */
export function instantOfCivilTime(
  civil: CivilTime,
  timeZone: string = WAVE_TIME_ZONE,
): Date {
  const asUtc = Date.UTC(
    civil.year,
    civil.month - 1,
    civil.day,
    civil.hour,
    civil.minute,
    civil.second,
  )
  const firstGuess = asUtc - zoneOffsetMs(new Date(asUtc), timeZone)
  const corrected = asUtc - zoneOffsetMs(new Date(firstGuess), timeZone)
  return new Date(corrected)
}

/** Jour de la semaine ISO d'une date civile : 1 = lundi … 7 = dimanche. */
export function isoWeekday(civil: CivilTime): number {
  const day = new Date(
    Date.UTC(civil.year, civil.month - 1, civil.day),
  ).getUTCDay()
  return day === 0 ? 7 : day
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** Identité d'une vague : la date civile de son jeudi, à Paris. */
export function dayKey(civil: CivilTime): string {
  return `${pad(civil.year, 4)}-${pad(civil.month)}-${pad(civil.day)}`
}

/** Décale une date civile d'un nombre entier de jours, heure murale conservée. */
function addDays(civil: CivilTime, days: number): CivilTime {
  const shifted = new Date(
    Date.UTC(civil.year, civil.month - 1, civil.day) + days * MS_PER_DAY,
  )
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: civil.hour,
    minute: civil.minute,
    second: civil.second,
  }
}

function boundsOf(day: CivilTime, timeZone: string): { start: Date; end: Date } {
  const midnight = { ...day, hour: WAVE_START_HOUR, minute: 0, second: 0 }
  const noon = { ...day, hour: WAVE_END_HOUR, minute: 0, second: 0 }
  return {
    start: instantOfCivilTime(midnight, timeZone),
    end: instantOfCivilTime(noon, timeZone),
  }
}

/**
 * Vague de l'instant donné : celle en cours si l'on y est, sinon la prochaine.
 * `inWindow` distingue les deux cas, et `waveDay` nomme le jeudi concerné.
 */
export function waveWindowAt(
  instant: Date,
  timeZone: string = WAVE_TIME_ZONE,
): WaveWindow {
  const civil = civilTimeAt(instant, timeZone)
  if (isoWeekday(civil) === WAVE_WEEKDAY && civil.hour < WAVE_END_HOUR) {
    const { start, end } = boundsOf(civil, timeZone)
    return { inWindow: true, waveDay: dayKey(civil), start, end }
  }

  const behind = (isoWeekday(civil) - WAVE_WEEKDAY + 7) % 7
  // Un jeudi après midi vise le jeudi suivant, pas le jour même.
  const ahead = behind === 0 ? 7 : 7 - behind
  const nextDay = addDays(civil, ahead)
  const { start, end } = boundsOf(nextDay, timeZone)
  return { inWindow: false, waveDay: dayKey(nextDay), start, end }
}

/** Ouverture de la prochaine vague, strictement postérieure à l'instant donné. */
export function nextWaveStart(
  instant: Date,
  timeZone: string = WAVE_TIME_ZONE,
): Date {
  const window = waveWindowAt(instant, timeZone)
  if (!window.inWindow) return window.start
  const nextDay = addDays(civilTimeAt(instant, timeZone), 7)
  return boundsOf(nextDay, timeZone).start
}

/** Vrai à midi passé : les parties encore en cours deviennent des nuls. */
export function isWaveOver(instant: Date, window: WaveWindow): boolean {
  return instant.getTime() >= window.end.getTime()
}
