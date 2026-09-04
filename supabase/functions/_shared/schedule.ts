/**
 * Calendrier d'une vague : toutes contre toutes, deux étages par paire
 * (histoire 15). Aucune IA n'est jamais exemptée, la parité du nombre
 * d'inscrits n'entrant pas en jeu.
 *
 * **La borne des cent parties saute à 52 IA, et c'est assumé.** `plan.md`
 * (histoire 15) demande deux choses qui deviennent incompatibles au-delà de 51
 * inscrites : que le tournoi soit **toutes contre toutes**, aucune IA n'étant
 * jamais laissée sans adversaire, et qu'une IA joue de l'**ordre d'une centaine
 * de parties**. À 51 IA, `k` vaut zéro et l'aller-retour à plateau vide donne
 * pile cent parties ; à 52, il en donne cent deux, et rien ne peut plus le
 * réduire — `k` est déjà à son minimum. Tenir les cent obligerait à **plafonner
 * le nombre d'adversaires**, donc à sauter des paires, donc à abandonner le
 * toutes contre toutes et à choisir qui rencontre qui : ce n'est pas un détail
 * d'implémentation, c'est le format du tournoi, et il se décide dans `plan.md`,
 * pas ici. Le format y étant écrit deux fois et l'objectif du centaine y étant
 * donné comme un « de l'ordre de », c'est l'objectif qui cède.
 *
 * Ce que cela coûte, en clair : au-delà de 51 IA le nombre de parties croît en
 * `n²` et la vague cesse de tenir dans ses douze heures. Elle ne se perd pas —
 * midi passé, les parties encore en cours sortent en nuls techniques et la vague
 * se clôt normalement —, mais une part croissante de la vague ne se joue pas.
 * `MAX_BOTS_WITHIN_TARGET` nomme ce seuil ; le franchir demande une décision
 * produit, pas un correctif.
 */
import { OPENINGS } from './openings.ts'
import type { Opening } from './openings.ts'

/**
 * Objectif de parties par IA et par vague, pas plafond dur : il n'est tenu que
 * tant que le tournoi toutes contre toutes le permet — voir `gamesPerBot`.
 */
export const MAX_GAMES_PER_BOT = 100

/**
 * Nombre d'IA au-delà duquel l'objectif des cent parties **cesse d'être tenu**.
 * À 51 IA, `k` vaut zéro et le seul aller-retour à plateau vide donne déjà
 * exactement cent parties par IA ; à 52, il en donne cent deux, et le total
 * croît ensuite en `n²` — 200 IA donneraient 39 800 parties.
 */
export const MAX_BOTS_WITHIN_TARGET = 51

export type ScheduledGame = {
  blue: string
  white: string
  /** Notation imposée ; chaîne vide pour une partie à plateau vide. */
  opening: string
}

export type Schedule = {
  /** `k` : ouvertures imposées par paire, chacune jouée deux fois. */
  openingsPerPair: number
  games: ScheduledGame[]
}

/**
 * `k` est le plus grand entier tel que `(n − 1) × (2 + 2k) ≤ 100`, borné par le
 * nombre de débuts canoniques disponibles, et nul dès que l'aller-retour à
 * plateau vide suffit à atteindre ce total.
 */
export function openingsPerPair(
  botCount: number,
  availableOpenings: number,
): number {
  if (botCount < 2) return 0
  const opponents = botCount - 1
  const perOpponent = Math.floor(MAX_GAMES_PER_BOT / opponents)
  return Math.max(
    0,
    Math.min(Math.floor((perOpponent - 2) / 2), availableOpenings),
  )
}

/**
 * Parties jouées par chaque IA d'une vague de `botCount` inscrites. Vaut
 * `MAX_GAMES_PER_BOT` au plus tant que `botCount` ne dépasse pas
 * `MAX_BOTS_WITHIN_TARGET`, et croît linéairement ensuite : c'est la sortie de
 * borne assumée ci-dessus, et de quoi la mesurer plutôt que de la découvrir.
 */
export function gamesPerBot(
  botCount: number,
  availableOpenings: number = OPENINGS.length,
): number {
  if (botCount < 2) return 0
  return (botCount - 1) * (2 + 2 * openingsPerPair(botCount, availableOpenings))
}

/** Empreinte FNV-1a : convertit l'identité d'une paire en graine entière. */
function fingerprint(text: string): number {
  let value = 0x81_1c_9d_c5
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, 0x01_00_01_93) >>> 0
  }
  return value >>> 0
}

/** Même générateur congruentiel que le Zobrist de `engineBoard.ts`. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state
  }
}

/**
 * Tire `k` ouvertures distinctes pour une paire. Le tirage ne dépend que de la
 * graine de la vague et des deux identifiants, pris dans l'ordre alphabétique :
 * reconstruire la vague redonne exactement les mêmes ouvertures.
 */
export function drawOpenings(
  seed: string,
  first: string,
  second: string,
  count: number,
  openings: readonly Opening[] = OPENINGS,
): Opening[] {
  const [a, b] = [first, second].sort()
  const next = seededRandom(fingerprint(`${seed}|${a}|${b}`))
  const shuffled = [...openings]
  const taken = Math.min(count, shuffled.length)
  for (let i = 0; i < taken; i += 1) {
    const j = i + (next() % (shuffled.length - i))
    const swap = shuffled[i]
    shuffled[i] = shuffled[j]
    shuffled[j] = swap
  }
  return shuffled.slice(0, taken)
}

/**
 * Construit le calendrier complet. Les identifiants sont dédoublonnés et triés :
 * le calendrier ne dépend que de l'ensemble des IA actives et de la graine.
 */
export function buildSchedule(
  botIds: readonly string[],
  seed: string,
  openings: readonly Opening[] = OPENINGS,
): Schedule {
  const bots = [...new Set(botIds)].sort()
  const count = openingsPerPair(bots.length, openings.length)
  const games: ScheduledGame[] = []

  for (let i = 0; i < bots.length; i += 1) {
    for (let j = i + 1; j < bots.length; j += 1) {
      const a = bots[i]
      const b = bots[j]
      games.push({ blue: a, white: b, opening: '' })
      games.push({ blue: b, white: a, opening: '' })
      for (const opening of drawOpenings(seed, a, b, count, openings)) {
        games.push({ blue: a, white: b, opening: opening.notation })
        games.push({ blue: b, white: a, opening: opening.notation })
      }
    }
  }

  return { openingsPerPair: count, games }
}
