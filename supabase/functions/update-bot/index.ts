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
 *
 * Ce qui se décide — quelles transitions sont ouvertes, et ce que chacune écrit
 * — vit dans `_shared/botStatus.ts`, pur et testé sans base.
 */
import {
  STATUS_MESSAGES,
  checkTransition,
  isRequestable,
  statusUpdate,
} from '../_shared/botStatus.ts'
import type { BotStatus } from '../_shared/botStatus.ts'
import { currentUserId } from '../_shared/platformAuth.ts'
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

const UUID =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Field = 'bot' | 'status'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function refuse(message: string, status: number, field: Field | null = null) {
  return json({ ok: false, field, message }, status)
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
  if (!isRequestable(asked)) {
    return refuse(
      'État demandé inconnu : une IA se retire ou se réactive, rien d’autre.',
      400,
      'status',
    )
  }
  const status = asked

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
  let updated: Array<{ id: string; nom: string; statut: BotStatus }>
  try {
    updated = await rest.update(
      'bots',
      `id=eq.${botId}&proprietaire=eq.${utilisateur}&statut=eq.${bot.statut}`,
      statusUpdate(status),
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

  return json({ ok: true, bot: updated[0], message: STATUS_MESSAGES[status] })
})
