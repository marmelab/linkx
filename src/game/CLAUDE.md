# src/game — logique de jeu

Domaine pur : aucune importation React, aucun accès au DOM, aucune horloge ni aléa non injecté. Toute fonction est déterministe et testable seule. Les règles elles-mêmes — chute, support, connexion, blocage, notation — sont spécifiées dans `plan.md` ; ce fichier ne dit que comment elles sont réparties ici.

## Sources uniques

- `placement.ts` est la source de vérité pour la chute et le support. Le ghost, l'énumération des coups et la pose définitive appellent tous la même fonction `calculateDrop`.
- `aimedColumn` est la source de vérité pour la conversion pointeur → ancre. Le survol, les flèches d'entrée et le clavier passent tous par elle.
- Une action de dépôt transmet **seulement la colonne**. Le reducer recalcule toujours l'atterrissage ; ne jamais accepter des cellules finales calculées par un composant.
- `connectivity.ts` détecte les connexions sur la **couleur** des cases. Le `pieceId` identifie une pièce physique pour le rendu et l'animation, jamais pour relier les zones gagnantes.
- `simulation.ts` fournit la position pure utilisée par `minimax.ts` : elle rejoue les mêmes fonctions de domaine que le reducer, sans les dupliquer.
- `minimax.ts` traduit seul un niveau en profondeur : `DIFFICULTY_DEPTHS` donne la profondeur visée, `getAffordableDepth` l'abaisse tant que la position offre trop de coups légaux, `chooseMoveForDifficulty` enchaîne les deux pour le joueur au trait. L'interface transmet un niveau, jamais une profondeur.
- `evaluation.ts` : `getConnectionScore` reste la distance de connexion la plus courte d'un joueur (source unique, testée), tandis que `getConnectionPotential` combine les deux axes — le plus proche domine, le second départage — et sert d'heuristique à `minimax.ts`. C'est le second axe qui rend l'évaluation sensible au blocage d'un chemin adverse qui n'était pas le plus court.
- `openingBook.ts` est la source unique du livre d'ouverture : `canonicalPosition` réduit par la **seule** symétrie du jeu — le miroir gauche-droite, la gravité fixant un bas —, et `lookupOpeningMove` rend un coup légal ou `null`. `chooseMoveForDifficulty` le consulte **avant** la recherche, au seul niveau maître, sur les deux premiers coups. `openingBook.data.ts` est généré par `scripts/generate-opening-book.ts` (profondeur 5+, hors ligne) ; vide par défaut, le maître cherche alors en direct comme les autres niveaux. Ne jamais réduire par rotation ni miroir haut-bas : ces transformations inversent le sens de la chute et corrompraient les coups stockés.
- Le départage des ex æquo est le **seul** aléa du domaine, et il est injecté : `random` est un paramètre optionnel de `chooseMinimaxMove` et `chooseMoveForDifficulty`, jamais un `Math.random` appelé ici. Absent, le premier coup rencontré l'emporte et la recherche reste déterministe — c'est ce qui permet au conseil d'être stable pendant que l'adversaire varie. Seul `App.tsx` fournit `Math.random`, pour le tour de l'ordinateur ; les tests fournissent un générateur à graine.
- Reconnaître un ex æquo impose au tour racine une fenêtre alpha ouverte d'un point sous le meilleur score. Les scores sont entiers : l'élagage des coups strictement moins bons est inchangé, mais un coup à égalité revient avec un score exact au lieu d'une borne tronquée. Sans cette ouverture, la racine ne collecte qu'un candidat et le tirage ne varie rien. Ne pas resserrer cette fenêtre à `bestScore`.
- `hint.ts` réutilise cette recherche : `chooseHint` délègue à `chooseMoveForDifficulty` et hérite donc du plafond adaptatif, sans second mécanisme de budget. Il ne réimplémente ni l'énumération des coups ni l'évaluation. `canOfferHint` dit à lui seul quand la commande a un sens — partie en cours et joueur au trait humain.

## Modèle

`types.ts` fait foi ; ne pas dupliquer ces définitions ailleurs.

- `PlayerId` : `'blue' | 'white'`. `ShapeId` : les sept formes. `BOARD_SIZE` vaut `9`.
- `Board` est un tableau de 9 lignes de 9 `BoardCell`, chaque case occupée portant `player`, `pieceId` et `shapeId`.
- `Inventory` compte les exemplaires restants ; `PlayedCopies` mémorise lequel des deux exemplaires a été joué, afin que la silhouette cliquée soit exactement celle qui devient pointillée.
- `DropResult` est un résultat discriminé : soit `{ valid: true, cells, anchorY }`, soit une raison structurée `horizontal-bounds`, `overflow` ou `unsupported`.
- `GameState` porte `phase`, `mode`, `aiPlayer`, `difficulty`, `firstPlayer`, `history`, `board`, `inventories`, `playedCopies`, `activePlayer`, `selection`, `consecutivePasses`, `result`, `lastEvent`, `nextPieceId` et `lastPlacedPieceId`.
- `history` est la suite des `HistoryEntry` : une pose (`RecordedMove`) ou une passe forcée, dans l'ordre. Les joueurs alternent d'une entrée à l'autre, ce qui suffit à re-sérialiser la partie depuis `firstPlayer`.
- Actions du reducer : `START_GAME`, `SELECT_SHAPE`, `ROTATE_SELECTION`, `FLIP_SELECTION`, `DROP_SELECTED_SHAPE`, `PLAY_AI_MOVE`, `RESET_GAME`.
- En mode `ai`, `aiPlayer` vaut `'white'` et l'ordinateur pose uniquement via `PLAY_AI_MOVE` ; ses cases ne passent jamais par le chemin de sélection humain.
- `Difficulty` énumère les niveaux (`DIFFICULTY_IDS`, défaut `DEFAULT_DIFFICULTY`). `START_GAME` transporte le niveau choisi, que `GameState.difficulty` conserve jusqu'à la fin de la partie.

## Notation et positions par URL

La grammaire, la canonicité et le jeton de passe sont spécifiés dans `plan.md` et rappelés en tête de `moveNotation.ts`.

- `parseGameRecord` rejoue les coups en dispatchant les actions du reducer : légalité, victoire, passes et blocage restent calculés par le moteur, jamais recopiés. Il renvoie un résultat discriminé et, en cas de refus, l'index du jeton fautif avec une raison structurée.
- L'écriture canonique d'une orientation est celle des orientations uniques de `transforms.ts`. Les écritures redondantes sont acceptées en lecture puis normalisées, donc `serializeGameRecord(parseGameRecord(x).state) === x` pour toute notation canonique.
- `queryState.ts` accepte `?moves=<notation>` et `?board=<9 lignes B/W/.>&turn=blue|white`. `moves` l'emporte quand les deux sont fournis ; `turn` ne s'applique qu'à `board`.
- Le parseur du format `B/W/.` est `boardText.ts`, partagé par `queryState.ts` et par les tests. Ne pas recréer ce format ailleurs.
- `fixtures/urls.md` contient des URLs prêtes à coller pour les vérifications navigateur.

## Tests

- Ajouter ou adapter des tests pour toute modification de règles, de transformations, de chute, de passe ou de connexion.
- Toujours couvrir le cas négatif : une action refusée ne doit modifier ni la grille, ni l'inventaire, ni le joueur actif.
- Les scénarios de plateau s'écrivent au format textuel `B/W/.` via `boardText.ts`, pas en construisant un `Board` à la main.
- Le duel entre profondeurs de recherche (`depthDuel.test.ts`) dure une trentaine de secondes et reste donc hors de `npm test`. Le lancer après toute modification de l'évaluation ou de la recherche : `LINKX_DEPTH_DUEL=1 npx vitest run src/game/depthDuel.test.ts`.
