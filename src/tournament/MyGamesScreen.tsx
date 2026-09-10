import { useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { AsyncPanel } from './AsyncPanel'
import {
  fetchGameEvents,
  fetchMyBots,
  fetchMyGames,
  fetchWaves,
  MY_GAMES_LIMIT,
} from './api'
import {
  ANY,
  filterGames,
  gameKey,
  QUALIFICATION,
  replayHref,
  serverFilter,
  toMyGames,
} from './games'
import type { GameFilters, MyGame } from './games'
import { COLOR_LABELS, OUTCOME_LABELS } from './outcomes'
import { TOURNAMENT_PATHS } from './routes'
import { formatParisDateTime, formatParisDay } from './schedule'
import { useSession } from './session'
import { pending, useAsync } from './useAsync'
import type { BotRow, WaveRow } from './types'

/** Ce dont les filtres ont besoin : la liste des IA et celle des vagues. */
type Context = { bots: BotRow[]; waves: WaveRow[] }

async function loadContext(owner: string): Promise<Context> {
  const [bots, waves] = await Promise.all([fetchMyBots(owner), fetchWaves(24)])
  return { bots, waves }
}

type Games = {
  games: MyGame[]
  /** Nom des IA des deux camps, pour le journal d'une partie. */
  names: Map<string, string>
  /** Vrai quand la lecture a buté sur sa borne : il en reste de plus anciennes. */
  truncated: boolean
}

async function loadGames(
  bots: readonly BotRow[],
  filters: GameFilters,
): Promise<Games> {
  const ids = bots.map((bot) => bot.id)
  const rows = ids.length === 0 ? [] : await fetchMyGames(serverFilter(filters))
  // Les noms viennent déjà résolus des deux côtés (`api.ts`) : le journal n'a
  // pas à les redemander pour nommer l'IA qui a répondu.
  const names = new Map(bots.map((bot) => [bot.id, bot.nom]))
  for (const row of rows) {
    if (row.bleu) names.set(row.bot_bleu, row.bleu.nom)
    if (row.blanc) names.set(row.bot_blanc, row.blanc.nom)
  }
  return {
    games: toMyGames(rows, ids),
    names,
    truncated: rows.length >= MY_GAMES_LIMIT,
  }
}

function waveLabel(wave: WaveRow): string {
  return `Vague du ${formatParisDay(Date.parse(wave.debut))}`
}

function GameJournal({
  game,
  names,
  mine,
}: {
  game: MyGame
  names: Map<string, string>
  mine: ReadonlySet<string>
}) {
  const state = useAsync(() => fetchGameEvents(game.id), [game.id])

  return (
    <AsyncPanel state={state}>
      {(events) =>
        events.length === 0 ? (
          <p className="tournament-note">
            Aucun appel journalisé pour cette partie.
          </p>
        ) : (
          <table className="tournament-table tournament-table--wide tournament-table--journal">
            <caption className="visually-hidden">
              Journal des appels, coup par coup
            </caption>
            <thead>
              <tr>
                <th scope="col">Coup</th>
                <th scope="col">IA</th>
                <th scope="col">Réponse</th>
                <th scope="col">Code HTTP</th>
                <th scope="col">Coup rendu</th>
                <th scope="col">Erreur</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td data-label="Coup">{event.rang_coup}</td>
                  <td data-label="IA">
                    {names.get(event.bot_id) ?? 'adversaire'}
                  </td>
                  <td data-label="Réponse">
                    {event.latence_ms === null ? '—' : `${event.latence_ms} ms`}
                  </td>
                  <td data-label="Code HTTP">{event.statut_http ?? '—'}</td>
                  <td data-label="Coup rendu">{event.coup ?? '—'}</td>
                  {/* Ce qu'un service a répondu ne va qu'à son auteur : la vue
                      `journal_appels` rend `erreur` à `null` sur les appels de
                      l'adversaire. Le tiret dirait « aucune erreur », ce qui
                      serait faux ; la cellule dit donc pourquoi elle est vide. */}
                  <td data-label="Erreur">
                    {mine.has(event.bot_id)
                      ? (event.erreur ?? '—')
                      : 'réservée à son auteur'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </AsyncPanel>
  )
}

function GameRows({
  game,
  names,
  mine,
}: {
  game: MyGame
  names: Map<string, string>
  mine: ReadonlySet<string>
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <tr>
        <td data-label="Date">
          {formatParisDateTime(Date.parse(game.playedAt))}
        </td>
        <td data-label="Ouverture">{game.openingLabel}</td>
        <td data-label="Couleur tenue">{COLOR_LABELS[game.color]}</td>
        <td data-label="Adversaire">{game.opponent ?? 'nom inconnu'}</td>
        <td data-label="Issue">{game.outcomeText}</td>
        <td data-label="Coups">{game.moveCount}</td>
        <td data-label="Actions" className="game-actions">
          <a
            className="secondary-button secondary-button--small"
            href={replayHref(window.location.pathname, game.notation)}
          >
            Rejouer
          </a>
          <button
            type="button"
            className="secondary-button secondary-button--small"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? 'Masquer le journal' : 'Journal'}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="journal-row">
          <td colSpan={7}>
            <GameJournal game={game} names={names} mine={mine} />
          </td>
        </tr>
      )}
    </>
  )
}

/**
 * Les parties, relues à chaque changement d'IA ou de vague : ces deux filtres
 * partent à la requête, l'issue seule se départage ici.
 */
function GamesTable({
  bots,
  filters,
}: {
  bots: readonly BotRow[]
  filters: GameFilters
}) {
  const state = useAsync<Games>(
    () => loadGames(bots, filters),
    [bots, filters.botId, filters.waveId],
  )
  const mine = new Set(bots.map((bot) => bot.id))

  return (
    <AsyncPanel state={state}>
      {(payload) => {
        const shown = filterGames(payload.games, filters)

        return (
          <>
            {payload.truncated && (
              <p className="tournament-note">
                Seules les {MY_GAMES_LIMIT} parties les plus récentes de cette
                sélection sont affichées : choisissez une IA ou une vague pour
                atteindre les plus anciennes.
              </p>
            )}
            {payload.games.length === 0 ? (
              <p className="tournament-note">
                Aucune partie pour l’instant. Une IA déclarée joue d’abord sa
                qualification contre l’IA de la maison, puis les vagues du
                jeudi.
              </p>
            ) : shown.length === 0 ? (
              <p className="tournament-note">
                Aucune partie ne répond à ces trois filtres.
              </p>
            ) : (
              <div className="tournament-table-frame">
                <table className="tournament-table tournament-table--wide">
                  <caption className="visually-hidden">
                    Parties jouées par mes IA
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Ouverture</th>
                      <th scope="col">Couleur tenue</th>
                      <th scope="col">Adversaire</th>
                      <th scope="col">Issue</th>
                      <th scope="col">Coups</th>
                      <th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((game) => (
                      <GameRows
                        key={gameKey(game)}
                        game={game}
                        names={payload.names}
                        mine={mine}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )
      }}
    </AsyncPanel>
  )
}

export function MyGamesScreen() {
  const { session, ready } = useSession()
  const [params, setParams] = useSearchParams()
  // Rien n'est lu avant que la session ait répondu : une lecture à vide
  // afficherait « aucune partie » à un auteur qui en a.
  const context = useAsync<Context>(
    () => (session ? loadContext(session.user.id) : pending<Context>()),
    [ready, session?.user.id],
  )
  const [outcome, setOutcome] = useState(ANY)
  const [wave, setWave] = useState(ANY)

  if (ready && !session) return <Navigate to={TOURNAMENT_PATHS.login} replace />

  // L'IA filtrée vit dans l'adresse : « voir ses parties » y mène directement,
  // et le lien se partage.
  const asked = params.get('ia') ?? ANY

  return (
    <>
      <h1 className="tournament-title">Mes parties</h1>
      <p className="tournament-lede">
        Chaque partie s’ouvre dans l’écran de jeu et se déroule coup par coup.
        Le journal donne, appel par appel, le temps de réponse et le code HTTP
        des deux camps ; l’erreur rendue par un service n’est montrée qu’à
        l’auteur de l’IA appelée. Les dates sont à l’heure de Paris.
      </p>

      <AsyncPanel state={context}>
        {(ctx) => {
          // Une IA inconnue dans l'adresse ne doit pas filtrer en silence : le
          // sélecteur dirait « Toutes mes IA » pendant que le filtre exclut
          // tout. On revient donc à toutes, et on le dit.
          const known = ctx.bots.some((row) => row.id === asked)
          const bot = known ? asked : ANY
          const filters: GameFilters = { botId: bot, waveId: wave, outcome }

          return (
            <>
              <div className="tournament-filters">
                <p className="tournament-field">
                  <label htmlFor="filtre-ia">IA</label>
                  <select
                    id="filtre-ia"
                    value={bot}
                    onChange={(event) => {
                      const next = new URLSearchParams(params)
                      if (event.target.value === ANY) next.delete('ia')
                      else next.set('ia', event.target.value)
                      setParams(next, { replace: true })
                    }}
                  >
                    <option value={ANY}>Toutes mes IA</option>
                    {ctx.bots.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.nom}
                      </option>
                    ))}
                  </select>
                </p>
                <p className="tournament-field">
                  <label htmlFor="filtre-vague">Vague</label>
                  <select
                    id="filtre-vague"
                    value={wave}
                    onChange={(event) => setWave(event.target.value)}
                  >
                    <option value={ANY}>Toutes les vagues</option>
                    <option value={QUALIFICATION}>Qualification</option>
                    {ctx.waves.map((row) => (
                      <option key={row.id} value={row.id}>
                        {waveLabel(row)}
                      </option>
                    ))}
                  </select>
                </p>
                <p className="tournament-field">
                  <label htmlFor="filtre-issue">Issue</label>
                  <select
                    id="filtre-issue"
                    value={outcome}
                    onChange={(event) => setOutcome(event.target.value)}
                  >
                    <option value={ANY}>Toutes les issues</option>
                    <option value="gagne">{OUTCOME_LABELS.gagne}</option>
                    <option value="perdu">{OUTCOME_LABELS.perdu}</option>
                    <option value="nul">{OUTCOME_LABELS.nul}</option>
                    <option value="en_cours">{OUTCOME_LABELS.en_cours}</option>
                  </select>
                </p>
              </div>

              {asked !== ANY && !known && (
                <p className="tournament-note" role="status">
                  L’IA demandée dans l’adresse n’est pas l’une des vôtres :
                  toutes vos parties sont affichées.
                </p>
              )}

              <GamesTable bots={ctx.bots} filters={filters} />
            </>
          )
        }}
      </AsyncPanel>
    </>
  )
}
