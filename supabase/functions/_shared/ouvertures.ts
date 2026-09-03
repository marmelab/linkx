/**
 * Débuts canoniques imposés aux vagues (histoire 15).
 *
 * Ce jeu d'ouvertures est un **choix éclairé, et provisoire**. L'appariement
 * en neutralise le déséquilibre — chaque ouverture est jouée deux fois,
 * couleurs échangées —, mais il ne rachète pas une ouverture *perdante d'office* :
 * une position déjà résolue ne mesure plus rien, les deux camps y jouant la
 * même fin forcée. Ces notations doivent donc être **re-dérivées du livre
 * d'ouverture** (`src/game/openingBook.data.ts`, profondeur 9) : ne garder que
 * des débuts que le moteur évalue proches de l'équilibre, et écarter ceux qu'il
 * juge déjà gagnés. Tant que cette mesure n'est pas faite, la liste ci-dessous
 * tient lieu de garnissage.
 *
 * Les notations sont **canoniques** au sens de `moveNotation.ts` : elles se
 * relisent et se réécrivent à l'identique.
 */

export type Ouverture = {
  /** Notation de la partie depuis son début, un ou deux demi-coups. */
  notation: string
  /** Libellé court, destiné au classement et à « Mes parties ». */
  libelle: string
}

export const OUVERTURES: readonly Ouverture[] = [
  { notation: '15', libelle: 'mono au centre' },
  { notation: '12', libelle: 'mono à gauche' },
  { notation: '18', libelle: 'mono à droite' },
  { notation: '23', libelle: 'domino couché à gauche' },
  { notation: '26', libelle: 'domino couché à droite' },
  { notation: '2r15', libelle: 'domino debout au centre' },
  { notation: '3I2', libelle: 'barre couchée à gauche' },
  { notation: '3I6', libelle: 'barre couchée à droite' },
  { notation: '3Ir14', libelle: 'barre debout' },
  { notation: '3Lr23', libelle: 'petit L à gauche' },
  { notation: '3Lr36', libelle: 'petit L retourné à droite' },
  { notation: '4Tr24', libelle: 'T couché' },
  { notation: '4Lr27', libelle: 'grand L à droite' },
  { notation: '4Lsr15', libelle: 'grand L retourné au centre' },
  { notation: '3I4 15', libelle: 'barre centrale, mono posé dessus' },
  { notation: '26 2r12', libelle: 'domino à droite, domino debout à gauche' },
]

export const LIBELLE_PLATEAU_VIDE = 'plateau vide'

/** Libellé d'une ouverture imposée, ou « plateau vide » pour une notation vide. */
export function libelleOuverture(notation: string): string {
  if (notation === '') return LIBELLE_PLATEAU_VIDE
  return (
    OUVERTURES.find((ouverture) => ouverture.notation === notation)?.libelle ??
    notation
  )
}
