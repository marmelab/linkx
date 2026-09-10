/**
 * Export des parties affichées, pour réentraîner une IA hors de la plateforme.
 *
 * On exporte **ce que l'écran montre**, filtres compris : l'auteur choisit son
 * périmètre avec les mêmes commandes qu'il vient d'employer, plutôt qu'un
 * bouton par IA qui n'offrirait qu'une découpe figée.
 *
 * Chaque partie porte sa notation complète — de quoi rejouer la position à
 * n'importe quel coup — et le camp que tenait l'IA de l'auteur, sans lequel une
 * notation ne dit pas qui a gagné pour lui. Les libellés lisibles voyagent avec
 * les valeurs brutes : un fichier qu'on ouvre pour comprendre vaut mieux qu'un
 * fichier qu'il faut décoder.
 *
 * Module pur : l'instant et les données sont passés, rien n'est lu du monde.
 */
import type { MyGame } from './games'

export type ExportedGame = {
  id: string
  jouee_le: string
  vague_id: string | null
  ia: string
  ia_nom: string | null
  couleur: MyGame['color']
  adversaire: string | null
  ouverture: string
  ouverture_libelle: string
  issue: MyGame['outcome']
  issue_libelle: string
  motif_fin: MyGame['reason']
  nombre_coups: number
  notation: string
}

export type GamesExport = {
  format: 'linkx-parties'
  version: 1
  exporte_le: string
  parties: ExportedGame[]
}

export function buildGamesExport(
  games: readonly MyGame[],
  botNames: ReadonlyMap<string, string>,
  now: Date,
): GamesExport {
  return {
    format: 'linkx-parties',
    version: 1,
    exporte_le: now.toISOString(),
    parties: games.map((game) => ({
      id: game.id,
      jouee_le: game.playedAt,
      vague_id: game.waveId,
      ia: game.botId,
      ia_nom: botNames.get(game.botId) ?? null,
      couleur: game.color,
      adversaire: game.opponent,
      ouverture: game.opening,
      ouverture_libelle: game.openingLabel,
      issue: game.outcome,
      issue_libelle: game.outcomeText,
      motif_fin: game.reason,
      nombre_coups: game.moveCount,
      notation: game.notation,
    })),
  }
}

/**
 * Nom du fichier, daté à la seconde près : deux exports d'une même journée ne
 * doivent pas se recouvrir dans le dossier de téléchargement.
 */
export function gamesExportFileName(now: Date): string {
  const horodatage = now.toISOString().slice(0, 19).replace(/[:T]/g, '-')
  return `linkx-parties-${horodatage}.json`
}
