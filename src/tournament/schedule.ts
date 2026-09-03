/**
 * Calendrier des vagues vu de l'écran public : la prochaine échéance et le
 * compte à rebours qui y mène (plan.md, histoires 15 et 16).
 *
 * Les vagues se jouent le **jeudi de 0 h à 12 h, heure de Paris**. Le décalage
 * de Paris change deux fois par an : il n'est donc jamais écrit en dur, il est
 * relu du fuseau à chaque conversion. Module pur — aucune horloge implicite,
 * l'instant courant est toujours passé en argument.
 */
const PARIS = 'Europe/Paris'

/** Jeudi, au sens de `Date.prototype.getUTCDay` (0 = dimanche). */
export const WAVE_WEEKDAY = 4
export const WAVE_START_HOUR = 0
export const WAVE_END_HOUR = 12
export const WAVE_START_LABEL = 'jeudi à 0 h'

type WallClock = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: PARIS,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** Heure murale parisienne d'un instant. */
export function parisWallClock(instant: number): WallClock {
  const parts = partsFormat.formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')
  // `hour12: false` rend minuit « 24 » sur certains moteurs : c'est le même
  // instant que 0 h du jour affiché, pas le lendemain.
  const hour = read('hour') % 24
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour,
    minute: read('minute'),
    second: read('second'),
  }
}

/** Décalage de Paris à cet instant, en millisecondes. */
function parisOffsetMs(instant: number): number {
  const wall = parisWallClock(instant)
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  )
  // Les millisecondes ne survivent pas au formatage : les rendre à l'instant
  // reconstruit, sans quoi le décalage porterait leur reste.
  return asUtc - (instant - (instant % 1000))
}

/**
 * Instant UTC d'une heure murale parisienne. Deux passes : la première devine
 * le décalage à partir d'une approximation, la seconde le confirme à la date
 * trouvée — c'est ce qui rend le calcul juste les deux nuits de changement
 * d'heure. Les débordements de champs sont normalisés par `Date.UTC` : un jour
 * 33 est le 2 du mois suivant.
 */
export function parisInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
): number {
  const wall = Date.UTC(year, month - 1, day, hour)
  let instant = wall
  for (let pass = 0; pass < 2; pass += 1) {
    instant = wall - parisOffsetMs(instant)
  }
  return instant
}

function parisWeekday(instant: number): number {
  const wall = parisWallClock(instant)
  return new Date(Date.UTC(wall.year, wall.month - 1, wall.day)).getUTCDay()
}

/** Début de la vague ouverte à cet instant, ou de la dernière fermée. */
function lastWaveStart(now: number): number {
  const wall = parisWallClock(now)
  const back = (parisWeekday(now) - WAVE_WEEKDAY + 7) % 7
  return parisInstant(wall.year, wall.month, wall.day - back, WAVE_START_HOUR)
}

/** Prochaine ouverture de vague, strictement postérieure à `now`. */
export function nextWaveStart(now: number): number {
  const wall = parisWallClock(now)
  const ahead = (WAVE_WEEKDAY - parisWeekday(now) + 7) % 7
  let start = parisInstant(
    wall.year,
    wall.month,
    wall.day + ahead,
    WAVE_START_HOUR,
  )
  if (start <= now) {
    start = parisInstant(
      wall.year,
      wall.month,
      wall.day + ahead + 7,
      WAVE_START_HOUR,
    )
  }
  return start
}

export type WaveWindow = { start: number; end: number }

/** Fenêtre de la vague en cours, ou `null` hors vague. */
export function currentWaveWindow(now: number): WaveWindow | null {
  const start = lastWaveStart(now)
  const wall = parisWallClock(start)
  const end = parisInstant(wall.year, wall.month, wall.day, WAVE_END_HOUR)
  return now >= start && now < end ? { start, end } : null
}

export type Countdown = { days: number; hours: number; minutes: number }

export function countdownParts(remainingMs: number): Countdown {
  const minutes = Math.max(0, Math.floor(remainingMs / 60_000))
  return {
    days: Math.floor(minutes / (24 * 60)),
    hours: Math.floor((minutes % (24 * 60)) / 60),
    minutes: minutes % 60,
  }
}

/** « 3 j 04 h 12 min », « 04 h 12 min » le dernier jour, « 12 min » la dernière heure. */
export function formatCountdown(remainingMs: number): string {
  const { days, hours, minutes } = countdownParts(remainingMs)
  const pad = (value: number) => String(value).padStart(2, '0')
  if (days > 0) return `${days} j ${pad(hours)} h ${pad(minutes)} min`
  if (hours > 0) return `${pad(hours)} h ${pad(minutes)} min`
  return `${minutes} min`
}

const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS,
  hour: '2-digit',
  minute: '2-digit',
})

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: PARIS,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

/** « 12:00 » à l'heure de Paris, quelle que soit celle du visiteur. */
export function formatParisTime(instant: number): string {
  return timeFormat.format(instant)
}

/** « jeudi 2 avril », à l'heure de Paris. */
export function formatParisDate(instant: number): string {
  return dateFormat.format(instant)
}

/** Part des parties jouées, bornée à [0, 1] ; `null` si le total est inconnu. */
export function waveProgress(played: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null
  return Math.min(1, Math.max(0, played / total))
}
