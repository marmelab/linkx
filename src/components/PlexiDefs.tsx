/**
 * Traitement « plexiglas » partagé par toutes les silhouettes.
 *
 * La géométrie reste produite par `getCellsOutlinePath` ; ce module n'ajoute que
 * la matière : biseau de tranche, reflet spéculaire, ombre portée. Un seul jeu de
 * `<defs>` vit dans le document et chaque silhouette y fait référence par
 * `filter: url(#…)` depuis le CSS, quel que soit son `<svg>` d'accueil.
 *
 * INVARIANCE DES REFLETS — contrainte structurante.
 * L'éclairage ne doit jamais tourner avec la pièce. Trois choix le garantissent :
 *
 * 1. `feDistantLight` : son azimut est exprimé dans l'espace utilisateur du
 *    filtre, jamais dans la boîte englobante de la forme. Une pièce tournée ou
 *    retournée garde donc sa lumière en haut à gauche de l'écran.
 * 2. `feOffset` : les décalages du liseré sombre, du voile brillant et de
 *    l'ombre portée sont des vecteurs d'espace utilisateur, eux aussi fixes à
 *    l'écran.
 * 3. Aucun dégradé directionnel n'est utilisé pour la matière. Un dégradé en
 *    `objectBoundingBox` — la valeur par défaut — s'étirerait avec la boîte de
 *    la pièce et ferait basculer la lumière d'un `L` couché à un `L` debout.
 *
 * Corollaire à respecter côté rendu : les orientations sont cuites dans les
 * coordonnées du chemin (`getOrientation`), jamais posées en `transform` SVG. Un
 * `transform="rotate(…)"` sur une silhouette ferait tourner l'espace du filtre
 * avec elle et casserait l'invariance.
 *
 * ÉCHELLE — toutes les longueurs sont en unités de case. Le plateau et la
 * réserve dessinent l'un et l'autre une case par unité utilisateur : le relief
 * garde la même épaisseur relative du grand plateau de bureau à la petite
 * silhouette de réserve, sans valeur en pixels à maintenir en double.
 */

/** Lumière rasante venant du haut à gauche, commune à toute la scène. */
const LIGHT_AZIMUTH = 215
const LIGHT_ELEVATION = 55

/** Les longueurs dérivées de l'azimut sont irrationnelles : les arrondir garde
 *  un DOM lisible, à une précision très inférieure au pixel. */
const round = (value: number) => Number(value.toFixed(4))

/**
 * Une bande le long des seules arêtes tournées vers `(dx, dy)`.
 *
 * Décaler la silhouette dans la direction opposée puis la soustraire à
 * l'originale ne laisse que le liseré du côté visé. Contrairement à un dégradé,
 * la bande épouse le contour réel — creux rentrants des `L`, `T` et `S`
 * compris — et son orientation est un vecteur d'espace utilisateur : elle ne
 * tourne jamais avec la pièce.
 */
function EdgeBand({
  source,
  dx,
  dy,
  blur,
  color,
  opacity,
  result,
}: {
  /** Alpha de départ : la face intérieure, pour rester en deçà du liseré. */
  source: string
  dx: number
  dy: number
  blur: number
  color: string
  opacity: number
  result: string
}) {
  return (
    <>
      <feOffset
        in={source}
        dx={round(-dx)}
        dy={round(-dy)}
        result={`${result}Shift`}
      />
      <feGaussianBlur
        in={`${result}Shift`}
        stdDeviation={round(blur)}
        result={`${result}Soft`}
      />
      <feComposite
        in={source}
        in2={`${result}Soft`}
        operator="out"
        result={`${result}Mask`}
      />
      <feFlood floodColor={color} floodOpacity={opacity} result={`${result}Ink`} />
      <feComposite
        in={`${result}Ink`}
        in2={`${result}Mask`}
        operator="in"
        result={result}
      />
    </>
  )
}

type ReliefProps = {
  id: string
  /** Épaisseur de la tranche, en unités de case. */
  bevel: number
  /** Opacité de l'arête éclairée, côté lumière. */
  highlight: number
  /** Opacité de l'arête à l'ombre, côté opposé. */
  shade: number
  /** Opacité du voile brillant étalé sur la moitié éclairée. `0` le supprime. */
  sheen: number
  /** Intensité du filet spéculaire, la brillance dure du plexiglas. `0` le supprime. */
  gloss: number
  /** Densité du liseré : la tranche traverse plus de matière, donc plus foncée. */
  rim: number
  /** Ombre portée, en unités de case. */
  shadow: { dx: number; dy: number; blur: number; opacity: number }
}

/**
 * Une dalle translucide : tranche biseautée, reflets et ombre portée. Le
 * remplissage et le contour restent à la charge du CSS appelant, ce qui laisse
 * chaque camp choisir sa teinte sans dupliquer le filtre.
 *
 * Le biseau est volontairement étroit. Une tranche large finit par occuper
 * l'essentiel d'une pièce de trois cases : la couleur se délave et la dalle
 * prend l'air d'un cadre de tableau plutôt que d'un morceau de plexiglas.
 */
function ReliefFilter({
  id,
  bevel,
  highlight,
  shade,
  sheen,
  gloss,
  rim,
  shadow,
}: ReliefProps) {
  // Composante du vecteur lumière projetée à l'écran : les liserés suivent
  // exactement l'azimut déclaré, sans second réglage à garder en phase.
  const radians = (LIGHT_AZIMUTH * Math.PI) / 180
  const toLight = { x: Math.cos(radians), y: Math.sin(radians) }

  return (
    <filter
      id={id}
      x="-35%"
      y="-35%"
      width="170%"
      height="170%"
      primitiveUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      {/* Face intérieure : la silhouette érodée de l'épaisseur du liseré. Les
          reflets s'y appuient, donc ils restent en deçà du contour au lieu de
          l'effacer. Sans cela la tranche éclairée mange le trait qui sépare
          deux pièces voisines de même couleur. */}
      <feMorphology
        in="SourceAlpha"
        operator="erode"
        radius={round(bevel * 0.6)}
        result="face"
      />

      {/* Liseré dense : sur la tranche, la lumière traverse plus de matière et
          la teinte s'y concentre. C'est le liseré, non la saturation, qui
          continue de distinguer les camps en vision daltonienne. */}
      <feComposite
        in="SourceAlpha"
        in2="face"
        operator="out"
        result="rimMask"
      />
      <feFlood floodColor="#0d1a30" floodOpacity={rim} result="rimInk" />
      <feComposite in="rimInk" in2="rimMask" operator="in" result="rimEdge" />

      {/* Voile brillant : un large liseré très flou côté lumière, qui éclaircit
          la moitié haute-gauche de la dalle et s'éteint vers le bas-droite.
          C'est le flou le plus large du filtre, donc la primitive la plus
          coûteuse : les variantes allégées s'en passent. */}
      {sheen > 0 && (
        <EdgeBand
          source="face"
          dx={toLight.x * 0.55}
          dy={toLight.y * 0.55}
          blur={0.32}
          color="#ffffff"
          opacity={sheen}
          result="sheen"
        />
      )}

      {/* Tranche à l'ombre, côté opposé à la lumière : c'est elle qui donne son
          épaisseur à la dalle. Le ghost s'en passe, il ne repose sur rien. */}
      {shade > 0 && (
        <EdgeBand
          source="face"
          dx={-toLight.x * bevel}
          dy={-toLight.y * bevel}
          blur={bevel * 0.55}
          color="#09142a"
          opacity={shade}
          result="shadeEdge"
        />
      )}

      {/* Tranche éclairée, côté lumière. */}
      <EdgeBand
        source="face"
        dx={toLight.x * bevel}
        dy={toLight.y * bevel}
        blur={bevel * 0.5}
        color="#ffffff"
        opacity={highlight}
        result="litEdge"
      />

      {/* Filet spéculaire : la brillance dure et étroite du plexiglas poli.
          `feDistantLight` raisonne dans l'espace du filtre, donc l'orientation
          de la pièce ne le déplace pas. Rester en relief faible et en exposant
          élevé concentre le reflet sur les seules arêtes tournées vers la
          lumière, au lieu d'allumer tout le pourtour. */}
      {gloss > 0 && (
        <>
          <feGaussianBlur
            in="SourceAlpha"
            stdDeviation={round(bevel * 0.75)}
            result="bump"
          />
          <feSpecularLighting
            in="bump"
            surfaceScale={round(bevel * 4.5)}
            specularConstant={gloss}
            specularExponent={26}
            lightingColor="#ffffff"
            result="specular"
          >
            <feDistantLight azimuth={LIGHT_AZIMUTH} elevation={LIGHT_ELEVATION} />
          </feSpecularLighting>
          <feComposite
            in="specular"
            in2="SourceAlpha"
            operator="in"
            result="specularEdge"
          />
        </>
      )}

      <feMerge result="slab">
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="rimEdge" />
        {sheen > 0 && <feMergeNode in="sheen" />}
        {shade > 0 && <feMergeNode in="shadeEdge" />}
        <feMergeNode in="litEdge" />
        {gloss > 0 && <feMergeNode in="specularEdge" />}
      </feMerge>

      <feDropShadow
        in="slab"
        dx={shadow.dx}
        dy={shadow.dy}
        stdDeviation={shadow.blur}
        floodColor="#101a2b"
        floodOpacity={shadow.opacity}
      />
    </filter>
  )
}

/**
 * Les `<defs>` du document. Rendu une seule fois, à côté du plateau : les
 * références `url(#…)` portent sur tout le document, la réserve et l'aperçu
 * central s'en servent depuis leur propre `<svg>`.
 */
export function PlexiDefs() {
  return (
    <svg className="plexi-defs" aria-hidden="true" focusable="false">
      <defs>
        {/* Pièce posée et aperçu central : relief franc, la dalle repose. */}
        <ReliefFilter
          id="plexi-relief"
          bevel={0.075}
          highlight={0.5}
          shade={0.32}
          sheen={0.11}
          gloss={0.7}
          rim={0.2}
          shadow={{ dx: 0.045, dy: 0.07, blur: 0.05, opacity: 0.34 }}
        />

        {/* Réserve : mêmes lumières, relief et ombre atténués. Aux petites
            tailles un biseau appuyé se referme en bouillie et l'ombre déborde
            sur la silhouette voisine. */}
        <ReliefFilter
          id="plexi-relief-soft"
          bevel={0.062}
          highlight={0.42}
          shade={0.24}
          sheen={0.09}
          gloss={0.55}
          rim={0.16}
          shadow={{ dx: 0.03, dy: 0.045, blur: 0.038, opacity: 0.24 }}
        />

        {/* Mobile : mêmes tranches et même ombre, sans le voile brillant ni le
            filet spéculaire. Sur une case de trente pixels ces deux couches ne
            se distinguent plus du biseau, et ce sont les deux primitives les
            plus lourdes à rastériser sur un plateau bien rempli. */}
        <ReliefFilter
          id="plexi-relief-lite"
          bevel={0.06}
          highlight={0.46}
          shade={0.3}
          sheen={0}
          gloss={0}
          rim={0.2}
          shadow={{ dx: 0.04, dy: 0.06, blur: 0.045, opacity: 0.32 }}
        />

        {/* Ghost : la pièce n'est pas posée. Pas de tranche à l'ombre, reflet
            discret, et une ombre lointaine et diffuse qui la fait planer. */}
        <ReliefFilter
          id="plexi-float"
          bevel={0.06}
          highlight={0.3}
          shade={0}
          sheen={0.07}
          gloss={0.4}
          rim={0.12}
          shadow={{ dx: 0.07, dy: 0.15, blur: 0.13, opacity: 0.2 }}
        />
      </defs>
    </svg>
  )
}
