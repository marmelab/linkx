---
paths:
  - "engine-mcts/**"
---

# MCTS hybride

`engine-mcts/` est une seconde IA, un MCTS, distincte du maître. Module Go autonome (`github.com/marmelab/linkx/engine-mcts`, go 1.24, aucune dépendance externe), qui importe `engine-go` par `replace => ../engine-go` dans son `go.mod`. Un `go.work` à la racine aurait aussi placé `engine-go` dans l'espace de travail quand on le teste depuis son dossier ; le `replace` laisse `engine-go` intact et rend `engine-mcts` reproductible depuis son seul dossier. Plateau (`board`), règles, évaluation (`search.Evaluator`), notation, livre, mulberry32 et alpha-bêta (`search.Searcher`) viennent d'`engine-go`, qui n'a pas été modifié : le MCTS ne redéfinit aucune règle. Ni le jeu ni la CI n'en dépendent.

```text
mcts/tactics.go     cases et voisinage de chaque coup, victoire immédiate par zones de bord, issue d'une pose
mcts/tree.go        arène, développement, prior, PUCT, MCTS-Solver, itération
mcts/mcts.go        Player.Choose : livre, alpha-bêta à la racine, fils, choix final
mcts/params.go      Params et DefaultParams
cmd/linkx-mcts      le binaire
cmd/calibrer-k      ajustement de K sur des journaux de duel
```

## Recherche

- **Sélection PUCT**, `Q + c·P·√N/(1+n)` ; un coup jamais visité prend la valeur moyenne du nœud moins `fpu` (0).
- **Valeur d'une feuille** : `sigmoïde(éval/K)`, l'évaluation du maître étant du point de vue du joueur au trait, **TEMPO compris**. Les résultats remontent en probabilité de gain de bleu, que chaque arc lit du point de vue de son joueur : une passe forcée ne demande aucun cas particulier. Nulle : ½.
- **K = 1 900**, ajusté et non choisi. Le dépôt ne garde pas d'échelle de l'ajustement Texel du maître ; `cmd/calibrer-k` la refait sur les issues de 506 parties de duels Go/TS à 2,5 s et 6 s (8 307 positions, un tiers des **parties** tenu à part). Entropie croisée de test 0,596, contre 0,693 sans modèle ; un décalage libre ne vaut que −146 points, et retirer TEMPO dégrade à 0,621 (K = 2 550). TEMPO est donc bien l'avantage du trait, et il reste dans la valeur.
- **Prior**, calculé une fois au développement : logit = `size`·cases posées + `own`·voisines à soi + `other`·voisines à l'adversaire (1 ; 0,3 ; 0,3), softmax à `temperature` 1. Les cases et le voisinage à huit de chacun des 16 384 coups empaquetés sont précalculés.
- **Élargissement progressif** : arcs triés par prior, seuls les `ceil(a·(N+1)^b)` premiers non perdants sont candidats (`a` = 2, `b` = 0,4).
- **Garde tactique** au développement. Victoire immédiate : un coup gagne s'il touche un bord ou borde une zone qui le touche, des deux côtés opposés — même verdict que `MovePlacedWins` (test sur 45 000 coups), sans poser. Si l'adversaire menace de gagner en un coup, chaque coup qui lui en laisse un est prouvé perdant.
- **MCTS-Solver** : issue prouvée par arc et par nœud ; un nœud est gagné dès qu'un arc gagne, perdu ou nul quand tous ses arcs sont prouvés ; un arc prouvé n'est plus descendu.
- **Alpha-bêta d'`engine-go`** : à la racine d'abord, `rootSolveNodes` = 20 000 nœuds ; s'il rend une valeur exacte, son coup est joué (13 positions sur 30 tirées des parties du duel : l'issue y est souvent déjà décidée). Dans l'arbre, à `solvePlies` = 4 demi-coups restants ou moins (3 000 nœuds au plus avec `solveNodes`), ou à `solveVisits` visites (désactivé). Une valeur exacte non décisive n'est retenue comme nulle qu'à 0 : une passe peut faire évaluer une feuille avant la fin.
- **Choix** : un coup prouvé gagnant, sinon le plus visité parmi les non perdants ; ex æquo tirés par la graine. Livre au premier coup, comme le maître.
- **Budget** : `budgetMs` moins `marginMs` (50), horloge lue toutes les 32 itérations ; ou `maxIterations`, sans horloge, réparties entre les fils.
- **Parallélisme à la racine** : un arbre par fil, graine dérivée, logits des fils d'aide bruités de ±`noise` (0,5) pour que les arbres diffèrent ; visites additionnées par coup. Reproductible à `maxIterations` et graine fixées.
- **Mémoire** : nœuds en tranche, arcs en blocs fixes de 65 536 réutilisés d'une requête à l'autre, indices `int32`. Les blocs ne recopient jamais : une tranche qui doublait recopiait des centaines de Mo pendant le budget et dépassait l'échéance de 230 ms. Environ 290 Mo par fil à 2,5 s.

## Protocole

`go build -o bin/linkx-mcts ./cmd/linkx-mcts`, même protocole que `linkx-maitre` (`moteur-go.md`) :

```text
{"record": "4Lsr21 4Ss3", "budgetMs": 2500, "maxIterations": 0, "seed": 1, "book": true, "threads": 1, "params": {"c": 3}}
{"move": "4Lsr32", "iterations": 97248, "visits": 92674, "value": 0.576, "proven": "aucun", "fromBook": false, "fromSolver": false, "nodes": 97248, "solves": 0, "elapsedMs": 2451}
```

`params` remplace champ par champ `DefaultParams`, avec les clés JSON de `Params` (`c`, `k`, `temperature`, `a`, `b`, `size`, `own`, `other`, `fpu`, `rootSolveNodes`, `solvePlies`, `solveVisits`, `solveNodes`, `noise`, `marginMs`, `checkEvery`) ; une clé inconnue est une erreur. `value` est la probabilité de gain du joueur au trait, `proven` vaut `gain`, `perte`, `nulle` ou `aucun`. `maxNodes` est ignoré.

## Mesures

`scripts/duel-go.ts` accepte l'arme `mcts`, `mcts:threads=N` et `mcts:c=3,b=0.6,…`, et `--iterations N` pour borner le MCTS sans horloge.

- **Témoin** : `--iterations 2000 --a mcts --b mcts --temoin --jobs 3` rend 100 parties sur 100 identiques, 50 % pile.
- **Réglage** contre le maître Go, 500 ms, 50 ouvertures × 2, un paramètre à la fois : base `c` = 1,5 : 45 % ; `c` = 3 : 54 % (ouvertures 8 contre 4) ; `c` = 5 : 46 % ; `c` = 3, `b` = 0,6 sur la base : 51 % ; `c` = 3, `temperature` = 2 : 50 %. Tous dans le bruit (intervalles de ± 6 points) ; `c` = 3 est retenu comme meilleur observé, le reste n'a pas bougé.
- **Duel principal**, `--ms 2500 --a mcts --b go --jobs 3`, mono-fil des deux côtés. Graine 1 : **50 victoires à 50**, ouvertures gagnées des deux couleurs **5 contre 5**, p = 1, apparié [43,7 %, 56,3 %]. Graine 2 : **50 à 50**, **7 contre 7**, [42,6 %, 57,4 %]. **Force égale au maître**, sans plus. La couleur décide 36 à 40 ouvertures sur 50.
- **Temps** : hors positions prouvées, le MCTS rend la main à 2 450 ms (98 % du budget, ~170 000 itérations, 40 000 à 70 000 par seconde selon la largeur) ; le maître, à ~0,8 s. En moyenne de partie, 44 % contre 31 % : sur 30 positions tirées des parties, 20 sont prouvées, 13 par l'alpha-bêta de la racine, et tranchées en quelques millisecondes. Quatre fils : 3,4 fois plus d'itérations ; force non mesurée.
- **Vérification tactique dans l'arbre** (`solveVisits=4096,solveNodes=20000`) : 50,5 % au duel principal, graine 1 ; non retenue.

## Où les parties se perdent

Dans les paires décisives des deux graines, un alpha-bêta à 400 000 nœuds montre le même profil pour les deux moteurs : la partie bascule aux demi-coups 7 à 14, sur un coup après lequel la perte est **prouvable** à cette profondeur, mais ni à 20 000 nœuds ni dans l'arbre. C'est un horizon tactique de quatre à huit demi-coups, pas une valeur mal calibrée ni une largeur trop étroite : le MCTS y voit aussi mal que le maître, avec trois fois plus de temps consommé.

## Pistes

- Une **tactique plus profonde à bas coût** est le levier : menaces doubles et coups forcés détectés dans le prior ou à l'expansion (zones de bord de l'adversaire, coups qui créent deux victoires immédiates), plutôt qu'un alpha-bêta générique, dont le coût mange les itérations.
- **Prior appris** : ajuster les poids du prior (ou un petit modèle linéaire sur les termes de `evaluationTerms`) sur les coups des duels, comme Texel pour l'évaluation.
- Mesurer `threads` = 4 (`--jobs 1`) ; l'arbre partagé à perte virtuelle n'est pas fait.
- Duels plus puissants : des ouvertures moins décidées par la couleur, faute de quoi 40 ouvertures sur 50 ne départagent rien.

## Refaire

```bash
cd engine-mcts && go vet ./... && go test ./... && go test -race -run 'Parallel|Deterministic|SelfPlay' ./mcts && go test -race ./cmd/...
go run ./cmd/calibrer-k duel-a.jsonl duel-b.jsonl
node node_modules/vite-node/dist/cli.mjs scripts/duel-go.ts --iterations 2000 --a mcts --b mcts --temoin --jobs 3
node node_modules/vite-node/dist/cli.mjs scripts/duel-go.ts --ms 500 --a mcts:c=3 --b go --jobs 3
node node_modules/vite-node/dist/cli.mjs scripts/duel-go.ts --ms 2500 --a mcts --b go --jobs 3 --journal duel.jsonl [--graine 2]
```
