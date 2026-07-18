# Plan d'implémentation de Linkx

## 1. Objet du document

Ce document doit permettre à un agent reprenant le projet sans historique de conversation d'implémenter une SPA React permettant à deux joueurs de jouer à Linkx sur le même écran.

Il contient :

- les règles validées avec le propriétaire du projet ;
- la topologie exacte des pièces ;
- les décisions d'UX déjà demandées ;
- l'architecture recommandée ;
- les algorithmes de pose, de passe et de victoire ;
- le plan de tests et les critères d'acceptation ;
- les décisions UX définitivement appliquées.

Ce fichier est la spécification de référence du jeu actuel. Un agent doit pouvoir repartir du starter décrit ci-dessous et recréer le même moteur, les mêmes interactions et la même présentation sans avoir besoin de l'historique de conversation. Les comportements formulés comme obligations dans ce document priment sur les anciennes recommandations.

## 2. État initial du dépôt

Le dépôt est une SPA Vite standard, encore proche du starter :

- React `19.2.x` ;
- TypeScript `~6.0.x` ;
- Vite `8.1.x` ;
- styles CSS classiques dans `src/App.css` et `src/index.css` ;
- `oxlint` pour le lint ;
- `package-lock.json`, donc utiliser `npm` par défaut ;
- aucun framework de test installé ;
- aucune dépendance de gestion d'état ou de rendu graphique.

Fichiers principaux existants :

```text
src/App.tsx
src/App.css
src/index.css
src/main.tsx
package.json
vite.config.ts
```

Le starter peut être remplacé. Éviter d'ajouter une bibliothèque d'état : le jeu tient dans un reducer React et des fonctions TypeScript pures.

## 3. Sources et arbitrage des règles

Règle française fournie par l'utilisateur :

- https://www.jeux-abstraits.fr/wp-content/uploads/2026/07/lynkx.pdf

Fiche officielle :

- https://blueorangegames.eu/fr/jeux/linkx/

Les dimensions et l'inventaire ci-dessous ont été corrigés et explicitement confirmés par l'utilisateur. Ils priment sur toute déduction faite à partir des photos ou des fiches commerciales.

## 4. Règles validées

### 4.1 Plateau et joueurs

- Deux joueurs : bleu et blanc.
- Une grille verticale de **9 colonnes par 9 lignes**, soit 81 cases.
- Chaque joueur possède 14 pièces au début de la partie.
- Le jeu est local : les deux joueurs utilisent le même écran et jouent à tour de rôle.
- La règle physique fait commencer le plus jeune joueur. Pour l'application, prévoir un choix du premier joueur à l'écran de démarrage, avec bleu sélectionné par défaut si aucun choix n'est fait.

### 4.2 Inventaire exact

Il existe sept formes. Chaque joueur possède **deux exemplaires de chaque forme**.

```text
MONO       DOMINO      BARRE_3      PETIT_L
X          XX          XXX          XX
                                      X

S          T           GRAND_L
 X         XXX         XXX
XX          X          X
X
```

Matrice canonique de chaque forme :

```ts
const BASE_SHAPES = {
  mono: [[1]],
  domino: [[1, 1]],
  bar3: [[1, 1, 1]],
  smallL: [
    [1, 1],
    [1, 0],
  ],
  s: [
    [0, 1],
    [1, 1],
    [1, 0],
  ],
  t: [
    [1, 1, 1],
    [0, 1, 0],
  ],
  largeL: [
    [1, 1, 1],
    [1, 0, 0],
  ],
} as const
```

Contrôles de cohérence à tester :

- 7 formes ;
- 2 exemplaires de chaque forme ;
- 14 pièces par joueur ;
- 42 cases de pièces par joueur : `2 × (1 + 2 + 3 + 3 + 4 + 4 + 4)`.

Il n'y a pas de pièce carrée `O` ni de barre de quatre cases.

### 4.3 Orientations et retournements

- Toutes les pièces peuvent tourner par quarts de tour.
- Le grand `L` peut être retourné pour devenir un `J`.
- Le `S` peut être retourné pour devenir un `Z`.
- Le miroir du petit `L` ne crée pas de nouvelle géométrie : il est déjà accessible par rotation.
- Les autres retournements sont géométriquement redondants.
- Retourner une pièce ne crée pas une nouvelle pièce d'inventaire : il s'agit d'une orientation du même exemplaire.

Le moteur doit générer les rotations et réflexions à partir de la matrice de base, normaliser les coordonnées puis supprimer les doublons.

Nombre attendu d'orientations géométriques uniques en autorisant les miroirs :

- mono : 1 ;
- domino : 2 ;
- barre de 3 : 2 ;
- petit L : 4 ;
- S/Z : 4 ;
- T : 4 ;
- grand L/J : 8.

### 4.4 Déroulement d'un tour

À son tour, un joueur :

1. sélectionne une forme dont il reste au moins un exemplaire ;
2. choisit son orientation ;
3. choisit une colonne d'entrée au-dessus de la grille ;
4. laisse la pièce descendre verticalement ;
5. ne termine son tour que si la pose est légale.

Une pose illégale ne consomme ni la pièce ni le tour.

### 4.5 Contraintes de placement

Une pose est légale seulement si toutes les conditions suivantes sont remplies :

1. la pièce entre horizontalement dans les neuf colonnes ;
2. après sa descente, toutes ses cases sont dans les neuf lignes de la grille ;
3. aucune case ne chevauche une case déjà occupée ;
4. la pièce est arrivée à la première position où elle ne peut plus descendre ;
5. elle ne laisse aucun vide directement sous une partie de sa face inférieure.

Formalisation de la règle « aucun trou sous une pièce » : pour chaque case de la nouvelle pièce, si la case située juste en dessous ne fait pas elle-même partie de la nouvelle pièce, alors cette case doit :

- être le fond de la grille ; ou
- être déjà occupée par une pièce bleue ou blanche.

Une pièce retenue par un seul point de collision mais dont une autre partie surplombe une case vide est donc interdite. Une pièce ne peut pas être placée volontairement plus haut que sa position naturelle de chute.

### 4.6 Connexions et victoire immédiate

Deux cases de même couleur sont connectées si elles se touchent :

- par un côté ; ou
- par un angle.

La connectivité utilise donc les huit voisins d'une case.

À la fin d'une pose légale, le joueur actif gagne immédiatement si une même composante connectée de sa couleur touche :

- le bord gauche et le bord droit ; ou
- le bord supérieur et le bord inférieur.

Une connexion diagonale est suffisante. Il n'est pas nécessaire de relier une paire de bords choisie à l'avance.

### 4.7 Absence de coup, passes et fin par blocage

- Un joueur doit jouer s'il possède au moins un coup légal.
- S'il n'en possède aucun, son tour est automatiquement passé.
- Après une pose, remettre le compteur de passes consécutives à zéro.
- La partie se termine par blocage uniquement après deux tours consécutifs sans coup légal, un pour chaque joueur, sans pose entre les deux.

Important : ne pas considérer qu'un joueur bloqué le restera définitivement. Une pièce adverse nouvellement posée peut créer un support et rendre un coup possible au tour suivant.

En cas de blocage total :

1. calculer la taille en cases de la plus grande composante connectée bleue ;
2. faire la même chose pour les blancs ;
3. le score le plus élevé gagne.

La règle imprimée ne précise pas le cas d'une égalité parfaite. Décision appliquée dans l'application : déclarer un match nul.

## 5. Expérience utilisateur demandée

### 5.1 Disposition générale

Sur écran de bureau :

```text
[ Réserve bleue ]   [ Grille 9×9 ]   [ Réserve blanche ]
```

- Les deux réserves doivent rester visibles.
- La zone centrale contient l'état du tour, les entrées de colonnes et la grille.
- La réserve adverse est visible mais non interactive.
- Le bandeau placé au-dessus de la grille indique le joueur actif par une seule flèche : vers la réserve bleue à gauche ou vers la réserve blanche à droite. Il n'affiche pas de libellé de tour.
- Utiliser un fond neutre suffisamment contrasté pour que les pièces blanches restent lisibles.
- Sur bureau, utiliser trois colonnes d'environ `330 px / zone centrale / 330 px`. La grille centrale est limitée à environ `520 px` afin que les pièces de réserve puissent être représentées presque à la même échelle que les pièces jouées.

Sur petit écran, conserver la grille prioritaire et réorganiser les réserves au-dessus et au-dessous. Les sept formes d'une réserve sont alors placées dans une rangée horizontale défilante, sans provoquer de débordement de page. La partie doit rester jouable en mode paysage sur tablette et sur mobile.

### 5.2 Affichage de l'inventaire

Afficher sept groupes de forme par joueur, sans nom visible et sans badge numérique.

- Chaque groupe conserve toujours deux silhouettes identiques : un exemplaire disponible est plein et constitue son propre bouton ; un exemplaire déjà joué reste visible sous forme de contour pointillé et n'est plus interactif.
- La séquence visuelle est donc `deux pleines`, puis `une pleine + une pointillée`, puis `deux pointillées`.
- Sur bureau, chaque forme occupe sa propre ligne. Sur tablette et mobile, ces lignes deviennent des cartes dans une rangée horizontale défilante.
- Lorsque les deux exemplaires sont joués, les deux silhouettes pointillées restent pleinement lisibles mais aucune zone interactive ne subsiste.
- Une pose décrémente exactement une occurrence.
- Le joueur sélectionne directement une silhouette disponible, jamais la ligne ou le groupe entier. Les deux exemplaires d'une même forme ont le même comportement de jeu mais des boutons et états sélectionnés distincts.
- Les noms de forme et les quantités restent disponibles uniquement dans les noms accessibles du groupe et des boutons (`aria-label`) pour les lecteurs d'écran et les tests.
- Les cellules graphiques des pièces de réserve utilisent une taille d'environ `46 px`. La grille centrale est dimensionnée pour que la partie visible d'une case jouée soit de taille équivalente.
- Choisir une orientation initiale compacte et reconnaissable ; le `S` est affiché horizontalement pour limiter la hauteur de la réserve. Cette orientation est une donnée partagée par la réserve et le reducer : au premier clic, l'aperçu central doit être strictement orienté comme la silhouette cliquée, puis les rotations partent de cette orientation.
- La réserve affiche les formes directement sur son fond, sans rectangle blanc ni bordure permanente autour de chaque paire. Un fond léger épouse uniquement la silhouette cliquée au survol ou pour signaler la sélection ; il ne doit modifier ni marge, ni padding, ni position afin d'éviter tout saut.
- La réserve blanche utilise un fond gris bleuté plus soutenu. Les silhouettes blanches pleines ont un contour externe gris foncé, et leurs versions indisponibles un contour pointillé sombre.
- Supprimer entièrement l'en-tête visible de chaque réserve : aucun texte « Réserve », nom de couleur, pastille ou badge de tour ne doit apparaître au-dessus des pièces.

### 5.3 Sélection, rotation et miroir

Interaction demandée :

- premier clic sur un exemplaire disponible : sélection de cet exemplaire ;
- clic sur l'autre exemplaire de la même forme : changement de sélection sans rotation ;
- nouveau clic sur l'exemplaire déjà sélectionné : rotation de 90° ;
- bouton visible « Retourner » pour `grand L` et `S` ;
- raccourci clavier `F` pour retourner ;
- raccourci clavier `R` ou flèches pour tourner, en complément du clic ;
- afficher la pièce sélectionnée dans une zone dédiée au-dessus des flèches d'entrée et de la grille ;
- appliquer les rotations et retournements uniquement à cet aperçu central et au ghost ; les silhouettes de réserve restent dans leur orientation canonique compacte.

Le bouton de retournement peut être masqué ou désactivé pour les formes dont le miroir est redondant.

Ne pas afficher de texte du type « nom de la pièce · 90° ». La zone centrale contient seulement la silhouette sélectionnée et les boutons `Tourner`/`Retourner`.

La zone de sélection doit conserver une hauteur fixe d'environ `150 px`, qu'une pièce soit sélectionnée ou non, afin de contenir une orientation de trois cases à l'échelle de jeu. Les cellules de l'aperçu central utilisent exactement la même taille nominale que celles de la réserve (`46 px`) et une taille visuelle équivalente aux cases jouées. Les entrées de colonnes ont elles aussi un espace réservé de hauteur fixe. Le bord supérieur de la grille ne doit donc jamais changer de position lors d'une sélection, d'une rotation ou d'un retournement.

### 5.4 Ghost et dépôt

- Afficher neuf zones d'entrée cliquables au-dessus de la grille uniquement lorsqu'une pièce est sélectionnée.
- Chaque zone affiche seulement une flèche. Ne pas afficher les numéros de colonnes ; conserver « colonne N » dans l'`aria-label` du bouton.
- Le survol d'une entrée calcule immédiatement l'atterrissage de la pièce.
- L'aperçu ghost occupe exactement les cases finales calculées par le moteur.
- Ghost valide : couleur du joueur avec transparence et contour positif.
- Ghost invalide : rouge ou hachuré, avec une courte raison (`dépassement`, `collision`, `vide sous la pièce`).
- Le clic sur l'entrée valide déclenche la pose.
- Le clic sur une entrée invalide ne change pas l'état de la partie.
- Après validation, animer visuellement la descente, mais appliquer la logique de jeu de façon déterministe et indépendante de l'animation.

Convention recommandée : la colonne survolée représente la colonne de la case occupée la plus à gauche de la matrice normalisée. Les positions qui dépassent à droite sont montrées comme invalides. Documenter cette convention dans l'aide de jeu.

### 5.5 Retours d'état

Prévoir :

- `Au tour des bleus/blancs` ;
- message court lors d'une pose refusée ;
- message lors d'une passe forcée ;
- panneau compact de fin de partie indiquant la raison : connexion, blocage ou match nul ;
- scores des plus grandes zones en cas de blocage ;
- bouton `Nouvelle partie` ;
- aide/règles résumées sans quitter la partie.

Le panneau final ne doit jamais être modal et ne doit jamais recouvrir la grille. Il remplace la barre d'état au-dessus du plateau afin que le dernier coup et le chemin gagnant restent immédiatement visibles. Le bandeau, la zone de sélection vide et l'espace des entrées de colonnes conservent exactement leurs hauteurs pendant ce remplacement : le bord supérieur de la grille ne doit pas remonter à la fin de la partie. Le panneau contient un bouton compact `Rejouer`.

Ne pas afficher de texte d'instruction permanent lorsque le visuel suffit. Les informations nécessaires à l'accessibilité et aux tests doivent être placées dans des attributs `aria-*` ou `data-testid`, pas ajoutées comme libellés visibles.

### 5.6 Continuité visuelle des pièces et chemin gagnant

- Les carrés qui composent une même pièce doivent former une silhouette continue, dans la réserve, dans le ghost et une fois posés sur la grille.
- Dans la réserve, les cellules d'une matrice se touchent sans gouttière ni bordure interne.
- La réserve et la grille partent des mêmes matrices et appellent la même fonction de calcul des voisins orthogonaux. Ne pas recréer manuellement une géométrie différente pour le plateau.
- Sur le plateau, utiliser le `pieceId` pour regrouper les cases d'une même pièce et dessiner une silhouette SVG unique par pièce. Chaque case contribue un rectangle dont les côtés atteignent ou chevauchent très légèrement la limite commune avec ses voisins orthogonaux. Le chemin de remplissage ne possède aucun `stroke` : un trait appliqué aux sous-rectangles reste visible dans les angles concaves des L, T et S, même avec `paint-order`. Pour le contraste, produire uniquement un contour externe depuis l'alpha fusionné de la silhouette avec `feMorphology` (`dilate`), puis placer ce contour derrière `SourceGraphic`. Le filtre voit la forme pleine, jamais ses arêtes internes, et ne peut donc créer aucune encoche centrale. Ne jamais appliquer de `drop-shadow` CSS décalée aux chemins SVG du plateau : ses unités sont mises à l'échelle du `viewBox` et créent de grosses formes grises autour des pièces. La grille reste dessinée sous cette couche par les bordures fines des cases.
- Les cellules des polyominos restent rectangulaires, sans arrondi aux angles rentrants. En particulier, le `S`/`Z` ne doit présenter aucun petit coin, encoche ou artefact à ses jonctions.
- Deux pièces distinctes, même de même couleur et adjacentes, doivent rester visuellement séparables.
- Les pièces blanches utilisent un contour externe gris sur fond gris bleuté pour rester lisibles, sans ajouter de lignes entre les cellules d'une même pièce.
- Après une victoire par connexion, reconstruire un chemin précis reliant les deux bords opposés et surligner uniquement ses cellules avec un contour SVG lumineux jaune/or animé. Ce contour reste transparent : il ne pose aucun fond au-dessus des pièces et ne change jamais la couleur bleue ou blanche du chemin victorieux.
- Le surlignage doit respecter `prefers-reduced-motion`.

### 5.7 Chargement de positions pour les tests visuels

L'application peut démarrer directement depuis une grille non vide fournie dans la query string. Cette entrée est réservée aux tests, démonstrations et reproductions visuelles ; elle n'ajoute aucun contrôle visible à l'interface.

- Paramètre obligatoire : `board`, avec exactement 9 lignes de 9 caractères.
- Symboles partagés avec `evaluation.test.ts` : `B` pour bleu, `W` pour blanc et `.` pour vide.
- Dans une URL, séparer les lignes par `/`. Une chaîne compacte de 81 caractères et le format multiligne des tests sont aussi acceptés par le parseur commun.
- Paramètre optionnel : `turn=blue` ou `turn=white`, bleu par défaut. Les alias `B` et `W` sont acceptés.
- Une grille valide démarre directement en phase `playing`, sans écran de configuration.
- Si la grille contient déjà une connexion gagnante pour une seule couleur, démarrer en phase `finished`, afficher le panneau final et reconstruire le chemin gagnant. Refuser une grille où les deux joueurs gagnent simultanément.
- Les inventaires restent complets : la représentation `B/W/.` ne contient pas l'historique des pièces jouées. Cette entrée sert à tester le plateau et les interactions depuis la position chargée, pas à restaurer une sauvegarde exacte.
- Pour le rendu SVG, regrouper en une même pièce de fixture les cases orthogonalement connexes d'une même couleur. Deux pièces réelles de même couleur qui se touchent orthogonalement ne peuvent pas être distinguées par ce format volontairement simple.

Exemple avec un S bleu et une case blanche, au tour des blancs :

```text
?board=........./........./........./........./........./........./.B......./BB......./B.......W&turn=white
```

Le parsing et la sérialisation de cette représentation appartiennent à un module de domaine commun utilisé à la fois par les tests d'évaluation et le chargeur de query string. Ne pas maintenir deux parseurs divergents.

## 6. Architecture recommandée

### 6.1 Arborescence cible

```text
src/
  game/
    types.ts
    pieces.ts
    transforms.ts
    placement.ts
    connectivity.ts
    boardText.ts
    queryState.ts
    legalMoves.ts
    evaluation.ts
    simulation.ts
    minimax.ts
    reducer.ts
    selectors.ts
    game.test.ts
  components/
    Board.tsx
    DropZone.tsx
    PieceShape.tsx
    PieceTray.tsx
    GameStatus.tsx
    SetupPanel.tsx
    GameOverPanel.tsx
    RulesPanel.tsx
  App.tsx
  App.css
  index.css
  main.tsx
```

Les noms peuvent évoluer, mais les règles doivent rester séparées des composants React.

### 6.2 Types principaux

```ts
type PlayerId = 'blue' | 'white'

type ShapeId =
  | 'mono'
  | 'domino'
  | 'bar3'
  | 'smallL'
  | 's'
  | 't'
  | 'largeL'

type Point = { x: number; y: number }

type Orientation = {
  cells: Point[]
  width: number
  height: number
  rotation: 0 | 1 | 2 | 3
  flipped: boolean
}

type BoardCell = null | {
  player: PlayerId
  pieceId: string
  shapeId: ShapeId
}

type Board = BoardCell[][] // toujours 9 lignes de 9 colonnes

type Inventory = Record<ShapeId, 0 | 1 | 2>

type PlayedCopies = Record<ShapeId, [boolean, boolean]>

type Selection = {
  shapeId: ShapeId
  copy: 0 | 1
  rotation: 0 | 1 | 2 | 3
  flipped: boolean
}

type GameResult = {
  winner: PlayerId | null
  reason: 'connection' | 'stalemate' | 'draw'
  largestZones?: Record<PlayerId, number>
}
```

L'ID de pièce posée permet le débogage et l'animation, mais la détection de connexion doit travailler sur les couleurs des cases, pas sur les IDs de pièces.

### 6.3 État du reducer

L'état minimal doit contenir :

- phase : configuration, partie ou fin ;
- grille ;
- inventaire bleu et blanc ;
- état joué/disponible de chacun des deux exemplaires de chaque forme, afin que la silhouette cliquée soit exactement celle qui devient pointillée ;
- joueur actif ;
- sélection courante ;
- nombre de passes consécutives ;
- résultat éventuel ;
- éventuellement le dernier événement pour les messages (`placed`, `forced-pass`, `invalid`).

Le survol de colonne et les animations peuvent rester dans un état UI local, à condition que le ghost appelle exactement la même fonction de placement que le reducer.

Actions possibles :

```text
START_GAME
SELECT_SHAPE
ROTATE_SELECTION
FLIP_SELECTION
DROP_SELECTED_SHAPE
RESET_GAME
```

Ne jamais accepter une position finale calculée par le composant. `DROP_SELECTED_SHAPE` doit transmettre seulement la colonne ; le reducer ou une fonction de domaine recalcule l'atterrissage et la validité.

## 7. Algorithmes de domaine

### 7.1 Normalisation d'une forme

Pour toute liste de coordonnées :

1. soustraire le `x` minimal à tous les `x` ;
2. soustraire le `y` minimal à tous les `y` ;
3. trier les cases par `y`, puis `x` ;
4. produire une clé stable comme `x,y|x,y|...`.

Cette clé sert à dédupliquer les symétries.

### 7.2 Transformations

Rotation horaire autour de l'origine, suivie d'une normalisation :

```text
(x, y) -> (-y, x)
```

Réflexion horizontale, suivie d'une normalisation :

```text
(x, y) -> (-x, y)
```

Pour énumérer les coups, générer les quatre rotations de la base puis les quatre rotations de la base réfléchie, et supprimer les doublons par clé normalisée.

Pour l'UI, garder `rotation` et `flipped` explicites afin que `Tourner` et `Retourner` aient un comportement prévisible.

### 7.3 Calcul de la chute

Convention de coordonnées :

- `x = 0` est la colonne gauche ;
- `x = 8` est la colonne droite ;
- `y = 0` est la ligne supérieure ;
- `y = 8` est la ligne du fond.

Pour une orientation et une colonne d'ancrage :

1. refuser immédiatement si `anchorX < 0` ou `anchorX + width > 9` ;
2. initialiser `anchorY = -height`, pièce entièrement au-dessus de la grille ;
3. descendre d'une ligne tant que la position suivante n'entre pas en collision ;
4. s'arrêter à la dernière position sans collision ;
5. refuser si une case de la pièce possède encore `y < 0` : elle dépasse du haut ;
6. appliquer la règle de support intégral ;
7. retourner la liste des cases finales et, en cas d'échec, une raison structurée.

Pendant la simulation, les cases dont `y < 0` sont hors de la grille et ne collisionnent pas encore. Une case dont `y >= 9`, dont `x` sort de la grille ou qui chevauche une case occupée collisionne.

Résultat recommandé :

```ts
type DropResult =
  | { valid: true; cells: Point[]; anchorY: number }
  | {
      valid: false
      reason: 'horizontal-bounds' | 'overflow' | 'unsupported'
      previewCells: Point[]
    }
```

La collision pendant la chute sert à déterminer l'arrêt ; elle n'a normalement pas besoin d'être présentée comme une erreur finale distincte.

### 7.4 Validation du support

Créer un `Set` des coordonnées finales de la nouvelle pièce.

Pour chaque nouvelle case `(x, y)` :

```text
si (x, y + 1) appartient à la nouvelle pièce : OK
sinon si y == 8 : OK
sinon si board[y + 1][x] est occupée : OK
sinon : pose interdite
```

Cette vérification doit être partagée entre le ghost, l'énumération des coups et la pose définitive.

### 7.5 Énumération des coups légaux

Pour le joueur demandé :

1. parcourir les sept formes dont le compteur d'inventaire est supérieur à zéro ;
2. parcourir leurs orientations uniques ;
3. parcourir `anchorX` de `0` à `9 - width` ;
4. appeler le calcul de chute ;
5. conserver uniquement les résultats valides.

La grille est petite : aucune optimisation complexe n'est nécessaire. Cette fonction est la source de vérité pour les passes forcées.

### 7.6 Détection des composantes

Utiliser un BFS ou DFS sur les 81 cases avec les huit directions :

```text
(-1,-1) (0,-1) (1,-1)
(-1, 0)        (1, 0)
(-1, 1) (0, 1) (1, 1)
```

Pour chaque composante d'une couleur, conserver :

- sa taille en cases ;
- touche gauche (`x == 0`) ;
- touche droite (`x == 8`) ;
- touche haut (`y == 0`) ;
- touche bas (`y == 8`).

Une composante est gagnante si :

```text
(touche gauche ET touche droite)
OU
(touche haut ET touche bas)
```

Le plus grand score de zone est le maximum des tailles de composantes, ou zéro si le joueur n'a aucune case.

Pour le surlignage final, conserver ou reconstruire les prédécesseurs d'un BFS à huit voisins :

1. chercher d'abord un chemin depuis toutes les cases du bord gauche jusqu'au bord droit ;
2. si aucun chemin horizontal n'existe, chercher depuis le bord supérieur jusqu'au bord inférieur ;
3. au premier bord opposé atteint, remonter les prédécesseurs jusqu'à la source ;
4. retourner uniquement cette liste ordonnée de cases comme chemin gagnant.

Le moteur de victoire et le calcul du chemin doivent utiliser la même connectivité à huit voisins. Le chemin peut donc contenir des pas diagonaux.

### 7.7 Avancement du tour

Après une pose valide :

1. écrire les cases avec la couleur et l'ID de pièce ;
2. décrémenter l'inventaire ;
3. si le tour passe à l'adversaire, vider la sélection ; si l'adversaire est passé automatiquement et que le même joueur rejoue, conserver la sélection seulement s'il reste un exemplaire ;
4. tester la victoire du joueur actif ;
5. si victoire, terminer immédiatement ;
6. remettre `consecutivePasses` à zéro ;
7. changer de joueur ;
8. tester si le nouveau joueur possède un coup légal ;
9. sinon, enregistrer une passe forcée et revenir à l'autre joueur ;
10. si la seconde absence de coup est consécutive, terminer par comparaison des zones.

Éviter une boucle infinie dans la résolution automatique. Au maximum deux joueurs sont examinés avant de conclure au blocage.

### 7.8 Évaluation d'une grille pour une future IA

Exposer `getConnectionScore(board, player)`, une fonction pure qui estime, pour un joueur, le nombre minimal de cases vides encore nécessaires pour relier une paire de bords opposés :

- entrer dans une case de sa couleur coûte `0` ;
- entrer dans une case vide coûte `1` ;
- une case adverse est infranchissable ;
- les déplacements utilisent les mêmes huit voisins que la détection de victoire ;
- calculer séparément le plus court chemin gauche-droite et haut-bas, puis conserver le plus petit score.

Une grille vide a donc un score de `9`, une grille déjà gagnante un score de `0`, et une grille dont les deux axes sont rendus impossibles par l'adversaire un score infini. Un score plus petit est meilleur.

Cette première heuristique mesure des cases à conquérir et non des pièces ou des tours. Elle ignore volontairement les formes restantes, la gravité et les supports légaux. Le Minimax compare les joueurs avec `score adverse - score du joueur` et complète cette valeur par la différence entre leurs plus grandes zones.

### 7.9 Minimax

Le moteur expose une sélection de coup pure, indépendante de React :

```ts
chooseMinimaxMove(position, { depth: 2 })
```

- la profondeur compte les poses futures, et vaut `2` par défaut afin d'examiner le coup de l'ordinateur puis la meilleure réponse adverse ;
- chaque nœud énumère uniquement les coups légaux depuis `legalMoves.ts` ;
- la simulation recalcule la chute, décrémente l'inventaire, détecte la victoire immédiate, les passes forcées et le blocage total ;
- les nœuds de l'ordinateur maximisent le score et ceux de l'adversaire le minimisent ;
- les résultats terminaux dominent toujours l'heuristique, avec une préférence pour une victoire plus rapide et une défaite plus tardive ;
- les positions non terminales utilisent `100 × (distance adverse - distance ordinateur)`, puis la différence de taille des plus grandes zones comme départage ;
- une distance infinie est remplacée par une valeur finie supérieure à toute distance possible avant la soustraction ;
- appliquer l'élagage alpha-bêta, ordonner les coups racine par l'heuristique et utiliser une table de transposition qui distingue valeurs exactes, bornes basses et bornes hautes ;
- retourner le coup, sa valeur et le nombre de nœuds explorés, ou `null` si aucun coup n'est disponible.

Cette étape fournit le moteur et son banc de validation. Le choix d'un adversaire ordinateur dans l'interface reste une évolution distincte.

## 8. Plan de tests

### 8.1 Outils

Ajouter au minimum Vitest et un script `test`. Pour les interactions React, ajouter React Testing Library et `user-event` si nécessaire.

Scripts cibles :

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 8.2 Tests des pièces

- les matrices correspondent exactement aux ASCII validés ;
- chaque forme possède quatre, trois, deux ou une case selon le cas ;
- l'inventaire initial contient deux exemplaires de chaque forme ;
- total de 14 pièces et 42 cases par joueur ;
- nombre d'orientations uniques : `1, 2, 2, 4, 4, 4, 8` ;
- aucune orientation n'a de coordonnées négatives après normalisation ;
- aucune orientation dupliquée.

### 8.3 Tests de chute et de support

- monomino sur grille vide : tombe au fond ;
- domino horizontal sur grille vide : valide au fond ;
- barre verticale : descend jusqu'au fond ;
- dépassement horizontal à droite : interdit ;
- colonne bouchée près du haut : dépassement supérieur interdit ;
- une pièce s'arrête au premier obstacle et ne traverse jamais une case occupée ;
- grand L reposant entièrement sur le fond : valide ;
- T avec tige vers le bas sur sol vide : bras non soutenus, donc invalide ;
- T retourné avec barre au fond : valide ;
- pont au-dessus d'une case vide : invalide ;
- surplomb dont toutes les faces inférieures sont soutenues : valide ;
- ghost et validation définitive retournent les mêmes cases ;
- une pose invalide ne modifie ni la grille, ni l'inventaire, ni le joueur actif.

### 8.4 Tests de coups disponibles et de passes

- une grille vide offre des coups aux deux joueurs ;
- une forme à compteur zéro n'est jamais énumérée ;
- un joueur sans coup est passé automatiquement ;
- une pose remet les passes consécutives à zéro ;
- un joueur précédemment bloqué peut rejouer si la pose adverse crée un support ;
- deux passes consécutives terminent la partie ;
- une absence de coup suivie d'une pose ne termine pas la partie.

### 8.5 Tests de connexion

- connexion gauche-droite orthogonale ;
- connexion haut-bas orthogonale ;
- connexion composée uniquement de contacts diagonaux ;
- deux zones séparées d'une case ne sont pas connectées ;
- les couleurs adverses ne relient jamais deux zones ;
- une composante touchant un seul bord ne gagne pas ;
- calcul correct de la plus grande composante ;
- victoire immédiate après le coup qui complète le chemin ;
- reconstruction d'un chemin gagnant ordonné entre les deux bords, y compris pour un chemin uniquement diagonal.

### 8.6 Tests d'évaluation de grille

Isoler ces scénarios dans `evaluation.test.ts` et décrire les grilles sous forme textuelle avec `B` pour une case bleue, `W` pour une case blanche et `.` pour une case vide.

- grille vide : score `9` pour les deux joueurs ;
- liaison gagnante horizontale, verticale ou diagonale : score `0` ;
- plusieurs zones séparées : somme minimale des cases vides nécessaires pour les raccorder aux bords ;
- choix du meilleur axe lorsque les distances horizontale et verticale diffèrent ;
- cases adverses infranchissables et score infini si aucun axe ne reste accessible ;
- au moins deux positions mixtes issues de parties rejouées avec de vraies pièces et uniquement des poses légales, puis comparées à leur représentation textuelle avant l'évaluation.

### 8.7 Tests du Minimax

- refuser une profondeur inférieure à `1` ;
- choisir immédiatement une pose gagnante depuis une position construite avec des coups légaux ;
- simuler correctement une passe forcée et une fin par blocage total ;
- jouer au moins 20 parties déterministes contre un adversaire aléatoire, en étant premier joueur dans la moitié des parties et second dans l'autre moitié ;
- à profondeur `2`, gagner au moins 80 % de cet échantillon et obtenir strictement plus de victoires que de défaites.

### 8.8 Tests d'interface

- seule la réserve active est interactive ;
- un premier clic sur une silhouette disponible sélectionne cet exemplaire ;
- un clic sur l'autre exemplaire identique change la sélection sans tourner ;
- un second clic sur le même exemplaire tourne ;
- `Retourner` transforme le grand L en J et S en Z ;
- chaque groupe de réserve conserve deux silhouettes individuellement cliquables tant qu'elles sont disponibles : deux pleines, puis une pleine et une pointillée, puis deux pointillées ;
- aucun nom de forme ni badge `×1`/`×2` n'est visible ; les informations restent présentes dans les attributs ARIA ;
- aucun rectangle ou séparateur permanent n'entoure les paires dans la réserve ;
- aucun en-tête visible ne précède les réserves et le bandeau central indique le tour uniquement par une flèche gauche/droite ;
- le survol ou la sélection d'une silhouette de réserve ne déplace aucun élément ;
- la réserve blanche et ses silhouettes pleines ou pointillées restent nettement lisibles ;
- sélectionner ou tourner une pièce ne modifie ni la géométrie de la réserve ni la position de la grille ;
- la pièce sélectionnée et sa rotation apparaissent uniquement dans la zone fixe au-dessus de la grille ;
- au premier clic, la pièce centrale possède exactement la même orientation que la silhouette choisie dans la réserve ;
- les cellules d'une même pièce forment une silhouette continue dans la réserve, le ghost et la grille ;
- les `L`/`J`, `S`/`Z` et `T` posés sont rendus comme une silhouette SVG sans trait sur les sous-rectangles ; leur contour externe dérive de l'alpha fusionné et ne présente aucun artefact, bordure interne ou encoche dans les angles rentrants ;
- les pièces de réserve et les pièces jouées ont une taille visuelle équivalente ;
- le ghost change avec la colonne et l'orientation ;
- un ghost invalide explique le refus ;
- les entrées n'affichent que des flèches, sans numéro visible ;
- une pose valide change le joueur ;
- une passe forcée est annoncée ;
- le panneau final distingue connexion, blocage et égalité ;
- le panneau final ne recouvre jamais le plateau ;
- le passage à l'état final ne change pas la position verticale de la grille ;
- une victoire par connexion surligne le chemin gagnant exact avec un contour transparent sans masquer ni éclaircir jusqu'au blanc la couleur des pièces ;
- `Nouvelle partie` restaure exactement les inventaires et une grille vide.

### 8.9 Tests du chargement par URL

- accepter le format multiligne `B/W/.` des tests d'évaluation ;
- accepter neuf lignes séparées par `/` et une chaîne compacte de 81 caractères ;
- refuser toute autre dimension ou tout symbole inconnu ;
- charger le joueur actif demandé et démarrer directement la partie ;
- regrouper les composantes orthogonales monochromes pour obtenir des silhouettes SVG continues ;
- détecter une position déjà gagnante et afficher immédiatement le résultat et son chemin ;
- refuser deux vainqueurs simultanés ou un joueur actif inconnu.

## 9. Ordre d'implémentation recommandé

### Étape 1 — Modèle des pièces

- Créer les types.
- Encoder les sept matrices.
- Implémenter rotation, miroir, normalisation et déduplication.
- Ajouter les premiers tests de cohérence.

### Étape 2 — Moteur de pose

- Créer la grille 9×9.
- Implémenter chute, collision, dépassement et support.
- Implémenter l'énumération des coups.
- Couvrir les cas de trou et de surplomb avant de poursuivre.

### Étape 3 — Connexions et fin de partie

- Implémenter BFS/DFS à huit voisins.
- Détecter les deux axes de victoire.
- Calculer la plus grande zone.
- Reconstruire un chemin gagnant avec les prédécesseurs du BFS.
- Implémenter les passes consécutives et le blocage.

### Étape 4 — Reducer

- Relier inventaires, sélection, pose et alternance.
- Garder toutes les transitions déterministes.
- Tester le reducer sans React.

### Étape 5 — Interface fonctionnelle

- Construire grille, réserves et sélection.
- Ajouter rotation et retournement.
- Ajouter les neuf entrées et le ghost.
- Ajouter messages de tour, passe et victoire.
- Afficher toujours deux silhouettes dans chaque groupe de réserve : chaque exemplaire disponible est un bouton propre, chaque exemplaire joué est pointillé, sans compteur textuel.
- Afficher la sélection et ses transformations à l'échelle des réserves dans une zone centrale de hauteur fixe.

### Étape 6 — Finition visuelle et accessibilité

- Travailler la hiérarchie visuelle bleu/blanc.
- Unifier visuellement les cellules d'une même pièce à partir du `pieceId`.
- Supprimer les gouttières et artefacts aux jonctions, notamment dans les creux des `S`/`Z` et `T`.
- Dimensionner les silhouettes de réserve comme les pièces jouées.
- Alléger les réserves en retirant les rectangles permanents et renforcer le contraste de la réserve blanche.
- Supprimer les en-têtes de réserve et les libellés visuels non indispensables ; indiquer le tour par une flèche gauche/droite et conserver les équivalents ARIA.
- Garder le panneau final hors de la grille et surligner le chemin gagnant.
- Ajouter focus clavier, libellés ARIA et contrastes.
- Ajouter animation de chute avec respect de `prefers-reduced-motion`.
- Vérifier les écrans de bureau, tablette et mobile.

### Étape 7 — Moteur Minimax

- Créer une représentation pure de position simulée avec plateau, inventaires et joueur actif.
- Simuler les poses et les passes avec les mêmes fonctions de domaine que le jeu local.
- Implémenter Minimax à profondeur limitée avec élagage alpha-bêta et cache de positions exactes.
- Valider les décisions terminales et mesurer le taux de victoire contre un joueur aléatoire déterministe.

### Étape 8 — Vérification finale

Exécuter :

```bash
npm test
npm run lint
npm run build
```

Puis tester dans un navigateur au minimum :

- sélection et rotations de chaque forme ;
- miroir L/J et S/Z ;
- plusieurs poses valides ;
- refus d'un trou ;
- refus d'un dépassement ;
- victoire horizontale ;
- victoire verticale ou diagonale ;
- position verticale identique de la grille juste avant et juste après la victoire ;
- passage visuel d'une réserve de deux silhouettes pleines à une pleine et une pointillée, puis deux pointillées ;
- stabilité de la grille et de la réserve pendant sélection, rotation et retournement ;
- rendu propre d'un `L`/`J`, d'un `S`/`Z` et d'un `T` posés ;
- continuité des silhouettes dans la réserve, le ghost et la grille ;
- panneau final non modal et surlignage du chemin gagnant ;
- absence de débordement horizontal sur tablette et mobile ;
- passe forcée ;
- nouvelle partie.
- chargement direct d'une position non vide et d'une position gagnante avec `?board=...&turn=...`.

## 10. Critères d'acceptation

Le développement est terminé lorsque :

- la grille comporte exactement 9×9 cases ;
- chaque joueur commence avec deux exemplaires des sept topologies validées ;
- les rotations et miroirs autorisés sont corrects ;
- le ghost et la pose utilisent la même logique ;
- aucun chevauchement, dépassement ou vide sous une pièce n'est accepté ;
- une pose invalide ne consomme rien ;
- les connexions par côtés et angles sont reconnues ;
- les victoires gauche-droite et haut-bas sont détectées immédiatement ;
- les passes et le blocage total suivent les règles ;
- le Minimax choisit uniquement des coups légaux, reconnaît les résultats terminaux et dépasse le seuil statistique défini contre le joueur aléatoire ;
- les deux réserves et le joueur actif sont clairement visibles ;
- chaque réserve conserve deux silhouettes par forme, individuellement sélectionnables lorsqu'elles sont disponibles et pointillées lorsqu'elles sont jouées, sans nom ni badge numérique visible ;
- les réserves n'utilisent pas de rectangles permanents autour des paires, et les pièces blanches restent contrastées ;
- la pièce sélectionnée et ses rotations sont affichées à la même échelle que dans la réserve dans une zone fixe au-dessus de la grille sans déplacer le plateau ni transformer les silhouettes de réserve ;
- les pièces ont une silhouette continue et une taille visuelle cohérente entre réserve, ghost et plateau ;
- les `L`/`J`, `S`/`Z` et `T` ne présentent aucune encoche dans leurs angles rentrants ni aucun artefact de jonction ;
- les entrées de colonnes ne montrent que les flèches ;
- aucun nom de pièce, angle de rotation ou aperçu redondant n'encombre la zone centrale ;
- le panneau de fin ne recouvre pas la grille et le chemin gagnant exact est surligné sans altérer la couleur du joueur ;
- la partie est jouable intégralement à la souris et raisonnablement au clavier ;
- tests, lint et build passent ;
- la SPA ne dépend d'aucun serveur.

## 11. Décisions UX appliquées

1. **Égalité après blocage total** : déclarer un match nul.
2. **Premier joueur** : écran de configuration bleu/blanc avec rappel « le plus jeune commence » ; bleu sélectionné par défaut.
3. **Convention de colonne** : la colonne cliquée est l'ancre de la case la plus à gauche de la pièce normalisée.
4. **Contrôle du miroir** : bouton `Retourner` et touche `F`, en plus du clic répété qui reste réservé à la rotation.
5. **Inventaire** : toujours deux silhouettes par forme, chacune sélectionnable séparément lorsqu'elle est disponible et exactement la silhouette jouée devient pointillée, sans nom ni multiplicateur visible et sans rectangle permanent autour des paires.
6. **Fin de partie** : panneau compact non modal au-dessus de la grille et chemin gagnant surligné.
7. **Densité visuelle** : supprimer les numéros de colonnes, le nom et l'angle de la sélection, les légendes de bords et les textes permanents redondants.
8. **Sélection** : aperçu à l'échelle des réserves et rotations dans une zone centrale fixe ; la grille et les réserves ne bougent pas et la géométrie canonique de la réserve ne tourne jamais.
9. **Contraste** : fond gris bleuté pour la réserve blanche et contour externe sombre pour ses pièces.
10. **Tour actif** : aucune en-tête de réserve ; une flèche gauche/droite dans le bandeau central pointe vers la réserve du joueur actif.
11. **Rendu du plateau** : une silhouette SVG globale par pièce, sans trait sur ses sous-rectangles et avec un contour externe calculé par morphologie sur l'alpha fusionné, élimine les encoches des L, S et T ; le chemin victorieux reçoit seulement un contour transparent qui préserve la couleur du joueur.
12. **Fixtures visuelles** : une query string `board` au format commun `B/W/.`, complétée éventuellement par `turn`, charge directement une position ; une victoire préexistante ouvre son état final.

Ces décisions font partie de la spécification et doivent être reproduites telles quelles.

## 12. Hors périmètre initial

Ne pas ajouter sans demande explicite :

- jeu en réseau ;
- intégration de l'adversaire IA dans l'interface (le moteur Minimax seul est disponible) ;
- comptes utilisateurs ;
- backend ou base de données ;
- matchmaking ;
- chronomètre compétitif ;
- historique persistant ;
- effets sonores complexes.

Une fonction d'annulation n'est pas recommandée dans la première version, car le jeu physique ne permet normalement pas de reprendre une pièce une fois jouée.
