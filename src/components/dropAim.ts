import { BOARD_SIZE } from '../game/types'

/**
 * Colonne visée par une abscisse d'écran, la bande de visée s'étendant de
 * `left` à `right` — les bords extérieurs de ses deux flèches extrêmes, donc
 * exactement la largeur du damier.
 *
 * Un doigt qui sort de la bande vise la colonne de bord au lieu de ne plus
 * rien viser : le geste dure jusqu'au relâchement, et il dérive forcément un
 * peu pendant qu'on cherche la bonne colonne.
 */
export function columnAtX(left: number, right: number, clientX: number): number {
  const column = Math.floor(((clientX - left) / (right - left)) * BOARD_SIZE)
  return Math.min(Math.max(column, 0), BOARD_SIZE - 1)
}
