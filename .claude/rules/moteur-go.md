---
paths:
  - "engine-go/**"
  - "scripts/*-go.ts"
---

# Portage Go du maître

`engine-go/` est un module Go autonome (`github.com/marmelab/linkx/engine-go`, go 1.24, aucune dépendance) qui reproduit le maître **à l'identique** : mêmes règles, même évaluation, même recherche, même livre. Il sert de base de travail à une prochaine version du moteur. Le jeu n'en dépend jamais, et il n'est ni construit ni testé par la CI.

**Fidélité avant tout.** Le TS reste la référence. Une modification de `src/game/engine*.ts`, `bitboard.ts`, des règles ou du livre se reporte ici dans le même changement, puis on régénère les données de référence : `go test` doit repasser. Une optimisation du Go n'a pas besoin de duel tant que ces tests restent verts — même nombre de nœuds au nœud près.

## Correspondance

| TS | Go |
| --- | --- |
| `types.ts`, `pieces.ts`, `transforms.ts`, `placement.ts`, `legalMoves.ts`, `connectivity.ts`, pose du reducer | `rules/` |
| `moveNotation.ts` | `notation/` |
| `bitboard.ts` | `bitboard/` |
| `engineBoard.ts` | `board/` |
| `engineSearch.ts` (évaluation, recherche) | `search/` (`Evaluator`, `Searcher`) |
| `openingBook.ts`, `openingBook.data.ts` | `book/` (`book.json` embarqué) |
| `chooseMoveForDifficulty(…, 'master', …)` | `master/` |
| mulberry32 de `scripts/duel-appariee.ts` | `rng/` |

Les tampons de module du TS deviennent des champs : un `Searcher` (table de 2¹⁸ entrées, tueurs, historique) par fil, jamais partagé. `Options` reprend `MasterSearchOptions`, le zéro de chaque champ valant le défaut ; `SkipOddDepth` est l'inverse d'`allowOddDepth`. Les poids sont entiers : `Criteria.Reserve` doit être pair. Quelques écritures diffèrent du TS sans changer une valeur : dilatation insérée dans les boucles de `bitboard`, `capBalance` par plateaux de bits, plus grande zone arrêtée dès que le reste ne peut plus la dépasser.

## Binaire

`go build -o bin/linkx-maitre ./cmd/linkx-maitre` (depuis `engine-go/`). Processus longue durée, une requête JSON par ligne sur l'entrée, une réponse par ligne, vidée aussitôt :

```text
{"record": "4Lsr21 4Ss3", "budgetMs": 2500, "maxNodes": 0, "seed": 123, "book": true}
{"move": "4Lsr32", "depth": 6, "nodes": 1305375, "score": 662, "exact": false, "fromBook": false, "elapsedMs": 2240}
```

`maxNodes` positif borne aux nœuds sans lire l'horloge ; sinon `budgetMs`, 2 500 ms par défaut. `seed` absent, le premier ex æquo l'emporte. Le rejeu applique les passes forcées : le joueur au trait d'une partie en cours a toujours un coup (`--` ne sort donc jamais en pratique) ; une partie finie ou une notation refusée rend `{"error": "…"}`.

## Régénérer et tester

- Livre : `go generate ./book` (lance `scripts/livre-go.ts`).
- Données de référence : `node node_modules/vite-node/dist/cli.mjs scripts/empreinte-go.ts` (une minute) écrit `conformance/testdata/empreinte.json`.
- `go vet ./... && go test ./...` : 623 positions de 31 parties (coups légaux dans l'ordre, hachages Zobrist, zones, verdicts, notation), 3 × 9 305 évaluations (critères du maître, tous les critères, autres poids), 106 recherches à plafond de nœuds (coups ex æquo, variante, score, profondeur, exactitude, **nœuds**, tirage graine), 474 lectures du livre, l'entrée du maître.

## Débit mesuré

`scripts/bench-go.ts` et `go test ./conformance -run '^$' -bench ReferenceGame -benchtime 3x [-args -nodes N -budget MS]` cherchent les 24 positions en cours de la partie de référence. À 200 000 nœuds, mêmes 1 424 984 nœuds : environ 130 000 nœuds/s en TS, 360 000 à 400 000 en Go. Au budget de 2 500 ms, le Go gagne un palier sur 9 positions sur 24 (5 → 6 en ouverture, 9 → 10 au treizième demi-coup).

## Force

`scripts/duel-go.ts` oppose le binaire au maître TS avec le protocole de `duel-appariee.ts --comme-le-jeu` (statistique et ouvertures partagées dans `scripts/duel-commun.ts`) : les 50 premiers coups distincts de bleu, chacun joué deux fois couleurs échangées, livre puis recherche. Le binaire repartant d'une graine neuve à chaque requête, la suite graine par ouverture et par couleur tire **une graine par coup**, que chaque arme consomme comme l'entrée du maître.

- Témoin, à nœuds égaux : `scripts/duel-go.ts --nodes 50000 --temoin --jobs 3` rejoue chaque ouverture TS contre TS. **100 parties sur 100 identiques** coup pour coup, donc 50 % pile. Une divergence est un bug du portage ou du harnais.
- Au budget du jeu : `scripts/duel-go.ts --ms 2500 --jobs 3 --journal duel.jsonl` (six minutes : les parties font 17 poses, et une recherche rend la main vers 0,8 s faute de temps pour le palier suivant). Graine 1 : **58 victoires à 41**, une nulle, 58,5 % (Wilson [48,7 %, 67,7 %], apparié [51,7 %, 65,3 %]) ; ouvertures gagnées des deux couleurs **11 pour Go, 2 pour TS, p = 0,022**. Graine 2 : 54 à 46, 5 contre 1, p = 0,22, sans trancher. Profondeur moyenne 5,4 contre 5,0, environ 520 000 nœuds/s contre 173 000. Le Go est donc au moins aussi fort, et le gain d'un tiers de palier se voit en parties.
