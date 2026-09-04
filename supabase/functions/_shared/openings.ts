/**
 * Débuts canoniques imposés aux vagues (histoire 15).
 *
 * Cette liste est **mesurée**, pas choisie : `scripts/choisir-ouvertures.ts` la
 * régénère, et le tableau qu'il imprime est la seule justification de son
 * contenu. L'appariement — chaque ouverture jouée deux fois, couleurs échangées
 * — neutralise un déséquilibre modéré, mais il ne rachète pas une ouverture
 * *perdante d'office* : sur une position déjà décidée, les deux camps jouent la
 * même fin forcée et la rencontre ne mesure plus rien.
 *
 * **Méthode.** La valeur d'un début, c'est la valeur de la position après la
 * **meilleure réponse** de l'adversaire : on mesure donc chacun des 50 premiers
 * coups distincts (au miroir gauche-droite près, seule symétrie du jeu)
 * prolongé par la réponse du livre d'ouverture — profondeur 9, deux paliers
 * au-delà de ce que la recherche en direct atteint —, à profondeur 6 et sur un
 * **nombre de nœuds** plafonné, jamais sur l'horloge, pour que la mesure se
 * rejoue à l'identique. Le zéro de l'échelle est mesuré lui aussi, sur des
 * positions témoins invariantes par miroir plus échange des couleurs : il vaut
 * −16 points, soit un soixante-dixième du seuil.
 *
 * **Chiffres.** Seuil retenu : 1 100 points, un cran d'axe principal, la plus
 * petite unité d'avantage de l'évaluation et 1,3 fois le trait. Sur 50
 * ouvertures mesurées, 22 passent le seuil ; les 16 ci-dessous en sont les mieux
 * classées sous une règle de diversité — ni une forme ni une colonne d'ancrage
 * ne prend plus du quart de la liste. Leur déséquilibre va de **+8** à **−1 094**
 * points, l'ouvreur étant du mauvais côté dans quinze cas sur seize : imposer un
 * début rend la main, et c'est justement ce que l'échange des couleurs annule.
 * Aucune n'est décidée, et le test le revérifie à chaque exécution.
 *
 * **Ce que la mesure a écarté.** Les 28 ouvertures au-delà du seuil, dont
 * **tous** les débuts au mono — le meilleur, en colonne 2, lit −1 247 : poser
 * une seule case offre à l'adversaire une réponse trop forte. Le S n'apparaît
 * pas non plus, mais pour une raison de règle et non de mesure : aucune de ses
 * orientations n'a de base plate, il ne peut donc pas ouvrir sur un plateau
 * vide. Six formes sont ouvrables, cinq figurent ici.
 *
 * Les notations sont **canoniques** au sens de `moveNotation.ts` : elles se
 * relisent et se réécrivent à l'identique.
 */

export type Opening = {
  /** Notation de la partie depuis son début, un ou deux demi-coups. */
  notation: string
  /** Libellé court, destiné au classement et à « Mes parties ». */
  label: string
}

export const OPENINGS: readonly Opening[] = [
  // Déséquilibre mesuré, en points, du point de vue de l'ouvreur (voir en-tête).
  { notation: '4Tr24', label: 'T couché au centre' }, // +8
  { notation: '4Lr38', label: 'grand L debout à droite' }, // -104
  { notation: '4Lsr15', label: 'grand L debout retourné au centre' }, // -139
  { notation: '4Lr35', label: 'grand L debout au centre, colonne 5' }, // -210
  { notation: '4Lr36', label: 'grand L debout au centre, colonne 6' }, // -224
  { notation: '4Tr23', label: 'T couché à gauche, colonne 3' }, // -494
  { notation: '4Tr21', label: 'T couché à gauche, colonne 1' }, // -496
  { notation: '3Lr23', label: 'petit L à gauche' }, // -595
  { notation: '3Lr28', label: 'petit L à droite' }, // -884
  { notation: '3Ir15', label: 'barre debout au centre, colonne 5' }, // -904
  { notation: '4Tr22', label: 'T couché à gauche, colonne 2' }, // -904
  { notation: '3Ir12', label: 'barre debout à gauche' }, // -927
  { notation: '3Ir17', label: 'barre debout à droite' }, // -931
  { notation: '3Ir14', label: 'barre debout au centre, colonne 4' }, // -937
  { notation: '2r15', label: 'domino debout au centre' }, // -968
  { notation: '3Lr24', label: 'petit L au centre' }, // -1094
]

export const EMPTY_BOARD_LABEL = 'plateau vide'

/** Libellé d'une ouverture imposée, ou « plateau vide » pour une notation vide. */
export function openingLabel(notation: string): string {
  if (notation === '') return EMPTY_BOARD_LABEL
  return (
    OPENINGS.find((opening) => opening.notation === notation)?.label ?? notation
  )
}
