/**
 * Sonde de mise au point (histoire 14) : l'auteur désigne **son** IA, la
 * plateforme l'appelle sur une position d'essai avec **son vrai secret**, et
 * rend le verdict ainsi que l'échange complet.
 *
 * **Authentifiée** (`verify_jwt = true`) et bornée à une IA de l'appelant. Ce
 * n'est pas une précaution de plus : c'est ce qui rend la sonde utile. Publique,
 * elle ne connaissait aucun secret, signait donc avec un jeton d'essai — que
 * toute IA conforme au protocole rejette. Elle échouait sur ce qu'elle était
 * censée vérifier, et son verdict ne disait rien du vrai appel. En signant comme
 * l'arbitre signera, elle éprouve enfin le chemin réel.
 *
 * L'appelant étant le propriétaire de l'IA appelée, la réponse porte le code
 * HTTP et le corps reçu sans rien divulguer à personne : c'est déjà le critère
 * retenu pour `reponse_brute` dans le journal des parties. Et l'adresse n'étant
 * plus choisie dans la requête mais lue en base, la sonde ne peut plus servir à
 * balayer des adresses arbitraires.
 *
 * Deux garde-fous demeurent :
 *
 * 1. `checkBotAddressResolved` à **chaque** appel — https, port 443, nom public,
 *    ni IP littérale ni réseau privé : une adresse déclarée hier peut résoudre
 *    aujourd'hui vers un réseau interne. `botClient` refuse en outre les
 *    redirections, qui ramèneraient l'appel sur une machine non contrôlée.
 * 2. Un débit borné par compte et au total : la sonde fait émettre un appel
 *    sortant, et un compte ne doit pas en faire une source gratuite. Il est
 *    compté sur l'identifiant du compte, que l'appelant ne choisit pas, et non
 *    sur un en-tête qu'il écrirait lui-même.
 */
import {
  buildRequestBody,
  callBot,
  MOVE_DEADLINE_MS,
  toBotReply,
} from '../_shared/botClient.ts'
import type { BotCallRequest } from '../_shared/botClient.ts'
import { checkBotAddressResolved } from '../_shared/denoDns.ts'
import { judgeReply, openGame, REFUSAL_LABELS } from '../_shared/referee.ts'
import { currentUserId } from '../_shared/platformAuth.ts'

/**
 * Position d'essai : les huit premiers coups de la partie de référence du
 * dépôt. Ni le premier coup — que n'importe quel programme trouve — ni une fin
 * de partie : un milieu de partie réel, plateau à demi rempli, 42 coups légaux,
 * les bleus au trait. Fixe : deux sondes se comparent.
 */
const PROBE_RECORD = '4Lsr21 4Ss3 3Ir11 3Ir11 4Ss3 3Ir13 3Ir14 3Lr13'
const PROBE_COLOR = 'blue'

/** Cinq sondes par minute et par compte, soixante au total. */
const RATE_WINDOW_MS = 60_000
const MAX_PROBES_PER_ACCOUNT = 5
const MAX_PROBES_TOTAL = 60

const MAX_MOVE_ECHO = 32

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'content-type': 'application/json; charset=utf-8',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function refuse(message: string, status: number): Response {
  return json({ ok: false, result: 'refused', message }, status)
}

/**
 * Compteur en mémoire d'isolate : il ne prétend pas être exact — deux instances
 * comptent séparément — mais il coupe l'abus en boucle, qui est le cas réel.
 * Une limite durable demanderait une table, donc une migration.
 */
const recentProbes = new Map<string, number[]>()

function tooFrequent(source: string, now: number): boolean {
  let total = 0
  for (const [key, stamps] of recentProbes) {
    const kept = stamps.filter((stamp) => now - stamp < RATE_WINDOW_MS)
    if (kept.length === 0) recentProbes.delete(key)
    else recentProbes.set(key, kept)
    total += kept.length
  }
  const mine = recentProbes.get(source) ?? []
  if (total >= MAX_PROBES_TOTAL || mine.length >= MAX_PROBES_PER_ACCOUNT) {
    return true
  }
  recentProbes.set(source, [...mine, now])
  return false
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') return refuse('Utiliser POST.', 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return refuse('Service mal configuré.', 500)
  }

  const utilisateur = await currentUserId(request, supabaseUrl, anonKey)
  if (!utilisateur) return refuse('Connectez-vous pour sonder une IA.', 401)

  if (tooFrequent(utilisateur, Date.now())) {
    return refuse('Trop de sondes en peu de temps : attendez une minute.', 429)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return refuse('Corps JSON illisible.', 400)
  }
  const fields = payload as { bot?: unknown } | null
  const botId = typeof fields?.bot === 'string' ? fields.bot : ''
  if (botId === '') return refuse('Désignez l’IA à sonder.', 400)

  // Lecture par la clé de service : `secret_signature` est réservé au service,
  // aucun client ne le lit. Le filtre porte sur le propriétaire, si bien qu'une
  // IA qui n'est pas la sienne est introuvable plutôt que refusée — l'appelant
  // n'apprend pas qu'elle existe.
  const lecture = await fetch(
    `${supabaseUrl}/rest/v1/bots?select=adresse_service,secret_signature` +
      `&id=eq.${encodeURIComponent(botId)}` +
      `&proprietaire=eq.${encodeURIComponent(utilisateur)}&limit=1`,
    {
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
      },
    },
  )
  if (!lecture.ok) return refuse('Service indisponible, réessayez.', 503)
  const [ligne] = (await lecture.json()) as Array<{
    adresse_service?: unknown
    secret_signature?: unknown
  }>
  if (!ligne) return refuse('IA introuvable.', 404)
  const secret = typeof ligne.secret_signature === 'string'
    ? ligne.secret_signature
    : ''
  if (secret === '') return refuse('Service mal configuré.', 500)

  // Revérifié à chaque appel : une adresse déclarée hier peut résoudre
  // aujourd'hui vers un réseau interne.
  const address = await checkBotAddressResolved(
    typeof ligne.adresse_service === 'string' ? ligne.adresse_service : '',
  )
  if (!address.ok) {
    return json(
      { ok: false, result: 'refused', field: 'url', message: address.message },
      400,
    )
  }

  const opened = openGame(PROBE_RECORD, { blue: 'sonde', white: 'adversaire' })
  if (!opened.ok) return refuse('Position d’essai invalide.', 500)

  const appel: BotCallRequest = {
    address: address.address,
    secret,
    gameId: 'sonde',
    color: PROBE_COLOR,
    record: PROBE_RECORD,
    deadlineMs: MOVE_DEADLINE_MS,
  }
  const result = await callBot(appel, { fetch, now: Date.now })

  const common = {
    // L'adresse **après** contrôle et normalisation, et non celle qui a été
    // saisie : c'est elle que la plateforme appelle, et c'est donc elle qu'il
    // faut lire quand la réponse déçoit.
    url: address.address,
    // L'envoi et la réponse, tels quels. Un verdict seul ne se déboguerait pas :
    // il ne distingue pas une signature refusée d'une route absente, quand le
    // code HTTP et le corps rendu le disent d'un coup d'œil.
    request: buildRequestBody(appel, MOVE_DEADLINE_MS),
    status: result.status,
    snippet: result.snippet,
    detail: result.ok ? null : result.detail,
    record: PROBE_RECORD,
    color: PROBE_COLOR,
    latency_ms: result.latencyMs,
    headers: result.headers,
  }

  if (!result.ok) {
    // Vocabulaire public de `docs/protocole-ia.md` ; `unreadable-reply` y est
    // écrit `unreadable`.
    if (result.failure === 'timeout') {
      return json({
        ...common,
        ok: false,
        result: 'timeout',
        message: `Hors délai — aucune réponse complète en ${MOVE_DEADLINE_MS} ms.`,
      })
    }
    if (result.failure === 'unreachable') {
      return json({
        ...common,
        ok: false,
        result: 'unreachable',
        message:
          'Injoignable — la route doit répondre 200 en https, sans redirection.',
      })
    }
    return json({
      ...common,
      ok: false,
      result: 'unreadable',
      message:
        'Réponse illisible — attendu un corps JSON { "move": "…" } portant un seul jeton.',
    })
  }

  const move = result.move.slice(0, MAX_MOVE_ECHO)
  const verdict = judgeReply(opened.game, toBotReply(result))
  if (verdict.ok) {
    return json({
      ...common,
      ok: true,
      result: 'ok',
      move,
      message: `OK — coup « ${move} » accepté par l’arbitre, réponse en ${result.latencyMs} ms.`,
    })
  }

  const reason = verdict.outcome.notationReason
  if (!reason) {
    return json({
      ...common,
      ok: false,
      result: 'unreadable',
      message:
        'Réponse illisible — attendu un seul jeton de coup, sans séparateur.',
    })
  }
  return json({
    ...common,
    ok: false,
    result: 'illegal',
    move,
    reason,
    message: `Coup refusé — « ${move} » est illégal : ${REFUSAL_LABELS[reason]} (${reason}).`,
  })
})
