/**
 * Calendrier d'une vague : toutes contre toutes, deux étages par paire
 * (histoire 15). Aucune IA n'est jamais exemptée, la parité du nombre
 * d'inscrits n'entrant pas en jeu.
 */
import { OUVERTURES } from './ouvertures.ts'
import type { Ouverture } from './ouvertures.ts'

export const PARTIES_MAX_PAR_IA = 100

export type PartiePrevue = {
  bleu: string
  blanc: string
  /** Notation imposée ; chaîne vide pour une partie à plateau vide. */
  ouverture: string
}

export type Calendrier = {
  /** `k` : ouvertures imposées par paire, chacune jouée deux fois. */
  ouverturesParPaire: number
  parties: PartiePrevue[]
}

/**
 * `k` est le plus grand entier tel que `(n − 1) × (2 + 2k) ≤ 100`, borné par le
 * nombre de débuts canoniques disponibles, et nul dès que l'aller-retour à
 * plateau vide suffit à atteindre ce total.
 */
export function ouverturesParPaire(
  nombreDIa: number,
  ouverturesDisponibles: number,
): number {
  if (nombreDIa < 2) return 0
  const adversaires = nombreDIa - 1
  const parAdversaire = Math.floor(PARTIES_MAX_PAR_IA / adversaires)
  return Math.max(
    0,
    Math.min(Math.floor((parAdversaire - 2) / 2), ouverturesDisponibles),
  )
}

/** Empreinte FNV-1a : convertit l'identité d'une paire en graine entière. */
function empreinte(texte: string): number {
  let valeur = 0x81_1c_9d_c5
  for (let i = 0; i < texte.length; i += 1) {
    valeur ^= texte.charCodeAt(i)
    valeur = Math.imul(valeur, 0x01_00_01_93) >>> 0
  }
  return valeur >>> 0
}

/** Même générateur congruentiel que le Zobrist de `engineBoard.ts`. */
function generateur(graine: number): () => number {
  let etat = graine >>> 0
  return () => {
    etat = (Math.imul(etat, 1_664_525) + 1_013_904_223) >>> 0
    return etat
  }
}

/**
 * Tire `k` ouvertures distinctes pour une paire. Le tirage ne dépend que de la
 * graine de la vague et des deux identifiants, pris dans l'ordre alphabétique :
 * reconstruire la vague redonne exactement les mêmes ouvertures.
 */
export function tirerOuvertures(
  graine: string,
  premier: string,
  second: string,
  nombre: number,
  ouvertures: readonly Ouverture[] = OUVERTURES,
): Ouverture[] {
  const [a, b] = [premier, second].sort()
  const suivant = generateur(empreinte(`${graine}|${a}|${b}`))
  const melange = [...ouvertures]
  const pris = Math.min(nombre, melange.length)
  for (let i = 0; i < pris; i += 1) {
    const j = i + (suivant() % (melange.length - i))
    const tampon = melange[i]
    melange[i] = melange[j]
    melange[j] = tampon
  }
  return melange.slice(0, pris)
}

/**
 * Construit le calendrier complet. Les identifiants sont dédoublonnés et triés :
 * le calendrier ne dépend que de l'ensemble des IA actives et de la graine.
 */
export function construireCalendrier(
  ia: readonly string[],
  graine: string,
  ouvertures: readonly Ouverture[] = OUVERTURES,
): Calendrier {
  const bots = [...new Set(ia)].sort()
  const nombre = ouverturesParPaire(bots.length, ouvertures.length)
  const parties: PartiePrevue[] = []

  for (let i = 0; i < bots.length; i += 1) {
    for (let j = i + 1; j < bots.length; j += 1) {
      const a = bots[i]
      const b = bots[j]
      parties.push({ bleu: a, blanc: b, ouverture: '' })
      parties.push({ bleu: b, blanc: a, ouverture: '' })
      for (const ouverture of tirerOuvertures(graine, a, b, nombre, ouvertures)) {
        parties.push({ bleu: a, blanc: b, ouverture: ouverture.notation })
        parties.push({ bleu: b, blanc: a, ouverture: ouverture.notation })
      }
    }
  }

  return { ouverturesParPaire: nombre, parties }
}
