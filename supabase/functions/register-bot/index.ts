/**
 * Déclaration d'une IA par son auteur, depuis la SPA (histoire 14).
 *
 * La session est déjà ouverte : le clic sur le lien magique vaut confirmation de
 * l'adresse électronique, il n'y a pas d'autre étape ici. La fonction écrit avec
 * la clé de service — le déclencheur des colonnes réservées interdit à un client
 * d'écrire `statut` et `secret_signature` — mais elle ne fait jamais confiance
 * au corps de la requête pour savoir **qui** déclare : le propriétaire vient du
 * jeton, validé par le service d'authentification.
 *
 * La partie de qualification est déclenchée par l'ordonnanceur : l'IA reste ici
 * en `en_attente`, et la réponse le dit.
 */
import { checkBotAddressResolved } from '../_shared/denoDns.ts'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'content-type': 'application/json; charset=utf-8',
}

/** Deux déclarations par minute : au-delà, ce n'est plus un auteur qui essaie. */
const REGISTRATION_WINDOW_MS = 60_000
const MAX_REGISTRATIONS_PER_WINDOW = 2

const MAX_NAME_LENGTH = 64
/** Lettres, chiffres et ponctuation de nom ; ni contrôle, ni balise, ni emoji. */
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} '._+-]*$/u

type Field = 'name' | 'url'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function refuse(message: string, status: number, field: Field | null = null) {
  return json({ ok: false, field, message }, status)
}

/**
 * Identité de l'appelant, telle que le service d'authentification la confirme.
 * Le jeton n'est jamais décodé ici : seul `/auth/v1/user` sait s'il est signé,
 * non révoqué et non expiré.
 */
async function currentUserId(
  request: Request,
  supabaseUrl: string,
  anonKey: string,
): Promise<string | null> {
  const authorization = request.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+$/i.test(authorization)) return null

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { authorization, apikey: anonKey },
  })
  if (!response.ok) return null
  const user = (await response.json()) as { id?: unknown }
  return typeof user.id === 'string' ? user.id : null
}

function newSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') {
    return refuse('Utiliser POST.', 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return refuse('Service mal configuré.', 500)
  }

  const utilisateur = await currentUserId(request, supabaseUrl, anonKey)
  if (!utilisateur) {
    return refuse('Connectez-vous avant de déclarer une IA.', 401)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return refuse('Corps JSON illisible.', 400)
  }
  const fields = payload as { name?: unknown; url?: unknown } | null

  const name = typeof fields?.name === 'string' ? fields.name.trim() : ''
  if (name === '') return refuse('Donnez un nom à votre IA.', 400, 'name')
  if (name.length > MAX_NAME_LENGTH) {
    return refuse(
      `Le nom ne doit pas dépasser ${MAX_NAME_LENGTH} caractères.`,
      400,
      'name',
    )
  }
  if (!NAME_PATTERN.test(name)) {
    return refuse(
      'Le nom ne peut contenir que des lettres, des chiffres, des espaces et les signes . _ + - ’',
      400,
      'name',
    )
  }

  const rawUrl = typeof fields?.url === 'string' ? fields.url : ''
  const address = await checkBotAddressResolved(rawUrl)
  if (!address.ok) return refuse(address.message, 400, 'url')

  const rest = `${supabaseUrl}/rest/v1/bots`
  const serviceHeaders = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    'content-type': 'application/json',
  }

  // Débit compté en base, sur les déclarations elles-mêmes : une mémoire
  // d'isolate ne survivrait ni à un redémarrage ni à une seconde instance.
  const depuis = new Date(Date.now() - REGISTRATION_WINDOW_MS).toISOString()
  const recentes = await fetch(
    `${rest}?select=id&proprietaire=eq.${utilisateur}` +
      `&cree_le=gte.${encodeURIComponent(depuis)}&limit=10`,
    { headers: serviceHeaders },
  )
  if (!recentes.ok) return refuse('Service indisponible, réessayez.', 503)
  if (((await recentes.json()) as unknown[]).length >= MAX_REGISTRATIONS_PER_WINDOW) {
    return refuse(
      'Trop de déclarations en peu de temps : attendez une minute.',
      429,
    )
  }

  const secret = newSecret()
  const creation = await fetch(`${rest}?select=id,nom,adresse_service,statut,cree_le`, {
    method: 'POST',
    headers: { ...serviceHeaders, prefer: 'return=representation' },
    body: JSON.stringify({
      proprietaire: utilisateur,
      nom: name,
      adresse_service: address.address,
      secret_signature: secret,
      statut: 'en_attente',
    }),
  })

  if (!creation.ok) {
    const erreur = (await creation.json().catch(() => null)) as
      | { code?: unknown }
      | null
    if (erreur?.code === '23505') {
      return refuse('Ce nom est déjà pris par une autre IA.', 409, 'name')
    }
    return refuse('La déclaration a échoué, réessayez.', 503)
  }

  const [bot] = (await creation.json()) as Array<Record<string, unknown>>
  return json({
    ok: true,
    bot,
    secret,
    warning:
      'Ce secret de signature n’est affiché qu’une seule fois : conservez-le maintenant, il ne sera jamais réaffiché.',
    message:
      'IA déclarée. Elle est en attente de sa partie de qualification contre l’IA de la maison ; elle entrera au classement dès qu’elle l’aura terminée sans faute technique.',
  }, 201)
})
