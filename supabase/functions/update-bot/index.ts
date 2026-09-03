/**
 * Retrait et réactivation d'une IA par son auteur (histoires 14 à 16).
 *
 * `statut` est une colonne réservée au service : le déclencheur des colonnes
 * réservées (migration `plateforme_tournoi_colonnes_reservees`) refuse toute
 * écriture cliente, quel que soit le chemin. Un auteur ne peut donc pas se
 * déclarer `active` sans qualification, ni se sortir du sommeil sans y
 * repasser. Cette fonction est l'unique porte, et elle n'ouvre que deux
 * transitions.
 *
 * Comme `register-bot`, elle ne décode jamais le jeton elle-même : seul
 * `/auth/v1/user` sait s'il est signé, non révoqué et non expiré. Et elle ne
 * fait jamais confiance au corps de la requête pour savoir **qui** demande.
 */
import { createRest } from '../_shared/rest.ts'

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'content-type': 'application/json; charset=utf-8',
}

type BotStatus = 'en_attente' | 'active' | 'sommeil' | 'retiree'

/** Les deux seuls statuts qu'un auteur peut demander. */
const REQUESTABLE: readonly BotStatus[] = ['retiree', 'en_attente']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Field = 'bot' | 'status'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function refuse(message: string, status: number, field: Field | null = null) {
  return json({ ok: false, field, message }, status)
}

/** Identité de l'appelant, telle que le service d'authentification la confirme. */
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

/**
 * Ce qu'une transition demandée vaut, et pourquoi elle est refusée le cas
 * échéant. Deux règles, et rien d'autre :
 *
 * - **`retiree` est terminal.** « Retirer une IA est possible à tout moment »
 *   (histoire 14), depuis n'importe quel état vivant — une IA restée en
 *   qualification faute d'adresse joignable doit pouvoir disparaître, sans quoi
 *   son nom reste réservé à jamais. Mais elle ne revient pas : réactiver, ce
 *   serait revenir sur des classements déjà calculés.
 * - **`en_attente` ne s'atteint que depuis `sommeil`.** C'est la réactivation
 *   de l'histoire 15, qui repasse par la qualification de l'histoire 14. Aucune
 *   demande ne mène à `active` : cela reste le verdict de l'ordonnanceur.
 */
function checkTransition(
  from: BotStatus,
  to: BotStatus,
): { ok: true } | { ok: false; message: string } {
  if (from === to) {
    return { ok: false, message: 'Cette IA est déjà dans cet état.' }
  }
  if (from === 'retiree') {
    return {
      ok: false,
      message:
        'Une IA retirée ne revient pas : déclarez-en une nouvelle si vous voulez la remettre au tournoi.',
    }
  }
  if (to === 'retiree') return { ok: true }
  if (from === 'sommeil') return { ok: true }
  return {
    ok: false,
    message:
      'Seule une IA en sommeil se réactive : celle-ci ne l’est pas, il n’y a rien à relancer.',
  }
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
    return refuse('Connectez-vous avant de modifier une IA.', 401)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return refuse('Corps JSON illisible.', 400)
  }
  const fields = payload as { bot?: unknown; status?: unknown } | null

  const botId = typeof fields?.bot === 'string' ? fields.bot.trim() : ''
  if (!UUID.test(botId)) {
    return refuse('IA inconnue : identifiant absent ou mal formé.', 400, 'bot')
  }

  const asked = typeof fields?.status === 'string' ? fields.status : ''
  if (!REQUESTABLE.includes(asked as BotStatus)) {
    return refuse(
      'État demandé inconnu : une IA se retire ou se réactive, rien d’autre.',
      400,
      'status',
    )
  }
  const status = asked as BotStatus

  const rest = createRest({ url: supabaseUrl, serviceKey })

  // Le filtre porte le propriétaire : une IA qui ne lui appartient pas est
  // introuvable, et non « interdite ». La distinction dirait à un tiers qu'une
  // IA existe sous cet identifiant.
  let bots: Array<{ id: string; statut: BotStatus }>
  try {
    bots = await rest.select(
      `bots?select=id,statut&id=eq.${botId}&proprietaire=eq.${utilisateur}&limit=1`,
    )
  } catch {
    return refuse('Service indisponible, réessayez.', 503)
  }
  const bot = bots[0]
  if (!bot) {
    return refuse('IA introuvable dans votre compte.', 404, 'bot')
  }

  const verdict = checkTransition(bot.statut, status)
  if (!verdict.ok) return refuse(verdict.message, 409, 'status')

  // Écriture conditionnée à l'état lu : deux onglets ouverts sur la même IA ne
  // peuvent pas la retirer et la réactiver dans un ordre imprévisible.
  //
  // Seul le statut change. L'Elo n'est **pas** remis à 1200 : une IA réactivée
  // reprend le classement qui avait été gelé (histoire 15). Le compteur de
  // vagues échouées, lui, repart de zéro — il a rempli son office en prononçant
  // la mise en sommeil, et le laisser à trois ferait redormir l'IA à son
  // premier échec de vague, avant même qu'elle ait eu sa chance.
  let updated: Array<{ id: string; nom: string; statut: BotStatus }>
  try {
    updated = await rest.update(
      'bots',
      `id=eq.${botId}&proprietaire=eq.${utilisateur}&statut=eq.${bot.statut}`,
      status === 'en_attente'
        ? { statut: status, vagues_echouees_consecutives: 0 }
        : { statut: status },
      'id,nom,statut',
    )
  } catch {
    return refuse('La demande a échoué, réessayez.', 503)
  }
  if (updated.length === 0) {
    return refuse(
      'L’état de cette IA a changé entre-temps : rechargez la page.',
      409,
      'status',
    )
  }

  return json({
    ok: true,
    bot: updated[0],
    message:
      status === 'retiree'
        ? 'IA retirée. Elle sort des appariements dès maintenant ; ses parties passées restent consultables.'
        : 'IA réactivée. Elle repasse par la qualification contre l’IA de la maison et reprend au classement qui avait été gelé.',
  })
})
