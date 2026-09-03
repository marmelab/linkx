import { describe, expect, it } from 'vitest'
import {
  composeForRecipient,
  idempotencyKey,
  sendWaveMails,
} from './waveMailDelivery.ts'
import type {
  ClaimOutcome,
  Delivery,
  MailMessage,
  Recipient,
  WaveMailInput,
} from './waveMailDelivery.ts'
import type { BotReport, RenderedMail } from './waveMail.ts'

const LINKS = {
  ranking: 'https://exemple.test/classement',
  games: 'https://exemple.test/mes-parties',
  myBots: 'https://exemple.test/mes-ias',
}

const WAVE = '11111111-1111-4111-8111-111111111111'

function bot(name: string, overrides: Partial<BotReport> = {}): BotReport {
  return {
    name,
    status: 'active',
    rank: 2,
    elo: 1250,
    delta: 12,
    wins: 10,
    draws: 2,
    losses: 3,
    technical: {},
    fellAsleep: false,
    ...overrides,
  }
}

function recipient(id: string, bots: BotReport[]): Recipient {
  return { id, email: `${id}@exemple.test`, bots }
}

function input(recipients: Recipient[]): WaveMailInput {
  return {
    waveId: WAVE,
    waveEnd: new Date('2026-09-03T10:00:00Z'),
    ranking: [{ rank: 1, name: 'Gamma', elo: 1402, delta: 12, status: 'active' }],
    recipients,
    links: LINKS,
  }
}

/** Fournisseur de bouchon : retient ce qui part, sans le moindre réseau. */
function fakeSender(failing: ReadonlySet<string> = new Set()) {
  const sent: MailMessage[] = []
  const send = (message: MailMessage) => {
    if (failing.has(message.to)) {
      return Promise.resolve({ ok: false as const, error: 'Resend 500' })
    }
    sent.push(message)
    return Promise.resolve({ ok: true as const, id: `id-${sent.length}` })
  }
  return { sent, send }
}

/** Réservation de bouchon : la file `courriels_vague`, en mémoire. */
function fakeClaims() {
  const taken = new Map<string, string>()
  const claim = (id: string, mail: RenderedMail): Promise<ClaimOutcome> => {
    if (taken.has(id)) return Promise.resolve('already-sent')
    taken.set(id, mail.subject)
    return Promise.resolve('claimed')
  }
  const release = (id: string) => {
    taken.delete(id)
    return Promise.resolve()
  }
  return { taken, claim, release }
}

const noClaim: Delivery['claim'] = () => Promise.resolve('unavailable')

/** Ce que la réservation reçoit : le message composé, prêt à être conservé. */
function claimSpy() {
  const seen: Array<[string, string]> = []
  const claim: Delivery['claim'] = (id, mail) => {
    seen.push([id, mail.subject])
    return Promise.resolve('claimed')
  }
  return { seen, claim }
}

describe('composition', () => {
  it('rend un message par destinataire, sans réseau', () => {
    const data = input([recipient('a', [bot('Alpha')])])
    const mail = composeForRecipient(data, data.recipients[0]!)
    expect(mail.subject).toContain('Linkx')
    expect(mail.text).toContain('Alpha')
    expect(mail.html).toContain('Alpha')
  })

  it('remet le message composé à la réservation, avant tout envoi', async () => {
    const spy = claimSpy()
    const sender = fakeSender()
    await sendWaveMails(input([recipient('a', [bot('Alpha')])]), {
      send: sender.send,
      claim: spy.claim,
    })
    expect(spy.seen).toHaveLength(1)
    expect(spy.seen[0]?.[0]).toBe('a')
    expect(spy.seen[0]?.[1]).toContain('Linkx')
  })

  it('donne une clé d’idempotence stable pour un couple vague/destinataire', () => {
    expect(idempotencyKey(WAVE, 'a')).toBe(`wave-mail:${WAVE}:a`)
    expect(idempotencyKey(WAVE, 'a').length).toBeLessThanOrEqual(256)
  })
})

describe('un destinataire, un seul courriel', () => {
  it('ne sert pas deux fois le même destinataire quand la fonction est rappelée', async () => {
    const sender = fakeSender()
    const claims = fakeClaims()
    const data = input([recipient('a', [bot('Alpha')]), recipient('b', [bot('Beta')])])

    const first = await sendWaveMails(data, { ...claims, send: sender.send })
    const second = await sendWaveMails(data, { ...claims, send: sender.send })

    expect(first.envoyes).toBe(2)
    expect(second.envoyes).toBe(0)
    expect(second.ignores).toBe(2)
    expect(second.details.every((entry) => entry.statut === 'deja-envoye')).toBe(true)
    expect(sender.sent).toHaveLength(2)
    expect(first.garantie).toBe('base')
  })

  it('avoue que la garantie retombe sur le fournisseur quand la base ne sait pas retenir', async () => {
    const sender = fakeSender()
    const report = await sendWaveMails(input([recipient('a', [bot('Alpha')])]), {
      send: sender.send,
      claim: noClaim,
    })
    expect(report.garantie).toBe('fournisseur-24h')
    expect(sender.sent[0]?.idempotencyKey).toBe(`wave-mail:${WAVE}:a`)
  })

  it('n’écrit aucune adresse dans le compte rendu', async () => {
    const sender = fakeSender()
    const report = await sendWaveMails(input([recipient('a', [bot('Alpha')])]), {
      send: sender.send,
      claim: noClaim,
    })
    expect(JSON.stringify(report)).not.toContain('@')
  })
})

describe('un échec n’entraîne pas les autres', () => {
  it('sert les destinataires suivants après une panne d’envoi', async () => {
    const sender = fakeSender(new Set(['b@exemple.test']))
    const claims = fakeClaims()
    const report = await sendWaveMails(
      input([
        recipient('a', [bot('Alpha')]),
        recipient('b', [bot('Beta')]),
        recipient('c', [bot('Ceta')]),
      ]),
      { ...claims, send: sender.send },
    )
    expect(report.envoyes).toBe(2)
    expect(report.echecs).toBe(1)
    expect(sender.sent.map((message) => message.to)).toEqual([
      'a@exemple.test',
      'c@exemple.test',
    ])
    // La réservation de l'envoi manqué est rendue : un rappel réessaiera.
    expect(claims.taken.has('b')).toBe(false)
    expect(claims.taken.has('a')).toBe(true)
  })

  it('survit à un expéditeur qui lève au lieu de rendre une erreur', async () => {
    const report = await sendWaveMails(
      input([recipient('a', [bot('Alpha')]), recipient('b', [bot('Beta')])]),
      {
        send: (message) =>
          message.to.startsWith('a')
            ? Promise.reject(new Error('socket fermée'))
            : Promise.resolve({ ok: true, id: null }),
        claim: noClaim,
      },
    )
    expect(report.echecs).toBe(1)
    expect(report.envoyes).toBe(1)
    expect(report.details[0]?.detail).toBe('socket fermée')
  })

  it('s’abstient plutôt que de risquer un doublon quand la réservation échoue', async () => {
    const sender = fakeSender()
    const report = await sendWaveMails(input([recipient('a', [bot('Alpha')])]), {
      send: sender.send,
      claim: () => Promise.reject(new Error('réservation refusée (503)')),
    })
    expect(sender.sent).toHaveLength(0)
    expect(report.echecs).toBe(1)
    expect(report.details[0]?.detail).toContain('réservation impossible')
  })
})

describe('périmètre des destinataires', () => {
  it('n’envoie rien à un auteur sans IA', async () => {
    const sender = fakeSender()
    const report = await sendWaveMails(input([recipient('a', [])]), {
      send: sender.send,
      claim: noClaim,
    })
    expect(sender.sent).toHaveLength(0)
    expect(report.details[0]?.statut).toBe('sans-ia')
    expect(report.ignores).toBe(1)
  })

  it('compte ce qu’il a fait, destinataire par destinataire', async () => {
    const claims = fakeClaims()
    const sender = fakeSender(new Set(['c@exemple.test']))
    const report = await sendWaveMails(
      input([
        recipient('a', [bot('Alpha')]),
        recipient('b', []),
        recipient('c', [bot('Ceta')]),
      ]),
      { ...claims, send: sender.send },
    )
    expect(report).toMatchObject({
      vague: WAVE,
      destinataires: 3,
      envoyes: 1,
      ignores: 1,
      echecs: 1,
      garantie: 'base',
    })
  })
})
