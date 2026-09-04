import { useEffect, useState } from 'react'
import { AsyncPanel } from './AsyncPanel'
import { fetchLeaderboard, fetchWaveProgress, fetchWaves } from './api'
import { STATUS_LABELS } from './outcomes'
import { formatGap, orderLeaderboard } from './ranking'
import {
  formatCountdown,
  formatParisDate,
  formatParisTime,
  nextWaveStart,
  openWave,
  WAVE_START_LABEL,
  waveProgress,
} from './schedule'
import { PROTOCOL_URL } from './protocol'
import { useAsync } from './useAsync'
import type { WaveProgressRow } from './api'
import type { LeaderboardRow, WaveRow } from './types'

type Payload = {
  rows: LeaderboardRow[]
  waves: WaveRow[]
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
  return { rows, waves }
}

/**
 * La bannière ne parle d'une vague en cours que sur une **ligne** ouverte : le
 * calendrier seul annoncerait des parties là où l'ordonnanceur est arrêté, et
 * garderait « en cours » une vague close avant midi.
 */
function WaveBanner({
  open,
  progress,
  now,
}: {
  open: WaveRow | null
  progress: WaveProgressRow
  now: number
}) {
  if (open) {
    const part = progress ? waveProgress(progress.jouees, progress.total) : null
    return (
      <p className="wave-banner">
        <span className="overline">Vague en cours</span>
        <strong>
          {progress && part !== null
            ? `${progress.jouees} parties jouées sur ${progress.total}, soit ${Math.round(part * 100)} %`
            : 'Les parties se jouent'}
          {' — fin à '}
          {formatParisTime(Date.parse(open.fin))}, heure de Paris.
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
  const open = state.data ? openWave(state.data.waves, now) : null
  // L'avancement suit l'horloge, comme le compte à rebours : lu une seule fois,
  // « 42 parties sur 120 » ne bougerait plus de toute la vague.
  const progress = useAsync<WaveProgressRow>(
    () => (open ? fetchWaveProgress(open.id) : Promise.resolve(null)),
    [open?.id, now],
  )

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
            <WaveBanner open={open} progress={progress.data} now={now} />
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
