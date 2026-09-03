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

export type Opening = {
  /** Notation de la partie depuis son début, un ou deux demi-coups. */
  notation: string
  /** Libellé court, destiné au classement et à « Mes parties ». */
  label: string
}

export const OPENINGS: readonly Opening[] = [
  { notation: '15', label: 'mono au centre' },
  { notation: '12', label: 'mono à gauche' },
  { notation: '18', label: 'mono à droite' },
  { notation: '23', label: 'domino couché à gauche' },
  { notation: '26', label: 'domino couché à droite' },
  { notation: '2r15', label: 'domino debout au centre' },
  { notation: '3I2', label: 'barre couchée à gauche' },
  { notation: '3I6', label: 'barre couchée à droite' },
  { notation: '3Ir14', label: 'barre debout' },
  { notation: '3Lr23', label: 'petit L à gauche' },
  { notation: '3Lr36', label: 'petit L retourné à droite' },
  { notation: '4Tr24', label: 'T couché' },
  { notation: '4Lr27', label: 'grand L à droite' },
  { notation: '4Lsr15', label: 'grand L retourné au centre' },
  { notation: '3I4 15', label: 'barre centrale, mono posé dessus' },
  { notation: '26 2r12', label: 'domino à droite, domino debout à gauche' },
]

export const EMPTY_BOARD_LABEL = 'plateau vide'

/** Libellé d'une ouverture imposée, ou « plateau vide » pour une notation vide. */
export function openingLabel(notation: string): string {
  if (notation === '') return EMPTY_BOARD_LABEL
  return (
    OPENINGS.find((opening) => opening.notation === notation)?.label ?? notation
  )
}
