// Fonction d'essai : prouve que les règles de `src/game/` se chargent telles
// quelles dans le runtime Deno, sans copie ni réécriture.
import { enumerateLegalMoves } from '../../../src/game/legalMoves.ts'
import { parseGameRecord } from '../../../src/game/moveNotation.ts'

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' }

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Utiliser POST.' }, 405)
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return json({ ok: false, message: 'Corps JSON illisible.' }, 400)
  }

  const notation = (payload as { notation?: unknown } | null)?.notation
  if (typeof notation !== 'string') {
    return json(
      { ok: false, message: 'Champ « notation » manquant ou non textuel.' },
      400,
    )
  }

  const parsed = parseGameRecord(notation)
  if (!parsed.ok) {
    return json(
      {
        ok: false,
        reason: parsed.error.reason,
        index: parsed.error.index,
        token: parsed.error.token,
        message: parsed.error.message,
      },
      400,
    )
  }

  const state = parsed.state
  return json({
    ok: true,
    phase: state.phase,
    activePlayer: state.activePlayer,
    legalMoves: enumerateLegalMoves(
      state.board,
      state.inventories[state.activePlayer],
    ).length,
  })
})
