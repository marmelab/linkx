/**
 * Ce qu'un auteur peut changer sur son IA : son adresse, et son état (histoires
 * 14 à 16).
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
 *
 * **L'adresse se corrige ici, et nulle part ailleurs.** `authenticated` n'a plus
 * aucun droit d'écriture sur `bots` (migration
 * `plateforme_tournoi_ecriture_reservee_bots`), si bien qu'une IA déclarée sur
 * une adresse fautive était jusqu'ici sans recours : sa qualification échouait,
 * `qualificationNeeded` refusait d'en rouvrir une tant que la ligne n'avait pas
 * bougé, et rien ne pouvait la faire bouger. La nouvelle adresse repasse par le
 * **même** contrôle qu'à la déclaration — https, port 443, nom public résolu
 * hors des réseaux privés — sans quoi cette porte annulerait celle-là.
 */
import {
  checkTransition,
  isRequestable,
  statusMessage,
  statusUpdate,
} from '../_shared/botStatus.ts'
import type { BotStatus, RequestableStatus } from '../_shared/botStatus.ts'
import { checkBotAddressResolved } from '../_shared/denoDns.ts'
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

type Field = 'bot' | 'status' | 'url'

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
  const fields = payload as
    | { bot?: unknown; status?: unknown; url?: unknown }
    | null

  const botId = typeof fields?.bot === 'string' ? fields.bot.trim() : ''
  if (!UUID.test(botId)) {
    return refuse('IA inconnue : identifiant absent ou mal formé.', 400, 'bot')
  }

  // Les deux champs sont facultatifs, mais pas tous les deux : une demande vide
  // toucherait `modifie_le` sans rien vouloir, et relancerait une qualification
  // par inadvertance.
  const askedStatus = fields?.status
  const askedUrl = fields?.url
  if (askedStatus === undefined && askedUrl === undefined) {
    return refuse('Rien à changer : donnez un état ou une adresse.', 400)
  }

  let status: RequestableStatus | null = null
  if (askedStatus !== undefined) {
    const asked = typeof askedStatus === 'string' ? askedStatus : ''
    if (!isRequestable(asked)) {
      return refuse(
        'État demandé inconnu : une IA se retire, se réactive ou relance sa qualification, rien d’autre.',
        400,
        'status',
      )
    }
    status = asked
  }

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

  const patch: Record<string, unknown> = {}
  const messages: string[] = []

  if (askedUrl !== undefined) {
    // Une IA retirée ne joue plus : lui corriger son adresse n'aurait pas de
    // sens, et `checkTransition` dit déjà que rien ne l'en sort.
    if (bot.statut === 'retiree') {
      return refuse(
        'Une IA retirée ne joue plus : son adresse n’a plus d’effet.',
        409,
        'url',
      )
    }
    const address = await checkBotAddressResolved(
      typeof askedUrl === 'string' ? askedUrl : '',
    )
    if (!address.ok) return refuse(address.message, 400, 'url')
    patch.adresse_service = address.address
    messages.push('Adresse mise à jour.')
  }

  if (status !== null) {
    const verdict = checkTransition(bot.statut, status)
    if (!verdict.ok) return refuse(verdict.message, 409, 'status')
    Object.assign(patch, statusUpdate(status))
    messages.push(statusMessage(bot.statut, status))
  } else if (bot.statut === 'en_attente') {
    // Toucher la ligne suffit à rouvrir une qualification (`wavePlan.ts`) : le
    // dire, plutôt que de laisser l'auteur le découvrir.
    messages.push(
      'La qualification repartira au prochain réveil, sur cette nouvelle adresse.',
    )
  }

  // Écriture conditionnée à l'état lu : deux onglets ouverts sur la même IA ne
  // peuvent pas la retirer et la réactiver dans un ordre imprévisible.
  let updated: Array<{
    id: string
    nom: string
    statut: BotStatus
    adresse_service: string
  }>
  try {
    updated = await rest.update(
      'bots',
      `id=eq.${botId}&proprietaire=eq.${utilisateur}&statut=eq.${bot.statut}`,
      patch,
      'id,nom,statut,adresse_service',
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

  return json({ ok: true, bot: updated[0], message: messages.join(' ') })
})
