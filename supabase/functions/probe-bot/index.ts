/**
 * Sonde de mise au point (histoire 14) : on donne une adresse, la plateforme y
 * appelle l'IA sur une position d'essai et rend « OK » avec la latence, ou le
 * motif d'échec exact. Publique, `verify_jwt = false` : c'est l'outil qu'on
 * essaie **avant** d'ouvrir un compte.
 *
 * Publique et sortante, elle fait émettre à la plateforme une requête vers une
 * adresse choisie par l'appelant. Trois garde-fous, dans cet ordre :
 *
 * 1. `checkBotAddressResolved`, résolution DNS comprise : https, port 443, nom public,
 *    ni IP littérale ni réseau privé. `botClient` refuse en outre les
 *    redirections, qui ramèneraient l'appel sur une machine non contrôlée.
 * 2. Débit borné par provenance **et** au total, pour que la sonde ne devienne
 *    pas une source d'appels gratuite.
 * 3. Rien dans la réponse qui en ferait un scanner : ni code HTTP, ni en-tête,
 *    ni adresse résolue, ni **le moindre extrait du corps reçu**. Un service
 *    quelconque ne rend donc jamais qu'« injoignable » ou « illisible », ce qui
 *    ne dit rien de plus que ce que l'appelant savait déjà. Ce qui est rendu —
 *    le motif, la latence, le coup et son refus par l'arbitre — est exactement
 *    ce dont l'auteur d'une IA a besoin, et il l'a déjà dans ses propres
 *    journaux.
 */
import { callBot, MOVE_DEADLINE_MS, toBotReply } from '../_shared/botClient.ts'
import { checkBotAddressResolved } from '../_shared/denoDns.ts'
import { essaiTarget } from '../_shared/essaiLocal.ts'
import { judgeReply, openGame, REFUSAL_LABELS } from '../_shared/referee.ts'

/**
 * Position d'essai : les huit premiers coups de la partie de référence du
 * dépôt. Ni le premier coup — que n'importe quel programme trouve — ni une fin
 * de partie : un milieu de partie réel, plateau à demi rempli, 42 coups légaux,
 * les bleus au trait. Fixe : deux sondes se comparent.
 */
const PROBE_RECORD = '4Lsr21 4Ss3 3Ir11 3Ir11 4Ss3 3Ir13 3Ir14 3Lr13'
const PROBE_COLOR = 'blue'

/** Cinq sondes par minute et par provenance, soixante au total. */
const RATE_WINDOW_MS = 60_000
const MAX_PROBES_PER_SOURCE = 5
const MAX_PROBES_TOTAL = 60

const MAX_SECRET_LENGTH = 256
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
  if (total >= MAX_PROBES_TOTAL || mine.length >= MAX_PROBES_PER_SOURCE) {
    return true
  }
  recentProbes.set(source, [...mine, now])
  return false
}

/**
 * Provenance de l'appel, telle qu'on peut la connaître.
 *
 * `x-forwarded-for` est une liste que chaque relais **complète à droite** : le
 * premier élément est celui que l'appelant a écrit lui-même, donc ce qu'il veut.
 * Compter dessus donnait un compteur par valeur inventée, c'est-à-dire aucun
 * compteur. Le dernier élément est celui qu'a posé le relais le plus proche de
 * nous, le seul de la liste que l'appelant ne choisit pas.
 *
 * Ce n'en est pas une identité pour autant : deux appelants derrière le même
 * relais partagent la valeur, et une infrastructure qui n'ajouterait rien
 * laisserait passer celle de l'appelant. **Aucun en-tête HTTP ne borne un
 * abus** ; ce qui le borne est le plafond total ci-dessus, qui ne dépend
 * d'aucune provenance.
 */
function sourceOf(request: Request): string {
  const forwarded = (request.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  return forwarded[forwarded.length - 1] ?? 'inconnue'
}

function ephemeralSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (request.method !== 'POST') return refuse('Utiliser POST.', 405)

  if (tooFrequent(sourceOf(request), Date.now())) {
    return refuse('Trop de sondes en peu de temps : attendez une minute.', 429)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return refuse('Corps JSON illisible.', 400)
  }
  const fields = payload as { url?: unknown; secret?: unknown } | null

  const address = await checkBotAddressResolved(
    typeof fields?.url === 'string' ? fields.url : '',
  )
  if (!address.ok) {
    return json(
      { ok: false, result: 'refused', field: 'url', message: address.message },
      400,
    )
  }

  // Un auteur qui vérifie la signature peut donner son propre secret ; sinon la
  // sonde en tire un à usage unique, et l'annonce pour qu'un refus de signature
  // ne se prenne pas pour une panne.
  const secretFourni =
    typeof fields?.secret === 'string' &&
    fields.secret.length > 0 &&
    fields.secret.length <= MAX_SECRET_LENGTH
  const secret = secretFourni ? String(fields?.secret) : ephemeralSecret()

  const opened = openGame(PROBE_RECORD, { blue: 'sonde', white: 'adversaire' })
  if (!opened.ok) return refuse('Position d’essai invalide.', 500)

  const result = await callBot(
    {
      // Hors passe d'intégration locale, `essaiTarget` rend toujours `null`.
      address: essaiTarget(address.host) ?? address.address,
      secret,
      gameId: 'sonde',
      color: PROBE_COLOR,
      record: PROBE_RECORD,
      deadlineMs: MOVE_DEADLINE_MS,
    },
    { fetch, now: Date.now },
  )

  const common = {
    record: PROBE_RECORD,
    color: PROBE_COLOR,
    latency_ms: result.latencyMs,
    signature: secretFourni
      ? 'signée avec le secret fourni'
      : 'signée avec un secret d’essai, qu’une vérification de signature rejettera',
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
