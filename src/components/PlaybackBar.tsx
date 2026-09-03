import { PASS_TOKEN, serializeMove } from '../game/moveNotation'
import type { HistoryEntry } from '../game/types'

type PlaybackBarProps = {
  /** Coups et passes de la partie lue, dans l'ordre : le total du rang. */
  entries: HistoryEntry[]
  cursor: number
  /** Saut à un rang : la position se substitue, sans animation. */
  onSeek: (cursor: number) => void
  /** Pas en avant : la seule pièce du coup franchi tombe. */
  onStep: () => void
}

/**
 * Libellé du coup courant, écrit dans la notation du document — `4Lsr27` et non
 * une paraphrase : c'est le vocabulaire du lien qu'on vient d'ouvrir.
 */
function entryLabel(entries: HistoryEntry[], cursor: number): string {
  if (cursor === 0) return 'plateau vide'
  const entry = entries[cursor - 1]
  if (!entry) return '—'
  return entry.kind === 'pass' ? `${PASS_TOKEN} (tour passé)` : serializeMove(entry)
}

/**
 * Barre de lecture d'une partie reçue en notation (plan.md, histoire 13).
 *
 * Sa hauteur est **fixe** : elle est acquise dès le chargement et ne bouge plus,
 * curseur au début comme à la fin. Le bord haut du plateau est juste en dessous
 * et ne doit pas se déplacer d'un pixel — d'où aussi la ligne de légende, dont
 * le texte change mais jamais le nombre de lignes.
 */
export function PlaybackBar({ entries, cursor, onSeek, onStep }: PlaybackBarProps) {
  const total = entries.length
  const atStart = cursor === 0
  const atEnd = cursor >= total
  const label = entryLabel(entries, cursor)

  return (
    <nav className="playback-bar" aria-label="Lecture de la partie">
      <div className="playback-bar__controls">
        <button
          type="button"
          className="secondary-button secondary-button--small playback-bar__step"
          disabled={atStart}
          aria-label="Aller au début de la partie"
          onClick={() => onSeek(0)}
        >
          <span aria-hidden="true">⏮</span>
        </button>
        <button
          type="button"
          className="secondary-button secondary-button--small playback-bar__step"
          disabled={atStart}
          aria-label="Coup précédent"
          onClick={() => onSeek(cursor - 1)}
        >
          <span aria-hidden="true">◀</span>
        </button>
        <input
          className="playback-bar__slider"
          type="range"
          min={0}
          max={total}
          step={1}
          value={cursor}
          aria-label={`Rang du coup, de 0 à ${total}`}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <button
          type="button"
          className="secondary-button secondary-button--small playback-bar__step"
          disabled={atEnd}
          aria-label="Coup suivant"
          onClick={onStep}
        >
          <span aria-hidden="true">▶</span>
        </button>
        <button
          type="button"
          className="secondary-button secondary-button--small playback-bar__step"
          disabled={atEnd}
          aria-label="Aller à la fin de la partie"
          onClick={() => onSeek(total)}
        >
          <span aria-hidden="true">⏭</span>
        </button>
      </div>
      {/* Le rang et le passage en lecture seule sont annoncés : la barre les dit
          en toutes lettres plutôt que de laisser découvrir que rien ne répond. */}
      <p className="playback-bar__legend" aria-live="polite">
        <span className="overline">
          Coup {cursor} sur {total}
        </span>
        <span className="playback-bar__move">{label}</span>
        <span className="playback-bar__mode">
          {atEnd
            ? '· dernier coup'
            : '· en lecture seule, revenez à la fin'}
        </span>
      </p>
    </nav>
  )
}
