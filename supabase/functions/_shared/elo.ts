/**
 * Classement Elo de la plateforme (histoire 15).
 *
 * Arrondi : le calcul d'une vague se mène en flottant et le classement n'est
 * arrondi à l'entier qu'à la clôture, si bien qu'un classement stocké est
 * toujours entier et qu'aucune décimale ne se propage d'une vague à l'autre.
 */
import type { PlayerId } from '../../../src/game/types.ts'

export const CLASSEMENT_INITIAL = 1200
export const PARTIES_DE_RODAGE = 10
export const COEFFICIENT_RODAGE = 40
export const COEFFICIENT_ETABLI = 20

export type ClassementBot = {
  classement: number
  /** Parties déjà classées avant la vague : c'est elle qui fixe le coefficient. */
  partiesClassees: number
}

export type PartieClassee = {
  bleu: string
  blanc: string
  vainqueur: PlayerId | null
}

export type BilanBot = {
  bot: string
  avant: number
  apres: number
  ecart: number
  victoires: number
  nuls: number
  defaites: number
  partiesClassees: number
}

export type ResultatVague = {
  classements: Map<string, ClassementBot>
  bilans: BilanBot[]
}

export function esperance(classement: number, adverse: number): number {
  return 1 / (1 + 10 ** ((adverse - classement) / 400))
}

/**
 * Coefficient d'une partie : il se lit sur le nombre de parties classées **à
 * l'ouverture de la vague**, jamais sur un compteur qui monterait en cours de
 * calcul. C'est ce qui rend le résultat indépendant de l'ordre interne d'une
 * vague, et donc reproductible.
 */
export function coefficient(partiesClasseesAvantLaVague: number): number {
  return partiesClasseesAvantLaVague < PARTIES_DE_RODAGE
    ? COEFFICIENT_RODAGE
    : COEFFICIENT_ETABLI
}

type Compte = { victoires: number; nuls: number; defaites: number }

function requis<T>(table: ReadonlyMap<string, T>, cle: string): T {
  const valeur = table.get(cle)
  if (valeur === undefined) throw new Error(`IA inconnue : ${cle}.`)
  return valeur
}

function classementDeDepart(
  depart: ReadonlyMap<string, ClassementBot>,
  bot: string,
): ClassementBot {
  return depart.get(bot) ?? {
    classement: CLASSEMENT_INITIAL,
    partiesClassees: 0,
  }
}

/** Score du joueur bleu : 1 victoire, 0,5 nul, 0 défaite. */
function scoreBleu(vainqueur: PlayerId | null): number {
  if (vainqueur === 'blue') return 1
  if (vainqueur === 'white') return 0
  return 0.5
}

/**
 * Applique une vague entière, parties prises dans l'ordre chronologique reçu.
 * Fonction pure : deux appels sur les mêmes entrées rendent les mêmes valeurs.
 */
export function appliquerVague(
  depart: ReadonlyMap<string, ClassementBot>,
  parties: readonly PartieClassee[],
): ResultatVague {
  const bots = new Set<string>()
  for (const partie of parties) {
    bots.add(partie.bleu)
    bots.add(partie.blanc)
  }

  const avant = new Map<string, ClassementBot>()
  const courant = new Map<string, number>()
  const coefficients = new Map<string, number>()
  const compte = new Map<string, Compte>()
  for (const bot of bots) {
    const initial = classementDeDepart(depart, bot)
    avant.set(bot, initial)
    courant.set(bot, initial.classement)
    coefficients.set(bot, coefficient(initial.partiesClassees))
    compte.set(bot, { victoires: 0, nuls: 0, defaites: 0 })
  }

  for (const partie of parties) {
    const noteBleu = requis(courant, partie.bleu)
    const noteBlanc = requis(courant, partie.blanc)
    const attenduBleu = esperance(noteBleu, noteBlanc)
    const obtenuBleu = scoreBleu(partie.vainqueur)

    courant.set(
      partie.bleu,
      noteBleu + requis(coefficients, partie.bleu) * (obtenuBleu - attenduBleu),
    )
    courant.set(
      partie.blanc,
      noteBlanc + requis(coefficients, partie.blanc) * (attenduBleu - obtenuBleu),
    )

    const bilanBleu = requis(compte, partie.bleu)
    const bilanBlanc = requis(compte, partie.blanc)
    if (partie.vainqueur === 'blue') {
      bilanBleu.victoires += 1
      bilanBlanc.defaites += 1
    } else if (partie.vainqueur === 'white') {
      bilanBleu.defaites += 1
      bilanBlanc.victoires += 1
    } else {
      bilanBleu.nuls += 1
      bilanBlanc.nuls += 1
    }
  }

  const classements = new Map<string, ClassementBot>(depart)
  const bilans: BilanBot[] = []
  for (const bot of [...bots].sort()) {
    const initial = requis(avant, bot)
    const joue = requis(compte, bot)
    const parties = joue.victoires + joue.nuls + joue.defaites
    const apres = Math.round(requis(courant, bot))
    const partiesClassees = initial.partiesClassees + parties
    classements.set(bot, { classement: apres, partiesClassees })
    bilans.push({
      bot,
      avant: initial.classement,
      apres,
      ecart: apres - initial.classement,
      victoires: joue.victoires,
      nuls: joue.nuls,
      defaites: joue.defaites,
      partiesClassees,
    })
  }

  return { classements, bilans }
}

/** Écart signé, écrit comme le classement public l'exige : `+18`, `−7`, `=`. */
export function ecartEcrit(ecart: number): string {
  if (ecart === 0) return '='
  return ecart > 0 ? `+${ecart}` : `−${Math.abs(ecart)}`
}
