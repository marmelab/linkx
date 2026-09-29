/**
 * Réglages comparables du maître, partagés par les instruments de mesure
 * (`duel-appariee.ts`, `banc-positions.ts`) : un même nom désigne le même
 * moteur dans un duel et sur le banc.
 */
import { DEFAULT_WEIGHTS, NO_CRITERIA } from '../src/game/engineSearch'
import type { MasterSearchOptions } from '../src/game/engineSearch'

const TEXEL_TEMPO = 1133
const TEXEL_INTRA_TEMPO = 1385

/**
 * En ajouter un plutôt que de modifier le moteur à la volée : c'est ce qui rend
 * une mesure rejouable des mois plus tard.
 */
export const VARIANTS: Record<string, MasterSearchOptions> = {
  courant: {},
  'courant-bis': {},
  // L'évaluation d'avant l'ajustement Texel, pour rejouer les mesures d'alors.
  ancien: {
    weights: { primary: 1100, secondary: 300, pathWidth: 30, zoneBase: 20, zoneFill: 60, tempo: 819 },
    criteria: { hangingWall: 0, zoneStall: 0, caps: 0, bar3: 0 },
  },
  impair: { allowOddDepth: true, reduce: false },
  pair: { allowOddDepth: false, reduce: false },
  'sans-reduction': { reduce: false },
  'avec-reduction': { reduce: true },
  partiel: { keepPartial: true },
  'sans-partiel': { keepPartial: false },
  'axe2-1': { secondaryAxisWeight: 1 },
  'axe2-3': { secondaryAxisWeight: 3 },
  'axe2-5': { secondaryAxisWeight: 5 },
  // Critères tirés de `analyse-parties.ts`, mesurés un par un contre l'ancienne
  // évaluation : `ancien,gravity=150` rejoue ces mesures telles qu'elles furent faites.
  gravite: { criteria: { gravity: 150 } },
  zones: { criteria: { zoneCount: 300 } },
  coiffes: { criteria: { caps: 200 } },
  menaces: { criteria: { robust: 1000 } },
  mobilite: { criteria: { mobility: 150 } },
  reserve: { criteria: { reserve: 300 } },
  'lignes-hautes': { criteria: { topRows: 150 } },
  combinaison: { criteria: { robust: 1000, mobility: 150, reserve: 300 } },
  // Poids ajustés par régression logistique sur les coups du banc (méthode Texel) :
  // axe vertical à mur suspendu, barre de 3 gardée, second axe et largeur allégés.
  // Devenus ceux du moteur par défaut ; le nom reste pour les mesures qui le citent.
  texel: {
    weights: { primary: 1100, secondary: 94, pathWidth: 79, zoneBase: 32, zoneFill: 96, tempo: TEXEL_TEMPO },
    criteria: { hangingWall: 3, zoneStall: 57, caps: 84, bar3: 1199 },
  },
  // Même structure, poids ajustés à l'intérieur de chaque position : seul y compte l'ordre des coups.
  'texel-intra': {
    weights: { primary: 1100, secondary: 180, pathWidth: 95, tempo: TEXEL_INTRA_TEMPO },
    criteria: { hangingWall: 3, zoneStall: 53, caps: 549, bar3: 1600 },
  },
}

/**
 * Un réglage se nomme aussi par ses poids, `robust=500,mobility=150`, sans
 * l'ajouter à `VARIANTS` : c'est ce qui rend un balayage de poids rejouable
 * depuis sa seule ligne de commande. Les clés sont celles des critères ou des
 * poids de base (`primary`, `pathWidth`…), et un nom de réglage peut les
 * précéder : `texel,bar3=800`.
 */
export function variantOf(label: string): MasterSearchOptions | undefined {
  if (VARIANTS[label]) return VARIANTS[label]
  const [head, ...rest] = label.split(',')
  const base = VARIANTS[head]
  const pairs = (base ? rest : [head, ...rest]).map((pair) => pair.split('='))
  if (!pairs.every(([key, value]) => (key in NO_CRITERIA || key in DEFAULT_WEIGHTS) && Number.isFinite(Number(value)))) {
    return undefined
  }
  const pick = (keys: object) =>
    Object.fromEntries(pairs.filter(([key]) => key in keys).map(([key, value]) => [key, Number(value)]))
  return {
    ...base,
    criteria: { ...base?.criteria, ...pick(NO_CRITERIA) },
    weights: { ...base?.weights, ...pick(DEFAULT_WEIGHTS) },
  }
}

/** `variantOf`, ou une erreur qui liste les réglages connus. */
export function requireVariant(label: string): MasterSearchOptions {
  const options = variantOf(label)
  if (!options) {
    throw new Error(
      `Réglage inconnu : ${label}. Connus : ${Object.keys(VARIANTS).join(', ')}, ou des poids ` +
        `${[...Object.keys(NO_CRITERIA), ...Object.keys(DEFAULT_WEIGHTS)].join('/')} sous la forme reserve=300,robust=1000`,
    )
  }
  return options
}
