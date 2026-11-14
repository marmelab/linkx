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
