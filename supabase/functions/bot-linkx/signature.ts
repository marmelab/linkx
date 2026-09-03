/**
 * Vérification de la signature de la plateforme (`docs/protocole-ia.md`).
 *
 * L'empreinte est le HMAC-SHA256, avec le secret de l'IA, de la chaîne
 * `<horodatage>.<corps exact de la requête>`. Le corps doit donc être lu comme
 * texte avant d'être analysé : re-sérialiser le JSON changerait l'empreinte.
 */

export const TIMESTAMP_HEADER = 'x-linkx-timestamp'
export const SIGNATURE_HEADER = 'x-linkx-signature'

/** Nom de la variable d'environnement portant le secret remis à l'inscription. */
export const SECRET_ENV = 'LINKX_BOT_SECRET'

/** Au-delà, l'appel est considéré comme rejoué. */
export const MAX_TIMESTAMP_AGE_S = 300

export type SignatureVerdict =
  | { ok: true; checked: boolean }
  | { ok: false; message: string }

const encoder = new TextEncoder()

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Comparaison sans fuite de temps : on parcourt toujours la totalité des
 * caractères. Une longueur différente suffit à refuser, la taille d'une
 * empreinte SHA-256 n'étant pas un secret.
 */
function equalsInConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

async function computeDigest(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return toHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)))
}

/**
 * Rend `checked: false` lorsque aucun secret n'est configuré : le service reste
 * utilisable en développement, et l'appelant trace ce choix.
 */
export async function verifySignature(
  headers: Headers,
  rawBody: string,
  secret: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SignatureVerdict> {
  if (!secret) return { ok: true, checked: false }

  const timestamp = headers.get(TIMESTAMP_HEADER)
  const signature = headers.get(SIGNATURE_HEADER)
  if (!timestamp || !signature) {
    return { ok: false, message: 'Appel non signé.' }
  }

  const emittedAt = Number(timestamp)
  if (!Number.isFinite(emittedAt)) {
    return { ok: false, message: 'Horodatage illisible.' }
  }
  if (Math.abs(nowSeconds - emittedAt) > MAX_TIMESTAMP_AGE_S) {
    return { ok: false, message: 'Horodatage hors fenêtre.' }
  }

  const offered = signature.startsWith('sha256=') ? signature.slice(7) : signature
  const expected = await computeDigest(secret, `${timestamp}.${rawBody}`)
  if (!equalsInConstantTime(offered.toLowerCase(), expected)) {
    return { ok: false, message: 'Signature invalide.' }
  }
  return { ok: true, checked: true }
}
