import { useRef, type PointerEvent, type RefObject } from 'react'
import { BOARD_SIZE } from '../game/types'
import { columnAtX } from './dropAim'

type DropZoneProps = {
  enabled: boolean
  /**
   * Sans flèches : la bande reste une surface de visée alignée sur les colonnes,
   * pour approcher la grille par le haut même lorsqu'elle est pleine. La pièce
   * qui suit le pointeur tient alors lieu d'indication.
   */
  silent?: boolean
  /**
   * Prolongement bas de la surface de visée : le plateau que la bande surmonte.
   * Un geste maintenu y garde sa cible, et c'est en sortant de cette surface
   * qu'on renonce à poser.
   */
  surface?: RefObject<HTMLElement | null>
  onHover: (column: number | null) => void
  onDrop: (column: number) => void
}

/**
 * Bande de visée : neuf entrées de colonne alignées sur le damier.
 *
 * Le geste **vise tant que le pointeur est enfoncé et ne pose qu'au
 * relâchement**. C'est ce qui rend la bande utilisable au doigt : une pièce
 * couvre plusieurs colonnes, et sans survol la flèche seule ne dit pas où elle
 * tomberait. Pendant l'appui, l'aperçu de chute répond à la question, en rouge
 * quand la pose est refusée ; relâcher sur une colonne refusée ne pose rien et
 * laisse la pièce en main. Les flèches, elles, ne portent aucun état : l'aperçu
 * dit déjà la colonne visée et le refus, et le doigt couvre la flèche pressée.
 *
 * Sortir de la surface de visée — la bande et le plateau — **éteint l'aperçu**,
 * et relâcher là abandonne le geste sans rien poser. L'extinction est ce qui
 * rend l'abandon lisible : tant qu'un aperçu est peint, relâcher pose.
 */
export function DropZone({
  enabled,
  silent = false,
  surface,
  onHover,
  onDrop,
}: DropZoneProps) {
  const band = useRef<HTMLDivElement>(null)
  const gesturePointer = useRef<number | null>(null)

  /**
   * Colonne sous l'abscisse donnée. Elle se lit sur la géométrie et non sur la
   * flèche survolée : pendant un glissé le pointeur reste capturé, donc les
   * événements gardent la cible de départ, et le doigt sort volontiers de la
   * bande vers le plateau.
   */
  const columnAt = (clientX: number): number | null => {
    const zones = band.current?.children
    if (!zones?.length) return null
    const left = zones[0].getBoundingClientRect().left
    const right = zones[zones.length - 1].getBoundingClientRect().right
    return right > left ? columnAtX(left, right, clientX) : null
  }

  /** Vrai tant que le pointeur reste sur la bande ou sur le plateau. */
  const overSurface = (event: PointerEvent<HTMLDivElement>) =>
    [band.current, surface?.current].some((element) => {
      const box = element?.getBoundingClientRect()
      return (
        box !== undefined &&
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      )
    })

  const startAiming = (event: PointerEvent<HTMLDivElement>) => {
    // Bouton principal seulement. La bande pose au relâchement, donc sans ce
    // filtre un clic droit ou milieu jouerait un coup — et au bureau elle est
    // invisible au-dessus du plateau, où le clic droit sert à retourner la
    // pièce. Au doigt comme au stylet, le contact principal porte `button` à 0.
    if (!enabled || event.button !== 0 || gesturePointer.current !== null) return
    const column = columnAt(event.clientX)
    if (column === null) return
    gesturePointer.current = event.pointerId
    // Capture posée sur la bande et non sur la flèche pressée : au doigt, la
    // capture implicite retiendrait les événements sur cette flèche-là, et
    // glisser vers une autre colonne ne viserait plus rien.
    event.currentTarget.setPointerCapture(event.pointerId)
    onHover(column)
  }

  const moveAim = (event: PointerEvent<HTMLDivElement>) => {
    if (gesturePointer.current !== event.pointerId) return
    const column = overSurface(event) ? columnAt(event.clientX) : null
    onHover(column)
  }

  const endAiming = (event: PointerEvent<HTMLDivElement>) => {
    if (gesturePointer.current !== event.pointerId) return
    gesturePointer.current = null
    if (!overSurface(event)) {
      onHover(null)
      return
    }
    const column = columnAt(event.clientX)
    if (column !== null) onDrop(column)
  }

  const abortAiming = (event: PointerEvent<HTMLDivElement>) => {
    if (gesturePointer.current !== event.pointerId) return
    gesturePointer.current = null
    // Le navigateur a repris le geste. L'aperçu ne vise plus rien et doit
    // s'éteindre : peint sans geste vivant, il promettrait une pose que le
    // relâchement ne fera pas.
    onHover(null)
  }

  return (
    <div
      className="drop-zones"
      ref={band}
      aria-label="Colonnes d’entrée"
      onMouseLeave={() => {
        if (gesturePointer.current === null) onHover(null)
      }}
      onPointerDown={startAiming}
      onPointerMove={moveAim}
      onPointerUp={endAiming}
      onPointerCancel={abortAiming}
    >
      {Array.from({ length: BOARD_SIZE }, (_, column) => (
        <button
          type="button"
          className="drop-zone"
          key={column}
          disabled={!enabled}
          aria-label={`Faire tomber la pièce depuis la colonne ${column + 1}`}
          onMouseEnter={() => onHover(column)}
          onFocus={() => onHover(column)}
          onBlur={() => onHover(null)}
          // Le geste au pointeur pose déjà au relâchement : seule reste ici
          // l'activation sans pointeur — clavier ou aide technique — que
          // `detail` à zéro distingue d'un clic.
          onClick={(event) => {
            if (event.detail === 0) onDrop(column)
          }}
        >
          {!silent && (
            <span className="drop-arrow" aria-hidden="true">↓</span>
          )}
        </button>
      ))}
    </div>
  )
}
