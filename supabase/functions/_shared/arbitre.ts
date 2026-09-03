/**
 * Arbitrage d'une partie entre deux IA distantes (histoires 14 et 15).
 *
 * Le module n'appelle rien : il reçoit la réponse brute d'une IA et rend un
 * verdict. C'est ce qui le rend testable, et c'est aussi ce qui garantit qu'il
 * ne réécrit aucune règle : valider un coup, c'est `parseGameRecord` et rien
 * d'autre.
 */
import { parseGameRecord, serializeGameRecord } from '../../../src/game/moveNotation.ts'
import type { NotationError, NotationErrorReason } from '../../../src/game/moveNotation.ts'
import type { GameState, PlayerId } from '../../../src/game/types.ts'

/** Identifiants des deux IA, par la couleur qu'elles tiennent. */
export type Appariement = { bleu: string; blanc: string }

export type MotifIssue =
  | 'connexion'
  | 'blocage'
  | 'nul'
  | 'hors-delai'
  | 'illegal'
  | 'injoignable'
  | 'reponse-illisible'
  | 'interrompue'

export type IssuePartie = {
  vainqueur: PlayerId | null
  motif: MotifIssue
  /** IA fautive d'une défaite technique, sinon `null`. */
  fautif: string | null
  couleurFautive: PlayerId | null
  /** Refus exact rendu par `parseGameRecord`, conservé tel quel. */
  raisonNotation: NotationErrorReason | null
  /** Rang du coup fautif, à partir de 1, passes comprises. */
  rangCoup: number | null
  message: string
}

export type ReponseIa =
  | { ok: true; corps: string }
  | { ok: false; panne: 'hors-delai' | 'injoignable'; detail?: string }

export type PartieEnCours = {
  notation: string
  etat: GameState
  appariement: Appariement
}

export type ResultatArbitrage =
  | { ok: true; partie: PartieEnCours; issue: IssuePartie | null }
  | { ok: false; issue: IssuePartie }

export type OuvertureResult =
  | { ok: true; partie: PartieEnCours }
  | { ok: false; erreur: NotationError }

/** Motifs qui font perdre la partie sans qu'elle soit allée à son terme. */
export const MOTIFS_TECHNIQUES: readonly MotifIssue[] = [
  'hors-delai',
  'illegal',
  'injoignable',
  'reponse-illisible',
]

export const JETON_PASSE = '--'

/** Les sept motifs de refus, dans les termes que l'auteur d'une IA lira. */
export const LIBELLES_REFUS: Record<NotationErrorReason, string> = {
  syntax: 'syntaxe invalide',
  exhausted: 'pièce épuisée',
  'horizontal-bounds': 'débordement latéral',
  overflow: 'débordement par le haut',
  unsupported: 'support insuffisant',
  'game-over': 'partie déjà terminée',
  'unexpected-pass': 'passe non forcée',
}

/**
 * Tolérance sur la réponse d'une IA : seuls les espaces autour du jeton sont
 * ignorés ; tout le reste — jeton vide, jetons multiples, séparateur interne —
 * est une réponse illisible.
 */
const LONGUEUR_MAX_REPONSE = 32
const SEPARATEURS = /[\s,+]+/

export function estDefaiteTechnique(issue: IssuePartie): boolean {
  return MOTIFS_TECHNIQUES.includes(issue.motif)
}

function adversaire(couleur: PlayerId): PlayerId {
  return couleur === 'blue' ? 'white' : 'blue'
}

function botDeCouleur(appariement: Appariement, couleur: PlayerId): string {
  return couleur === 'blue' ? appariement.bleu : appariement.blanc
}

/** Couleur au trait et IA qu'elle désigne, ou `null` si la partie est finie. */
export function botAuTrait(
  partie: PartieEnCours,
): { couleur: PlayerId; bot: string } | null {
  if (partie.etat.phase !== 'playing') return null
  const couleur = partie.etat.activePlayer
  return { couleur, bot: botDeCouleur(partie.appariement, couleur) }
}

/** Rang du prochain coup, à partir de 1, les passes comptant pour un rang. */
function rangProchainCoup(etat: GameState): number {
  return etat.history.length + 1
}

/** Issue d'une partie allée à son terme, ou `null` si elle continue. */
export function issueDeLEtat(etat: GameState): IssuePartie | null {
  if (etat.phase !== 'finished' || !etat.result) return null
  const { winner, reason } = etat.result
  if (reason === 'connection') {
    return {
      vainqueur: winner,
      motif: 'connexion',
      fautif: null,
      couleurFautive: null,
      raisonNotation: null,
      rangCoup: null,
      message: 'Gagné par connexion.',
    }
  }
  if (reason === 'stalemate') {
    return {
      vainqueur: winner,
      motif: 'blocage',
      fautif: null,
      couleurFautive: null,
      raisonNotation: null,
      rangCoup: null,
      message: 'Gagné par blocage, à la plus grande zone.',
    }
  }
  return {
    vainqueur: null,
    motif: 'nul',
    fautif: null,
    couleurFautive: null,
    raisonNotation: null,
    rangCoup: null,
    message: 'Nul par blocage, zones égales.',
  }
}

function messageIllegal(etat: GameState, raison: NotationErrorReason): string {
  return `Perdu — coup illégal au coup ${rangProchainCoup(etat)}, ${LIBELLES_REFUS[raison]}.`
}

function defaiteTechnique(
  partie: PartieEnCours,
  couleurFautive: PlayerId,
  motif: MotifIssue,
  message: string,
  raisonNotation: NotationErrorReason | null = null,
): IssuePartie {
  return {
    vainqueur: adversaire(couleurFautive),
    motif,
    fautif: botDeCouleur(partie.appariement, couleurFautive),
    couleurFautive,
    raisonNotation,
    rangCoup: rangProchainCoup(partie.etat),
    message,
  }
}

/** Ouvre une partie, à plateau vide (`''`) ou sur une ouverture imposée. */
export function ouvrirPartie(
  ouverture: string,
  appariement: Appariement,
): OuvertureResult {
  const parsed = parseGameRecord(ouverture)
  if (!parsed.ok) return { ok: false, erreur: parsed.error }
  return {
    ok: true,
    partie: {
      notation: serializeGameRecord(parsed.state),
      etat: parsed.state,
      appariement,
    },
  }
}

/**
 * Valide la réponse d'une IA et l'applique, ou rend la défaite technique
 * motivée. Un `--` reçu d'une IA est toujours un coup illégal : les passes sont
 * forcées par les règles et appliquées par le rejeu de la notation, une IA dont
 * le tour est passé n'étant jamais appelée.
 */
export function arbitrerReponse(
  partie: PartieEnCours,
  reponse: ReponseIa,
): ResultatArbitrage {
  const trait = botAuTrait(partie)
  if (!trait) {
    throw new Error('La partie est terminée : aucune IA n’est au trait.')
  }
  const couleur = trait.couleur

  if (!reponse.ok) {
    const message = reponse.panne === 'hors-delai'
      ? `Perdu — hors délai au coup ${rangProchainCoup(partie.etat)}.`
      : `Perdu — service injoignable au coup ${rangProchainCoup(partie.etat)}.`
    return {
      ok: false,
      issue: defaiteTechnique(partie, couleur, reponse.panne, message),
    }
  }

  const jeton = reponse.corps.trim()
  const illisible =
    jeton === '' ||
    jeton.length > LONGUEUR_MAX_REPONSE ||
    jeton.split(SEPARATEURS).length !== 1
  if (illisible) {
    return {
      ok: false,
      issue: defaiteTechnique(
        partie,
        couleur,
        'reponse-illisible',
        `Perdu — réponse illisible au coup ${rangProchainCoup(partie.etat)}.`,
      ),
    }
  }

  if (jeton === JETON_PASSE) {
    return {
      ok: false,
      issue: defaiteTechnique(
        partie,
        couleur,
        'illegal',
        messageIllegal(partie.etat, 'unexpected-pass'),
        'unexpected-pass',
      ),
    }
  }

  const suite = partie.notation === '' ? jeton : `${partie.notation} ${jeton}`
  const parsed = parseGameRecord(suite)
  if (!parsed.ok) {
    return {
      ok: false,
      issue: defaiteTechnique(
        partie,
        couleur,
        'illegal',
        messageIllegal(partie.etat, parsed.error.reason),
        parsed.error.reason,
      ),
    }
  }

  const suivante: PartieEnCours = {
    notation: serializeGameRecord(parsed.state),
    etat: parsed.state,
    appariement: partie.appariement,
  }
  return { ok: true, partie: suivante, issue: issueDeLEtat(parsed.state) }
}

/** Fin de la fenêtre horaire : la partie non terminée devient un nul technique. */
export function cloturerPartieInterrompue(): IssuePartie {
  return {
    vainqueur: null,
    motif: 'interrompue',
    fautif: null,
    couleurFautive: null,
    raisonNotation: null,
    rangCoup: null,
    message: 'Nul technique — partie interrompue à la fin de la vague.',
  }
}
