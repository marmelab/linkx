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

Les tampons de module du TS deviennent des champs : un `Searcher` (table de 2¹⁸ entrées, tueurs, historique) par fil ; seule sa table se partage, avec ses propres aides de Lazy SMP. `Options` reprend `MasterSearchOptions`, le zéro de chaque champ valant le défaut ; `SkipOddDepth` est l'inverse d'`allowOddDepth`. Les poids sont entiers : `Criteria.Reserve` doit être pair. Quelques écritures diffèrent du TS sans changer une valeur : dilatation insérée dans les boucles de `bitboard`, `capBalance` par plateaux de bits, plus grande zone arrêtée dès que le reste ne peut plus la dépasser.

## Binaire

`go build -o bin/linkx-maitre ./cmd/linkx-maitre` (depuis `engine-go/`). Processus longue durée, une requête JSON par ligne sur l'entrée, une réponse par ligne, vidée aussitôt :

```text
{"record": "4Lsr21 4Ss3", "budgetMs": 2500, "maxNodes": 0, "seed": 123, "book": true, "threads": 4}
{"move": "4Lsr32", "depth": 6, "nodes": 740096, "totalNodes": 3021569, "score": 662, "exact": false, "fromBook": false, "elapsedMs": 1075}
```

`maxNodes` positif borne aux nœuds sans lire l'horloge ; sinon `budgetMs`, 2 500 ms par défaut. `seed` absent, le premier ex æquo l'emporte. `threads` (défaut : le drapeau `-threads` du binaire, 1 sinon) cherche à plusieurs fils, au temps seulement. `nodes` compte les nœuds du fil principal jusqu'au palier retenu, `totalNodes` tout ce que les fils ont cherché, palier abandonné compris. Le rejeu applique les passes forcées : le joueur au trait d'une partie en cours a toujours un coup (`--` ne sort donc jamais en pratique) ; une partie finie ou une notation refusée rend `{"error": "…"}`.

## Régénérer et tester

- Livre : `go generate ./book` (lance `scripts/livre-go.ts`).
- Données de référence : `node node_modules/vite-node/dist/cli.mjs scripts/empreinte-go.ts` (une minute) écrit `conformance/testdata/empreinte.json`.
- `go vet ./... && go test ./...` : 623 positions de 31 parties (coups légaux dans l'ordre, hachages Zobrist, zones, verdicts, notation), 3 × 9 305 évaluations (critères du maître, tous les critères, autres poids), 106 recherches à plafond de nœuds (coups ex æquo, variante, score, profondeur, exactitude, **nœuds**, tirage graine), 474 lectures du livre, l'entrée du maître.

## Débit mesuré

`scripts/bench-go.ts` et `go test ./conformance -run '^$' -bench ReferenceGame -benchtime 3x [-args -nodes N | -budget MS | -depth D] [-threads N]` cherchent les 24 positions en cours de la partie de référence. `nodes/s` n'y compte que les paliers retenus du fil principal, `all-nodes/s` tout le travail de tous les fils. À 200 000 nœuds, mêmes 1 424 984 nœuds : environ 130 000 nœuds/s en TS, 360 000 à 400 000 en Go. Au budget de 2 500 ms, le Go gagne un palier sur 9 positions sur 24 (5 → 6 en ouverture, 9 → 10 au treizième demi-coup).

## Force

`scripts/duel-go.ts` oppose le binaire au maître TS avec le protocole de `duel-appariee.ts --comme-le-jeu` (statistique et ouvertures partagées dans `scripts/duel-commun.ts`) : les 50 premiers coups distincts de bleu, chacun joué deux fois couleurs échangées, livre puis recherche. Le binaire repartant d'une graine neuve à chaque requête, la suite graine par ouverture et par couleur tire **une graine par coup**, que chaque arme consomme comme l'entrée du maître.

- Témoin, à nœuds égaux : `scripts/duel-go.ts --nodes 50000 --temoin --jobs 3` rejoue chaque ouverture TS contre TS. **100 parties sur 100 identiques** coup pour coup, donc 50 % pile. Une divergence est un bug du portage ou du harnais.
- Au budget du jeu : `scripts/duel-go.ts --ms 2500 --jobs 3 --journal duel.jsonl` (six minutes : les parties font 17 poses, et une recherche rend la main vers 0,8 s faute de temps pour le palier suivant). Graine 1 : **58 victoires à 41**, une nulle, 58,5 % (Wilson [48,7 %, 67,7 %], apparié [51,7 %, 65,3 %]) ; ouvertures gagnées des deux couleurs **11 pour Go, 2 pour TS, p = 0,022**. Graine 2 : 54 à 46, 5 contre 1, p = 0,22, sans trancher. Profondeur moyenne 5,4 contre 5,0, environ 520 000 nœuds/s contre 173 000. Le Go est donc au moins aussi fort, et le gain d'un tiers de palier se voit en parties.

## Lazy SMP

`Options.Threads` (défaut 1) ajoute `Threads − 1` aides au fil principal (`search/smp.go`). Tous cherchent la même racine dans **une table partagée sans verrou** (`search/table.go`) : une entrée tient en deux mots atomiques de 64 bits, la donnée et la clé mêlée à la donnée par XOR ; une lecture qui croise deux écritures ne retrouve pas sa clé et passe pour un défaut. Chaque aide a ses tueurs, son historique, ses tampons et sa variante, mène son propre approfondissement itératif, un sur deux partant d'un palier plus haut, et ne rend rien : **le fil principal décide seul** du coup, de l'exactitude, du tirage parmi ses ex æquo et de l'arrêt, puis lève un drapeau que les aides lisent toutes les 2 048 positions — ils ne lisent jamais l'horloge — et les attend. Le livre passe avant, comme sans fils. Mêler l'ordre des coups racine chez les aides a été essayé : 8,4 à 8,8 s pour atteindre la profondeur 6 sur la partie de référence, contre 6,1 à 7,4 s sans, donc retiré.

- **Mono-fil inchangé.** À `Threads = 1`, seule l'écriture de la table change (atomique, même contenu, même remplacement) : `empreinte.json` repasse sans régénération, au nœud près. Débit entrelacé avant/après, cinq passes à 200 000 nœuds : 3 894 contre 3 905 ms par passe, sous le bruit (± 4 %).
- **Borné aux nœuds, toujours mono-fil** : `Threads` y est ignoré. Le partage de table rend la recherche dépendante de l'ordonnancement, donc irreproductible, et le conseil comme les données de référence exigent la même réponse à chaque appel. `TestLazySMPIgnoredWhenNodeBounded` le vérifie ; `go test -race ./...` couvre la table partagée.
- **`IterationGrowth` est gardé à 4.** Mesuré sur la partie de référence (fil principal, paliers de plus de 5 ms), le rapport d'un palier au précédent vaut en moyenne géométrique 3,2 à 3,35 à quatre fils, contre 3,5 à 3,8 à un : les aides préparent le palier suivant. Mais à 3, le budget de 2 500 ms n'atteint aucun palier de plus et dépense plus de temps.
- **Efficacité**, quatre fils contre un, sur 4 cœurs : 2,5 à 2,8 millions de nœuds/s au total contre 0,7 million ; temps pour atteindre une profondeur fixée divisé par 1,9 (profondeur 5 : 3,2 → 1,7 s ; 6 : 13,3 → 6,9 s ; 7 : 78 → 38 s). La moitié du travail des aides est donc redondante. À 2 500 ms, profondeur moyenne 7,06 → 7,44 sur les 18 positions non triviales de la référence.
- **Force : pas de gain établi**, donc 1 par défaut. `scripts/duel-go.ts --a go:threads=4 --b go:threads=1 --ms 2500 --jobs 1` (vingt minutes ; `--jobs 1` impératif, sinon les processus se disputent les cœurs). Graine 1 : 54 victoires à 44, 2 nulles, 55,0 % (apparié [49,8 %, 60,2 %]), ouvertures gagnées des deux couleurs 6 contre 1, p = 0,125. Graine 2 : 52 à 47, 52,5 % ([48,0 %, 57,0 %]), 4 contre 1, p = 0,375. Profondeur moyenne 5,89 contre 5,66 en partie, soit 0,23 palier, quand le Go en gagne 0,4 sur le TS. Les deux graines réunies font 10 contre 2 (p ≈ 0,04), mais elles rejouent les mêmes ouvertures : c'est une piste, pas une preuve. À 6 000 ms (`--ms 6000`, quarante-deux minutes) : 51 à 49, sans nulle, 2 contre 1, p = 1 ; 47 paires sur 50 se partagent un point, la couleur décidant de presque tout. Profondeur 6,04 contre 5,86, mais chaque recherche rend la main vers 1,7 s : les deux armes laissent plus des deux tiers du budget, faute de temps pour le palier suivant, si bien qu'un budget plus long ne profite guère aux fils.
- Témoin : `scripts/duel-go.ts --nodes 50000 --a go:threads=1 --b go:threads=1 --temoin --jobs 3` rend 100 parties sur 100 identiques, 50 % pile ; avec `--a go:threads=4`, de même, puisque les fils sont ignorés aux nœuds.
- Refaire les mesures : `go test ./conformance -run '^$' -bench ReferenceGame -benchtime 1x -args -depth 6 -threads 4` (temps pour une profondeur), `-budget 2500 -threads 4` (profondeur à temps égal).
