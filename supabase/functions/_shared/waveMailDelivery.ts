/**
 * Envoi du courriel hebdomadaire de fin de vague (histoire 15) : composition et
 * boucle sur les destinataires, **sans réseau**.
 *
 * L'envoi et la réservation sont **injectés**. Le module ne connaît donc ni
 * Resend ni PostgREST, et toute la logique qui compte — un destinataire servi
 * une fois et une seule, un échec qui n'entraîne pas les autres — se teste avec
 * deux fonctions de bouchon.
 *
 * **Réservation.** Un destinataire ne doit pas être servi deux fois si un cron
 * rappelle la fonction. La réservation est donc prise **avant** l'envoi, et
 * rendue si l'envoi échoue. `ClaimRecipient` reçoit le message composé : la
 * réservation a de quoi conserver ce qui est parti. Elle rend `unavailable`
 * quand la plateforme ne sait pas retenir l'envoi — la garantie retombe alors
 * sur la clé d'idempotence du fournisseur, valable vingt-quatre heures, et le
 * compte rendu le dit.
 */
import { renderWaveMail } from './waveMail.ts'
import type { BotReport, MailLinks, RankingRow, RenderedMail } from './waveMail.ts'

export type MailMessage = {
  to: string
  subject: string
  text: string
  html: string
  /** Rejouée à l'identique par un second appel : c'est elle qui dédouble. */
  idempotencyKey: string
}

export type SendOutcome =
  | { ok: true; id: string | null }
  | { ok: false; error: string }

export type SendMail = (message: MailMessage) => Promise<SendOutcome>

/**
 * `claimed` : la place est prise, l'envoi peut partir. `already-sent` : ce
 * destinataire a déjà reçu cette vague. `unavailable` : rien ne sait retenir
 * l'envoi, on s'en remet à la clé d'idempotence.
 */
export type ClaimOutcome = 'claimed' | 'already-sent' | 'unavailable'
export type ClaimRecipient = (
  recipientId: string,
  mail: RenderedMail,
) => Promise<ClaimOutcome>
/** Libère une réservation dont l'envoi a échoué, pour qu'un rappel réessaie. */
export type ReleaseRecipient = (recipientId: string) => Promise<void>

export type Recipient = {
  /** Identifiant opaque : la seule chose de ce module qui aille au journal. */
  id: string
  email: string
  bots: readonly BotReport[]
}

export type WaveMailInput = {
  waveId: string
  waveEnd: Date
  ranking: readonly RankingRow[]
  recipients: readonly Recipient[]
  links: MailLinks
}

export type Delivery = {
  send: SendMail
  claim: ClaimRecipient
  release?: ReleaseRecipient
}

export type RecipientStatus =
  | 'envoye'
  | 'deja-envoye'
  | 'sans-ia'
  | 'echec'

export type RecipientReport = {
  /** Identifiant opaque du destinataire ; jamais son adresse. */
  destinataire: string
  statut: RecipientStatus
  detail?: string
}

export type DeliveryReport = {
  vague: string
  destinataires: number
  envoyes: number
  ignores: number
  echecs: number
  /** D'où vient la garantie de non-doublon effectivement obtenue. */
  garantie: 'base' | 'fournisseur-24h'
  details: RecipientReport[]
}

/**
 * Clé d'idempotence : stable pour un couple (vague, destinataire), et bornée à
 * 256 caractères par le fournisseur — deux UUID et un préfixe tiennent large.
 */
export function idempotencyKey(waveId: string, recipientId: string): string {
  return `wave-mail:${waveId}:${recipientId}`
}

/** Compose le message d'un destinataire, sans rien envoyer. */
export function composeForRecipient(
  input: WaveMailInput,
  recipient: Recipient,
): RenderedMail {
  return renderWaveMail({
    waveEnd: input.waveEnd,
    ranking: input.ranking,
    bots: recipient.bots,
    links: input.links,
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Compose et remet un message par destinataire. Chaque destinataire est traité
 * dans son propre `try` : une adresse qui échoue ne prive pas les suivantes de
 * leur courriel, et le compte rendu dit laquelle, par identifiant.
 */
export async function sendWaveMails(
  input: WaveMailInput,
  delivery: Delivery,
): Promise<DeliveryReport> {
  const details: RecipientReport[] = []
  let guaranteedByDatabase = true

  for (const recipient of input.recipients) {
    if (recipient.bots.length === 0) {
      // « Il ne part qu'aux auteurs ayant au moins une IA » (histoire 15).
      details.push({ destinataire: recipient.id, statut: 'sans-ia' })
      continue
    }

    let mail: RenderedMail
    try {
      mail = composeForRecipient(input, recipient)
    } catch (error) {
      details.push({
        destinataire: recipient.id,
        statut: 'echec',
        detail: `composition impossible : ${describe(error)}`,
      })
      continue
    }

    let claim: ClaimOutcome
    try {
      claim = await delivery.claim(recipient.id, mail)
    } catch (error) {
      // Réservation illisible : on ne sait pas si l'envoi a déjà eu lieu, donc
      // on s'abstient. Un rappel réessaiera, ce qu'un doublon ne défait pas.
      details.push({
        destinataire: recipient.id,
        statut: 'echec',
        detail: `réservation impossible : ${describe(error)}`,
      })
      continue
    }

    if (claim === 'already-sent') {
      details.push({ destinataire: recipient.id, statut: 'deja-envoye' })
      continue
    }
    if (claim === 'unavailable') guaranteedByDatabase = false

    let outcome: SendOutcome
    try {
      outcome = await delivery.send({
        to: recipient.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        idempotencyKey: idempotencyKey(input.waveId, recipient.id),
      })
    } catch (error) {
      outcome = { ok: false, error: describe(error) }
    }

    if (outcome.ok) {
      details.push({ destinataire: recipient.id, statut: 'envoye' })
      continue
    }

    if (claim === 'claimed' && delivery.release) {
      // Sans cela, une panne passagère du fournisseur ferait taire cet auteur
      // pour toute la vague : la place resterait prise sans message parti.
      await delivery.release(recipient.id).catch(() => undefined)
    }
    details.push({
      destinataire: recipient.id,
      statut: 'echec',
      detail: outcome.error,
    })
  }

  return {
    vague: input.waveId,
    destinataires: input.recipients.length,
    envoyes: details.filter((entry) => entry.statut === 'envoye').length,
    ignores: details.filter(
      (entry) => entry.statut === 'deja-envoye' || entry.statut === 'sans-ia',
    ).length,
    echecs: details.filter((entry) => entry.statut === 'echec').length,
    garantie: guaranteedByDatabase ? 'base' : 'fournisseur-24h',
    details,
  }
}
