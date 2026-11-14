/**
 * Livre d'ouverture du portage Go : recopie `openingBook.data.ts` en JSON dans
 * `engine-go/book/book.json`, que le paquet `book` embarque.
 *
 *   node node_modules/vite-node/dist/cli.mjs scripts/livre-go.ts
 *
 * À relancer après chaque régénération du livre ; `go generate ./book` le fait
 * depuis `engine-go/`. Les données de référence de `empreinte-go.ts` vérifient
 * ensuite que les deux livres répondent pareil.
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { OPENING_BOOK } from '../src/game/openingBook.data'

const target = fileURLToPath(new URL('../engine-go/book/book.json', import.meta.url))
const keys = Object.keys(OPENING_BOOK).sort()
const lines = keys.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(OPENING_BOOK[key])}`)
writeFileSync(target, `{\n${lines.join(',\n')}\n}\n`)
console.log(`${keys.length} entrées écrites dans ${target}`)
