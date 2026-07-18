import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PieceShape } from './PieceShape'
import { PlexiDefs } from './PlexiDefs'
import type { Rotation } from '../game/types'

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3]

const defs = renderToStaticMarkup(<PlexiDefs />)

describe('matière plexiglas partagée', () => {
  it('éclaire toujours depuis le même côté de l’écran', () => {
    const azimuths = [...defs.matchAll(/azimuth="([\d.]+)"/g)].map(
      ([, value]) => value,
    )

    // `feDistantLight` exprime son azimut dans l'espace du filtre : la lumière
    // reste accrochée à l'écran quand la silhouette tourne. Un seul azimut pour
    // tout le document, sinon deux pièces s'éclaireraient de deux côtés.
    expect(azimuths.length).toBeGreaterThan(0)
    expect(new Set(azimuths).size).toBe(1)
  })

  it('n’utilise aucun dégradé lié à la boîte englobante de la pièce', () => {
    // Un dégradé en `objectBoundingBox` s'étire avec la boîte de la forme : le
    // reflet basculerait d'un `L` couché à un `L` debout. Toute directionnalité
    // doit venir du filtre, dont les vecteurs sont en espace utilisateur.
    expect(defs).not.toContain('objectBoundingBox')
    expect(defs).not.toContain('<linearGradient')
    expect(defs).not.toContain('<radialGradient')
  })

  it('exprime ses longueurs en unités de case, sans pixel figé', () => {
    // Les unités utilisateur valent une case sur le plateau comme en réserve :
    // le relief garde la même épaisseur relative à toutes les échelles.
    expect(defs).toContain('primitiveUnits="userSpaceOnUse"')
    expect(defs).not.toMatch(/(stdDeviation|dx|dy)="[^"]*px"/)
  })
})

describe('invariance du reflet sur une pièce asymétrique', () => {
  /** Le `d` seul doit changer d'une orientation à l'autre. */
  const silhouetteAttributes = (markup: string) => {
    const openingTag = markup.match(/<path[^>]*>/)![0]
    return openingTag.replace(/ d="[^"]*"/, '')
  }

  const orientations = ROTATIONS.flatMap((rotation) =>
    [false, true].map((flipped) => ({ rotation, flipped })),
  )

  it('garde le même traitement lumineux dans les 4 rotations et les 2 miroirs', () => {
    const rendered = orientations.map(({ rotation, flipped }) =>
      renderToStaticMarkup(
        <PieceShape
          shapeId="largeL"
          player="blue"
          rotation={rotation}
          flipped={flipped}
        />,
      ),
    )

    const paths = rendered.map(silhouetteAttributes)
    expect(new Set(paths).size).toBe(1)

    // La géométrie, elle, doit bien varier : sans quoi le test ci-dessus
    // passerait sur huit rendus identiques.
    const outlines = rendered.map((markup) => markup.match(/ d="[^"]*"/)![0])
    expect(new Set(outlines).size).toBeGreaterThan(1)
  })

  it('cuit l’orientation dans les coordonnées, sans transform SVG', () => {
    // Un `transform="rotate(…)"` ferait tourner l'espace du filtre avec la
    // pièce : la lumière suivrait la silhouette au lieu de rester en haut à
    // gauche. Les orientations doivent donc rester dans le chemin lui-même.
    for (const { rotation, flipped } of orientations) {
      const markup = renderToStaticMarkup(
        <PieceShape
          shapeId="largeL"
          player="blue"
          rotation={rotation}
          flipped={flipped}
        />,
      )
      expect(markup).not.toContain('transform')
    }
  })
})
