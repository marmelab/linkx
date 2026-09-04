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
 *
 * Le transport passe par `_shared/rest.ts`, comme `update-bot` : c'est lui qui
 * porte les en-têtes de service, le `prefer` d'une insertion et le `SQLSTATE`
 * d'un refus. Trois `fetch` écrits à la main ici en faisaient une seconde
 * mécanique à tenir d'accord, et la seule des trois fonctions à ne pas pouvoir
 * s'essayer sans réseau.
 */
import { checkBotAddressResolved } from '../_shared/denoDns.ts'
import { currentUserId } from '../_shared/platformAuth.ts'
import { RestError, UNIQUE_VIOLATION, createRest } from '../_shared/rest.ts'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'content-type': 'application/json; charset=utf-8',
}

/** `SQLSTATE` d'une contrainte `check` violée : le motif du nom, ou le plafond. */
const CHECK_VIOLATION = '23514'

/** Deux déclarations par minute : au-delà, ce n'est plus un auteur qui essaie. */
const REGISTRATION_WINDOW_MS = 60_000
const MAX_REGISTRATIONS_PER_WINDOW = 2

/**
 * IA vivantes par compte. Une dizaine couvre largement l'auteur qui compare
 * plusieurs versions de la sienne, et borne ce qu'un compte peut peser sur les
 * appariements comme sur le travail de l'ordonnanceur. Le plafond est tenu en
 * base (migration `plateforme_tournoi_ecriture_reservee_bots`) ; il est
 * recompté ici pour rendre un refus lisible plutôt qu'une contrainte violée.
 * Une IA retirée ne compte pas : elle ne joue plus.
 */
const MAX_BOTS_PER_OWNER = 10

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

  const rest = createRest({ url: supabaseUrl, serviceKey })

  // Débit compté en base, sur les déclarations elles-mêmes : une mémoire
  // d'isolate ne survivrait ni à un redémarrage ni à une seconde instance.
  const depuis = new Date(Date.now() - REGISTRATION_WINDOW_MS).toISOString()
  let recentes: unknown[]
  let vivantes: unknown[]
  try {
    ;[recentes, vivantes] = await Promise.all([
      rest.select(
        `bots?select=id&proprietaire=eq.${utilisateur}` +
          `&cree_le=gte.${encodeURIComponent(depuis)}&limit=10`,
      ),
      rest.select(
        `bots?select=id&proprietaire=eq.${utilisateur}` +
          `&statut=neq.retiree&limit=${MAX_BOTS_PER_OWNER + 1}`,
      ),
    ])
  } catch {
    return refuse('Service indisponible, réessayez.', 503)
  }
  if (recentes.length >= MAX_REGISTRATIONS_PER_WINDOW) {
    return refuse(
      'Trop de déclarations en peu de temps : attendez une minute.',
      429,
    )
  }
  if (vivantes.length >= MAX_BOTS_PER_OWNER) {
    return refuse(
      `Vous avez déjà ${MAX_BOTS_PER_OWNER} IA en lice : retirez-en une avant d’en déclarer une autre.`,
      409,
    )
  }

  const secret = newSecret()
  let bot: Record<string, unknown> | undefined
  try {
    ;[bot] = await rest.insert<Record<string, unknown>>(
      'bots',
      [{
        proprietaire: utilisateur,
        nom: name,
        adresse_service: address.address,
        secret_signature: secret,
        statut: 'en_attente',
      }],
      { returning: 'id,nom,adresse_service,statut,cree_le' },
    )
  } catch (error) {
    const code = error instanceof RestError ? error.code : null
    if (code === UNIQUE_VIOLATION) {
      return refuse('Ce nom est déjà pris par une autre IA.', 409, 'name')
    }
    // Nom refusé par la contrainte, ou plafond d'IA franchi entre le décompte
    // ci-dessus et l'insertion : c'est un refus, pas une panne à réessayer.
    if (code === CHECK_VIOLATION) {
      return refuse('Cette déclaration a été refusée par la plateforme.', 400)
    }
    return refuse('La déclaration a échoué, réessayez.', 503)
  }

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
