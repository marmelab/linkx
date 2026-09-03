import { useEffect, useState } from 'react'
import { AsyncPanel } from './AsyncPanel'
import { fetchLeaderboard, fetchWaveProgress, fetchWaves } from './api'
import { STATUS_LABELS } from './outcomes'
import { formatGap, orderLeaderboard } from './ranking'
import {
  currentWaveWindow,
  formatCountdown,
  formatParisDate,
  formatParisTime,
  nextWaveStart,
  WAVE_START_LABEL,
  waveProgress,
} from './schedule'
import { useAsync } from './useAsync'
import type { LeaderboardRow, WaveRow } from './types'

const PROTOCOL_URL =
  'https://github.com/marmelab/linkx/blob/main/docs/protocole-ia.md'

type Payload = {
  rows: LeaderboardRow[]
  waves: WaveRow[]
  progress: { jouees: number; total: number } | null
}

/** L'horloge de l'écran, rafraîchie à la minute : le compte à rebours en vit. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

async function loadLeaderboard(): Promise<Payload> {
  const [rows, waves] = await Promise.all([fetchLeaderboard(), fetchWaves()])
  const now = Date.now()
  const open = waves.find(
    (wave) =>
      wave.statut === 'en_cours' &&
      Date.parse(wave.debut) <= now &&
      now < Date.parse(wave.fin),
  )
  const progress = open ? await fetchWaveProgress(open.id) : null
  return { rows, waves, progress }
}

function WaveBanner({ payload, now }: { payload: Payload; now: number }) {
  const open = payload.waves.find(
    (wave) => Date.parse(wave.debut) <= now && now < Date.parse(wave.fin),
  )
  const openWindow = open
    ? { start: Date.parse(open.debut), end: Date.parse(open.fin) }
    : currentWaveWindow(now)

  if (openWindow) {
    const part = payload.progress
      ? waveProgress(payload.progress.jouees, payload.progress.total)
      : null
    return (
      <p className="wave-banner">
        <span className="overline">Vague en cours</span>
        <strong>
          {part === null
            ? 'Les parties se jouent'
            : `${payload.progress?.jouees} parties jouées sur ${payload.progress?.total}, soit ${Math.round(part * 100)} %`}
          {' — fin à '}
          {formatParisTime(openWindow.end)}, heure de Paris.
        </strong>
      </p>
    )
  }

  const start = nextWaveStart(now)
  return (
    <p className="wave-banner">
      <span className="overline">Prochaine vague</span>
      <strong>
        dans {formatCountdown(start - now)} — {WAVE_START_LABEL},{' '}
        {formatParisDate(start)}, heure de Paris.
      </strong>
    </p>
  )
}

export function LeaderboardScreen() {
  const state = useAsync<Payload>(loadLeaderboard, [])
  const now = useMinute()

  return (
    <>
      <h1 className="tournament-title">Classement des IA</h1>
      <p className="tournament-lede">
        Les IA inscrites se rencontrent chaque semaine, toutes contre toutes.
        Chacun peut y brancher un programme :{' '}
        <a href={PROTOCOL_URL} target="_blank" rel="noreferrer">
          lire le protocole
        </a>
        .
      </p>

      <AsyncPanel state={state}>
        {(payload) => (
          <>
            <WaveBanner payload={payload} now={now} />
            {payload.rows.length === 0 ? (
              <p className="tournament-note">
                Aucune IA n’est encore inscrite. La première déclarée ouvrira ce
                classement : il suffit d’un service qui répond un coup.
              </p>
            ) : (
              <div className="tournament-table-frame">
                <table className="tournament-table">
                  <caption className="visually-hidden">
                    Classement Elo des IA inscrites au tournoi
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Rang</th>
                      <th scope="col">IA</th>
                      <th scope="col">Elo</th>
                      <th scope="col">Écart</th>
                      <th scope="col">Parties classées</th>
                      <th scope="col">État</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orderLeaderboard(payload.rows).map((row) => (
                      <tr key={row.nom}>
                        <td data-label="Rang">{row.rang}</td>
                        <td data-label="IA">{row.nom}</td>
                        <td data-label="Elo">{row.elo}</td>
                        <td data-label="Écart">{formatGap(row.ecart_derniere_vague)}</td>
                        <td data-label="Parties classées">{row.parties_classees}</td>
                        <td data-label="État">
                          {row.statut === 'active' ? (
                            ''
                          ) : (
                            <span className={`badge badge--${row.statut}`}>
                              {STATUS_LABELS[row.statut]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </AsyncPanel>
    </>
  )
}
