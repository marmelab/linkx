/**
 * Courriel hebdomadaire de fin de vague (histoire 15) : **rendu pur**.
 *
 * Le module ne parle ni à la base ni au réseau. Il reçoit le classement, la
 * vague écoulée et les IA d'un destinataire, et rend l'objet, le texte brut et
 * le HTML. Les deux corps sortent du **même** parcours de données : ils ne
 * peuvent donc pas diverger, et c'est la seule raison pour laquelle ils sont
 * écrits ici et non dans deux gabarits.
 *
 * Tout ce qui vient de la base traverse `escapeHtml` avant d'entrer dans le
 * HTML et `sanitize` avant d'entrer dans le texte ou dans l'objet : un nom d'IA
 * est choisi par un inconnu, et l'objet d'un message est un en-tête, où un
 * retour à la ligne serait une injection.
 */
import { formatDelta } from './elo.ts'
import { REFUSAL_LABELS, TECHNICAL_REASONS } from './referee.ts'
import type { OutcomeReason } from './referee.ts'
import type { NotationErrorReason } from '../../../src/game/moveNotation.ts'

export type BotStatus = 'en_attente' | 'active' | 'sommeil' | 'retiree'

/** Motifs de défaite technique : les quatre de `TECHNICAL_REASONS`. */
export type TechnicalReason =
  | 'timeout'
  | 'illegal'
  | 'unreachable'
  | 'unreadable-reply'

/** État d'une IA, en toutes lettres : jamais un code, jamais une couleur. */
export const STATUS_LABELS: Record<BotStatus, string> = {
  en_attente: 'en qualification',
  active: 'active',
  sommeil: 'en sommeil',
  retiree: 'retirée',
}

/** Les huit motifs de fin, dans les termes que l'auteur d'une IA lira. */
export const REASON_LABELS: Record<OutcomeReason, string> = {
  connection: 'connexion',
  stalemate: 'blocage',
  draw: 'nul',
  interrupted: 'nul technique de fin de vague',
  timeout: 'hors délai',
  illegal: 'coup illégal',
  unreachable: 'service injoignable',
  'unreadable-reply': 'réponse illisible',
}

/** Ce qu'il y a à corriger, motif par motif : le message sert à ça. */
export const TECHNICAL_ADVICE: Record<TechnicalReason, string> = {
  timeout:
    'Votre service n’a pas répondu dans le délai annoncé. Vérifiez son temps de démarrage à froid et le budget de réflexion de votre recherche.',
  illegal:
    'Votre service a répondu un coup que les règles refusent. Le journal de chaque partie donne le rang du coup et le motif exact du refus.',
  unreachable:
    'Votre service n’a pas pu être joint. Vérifiez que son adresse est toujours servie en https et qu’elle répond depuis l’extérieur.',
  'unreadable-reply':
    'Votre service a répondu autre chose qu’un coup. La réponse attendue est un jeton unique de notation, sans texte autour.',
}

/**
 * Seuils de l'alerte technique. Une panne franche se voit sur la proportion,
 * pas sur le compte brut : un quart des parties suffit à dire qu'un service va
 * mal, mais trois échecs au minimum, pour qu'une vague courte ne crie pas.
 */
export const TECHNICAL_ALERT_MIN = 3
export const TECHNICAL_ALERT_RATIO = 0.25

export type RankingRow = {
  rank: number
  name: string
  elo: number
  /** Écart depuis la vague précédente ; `null` si l'IA n'a jamais été classée. */
  delta: number | null
  status: BotStatus
}

export type BotReport = {
  name: string
  status: BotStatus
  /** Rang au classement, ou `null` pour une IA qui n'y figure pas. */
  rank: number | null
  elo: number
  delta: number | null
  wins: number
  draws: number
  losses: number
  /** Défaites techniques de la vague, par motif. */
  technical: Partial<Record<TechnicalReason, number>>
  /** Refus de notation, par motif : ne sert qu'aux défaites sur coup illégal. */
  refusals?: Partial<Record<NotationErrorReason, number>>
  /** Vrai si la mise en sommeil a été prononcée pendant cette vague. */
  fellAsleep: boolean
}

export type MailLinks = {
  /** Classement public, ouvert sans compte. */
  ranking: string
  /** « Mes parties » du destinataire. */
  games: string
  /** « Mes IA », d'où se réactive une IA en sommeil. */
  myBots: string
}

export type WaveMailData = {
  /** Fin de la fenêtre de la vague, en instant absolu. */
  waveEnd: Date
  ranking: readonly RankingRow[]
  /** Les IA du destinataire ; au moins une, l'envoi n'ayant pas lieu sinon. */
  bots: readonly BotReport[]
  links: MailLinks
}

export type RenderedMail = { subject: string; text: string; html: string }

const TEXT_WIDTH = 72
const MAX_SUBJECT_LENGTH = 160

const MONTHS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
]
const WEEKDAYS = [
  'dimanche', 'lundi', 'mardi', 'mercredi',
  'jeudi', 'vendredi', 'samedi',
]

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Échappe les cinq caractères qui changent le sens d'un document HTML. Le
 * guillemet simple est du lot : les valeurs de ce module entrent aussi dans des
 * attributs, et rien ne garantit qu'ils soient tous entre guillemets doubles.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char)
}

/**
 * Rend une valeur de base sûre pour du texte brut et pour un en-tête : les
 * caractères de contrôle — retour chariot compris — deviennent des espaces, et
 * les suites d'espaces se réduisent à une.
 */
export function sanitize(value: string): string {
  // Parcours par point de code plutôt que classe de caractères : une classe de
  // contrôles s'écrit mal, se lit moins bien, et le linteur la refuse.
  let plain = ''
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    const control = code < 0x20 || (code >= 0x7f && code <= 0x9f)
    plain += control ? ' ' : char
  }
  return plain.replace(/\s+/g, ' ').trim()
}

/**
 * Accord des pluriels : 0 et 1 au singulier, 2 et au-delà au pluriel. Le pluriel
 * par défaut suffixe un `s` au mot entier : un groupe nominal comme « défaite
 * technique » doit donc donner le sien, faute de quoi seul le dernier mot
 * s'accorderait.
 */
export function plural(count: number, singular: string, many?: string): string {
  const word = Math.abs(count) < 2 ? singular : (many ?? `${singular}s`)
  return `${count} ${word}`
}

/** Rang ordinal français : 1er, puis 2e, 3e… */
export function ordinal(rank: number): string {
  return rank === 1 ? '1er' : `${rank}e`
}

/** Écart signé, ou « nouvelle » quand l'IA n'a pas de vague précédente. */
function deltaText(delta: number | null): string {
  return delta === null ? 'nouvelle' : formatDelta(delta)
}

type Parts = { year: number; month: number; day: number; hour: number; minute: number }

/**
 * Découpe un instant dans le fuseau de Paris. Seules les valeurs **numériques**
 * sont demandées à `Intl` : les noms de mois et de jours sont écrits ici, pour
 * que le rendu ne dépende pas de la version d'ICU embarquée par le moteur.
 */
function parisParts(instant: Date): Parts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const found: Record<string, string> = {}
  for (const part of formatter.formatToParts(instant)) found[part.type] = part.value
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
  }
}

/** « jeudi 4 septembre 2026 », heure de Paris. */
export function formatWaveDate(instant: Date): string {
  const { year, month, day } = parisParts(instant)
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  return `${weekday} ${day} ${MONTHS[month - 1]} ${year}`
}

/** « 12 h 00 », heure de Paris. */
export function formatWaveTime(instant: Date): string {
  const { hour, minute } = parisParts(instant)
  return `${hour} h ${String(minute).padStart(2, '0')}`
}

function playedGames(bot: BotReport): number {
  return bot.wins + bot.draws + bot.losses
}

function technicalTotal(bot: BotReport): number {
  return Object.values(bot.technical).reduce((sum, count) => sum + count, 0)
}

/**
 * Motif dominant, départagé par l'ordre de `TECHNICAL_REASONS` : deux motifs à
 * égalité doivent toujours rendre le même, sans quoi deux rendus du même
 * courriel diffèrent.
 */
function dominantReason(bot: BotReport): TechnicalReason | null {
  let best: TechnicalReason | null = null
  let bestCount = 0
  for (const reason of TECHNICAL_REASONS) {
    const count = bot.technical[reason as TechnicalReason] ?? 0
    if (count > bestCount) {
      best = reason as TechnicalReason
      bestCount = count
    }
  }
  return best
}

function dominantRefusal(bot: BotReport): NotationErrorReason | null {
  let best: NotationErrorReason | null = null
  let bestCount = 0
  for (const [reason, count] of Object.entries(bot.refusals ?? {})) {
    if (count > bestCount) {
      best = reason as NotationErrorReason
      bestCount = count
    }
  }
  return best
}

/** Une IA dont l'échec technique est assez massif pour mériter une alerte. */
export function hasTechnicalAlert(bot: BotReport): boolean {
  const total = technicalTotal(bot)
  if (total < TECHNICAL_ALERT_MIN) return false
  const played = playedGames(bot)
  return played === 0 || total / played >= TECHNICAL_ALERT_RATIO
}

/** Détail des défaites techniques : « hors délai : 22, coup illégal : 2 ». */
function technicalDetail(bot: BotReport): string {
  const parts: string[] = []
  for (const reason of TECHNICAL_REASONS) {
    const count = bot.technical[reason as TechnicalReason] ?? 0
    if (count > 0) parts.push(`${REASON_LABELS[reason]} : ${count}`)
  }
  return parts.join(', ')
}

function sleepingBots(data: WaveMailData): BotReport[] {
  return data.bots.filter((bot) => bot.status === 'sommeil')
}

function alertingBots(data: WaveMailData): BotReport[] {
  return data.bots.filter(hasTechnicalAlert)
}

/**
 * Phrase de mise en sommeil. Le nom y est déjà assaini ; l'appelant échappe
 * ensuite pour le HTML, jamais l'inverse.
 */
function sleepParagraphs(bot: BotReport): string[] {
  const name = sanitize(bot.name)
  const opening = bot.fellAsleep
    ? `« ${name} » vient d’être mise en sommeil.`
    : `« ${name} » est toujours en sommeil.`
  return [
    `${opening} Elle a échoué techniquement sur la totalité de ses parties pendant trois vagues consécutives : elle sort des appariements, et son classement reste gelé à ${bot.elo}.`,
    `Pour la réactiver, ouvrez « Mes IA », vérifiez d’abord que votre service répond, puis réactivez-la. Elle repassera par une partie de qualification, et reprendra au classement gelé de ${bot.elo}.`,
  ]
}

/** Phrase d'alerte technique, motif dominant nommé en français. */
function technicalParagraph(bot: BotReport): string {
  const name = sanitize(bot.name)
  const total = technicalTotal(bot)
  const played = playedGames(bot)
  const reason = dominantReason(bot)
  if (!reason) return ''
  const refusal = reason === 'illegal' ? dominantRefusal(bot) : null
  const cause = refusal
    ? `${REASON_LABELS[reason]} (${REFUSAL_LABELS[refusal]})`
    : REASON_LABELS[reason]
  const count = plural(total, 'défaite technique', 'défaites techniques')
  const over = played > 0 ? ` sur ${plural(played, 'partie')}` : ''
  return `« ${name} » : ${count}${over}, motif dominant : ${cause}. ${TECHNICAL_ADVICE[reason]}`
}

/** Bilan chiffré d'une IA : « 15 victoires, 4 nuls, 5 défaites ». */
function tallyLine(bot: BotReport): string {
  return [
    plural(bot.wins, 'victoire'),
    plural(bot.draws, 'nul'),
    plural(bot.losses, 'défaite'),
  ].join(', ')
}

/** En-tête d'une IA : « Alpha — 1183 (=), 14e au classement, en sommeil ». */
function botHeading(bot: BotReport): string {
  const parts = [`${sanitize(bot.name)} — ${bot.elo} (${deltaText(bot.delta)})`]
  parts.push(bot.rank === null ? 'hors classement' : `${ordinal(bot.rank)} au classement`)
  if (bot.status !== 'active') parts.push(STATUS_LABELS[bot.status])
  return parts.join(', ')
}

/** Découpe un paragraphe en lignes d'au plus `width` caractères. */
function wrap(paragraph: string, width = TEXT_WIDTH): string[] {
  const lines: string[] = []
  let current = ''
  for (const word of paragraph.split(' ')) {
    if (current === '') current = word
    else if (current.length + 1 + word.length <= width) current += ` ${word}`
    else {
      lines.push(current)
      current = word
    }
  }
  if (current !== '') lines.push(current)
  return lines
}

function heading(title: string): string[] {
  return [title.toUpperCase(), '-'.repeat(title.length)]
}

function renderText(data: WaveMailData): string {
  const lines: string[] = []
  const date = formatWaveDate(data.waveEnd)
  lines.push('LINKX — TOURNOI DES IA')
  lines.push(`Vague du ${date}, close à ${formatWaveTime(data.waveEnd)}.`)

  const asleep = sleepingBots(data)
  const alerting = alertingBots(data)
  if (asleep.length > 0 || alerting.length > 0) {
    lines.push('', ...heading('À signaler'))
    for (const bot of asleep) {
      for (const paragraph of sleepParagraphs(bot)) {
        lines.push('', ...wrap(paragraph))
      }
      lines.push(`Mes IA : ${data.links.myBots}`)
    }
    for (const bot of alerting) {
      lines.push('', ...wrap(technicalParagraph(bot)))
    }
  }

  lines.push('', ...heading('Votre bilan'))
  for (const bot of data.bots) {
    lines.push('', botHeading(bot))
    lines.push(`  ${tallyLine(bot)}`)
    const total = technicalTotal(bot)
    if (total > 0) {
      lines.push(`  dont ${plural(total, 'défaite technique', 'défaites techniques')} — ${technicalDetail(bot)}`)
    }
  }

  lines.push('', ...heading('Classement'))
  const width = String(data.ranking.length).length
  for (const row of data.ranking) {
    const rank = String(row.rank).padStart(width, ' ')
    const state = row.status === 'active' ? '' : `, ${STATUS_LABELS[row.status]}`
    lines.push(
      `${rank}. ${sanitize(row.name)} — ${row.elo} (${deltaText(row.delta)})${state}`,
    )
  }
  if (data.ranking.length === 0) lines.push('Aucune IA classée pour le moment.')

  lines.push('')
  lines.push(`Classement complet : ${data.links.ranking}`)
  lines.push(`Vos parties : ${data.links.games}`)
  lines.push(`Vos IA : ${data.links.myBots}`)
  lines.push('')
  lines.push(
    ...wrap(
      'Vous recevez ce message parce que vous avez déclaré au moins une IA au tournoi Linkx. Il part une fois par semaine, à la clôture de la vague du jeudi.',
    ),
  )
  return `${lines.join('\n')}\n`
}

const HTML_BODY =
  'margin:0;padding:24px 12px;background:#f4f4f2;' +
  // Guillemets simples dans la pile de polices : la valeur vit dans un
  // attribut délimité par des guillemets doubles, qui la fermeraient ici.
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
  'color:#1c1c1a;font-size:15px;line-height:1.5;'
const HTML_FRAME =
  'max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dedcd6;' +
  'border-radius:8px;padding:24px;'
const HTML_H2 = 'font-size:17px;margin:28px 0 8px;'
const HTML_ALERT =
  'margin:16px 0;padding:12px 14px;background:#fdf3e3;' +
  'border-left:4px solid #b06a00;border-radius:4px;'
const HTML_CELL = 'padding:6px 8px;border-bottom:1px solid #eceae4;'
const HTML_HEAD_CELL =
  'padding:6px 8px;border-bottom:2px solid #dedcd6;font-weight:600;'
const HTML_MUTED = 'color:#5c5a54;font-size:13px;'

function paragraph(text: string, style = 'margin:8px 0;'): string {
  return `<p style="${style}">${escapeHtml(text)}</p>`
}

function renderHtml(data: WaveMailData): string {
  const out: string[] = []
  const date = formatWaveDate(data.waveEnd)
  out.push(`<div style="${HTML_BODY}"><div style="${HTML_FRAME}">`)
  out.push('<h1 style="font-size:20px;margin:0 0 4px;">Linkx — tournoi des IA</h1>')
  out.push(
    paragraph(
      `Vague du ${date}, close à ${formatWaveTime(data.waveEnd)}.`,
      `margin:0 0 8px;${HTML_MUTED}`,
    ),
  )

  const asleep = sleepingBots(data)
  const alerting = alertingBots(data)
  if (asleep.length > 0 || alerting.length > 0) {
    out.push(`<h2 style="${HTML_H2}">À signaler</h2>`)
    for (const bot of asleep) {
      const body = sleepParagraphs(bot)
        .map((text) => paragraph(text))
        .join('')
      const action = `<p style="margin:8px 0 0;">${link(data.links.myBots, 'Réactiver depuis « Mes IA »')}</p>`
      out.push(`<div style="${HTML_ALERT}">${body}${action}</div>`)
    }
    for (const bot of alerting) {
      out.push(`<div style="${HTML_ALERT}">${paragraph(technicalParagraph(bot))}</div>`)
    }
  }

  out.push(`<h2 style="${HTML_H2}">Votre bilan</h2>`)
  for (const bot of data.bots) {
    const total = technicalTotal(bot)
    out.push(paragraph(botHeading(bot), 'margin:16px 0 2px;font-weight:600;'))
    out.push(paragraph(tallyLine(bot), `margin:0;${HTML_MUTED}`))
    if (total > 0) {
      out.push(
        paragraph(
          `dont ${plural(total, 'défaite technique', 'défaites techniques')} — ${technicalDetail(bot)}`,
          `margin:0;${HTML_MUTED}`,
        ),
      )
    }
  }

  out.push(`<h2 style="${HTML_H2}">Classement</h2>`)
  if (data.ranking.length === 0) {
    out.push(paragraph('Aucune IA classée pour le moment.'))
  } else {
    out.push(
      '<table role="presentation" cellpadding="0" cellspacing="0"' +
        ' style="width:100%;border-collapse:collapse;font-size:14px;">',
      '<tr>' +
        `<th style="${HTML_HEAD_CELL}text-align:left;">Rang</th>` +
        `<th style="${HTML_HEAD_CELL}text-align:left;">IA</th>` +
        `<th style="${HTML_HEAD_CELL}text-align:right;">Elo</th>` +
        `<th style="${HTML_HEAD_CELL}text-align:right;">Écart</th>` +
        '</tr>',
    )
    for (const row of data.ranking) {
      const state = row.status === 'active'
        ? ''
        : ` <span style="${HTML_MUTED}">(${escapeHtml(STATUS_LABELS[row.status])})</span>`
      out.push(
        '<tr>' +
          `<td style="${HTML_CELL}">${row.rank}</td>` +
          `<td style="${HTML_CELL}">${escapeHtml(sanitize(row.name))}${state}</td>` +
          `<td style="${HTML_CELL}text-align:right;">${row.elo}</td>` +
          `<td style="${HTML_CELL}text-align:right;">${escapeHtml(deltaText(row.delta))}</td>` +
          '</tr>',
      )
    }
    out.push('</table>')
  }

  out.push(`<p style="margin:20px 0 0;">${link(data.links.ranking, 'Classement complet')} · ${
    link(data.links.games, 'Vos parties')
  } · ${link(data.links.myBots, 'Vos IA')}</p>`)
  out.push(
    paragraph(
      'Vous recevez ce message parce que vous avez déclaré au moins une IA au tournoi Linkx. Il part une fois par semaine, à la clôture de la vague du jeudi.',
      `margin:24px 0 0;${HTML_MUTED}`,
    ),
  )
  out.push('</div></div>')
  return out.join('\n')
}

/** Lien sobre : l'adresse est échappée pour l'attribut comme pour le texte. */
function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}" style="color:#1a5fb4;">${escapeHtml(label)}</a>`
}

/**
 * Objet du message. La mise en sommeil y passe devant tout le reste : c'est la
 * seule information du courriel qui demande une action, et beaucoup de lecteurs
 * ne lisent que cette ligne.
 */
export function renderSubject(data: WaveMailData): string {
  const date = formatWaveDate(data.waveEnd)
  const asleep = sleepingBots(data)
  const raw = asleep.length === 1 && asleep[0]
    ? `Linkx — « ${sanitize(asleep[0].name)} » est en sommeil (vague du ${date})`
    : asleep.length > 1
      ? `Linkx — ${plural(asleep.length, 'IA', 'IA')} en sommeil (vague du ${date})`
      : `Linkx — classement de la vague du ${date}`
  const subject = sanitize(raw)
  return subject.length <= MAX_SUBJECT_LENGTH
    ? subject
    : `${subject.slice(0, MAX_SUBJECT_LENGTH - 1)}…`
}

/** Objet, texte brut et HTML, rendus d'un même parcours des mêmes données. */
export function renderWaveMail(data: WaveMailData): RenderedMail {
  return {
    subject: renderSubject(data),
    text: renderText(data),
    html: renderHtml(data),
  }
}
