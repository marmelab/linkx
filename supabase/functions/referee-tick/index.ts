/**
 * Arbitre des parties d'une vague (histoire 15) : dépile des messages et joue
 * **un coup par partie**, en parallèle, sous un budget d'horloge.
 *
 * Trois contraintes gouvernent cette fonction.
 *
 * **Jamais plus de deux appels simultanés vers une même IA.** Le cron réveille
 * une invocation par minute et chacune vit cinquante secondes : plusieurs se
 * recouvrent toujours. Le compteur ne peut donc pas être une variable d'isolate,
 * il est en base — `prendre_jeton_appel` / `rendre_jeton_appel`, sérialisés par
 * un verrou consultatif (migration 20260904100100). Un jeton non rendu, parce
 * que l'invocation est morte, **expire** ; l'invisibilité d'un message étant
 * plus longue que la durée d'un jeton, la partie ne repart jamais avant que son
 * jeton fantôme soit tombé.
 *
 * **Deux secondes de processeur par requête**, l'attente réseau non comprise :
 * c'est ce qui rend cette fonction possible, et c'est pourquoi elle ne calcule
 * rien. Le seul travail est le rejeu de la notation par l'arbitre, quelques
 * dizaines de coups.
 *
 * **Chaque appel écrit une ligne de journal** : rang du coup, IA appelée,
 * latence, code HTTP, coup rendu, erreur. C'est ce que l'auteur d'un bot vient
 * lire après une défaite, et rien d'autre ne le lui dira.
 *
 * **Le calendrier ne le concerne pas.** Une partie dépilée se joue, qu'elle
 * appartienne à une vague ou à une qualification : une vague n'existe que parce
 * qu'elle a été ouverte — par le cron du jeudi ou à la main —, et une vague
 * ouverte est faite pour être jouée. C'est l'ordonnanceur qui décide d'en
 * ouvrir une, jamais l'arbitre de la retenir.
 *
 * **Deux appelants** : `pg_cron`, qui présente la clé de service, et un
 * administrateur connecté, qui déclenche le même tour à la main et reçoit le
 * même compte rendu (`_shared/platformAuth.ts`).
 */
import { callBot } from '../_shared/botClient.ts'
import type { BotCallResult } from '../_shared/botClient.ts'
import { checkBotAddressResolved } from '../_shared/denoDns.ts'
import {
  interruptMutation,
  planGameStep,
  replyMutation,
  settleMutation,
} from '../_shared/gameTick.ts'
import type { GameMutation, StoredGame } from '../_shared/gameTick.ts'
import {
  authorizePlatformCall,
  forceAsked,
  readJsonBody,
} from '../_shared/platformAuth.ts'
import { createRest } from '../_shared/rest.ts'
import type { Rest } from '../_shared/rest.ts'
import {
  CALL_LEASE_S,
  QUEUE_VISIBILITY_S,
  TICK_BATCH_SIZE,
  canStartCall,
} from '../_shared/tickBudget.ts'
import { waveWindowAt } from '../_shared/waveWindow.ts'

/**
 * Le navigateur envoie un **préflight** avant tout appel portant `authorization`
 * ou `apikey`, et un préflight ne porte jamais de jeton. Sans réponse à
 * `OPTIONS`, la requête tombait dans le contrôle d'identité, y était refusée en
 * 401, et cette réponse-là n'ayant aucun en-tête CORS le navigateur n'annonçait
 * qu'une erreur d'origine — masquant le vrai statut.
 *
 * Invisible en local : la passerelle de la CLI répond elle-même aux préflights,
 * là où celle du projet hébergé les transmet à la fonction. Le cron, lui, ne
 * préflighte rien ; seul l'écran d'administration était touché.
 */
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const JSON_HEADERS = {
  ...CORS_HEADERS,
  'content-type': 'application/json; charset=utf-8',
}

/** Attente d'un message dont l'IA tient déjà ses deux appels. */
const BUSY_RETRY_S = 2

type QueueMessage = { msg_id: number; tentatives: number; partie_id: string }

type GameDbRow = {
  id: string
  vague_id: string | null
  notation: string
  nombre_coups: number
  statut: string
  bot_bleu: string
  bot_blanc: string
}

type BotDbRow = {
  id: string
  adresse_service: string
  secret_signature: string
}

type Verdict =
  | 'coup joué'
  | 'partie terminée'
  | 'IA occupée'
  | 'partie absente'
  | 'écriture périmée'
  | 'erreur'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function storedOf(row: GameDbRow): StoredGame {
  return {
    id: row.id,
    notation: row.notation,
    moveCount: row.nombre_coups,
    blueBot: row.bot_bleu,
    whiteBot: row.bot_blanc,
  }
}

/**
 * Écriture conditionnée au nombre de coups sur lequel la décision a été prise,
 * et à une partie non close : c'est **là** qu'un message rejoué devient sans
 * effet. Rend `true` si la ligne a bien été avancée par cet appel-ci.
 */
async function applyMutation(
  rest: Rest,
  gameId: string,
  mutation: GameMutation,
): Promise<boolean> {
  const written = await rest.update<{ id: string }>(
    'parties',
    `id=eq.${gameId}&statut=neq.terminee` +
      `&nombre_coups=eq.${mutation.expectedMoveCount}`,
    mutation.update,
    'id',
  )
  if (written.length === 0) return false
  if (mutation.journal) {
    // Le journal **après** l'écriture du coup, et seulement si elle a pris. Le
    // journal est ce que l'auteur d'une IA vient lire pour comprendre la
    // notation : écrit d'abord, il porterait le coup du perdant d'une course
    // entre deux passages là où la notation porte celui du gagnant, et
    // désignerait un coup qui n'a jamais été appliqué. L'appel perdu n'est pas
    // pour autant muet : le message est replanifié et rejoué.
    await rest.insert('evenements_partie', [mutation.journal], {
      onConflict: 'partie_id,rang_coup',
      ignoreDuplicates: true,
    })
  }
  return true
}

/** Échec fabriqué pour une adresse devenue inappelable : c'est injoignable. */
function unreachable(detail: string): BotCallResult {
  return {
    ok: false,
    failure: 'unreachable',
    latencyMs: 0,
    status: null,
    snippet: '',
    // Rien n'est parti : l'adresse a été refusée avant tout appel.
    headers: null,
    detail,
  }
}

async function playOneMove(
  rest: Rest,
  message: QueueMessage,
  now: () => Date,
): Promise<Verdict> {
  const [row] = await rest.select<GameDbRow>(
    `parties?id=eq.${message.partie_id}` +
      '&select=id,vague_id,notation,nombre_coups,statut,bot_bleu,bot_blanc&limit=1',
  )
  if (!row) {
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'partie absente'
  }
  if (row.statut === 'terminee') {
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'partie terminée'
  }
  const stored = storedOf(row)
  const step = planGameStep(stored)

  if (step.kind !== 'call') {
    const mutation = step.kind === 'settle'
      ? settleMutation(stored, step.outcome, step.moveCount, now())
      : interruptMutation(stored, now())
    await applyMutation(rest, row.id, mutation)
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'partie terminée'
  }

  const [bot] = await rest.select<BotDbRow>(
    `bots?id=eq.${step.botId}&select=id,adresse_service,secret_signature&limit=1`,
  )
  if (!bot) {
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'partie absente'
  }

  const jeton = await rest.rpc<number | null>('prendre_jeton_appel', {
    bot: bot.id,
    partie: row.id,
    duree_s: CALL_LEASE_S,
  })
  if (jeton === null) {
    await rest.rpc('file_coups_replanifier', {
      msg: message.msg_id,
      delai_s: BUSY_RETRY_S,
    })
    return 'IA occupée'
  }

  let result: BotCallResult
  try {
    // L'adresse est recontrôlée à l'usage, pas seulement à la déclaration : un
    // nom public peut se mettre à résoudre vers le réseau interne (histoire 14).
    const address = await checkBotAddressResolved(bot.adresse_service)
    result = address.ok
      ? await callBot(
        {
          address: address.address,
          secret: bot.secret_signature,
          gameId: row.id,
          color: step.color,
          record: step.record,
        },
        { fetch, now: Date.now },
      )
      : unreachable(address.message)
  } finally {
    await rest.rpc('rendre_jeton_appel', { jeton })
  }

  const mutation = replyMutation(stored, step, result, now())
  const advanced = await applyMutation(rest, row.id, mutation)

  if (!advanced) {
    // Un autre passage a déjà avancé la partie : deux messages tournaient donc
    // pour elle, et celui-ci est le doublon. Le **supprimer** est ce qui fait
    // décroître la population de messages d'une partie : replanifié, il
    // resterait à doubler chaque appel d'IA jusqu'à la fin de la partie. Le
    // vainqueur de la course, lui, replanifie le sien ; et une partie qui se
    // retrouverait sans aucun message est réempilée par l'ordonnanceur.
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'écriture périmée'
  }
  if (mutation.update.statut === 'terminee') {
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'partie terminée'
  }
  await rest.rpc('file_coups_replanifier', { msg: message.msg_id, delai_s: 0 })
  return 'coup joué'
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  const startedAt = Date.now()
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceKey || !supabaseUrl) {
    return json({ ok: false, message: 'Service mal configuré.' }, 500)
  }
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const body = await readJsonBody(request)
  const caller = await authorizePlatformCall(request, {
    supabaseUrl,
    anonKey,
    serviceKey,
  })
  if (!caller) {
    return json({ ok: false, message: 'Réservé à la plateforme.' }, 401)
  }
  const force = forceAsked(body, caller)
  if (caller.kind === 'admin') {
    console.warn(
      `referee-tick déclenché à la main par ${caller.userId}${force ? ', force' : ''}.`,
    )
  }

  const now = new Date(startedAt)
  const window = waveWindowAt(now)

  const rest = createRest({ url: supabaseUrl, serviceKey })
  // Les jetons d'une invocation morte ne doivent pas attendre qu'une autre
  // partie de la même IA vienne les balayer.
  const purges = await rest.rpc<number>('purger_jetons_expires')

  const verdicts: Record<string, number> = {}
  let batches = 0
  while (canStartCall(startedAt, Date.now())) {
    const messages = await rest.rpc<QueueMessage[]>('file_coups_lire', {
      nombre: TICK_BATCH_SIZE,
      invisibilite_s: QUEUE_VISIBILITY_S,
    })
    if (messages.length === 0) break
    batches += 1

    const played = await Promise.all(
      messages.map((message) =>
        playOneMove(rest, message, () => new Date()).catch((error): Verdict => {
          // Une partie qui échoue ne doit pas emporter les sept autres. Son
          // message n'est ni supprimé ni replanifié : il redeviendra visible à
          // l'expiration de son invisibilité, jeton d'appel déjà périmé.
          console.error('referee-tick', message.partie_id, error)
          return 'erreur'
        })
      ),
    )
    for (const verdict of played) {
      verdicts[verdict] = (verdicts[verdict] ?? 0) + 1
    }

    // Rien que des messages qui attendent une IA occupée : inutile de tourner
    // en boucle sur eux, ils redeviendront visibles d'eux-mêmes.
    if (played.every((verdict) => verdict === 'IA occupée')) break
  }

  return json({
    ok: true,
    declenchement: caller.kind === 'service' ? 'cron' : 'administrateur',
    force,
    fenetre: window.inWindow ? 'ouverte' : 'fermée',
    prochain_jeudi: window.waveDay,
    jetons_purges: purges,
    lots: batches,
    verdicts,
    duree_ms: Date.now() - startedAt,
  })
})
