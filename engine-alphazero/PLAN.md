# Plan — une IA façon AlphaZero pour Linkx

Plan d'exécution, sans code, pour des agents qui n'auront que lui, le dépôt et les règles citées. **Hypothèse** marque ce qui n'a pas pu être vérifié dans le dépôt : à confirmer avant l'étape concernée. À lire d'abord : `README.md`, `plan.md` (« Règles du jeu », « Notation d'une partie »), `.claude/rules/moteur.md`, `.claude/rules/moteur-go.md`, `docs/protocole-ia.md`.

## Fondations

- `engine-go/` (go 1.24, sans dépendance), portage du maître au nœud près, sert de bibliothèque **sans jamais être modifié** :
  - `rules` (`Position`, `Game.Play`, `UniqueOrientations`) ;
  - `board` (`Load`, `GenerateMoves`, `Apply`/`Undo`, `FlipSide`, `HasAnyMove`, `MovePlacedWins`, `LargestZone`, `RemainingPlies`, `HashA`/`HashB`, `ToLegalMove`) ;
  - `notation` (`Parse`, `ParseMove`, `SerializeLegalMove`) ;
  - `search.Searcher.TopMoves` (ex æquo, `Exact`, `PV`, `MaxNodes` reproductible) ;
  - `master` et `rng`.
- `engine-mcts/`, écrit en parallèle par un autre agent : PUCT, feuilles à sigmoïde(évaluation / K), prior bon marché, élargissement progressif, MCTS-Solver avec fin exacte par `engine-go`, parallélisme racine, binaire `linkx-mcts` au protocole de `linkx-maitre`. **Hypothèse** : ses noms d'API sont inconnus à ce jour.
- `scripts/duel-go.ts` est le juge : 50 ouvertures × 2 couleurs, une graine par coup ; Wilson, pentanomial et test des signes viennent de `scripts/duel-commun.ts`.

## 1. Objectif et critère de succès

**Objectif.** Un binaire `linkx-az`, au protocole de `linkx-maitre`. Un réseau politique + valeur y guide un MCTS PUCT. Le réseau est pré-entraîné sur le maître, puis amélioré par auto-jeu.

**Juge.** `scripts/duel-go.ts` :
- contre `go` (minimax Go, livre compris) et contre `linkx-mcts` ;
- à 2 500 ms, puis à 6 000 ms ;
- sur CPU, même machine, un fil par moteur, `--jobs 1`.

Un résultat obtenu par inférence GPU se publie à part et ne compte pas pour le succès : le jeu et le tournoi (moins de 2 s de processeur) sont des cibles CPU.

**Succès** — à 2 500 ms, contre chacun des deux adversaires :
- au moins 55 %, avec un test des signes p < 0,05 sur les 50 ouvertures ;
- le même sens à la graine 2 ;
- p < 0,05 sur un second jeu d'ouvertures (`--ouvertures`, débuts de deux demi-coups tirés de `choisir-ouvertures.ts`), car les deux graines rejouent les mêmes ouvertures ;
- à 6 000 ms, au moins 50 %.

**Partiel**, gardé et documenté : battre `linkx-mcts` sans battre `go`, ou ne gagner qu'avec le GPU.

**Arrêt** :
- après C, le réseau avec PUCT fait moins de 25 % contre `go` à 2 500 ms ;
- après 30 générations ou 150 h-GPU, aucune génération ne dépasse 40 % contre `go` ;
- le plus petit réseau utilisable donne moins de 1 000 simulations en 2 500 ms sur un cœur.

## 2. Faits du jeu qui dimensionnent le réseau

Vérifiés dans `engine-go/` et `plan.md`.

- **Plateau.** 9 × 9, ligne 8 au fond. Une colonne n'a jamais de trou (support intégral) ; `Position.Top[x]` donne sa hauteur.
- **Réserve et durée.** 7 formes × 2 exemplaires par joueur, donc 28 demi-coups au plus. Les parties de duel font environ 17 poses.
- **Mesure ponctuelle, non versionnée** (20 000 parties aléatoires) : 19,6 demi-coups, 0,14 passe par partie, 31 % de blocages, 1,6 % de nulles, 38 coups légaux en moyenne.
- **Coups.** 25 orientations distinctes (1 + 2 + 2 + 4 + 4 + 4 + 8). Avec les ancres possibles (`10 − largeur`), cela fait **194 couples orientation × colonne**. Jusqu'à **95 coups légaux**, sur la grille vide.
- **Fin de partie.** Victoire immédiate par une zone (voisinage à huit, couleur seule) reliant gauche–droite ou haut–bas, pour l'un comme pour l'autre : aucune règle ne dépend de la couleur. Passes forcées. Au blocage, la plus grande zone l'emporte ; à égalité, nulle.
- **Symétrie.** Seulement le miroir gauche-droite (`canonicalPosition`, `book.CanonicalKey`). Jamais de rotation ni de miroir haut-bas.
- Les parties se décident aux demi-coups 8 à 14, où le maître résout souvent la fin exactement.

## 3. Encodage

Source unique : le paquet Go `encode/`. Python ne lit que des tenseurs déjà encodés.

**Entrée v1** — 24 plans de 9 × 9, du point de vue du joueur au trait. La couleur n'est pas encodée, puisque les règles en sont indépendantes.

| Plans | Contenu |
| --- | --- |
| 0–2 | mes cases, ses cases, vides |
| 3 | cases d'arrivée `(x, Top[x] − 1)` |
| 4 | hauteur `(9 − Top[x]) / 9` sur toute la colonne |
| 5–11, 12–18 | réserves par forme, `exemplaires / 2`, plans constants (moi, lui) |
| 19, 20 | cases couvertes par un coup légal (moi ; lui via `FlipSide`) |
| 21, 22 | cases d'un coup gagnant immédiat (moi, lui) |
| 23 | constante 1 (bord visible au rembourrage) |

Les réserves portent la parité et les passes passées.

**Variante v2**, en ablation : `hangingWall` et les cases hors d'atteinte des réserves. Ces masques sont privés dans `engine-go/search`. Les réécrire dans `encode/` est permis — c'est une caractéristique, pas une règle — et ils se testent sur des cas construits.

**Politique** — 225 logits, `p = 9·o + c` :
- `c` est la colonne d'ancrage, de 0 à 8 ;
- `o = offset[forme] + i`, avec `offset = [0, 1, 3, 5, 9, 13, 17]` et `i` le rang dans `rules.UniqueOrientations`, qui est l'ordre de la notation canonique ;
- 31 indices (`c > 9 − largeur`) ne sont jamais légaux ;
- un masque issu de `GenerateMoves` met les illégaux à −∞.

Les accesseurs de `board.Move` sont privés : on relit les bits documentés (`m & 7` orientation, `m>>3 & 7` forme, `m>>6 & 15` colonne). La ligne d'arrivée se recalcule, comme dans le reducer.

**Miroir.**
- Cases : `x → 8 − x`. Ancres : `c → 9 − c − largeur(o)`.
- Orientations globales, table calculée et vérifiée : 0–4, 13 et 15 fixes ; 5↔6, 7↔8, 9↔11, 10↔12, 14↔16, 17↔21, 18↔24, 19↔23, 20↔22.
- La permutation des 225 indices est écrite dans le manifeste des données, pour l'augmentation côté Python.

**Valeur.** Trois logits : gain, nulle, perte. Le PUCT emploie `v = P(gain) − P(perte)`. Les nulles, rares, ne se confondent pas avec l'équilibre.

**Passe forcée.** Jamais une sortie du réseau, qui n'est jamais interrogé pour un joueur sans coup. Après une pose, dans l'ordre :
1. victoire (`MovePlacedWins`) : nœud terminal ;
2. l'adversaire a un coup : nœud ordinaire ;
3. le poseur a un coup : `FlipSide`, et le nœud suivant est **du même joueur** ;
4. sinon : blocage, jugé par `LargestZone`.

La rétropropagation suit le joueur de chaque nœud, jamais une alternance de signes.

## 4. Architecture du réseau

Le tronc :
- une convolution d'entrée 3 × 3 ;
- `B` blocs résiduels, chacun de deux convolutions 3 × 3 suivies d'une normalisation par lot et d'une ReLU ;
- les normalisations par lot sont fusionnées à l'export.

Les têtes :
- **politique** : convolution 1 × 1 vers 8 plans, puis une couche linéaire 648 → 225 ;
- **valeur** : convolution 1 × 1 vers 4 plans, puis 324 → 64 (ReLU) → 3.

| Variante | B × F | Paramètres | MFLOP / éval. | Go pur, 1 cœur (estimation) |
| --- | --- | --- | --- | --- |
| S | 4 × 32 | ≈ 0,25 M | ≈ 13 | 300–600 éval./s |
| **M (départ)** | 6 × 64 | ≈ 0,63 M, 2,5 Mo float32 | ≈ 75 | 60–100 éval./s |
| L | 10 × 96 | ≈ 1,9 M | ≈ 270 | 15–30 éval./s |

Estimations de coût, à remplacer par la mesure D :
- Go pur, im2col et SGEMM float32 sans SIMD : 3 à 8 GFLOP/s par cœur ;
- oneDNN ou ONNX Runtime sur CPU : 5 à 10 fois plus ;
- GPU de milieu de gamme, par lots de 256 : 20 000 à 50 000 évaluations/s en M, limité par les échanges.

Pour comparer, le maître Go cherche environ 400 000 nœuds/s : **c'est le risque principal**.

Variantes à mesurer une à une :
- regroupement global dans les blocs (KataGo) ;
- tête auxiliaire de l'écart de zone au blocage ;
- encodage v2.

## 5. Pipeline

Dépendances : B et D1 suivent A ; C suit B ; E suit D1 ; F suit C, D et E ; G suit E.

### A — encodeur et décodeur Go

Paquets `encode/` et `dataset/`.

- [ ] `go.mod` : `github.com/marmelab/linkx/engine-alphazero`, go 1.24, `replace` vers `../engine-go` (et `../engine-mcts` en E), aucune autre dépendance.
- [ ] Fonctions `Planes`, `PolicyIndex`, `MoveAt`, `LegalMask`, `Mirror`.
- [ ] Fragments de données :
  - un en-tête JSON : signature, `encoderVersion`, échelles des plans, permutation miroir, source, commit ;
  - des enregistrements fixes : plans `uint8[24·81]`, masque sur 32 octets, politique `float16[225]`, WDL `float16[3]`, drapeaux (exacte, source, demi-coup) ;
  - environ 2,5 Go par million de positions.
- [ ] Tests :
  - sur les 623 positions de `engine-go/conformance/testdata` et 10 000 positions aléatoires graines, `PolicyIndex` concorde avec `board.ToLegalMove` ;
  - `ParseMove(SerializeLegalMove(m))` retombe sur le même indice ;
  - le masque compte autant de coups que `GenerateMoves` (95 sur la grille vide), et 194 indices sont atteignables ;
  - le miroir est une involution qui préserve la légalité ;
  - les plans 21–22 concordent avec `MovePlacedWins` ;
  - un fragment écrit puis relu est identique.
- Coût : moins d'une journée d'agent.

### B — données supervisées

Commandes `cmd/az-donnees` et `cmd/az-etiqueter`.

- [ ] `az-donnees` — auto-jeu du maître, parfaitement parallèle, un `Searcher` par goroutine :
  - ouvertures de 2 à 4 demi-coups aléatoires, sans livre. C'est bon pour la diversité, jamais pour mesurer (`moteur.md`, « Mesurer ») ;
  - `MaxNodes` à 300 000 (environ 0,75 s), ex æquo tirés par graine ;
  - politique cible uniforme sur `TopMoves().Moves` ;
  - valeur cible : le résultat, ou la valeur exacte si `Exact` (> `MateThreshold` gain, < −`MateThreshold` perte, 0 nulle).
- [ ] `az-etiqueter` — les ≈ 75 000 positions de valeur exacte de l'ajustement Texel, en fragments. Politique uniforme sur les coups qui gardent la meilleure valeur ; les coups `?` restent légaux mais hors de la cible.
  - **Hypothèse** : ni ces données ni leur générateur ne sont dans le dépôt (`.gitignore` : elles nomment les IA). On suppose le format JSONL de `banc-positions.ts` (`notation`, `demiCoup`, `valeur`, `coups[].cases`, `coups[].v`). Les demander au mainteneur.
  - À défaut, les reconstruire depuis l'export CSV de `parties` (`parties-tournoi.ts`, `loadGames`), par `TopMoves` sans plafond là où `RemainingPlies` le permet.
- [ ] Partition par partie, sans fuite :
  - clé : hachage des quatre premiers demi-coups ;
  - le tiers tenu à part forme le **banc de test** et n'est jamais appris ;
  - retirer de l'apprentissage tout ce que contient le `banc.jsonl` existant.
- [ ] Tests : même graine, mêmes octets ; aucune fuite vers le banc de test.
- Coût estimé : environ 13 s par partie et par cœur. 500 000 positions demandent environ 26 h sur les 4 cœurs actuels, 3 h sur 32.

### C — pré-entraînement supervisé (Python)

Dossier `python/`.

- [ ] Environnement : projet `uv`, `pyproject.toml` à versions exactes (`torch==…`, `numpy==…`, `pytest==…`), `uv.lock` versionné, Python 3.13, index CPU de PyTorch sans GPU.
- [ ] `data.py` : `numpy.memmap` et miroir aléatoire (p = 0,5) par la permutation du manifeste.
- [ ] `model.py` : variantes S, M et L.
- [ ] `train.py` :
  - entropie croisée de la politique masquée, plus WDL, plus L2 1e-4 ;
  - SGD avec moment 0,9, taux en cosinus, lots de 1 024 ;
  - graines fixées, algorithmes déterministes sur CPU ;
  - journal JSONL hors du dépôt.
- [ ] `export.py` : écrit les poids `.azw`.
  - En-tête : version, `encoderVersion`, architecture, SHA-256.
  - Corps : float32 petit-boutiste, normalisations fusionnées.
  - En plus : 1 000 positions avec leurs sorties PyTorch, pour la parité.
- [ ] Évaluation, dans l'ordre :
  1. sur le jeu tenu à part : accord top-1 avec le maître, perte de valeur, Brier et calibration sur les positions exactes ;
  2. puis `az-banc` (E) : taux de bons coups de la politique seule, apparié (McNemar exact) au maître Go à 312 000 nœuds.
- [ ] `pytest` : formes, masque, export relu identique.
- Coût estimé, pour 1 M de positions et 10 époques : M demande environ 12 h sur 4 cœurs ou moins de 30 min sur GPU ; S environ 2 h sur CPU.

### D — inférence côté Go

**D1 — Go pur** (`nn/`) : lecture `.azw`, im2col + SGEMM float32 maison, évaluation par lots. Sans dépendance, déterministe, embarqué dans `linkx-az`. Il est lent.

**D2 — serveur** (`python/linkx_az/serve.py`, client `nn/remote.go`) :
- stdin/stdout ou socket Unix, trames binaires préfixées par leur longueur : à l'aller `n × 24 × 81` octets, au retour `n × 228` float32 ;
- les requêtes de toutes les parties en cours sont regroupées par 256 ou toutes les 2 ms.

**gRPC est écarté** : deux dépendances pour un module qui n'en a aucune, sans gain sur un tube local.

**Recommandation : les deux, à rôles distincts.**
- D2 pour l'auto-jeu sur GPU.
- D1 pour les duels officiels, la porte, les tests et tout usage hors ligne.
- Si D1 reste sous 1 000 simulations en 2,5 s, essayer d'abord un noyau AVX2 en assembleur Go, toujours sans dépendance. En dernier recours, et mesuré, ONNX Runtime par cgo.

- [ ] Parité : D1 et D2 rendent les sorties PyTorch des 1 000 positions à 1e-4 près.
- [ ] Micro-mesure : évaluations/s par variante, par lot (1, 8, 32) et par fil, consignées avec la machine. C'est le **point de décision D-1** : la taille du réseau.
- [ ] Cache d'évaluations à taille fixe, indexé par `HashA<<32 | HashB`. Les transpositions abondent : des poses en colonnes disjointes jouées dans l'autre ordre.

### E — MCTS PUCT guidé par le réseau

Paquet `puct/` ; commandes `cmd/linkx-az` et `cmd/az-banc`.

- [ ] Brancher le réseau sur `engine-mcts` par une interface d'oracle : un lot de positions en entrée, des priors sur les coups légaux et une valeur WDL en sortie.
  - Si ce point d'entrée manque, proposer à son responsable un crochet minimal, dans un changement séparé, prouvé neutre : mêmes coups nœud pour nœud en duel témoin.
  - Sinon, écrire `puct/` en reprenant la logique du MCTS-Solver.
- [ ] Sélection :
  - `Q + c(N)·P·√N_parent / (1 + N)`, avec `c(N) = 1,25 + ln((N + 19 653) / 19 652)` ;
  - un enfant non visité vaut `Q_parent − 0,2` ;
  - tous les coups légaux sont développés ; l'élargissement progressif reste désactivé par défaut et ne s'active que pour être mesuré.
- [ ] Garder le solveur et la fin exacte d'`engine-mcts` ; jouer d'office une victoire immédiate.
- [ ] Perte virtuelle (3) pour regrouper 8 à 32 feuilles par lot. Le parallélisme racine est déconseillé : il multiplie les évaluations.
- [ ] En auto-jeu : bruit de Dirichlet α = 0,25 (≈ 10 / 38) avec ε = 0,25 ; température 1 sur 6 demi-coups, puis 0. En duel : température 0, ex æquo départagés par la graine.
- [ ] `linkx-az` :
  - `maxNodes` signifie un nombre de simulations : un fil, reproductible ;
  - `book` est ignoré (c'est le livre du maître), et c'est documenté ;
  - réponse : `nodes` les simulations, `totalNodes` les évaluations, `depth` la profondeur de la variante principale, `score` Q × 1 000, `exact` vrai si le solveur prouve ;
  - drapeaux `-poids`, `-inference go|serveur` ;
  - marge de 5 % sur `budgetMs`.
- [ ] `az-banc` : taux de bons coups par demi-coup, Wilson, McNemar contre le maître Go.
- [ ] Tests :
  - une passe forcée dans un arbre construit rétropropage juste ;
  - une victoire en un coup est jouée ;
  - les positions exactes du banc sont résolues ;
  - à `maxNodes` égal, deux appels rendent le même coup ;
  - `go test -race ./...` passe.
- Coût : une à deux semaines d'agent, sans GPU.

### F — auto-jeu, réentraînement, porte

Commande `cmd/az-autojeu`, script `python/linkx_az/loop.py`.

- [ ] Départs :
  - grille vide, premier joueur tiré au sort ;
  - 10 % des parties partent de positions du tournoi d'apprentissage ;
  - pas d'abandon.
- [ ] Nombre de simulations tiré à la KataGo : 400 sur un coup sur quatre, et seuls ces coups servent de cible de politique ; 100 sinon.
- [ ] Adjudication exacte : la partie s'arrête dès que `TopMoves` à 200 000 nœuds rend `Exact`. Les positions restantes prennent la valeur exacte.
- [ ] Cibles : la politique est la distribution des visites ; la valeur est le résultat. Mélanger résultat et Q racine moitié-moitié est une variante à mesurer.
- [ ] Génération : 4 000 parties, soit environ 70 000 positions.
  - Fenêtre des 8 dernières générations.
  - Part des données supervisées : de 50 % à 10 % en 10 générations.
  - Environ 4 passages par position.
- [ ] Porte : candidat contre meilleur, 50 ouvertures × 2 couleurs, 200 simulations, un fil, D1. Promotion à 55 % ou plus. Échelle Elo Bradley-Terry.
- [ ] Jalon : toutes les 5 promotions, un duel G contre `go` à 2 500 ms.
- [ ] Arrêt : 3 portes échouées après une baisse du taux d'apprentissage.
- [ ] Chaque génération consigne ses graines, le commit, l'empreinte des poids et la configuration.
- Coût estimé, par génération :
  - M sur GPU, environ 13 M d'évaluations : 20 à 40 min avec 8 à 16 cœurs, soit 15 à 35 h-GPU pour 50 générations ;
  - S sur 4 cœurs, à 100 et 50 simulations : 1 à 2,5 h.

### G — duels

- [ ] Ajouter à `scripts/duel-go.ts` une arme générique `exe=CHEMIN[:threads=N]`, sauf si `engine-mcts` l'a déjà fait. Le témoin `--nodes 50000 --a go --b go --temoin` doit rester à 100 parties identiques sur 100.
- [ ] Témoin `linkx-az` contre lui-même à `--nodes` fixe : 100 sur 100.
- [ ] Grille : `az` contre `go` et contre `mcts`, à 2 500 et 6 000 ms, graines 1 et 2, plus le second jeu d'ouvertures ; `--jobs 1`, `--journal` hors du dépôt.
- [ ] Consigner chaque résultat : la commande, la machine, l'empreinte des poids, Wilson, le pentanomial et le test des signes.
- Coût estimé : environ 1 h par duel à 2 500 ms, 2,5 h à 6 000 ms ; environ 20 h pour toute la grille.

## 6. Arborescence

```text
engine-alphazero/
  PLAN.md  go.mod  .gitignore     (bin/, .venv/, fragments, poids, journaux)
  encode/  dataset/               A
  nn/                             D : Go pur, client du serveur, cache
  puct/  selfplay/                E, F
  cmd/az-donnees/  cmd/az-etiqueter/  cmd/az-banc/  cmd/az-autojeu/  cmd/linkx-az/
  testdata/                       petits fichiers figés : parité, positions
  python/  pyproject.toml  uv.lock  linkx_az/  tests/
```

**Frontière.** Le Go possède les règles (via `engine-go`), l'encodage, la recherche, la génération et le binaire. Python ne fait qu'entraîner, exporter et servir sur GPU. Ils ne se parlent que par trois contrats versionnés par `encoderVersion` : les fragments, les poids `.azw` et les trames d'inférence. Un écart de version est refusé.

Les données, poids et journaux vivent sous `$LINKX_AZ_RUNS`, par défaut `../linkx-az-runs`, hors du dépôt.

## 7. Ressources

Toutes ces durées sont des **estimations**. La machine actuelle a 4 cœurs, 15 Go de mémoire et pas de GPU.

- **Sans GPU** : A, B, D1, E et G. C et F restent possibles avec S, en quelques jours pour une vingtaine de générations.
- **Avec GPU** : un GPU de 16 à 24 Go suffit, avec 8 à 16 cœurs.

| Phase | Calcul estimé |
| --- | --- |
| B | ≈ 100 heures-cœur |
| C | 0,5 h-GPU, ou 2 à 12 h CPU |
| F (50 générations) | 15 à 35 h-GPU et 400 heures-cœur |
| G | ≈ 20 h |

Total : environ 50 h-GPU et 600 heures-cœur avant la décision d'arrêt. Le plafond de 150 h-GPU laisse la marge des variantes.

## 8. Intégration éventuelle au jeu — hors périmètre

Pas dans le périmètre initial. Elle ne s'envisage qu'après un succès au sens de la section 1, et par une décision reportée dans `plan.md`.

Piste technique :
- inférence en WebAssembly (SIMD) ou WebGPU, dans `aiWorker.ts` ;
- poids de 1 à 3 Mo en float16, mis en cache hors ligne par le service worker (`hors-ligne.md`).

Contraintes du README :
- le jeu reste jouable hors ligne, sans appel réseau ;
- aucune dépendance sans nécessité démontrée : ONNX Runtime Web n'en est pas une ;
- `chooseMoveForDifficulty` reste l'unique entrée de l'ordinateur et ne reçoit qu'un niveau ;
- aucune règle n'est redéfinie : un portage TS du MCTS se prouverait contre `src/game/`, comme `engineBoard.test.ts`.

## 9. Risques et points de décision

- **Recherche profonde avantagée.** Les parties sont courtes, et le maître voit 5 à 10 demi-coups et prouve souvent la fin dès le treizième. Le réseau ne peut gagner qu'aux demi-coups 1 à 12. À mesurer par `az-banc` par demi-coup, et en relevant où les coups divergent en duel.
- **Faiblesse tactique.** Menaces de gravité (`hangingWall`) et victoires en deux coups manquées faute de simulations. Parades : le solveur, la victoire immédiate jouée d'office, les plans 19 à 22, et `pecher-bevues.ts` comme source de positions de non-régression.
- **Calibrage de la valeur.** Les données du maître portent son style. Parades : Brier et calibration sur positions exactes, température ajustée sur le jeu tenu à part, suivi d'une génération à l'autre.
- **Débit CPU.** C'est le risque principal : point D-1.
- **Point D-2**, après C : passer à l'auto-jeu seulement si la politique seule reste à moins de 10 points du maître sur le banc de test, et si le moteur E atteint 25 % ou plus contre `go`.
- **Coût de l'auto-jeu.** Réduit par l'adjudication exacte, le nombre de simulations tiré et le cache. **Point D-3**, après 10 générations : continuer seulement si l'Elo et le jalon progressent.
- **Plafond du maître.** L'imitation ne le dépasse pas ; seul l'auto-jeu le peut.
- **Reproductibilité.** Graines partout, mode à simulations fixes sur un fil, D1 en duel, empreinte des poids et `encoderVersion` dans chaque ligne de journal. Le non-déterminisme du GPU n'est toléré qu'à l'apprentissage.
- **Point D-4** : versionner ou non les poids finaux, qui font quelques Mo.

## 10. Discipline du dépôt

- **Mesurer avant de garder.** Aucune modification de la recherche, du réseau, de l'encodage ou de l'entraînement ne se garde sans mesure : banc (`az-banc`) d'abord, puis duel apparié. Une réécriture aux sorties identiques (parité D, mêmes coups à simulations fixes) se contente de chiffrer son gain.
- **Mesurer la force** par `scripts/duel-go.ts` seulement, sur 50 ouvertures × 2 couleurs au moins, jamais depuis un préfixe aléatoire.
- **Hors du dépôt** : journaux, données et poids. Les données du tournoi ne se versionnent jamais.
- **Règle `.claude/rules/moteur-alphazero.md`**, créée avec l'étape A (`paths: ["engine-alphazero/**"]`) : contrats, commandes, mesures et décisions. Ce plan s'allège à mesure.
- **README** : la ligne d'arborescence d'`engine-alphazero/` existe déjà ; on peut au plus y ajouter `cd engine-alphazero && go test ./...` au tableau des commandes. Il compte environ 1 350 mots sur 1 500, et `engine-mcts` en prendra une.
- **Ne pas toucher** à `src/` ni à `engine-go/`. `engine-mcts/` ne change que par un changement séparé, convenu et prouvé neutre.
- **Hors de la CI**, comme `engine-go`. Aucun fichier `.ts` dans le module (Vitest et `tsc -b` les ramasseraient). Vérifier qu'oxlint ignore `.venv/`.
- **À chaque fin d'étape** :
  - `go vet ./... && go test ./...`, avec `-race` dès E ;
  - `uv run pytest` ;
  - `npm test`, `npm run lint` et `npm run build` verts à la racine ;
  - `git diff --check` et relecture du diff ;
  - un commit par étape, en français et à l'impératif.
