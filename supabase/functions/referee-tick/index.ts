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
 * **Hors de la fenêtre du jeudi, la fonction ne se tait pas : elle ne joue que
 * les qualifications**, qui n'appartiennent à aucune vague et que l'histoire 14
 * veut immédiates. Une partie de vague dépilée hors fenêtre est simplement
 * remise en attente.
 */
import { callBot } from '../_shared/botClient.ts'
import type { BotCallResult } from '../_shared/botClient.ts'
import { checkBotAddressResolved } from '../_shared/denoDns.ts'
import { essaiInstant, essaiTarget, readJsonBody } from '../_shared/essaiLocal.ts'
import {
  interruptMutation,
  planGameStep,
  replyMutation,
  settleMutation,
} from '../_shared/gameTick.ts'
import type { GameMutation, StoredGame } from '../_shared/gameTick.ts'
import { createRest } from '../_shared/rest.ts'
import type { Rest } from '../_shared/rest.ts'
import {
  CALL_LEASE_S,
  QUEUE_VISIBILITY_S,
  TICK_BATCH_SIZE,
  canStartCall,
} from '../_shared/tickBudget.ts'
import { waveWindowAt } from '../_shared/waveWindow.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

/** Attente d'un message dont l'IA tient déjà ses deux appels. */
const BUSY_RETRY_S = 2

/** Attente d'un message de vague dépilé hors de la fenêtre du jeudi. */
const OUT_OF_WAVE_RETRY_S = 60

type QueueMessage = { msg_id: number; tentatives: number; partie_id: string }

type GameDbRow = {
  id: string
  vague_id: string | null
  notation: string
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
  | 'hors fenêtre'
  | 'partie absente'
  | 'écriture périmée'
  | 'erreur'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function fromPlatform(request: Request, serviceKey: string): boolean {
  return (request.headers.get('authorization') ?? '') === `Bearer ${serviceKey}`
}

function storedOf(row: GameDbRow): StoredGame {
  return {
    id: row.id,
    notation: row.notation,
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
  if (mutation.journal) {
    // Le journal d'abord : même si l'écriture du coup se révèle périmée, la
    // trace de l'appel reste, et l'index unique (partie, rang) la dédoublonne.
    await rest.insert('evenements_partie', [mutation.journal], {
      onConflict: 'partie_id,rang_coup',
      ignoreDuplicates: true,
    })
  }
  const written = await rest.update<{ id: string }>(
    'parties',
    `id=eq.${gameId}&statut=neq.terminee` +
      `&nombre_coups=eq.${mutation.expectedMoveCount}`,
    mutation.update,
    'id',
  )
  return written.length > 0
}

/** Échec fabriqué pour une adresse devenue inappelable : c'est injoignable. */
function unreachable(detail: string): BotCallResult {
  return {
    ok: false,
    failure: 'unreachable',
    latencyMs: 0,
    status: null,
    snippet: '',
    detail,
  }
}

async function playOneMove(
  rest: Rest,
  message: QueueMessage,
  now: () => Date,
  qualificationsOnly: boolean,
): Promise<Verdict> {
  const [row] = await rest.select<GameDbRow>(
    `parties?id=eq.${message.partie_id}` +
      '&select=id,vague_id,notation,statut,bot_bleu,bot_blanc&limit=1',
  )
  if (!row) {
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'partie absente'
  }
  if (row.statut === 'terminee') {
    await rest.rpc('file_coups_supprimer', { msg: message.msg_id })
    return 'partie terminée'
  }
  // Hors fenêtre, seules les qualifications se jouent : elles n'appartiennent à
  // aucune vague et l'histoire 14 les veut immédiates. Une partie de vague
  // attend son jeudi plutôt que d'être perdue.
  if (qualificationsOnly && row.vague_id !== null) {
    await rest.rpc('file_coups_replanifier', {
      msg: message.msg_id,
      delai_s: OUT_OF_WAVE_RETRY_S,
    })
    return 'hors fenêtre'
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
          // Hors passe d'intégration locale, `essaiTarget` rend toujours `null`.
          address: essaiTarget(address.host) ?? address.address,
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
    // Un autre passage a déjà avancé la partie : ce message est en retard d'un
    // coup. Le rendre visible tout de suite le fera repartir de l'état réel.
    await rest.rpc('file_coups_replanifier', { msg: message.msg_id, delai_s: 0 })
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
  const startedAt = Date.now()
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  if (!serviceKey || !supabaseUrl) {
    return json({ ok: false, message: 'Service mal configuré.' }, 500)
  }
  if (!fromPlatform(request, serviceKey)) {
    return json({ ok: false, message: 'Réservé à la plateforme.' }, 401)
  }

  const now = essaiInstant(await readJsonBody(request)) ?? new Date(startedAt)
  const window = waveWindowAt(now)
  // Hors fenêtre, le tour ne s'arrête pas : il ne joue que les qualifications,
  // qui n'attendent pas le jeudi (histoire 14).
  const qualificationsOnly = !window.inWindow

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
        playOneMove(rest, message, () => new Date(), qualificationsOnly).catch((error): Verdict => {
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

    // Rien que des messages qui attendent — une IA occupée, ou le jeudi :
    // inutile de tourner en boucle sur eux, ils reviendront visibles d'eux-mêmes.
    if (
      played.every(
        (verdict) => verdict === 'IA occupée' || verdict === 'hors fenêtre',
      )
    ) break
  }

  return json({
    ok: true,
    fenetre: window.inWindow ? 'ouverte' : 'fermée (qualifications seules)',
    vague: window.waveDay,
    jetons_purges: purges,
    lots: batches,
    verdicts,
    duree_ms: Date.now() - startedAt,
  })
})
