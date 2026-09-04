import { describe, expect, it } from 'vitest'
import {
  REASON_LABELS,
  STATUS_LABELS,
  TECHNICAL_ADVICE,
  escapeHtml,
  formatWaveDate,
  formatWaveTime,
  hasTechnicalAlert,
  ordinal,
  plural,
  renderSubject,
  renderWaveMail,
  sanitize,
} from './waveMail.ts'
import type { BotReport, RankingRow, WaveMailData } from './waveMail.ts'
import { TECHNICAL_REASONS } from './referee.ts'

const LINKS = {
  ranking: 'https://exemple.test/classement',
  games: 'https://exemple.test/mes-parties',
  myBots: 'https://exemple.test/mes-ias',
}

/** Fin de la vague du jeudi 3 septembre 2026, midi heure de Paris. */
const WAVE_END = new Date('2026-09-03T10:00:00Z')

function bot(overrides: Partial<BotReport> = {}): BotReport {
  return {
    name: 'Alpha',
    status: 'active',
    rank: 3,
    elo: 1247,
    delta: 18,
    wins: 15,
    draws: 4,
    losses: 5,
    technical: {},
    fellAsleep: false,
    ...overrides,
  }
}

function row(overrides: Partial<RankingRow> = {}): RankingRow {
  return { rank: 1, name: 'Gamma', elo: 1402, delta: 12, status: 'active', ...overrides }
}

function data(overrides: Partial<WaveMailData> = {}): WaveMailData {
  return {
    waveEnd: WAVE_END,
    ranking: [row(), row({ rank: 2, name: 'Delta', elo: 1301, delta: -7 })],
    bots: [bot()],
    links: LINKS,
    ...overrides,
  }
}

describe('outils de langue', () => {
  it('accorde les pluriels, et laisse zéro au singulier', () => {
    expect(plural(0, 'défaite')).toBe('0 défaite')
    expect(plural(1, 'victoire')).toBe('1 victoire')
    expect(plural(3, 'victoire')).toBe('3 victoires')
    expect(plural(2, 'IA', 'IA')).toBe('2 IA')
  })

  it('écrit les rangs en ordinaux français', () => {
    expect(ordinal(1)).toBe('1er')
    expect(ordinal(14)).toBe('14e')
  })

  it('date et heure sont lues dans le fuseau de Paris', () => {
    expect(formatWaveDate(WAVE_END)).toBe('jeudi 3 septembre 2026')
    expect(formatWaveTime(WAVE_END)).toBe('12 h 00')
    // Hiver : le même décalage ne s'applique plus, et la date bascule.
    expect(formatWaveDate(new Date('2026-01-01T23:30:00Z'))).toBe('vendredi 2 janvier 2026')
  })
})

describe('échappement', () => {
  const hostile = '<script>alert("x")</script> & \'Bobby\''

  it('neutralise les cinq caractères qui changent le sens du HTML', () => {
    expect(escapeHtml(hostile)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Bobby&#39;',
    )
  })

  it('n’écrit jamais un nom d’IA brut dans le HTML', () => {
    const mail = renderWaveMail(
      data({
        ranking: [row({ name: hostile })],
        bots: [bot({ name: hostile })],
      }),
    )
    expect(mail.html).not.toContain('<script>')
    expect(mail.html).not.toContain('alert("x")')
    expect(mail.html).toContain('&lt;script&gt;')
    // Le texte brut n'a pas à échapper, mais il doit rester le même nom.
    expect(mail.text).toContain('<script>alert("x")</script>')
  })

  it('replie les caractères de contrôle, y compris dans l’objet', () => {
    expect(sanitize('Alpha\r\nBcc: victime@exemple.test')).toBe(
      'Alpha Bcc: victime@exemple.test',
    )
    const subject = renderSubject(
      data({ bots: [bot({ name: 'Alpha\nX', status: 'sommeil', fellAsleep: true })] }),
    )
    expect(subject).not.toMatch(/[\r\n]/)
    expect(subject).toContain('Alpha X')
  })
})

describe('contenu du courriel', () => {
  it('porte le classement complet, signe écrit', () => {
    const mail = renderWaveMail(
      data({
        ranking: [
          row(),
          row({ rank: 2, name: 'Delta', elo: 1301, delta: -7 }),
          row({ rank: 3, name: 'Alpha', elo: 1247, delta: 0 }),
          row({ rank: 4, name: 'Neuve', elo: 1200, delta: null }),
        ],
      }),
    )
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain('Gamma')
      expect(body).toContain('+12')
      expect(body).toContain('−7')
      expect(body).toContain('=')
      expect(body).toContain('nouvelle')
    }
    expect(mail.text).toContain('1. Gamma — 1402 (+12)')
  })

  it('donne le bilan personnel : victoires, nuls, défaites, écart, rang', () => {
    const mail = renderWaveMail(data({ bots: [bot({ wins: 1, draws: 0, losses: 3 })] }))
    expect(mail.text).toContain('1 victoire, 0 nul, 3 défaites')
    expect(mail.text).toContain('Alpha — 1247 (+18), 3e au classement')
    expect(mail.html).toContain('1 victoire, 0 nul, 3 défaites')
  })

  it('porte les deux liens attendus', () => {
    const mail = renderWaveMail(data())
    for (const body of [mail.text, mail.html]) {
      expect(body).toContain(LINKS.ranking)
      expect(body).toContain(LINKS.games)
    }
  })

  it('écrit l’état d’une IA qui n’est pas active', () => {
    const mail = renderWaveMail(
      data({ ranking: [row({ status: 'en_attente' })], bots: [bot({ status: 'en_attente' })] }),
    )
    expect(mail.text).toContain(STATUS_LABELS.en_attente)
    expect(mail.html).toContain('en qualification')
  })
})

describe('mise en sommeil', () => {
  const asleep = data({
    bots: [
      bot({
        name: 'Alpha',
        status: 'sommeil',
        elo: 1183,
        delta: -41,
        wins: 0,
        draws: 0,
        losses: 24,
        technical: { timeout: 22, unreachable: 2 },
        fellAsleep: true,
        rank: 14,
      }),
      bot({ name: 'Beta' }),
    ],
  })

  it('l’annonce dans l’objet', () => {
    expect(renderSubject(asleep)).toContain('« Alpha » est en sommeil')
  })

  it('la place avant le bilan, et non en bas', () => {
    const { text } = renderWaveMail(asleep)
    expect(text.indexOf('À SIGNALER')).toBeGreaterThan(-1)
    expect(text.indexOf('À SIGNALER')).toBeLessThan(text.indexOf('VOTRE BILAN'))
    expect(text.indexOf('À SIGNALER')).toBeLessThan(text.indexOf('CLASSEMENT'))
  })

  it('dit comment la réactiver et donne le classement gelé', () => {
    const { text, html } = renderWaveMail(asleep)
    for (const body of [text, html]) {
      expect(body).toContain('réactiver')
      expect(body).toContain('qualification')
      expect(body).toContain('1183')
      expect(body).toContain(LINKS.myBots)
    }
  })

  it('distingue la mise en sommeil de cette vague d’une plus ancienne', () => {
    expect(renderWaveMail(asleep).text).toContain('vient d’être mise en sommeil')
    const older = data({
      bots: [bot({ status: 'sommeil', fellAsleep: false, technical: {} })],
    })
    expect(renderWaveMail(older).text).toContain('est toujours en sommeil')
  })

  it('ne signale rien quand aucune IA ne dort et qu’aucune ne casse', () => {
    const { text } = renderWaveMail(data())
    expect(text).not.toContain('À SIGNALER')
    expect(renderSubject(data())).toBe(
      'Linkx — classement de la vague du jeudi 3 septembre 2026',
    )
  })
})

describe('défaites techniques', () => {
  it('déclenche sur la proportion, pas sur une poignée d’échecs', () => {
    expect(hasTechnicalAlert(bot({ technical: { timeout: 2 }, losses: 5 }))).toBe(false)
    expect(
      hasTechnicalAlert(bot({ wins: 20, draws: 0, losses: 4, technical: { timeout: 4 } })),
    ).toBe(false)
    expect(
      hasTechnicalAlert(bot({ wins: 0, draws: 0, losses: 24, technical: { timeout: 22 } })),
    ).toBe(true)
  })

  it('nomme le motif dominant en français, et dit quoi corriger', () => {
    const mail = renderWaveMail(
      data({
        bots: [
          bot({
            wins: 0,
            draws: 0,
            losses: 300,
            technical: { timeout: 298, unreachable: 2 },
          }),
        ],
      }),
    )
    expect(mail.html).toContain('300 défaites techniques sur 300 parties')
    expect(mail.text).toContain('hors délai')
    expect(mail.html).toContain(TECHNICAL_ADVICE.timeout)
    expect(mail.text).toContain('hors délai : 298, service injoignable : 2')
  })

  it('précise le refus dominant quand le motif est un coup illégal', () => {
    const mail = renderWaveMail(
      data({
        bots: [
          bot({
            wins: 0,
            draws: 0,
            losses: 10,
            technical: { illegal: 10 },
            refusals: { unsupported: 7, syntax: 3 },
          }),
        ],
      }),
    )
    // Le HTML ne replie pas les lignes : c'est là que la phrase se lit entière.
    expect(mail.html).toContain('motif dominant : coup illégal (support insuffisant)')
  })

  it('a un libellé et un conseil pour chacun des quatre motifs techniques', () => {
    for (const reason of TECHNICAL_REASONS) {
      expect(REASON_LABELS[reason]).toBeTruthy()
      expect(TECHNICAL_ADVICE[reason as keyof typeof TECHNICAL_ADVICE]).toBeTruthy()
    }
  })
})

describe('forme du HTML', () => {
  const { html } = renderWaveMail(
    data({ bots: [bot({ status: 'sommeil', fellAsleep: true })] }),
  )

  it('ne dépend d’aucune feuille externe et d’aucune mise en page moderne', () => {
    expect(html).not.toContain('<link')
    expect(html).not.toContain('<style')
    expect(html).not.toContain('@media')
    expect(html).not.toContain('flex')
    expect(html).not.toContain('grid')
    expect(html).not.toContain('<script')
  })

  it('ne laisse aucun guillemet ouvrir ou fermer un attribut par erreur', () => {
    // Une valeur de style portant un guillemet double — une pile de polices,
    // par exemple — refermerait l'attribut au milieu et casserait la balise.
    const quotes = (html.match(/"/g) ?? []).length
    const attributes = (html.match(/ (?:style|href|role|cellpadding|cellspacing)="/g) ?? [])
      .length
    expect(attributes).toBeGreaterThan(0)
    expect(quotes).toBe(attributes * 2)
  })

  it('borne sa largeur et style en ligne', () => {
    expect(html).toContain('max-width:640px')
    expect(html).toMatch(/<table[^>]+style="/)
  })

  it('rend les mêmes faits que le texte brut', () => {
    const { text } = renderWaveMail(
      data({ bots: [bot({ status: 'sommeil', fellAsleep: true })] }),
    )
    for (const fact of ['Gamma', 'Delta', '1247', '15 victoires', 'en sommeil']) {
      expect(text).toContain(fact)
      expect(html).toContain(fact)
    }
  })
})
