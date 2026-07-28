import type { OpeningBook } from './openingBook'

/**
 * Livre d'ouverture — **fichier généré**, ne pas éditer à la main.
 *
 * Régénérer avec :
 *   node node_modules/vite-node/dist/cli.mjs scripts/generate-opening-book.ts
 *
 * Vide par défaut : sans entrées, `lookupOpeningMove` rend toujours `null` et le
 * maître retombe sur la recherche en direct — comportement identique à l'absence
 * de livre. La génération hors ligne remplit cet objet.
 */
export const OPENING_BOOK: OpeningBook = {}
