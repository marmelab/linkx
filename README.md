# Linkx

Une implémentation en SPA React du jeu de plateau Lynkx, jouable à deux sur le même écran ou contre l'ordinateur.

Règle du jeu officielle (PDF) :

- <https://www.jeux-abstraits.fr/wp-content/uploads/2026/07/lynkx.pdf>

Fiche officielle :

- <https://blueorangegames.eu/fr/jeux/linkx/>

## Démarrage

```bash
npm install
npm run dev
```

| Commande | Rôle |
| --- | --- |
| `npm run dev` | serveur de développement Vite |
| `npm test` | suite Vitest en une passe |
| `npm run test:watch` | Vitest en mode veille |
| `npm run lint` | oxlint |
| `npm run build` | `tsc -b` puis build de production |
| `npm run preview` | sert le build de production |

## Source de vérité

Deux documents, deux périmètres disjoints. Ne pas recopier l'un dans l'autre.

- `plan.md` est la **spécification produit** : règles du jeu, topologie des pièces, algorithmes de domaine, décisions UX, critères d'acceptation et checklists de validation visuelle.
- Ce README est la **spécification technique** : stack, arborescence, modèle de domaine, conventions de code et workflow de vérification. Il sert aussi de `CLAUDE.md` et de `AGENTS.md`.
- Lire entièrement `plan.md` avant toute modification fonctionnelle ou visuelle importante.
- Lorsqu'une décision produit ou utilisateur modifie le comportement attendu, mettre à jour `plan.md` dans le même changement. Supprimer l'ancienne recommandation contradictoire au lieu d'en ajouter une nouvelle à côté.
- Une modification de stack, d'arborescence ou de contrat entre modules se documente ici, pas dans `plan.md`.

## Stack

- React 19, TypeScript, Vite 8, CSS classique dans `src/index.css` et `src/App.css`.
- Vitest pour les tests, oxlint pour le lint.
- Vite 8 demande Node `20.19+`.
- `package-lock.json` fait foi : utiliser `npm`.
- Aucune dépendance d'état, de routage ou de rendu graphique. Le jeu tient dans un reducer React et des fonctions TypeScript pures ; ne pas en ajouter sans nécessité démontrée.

## Arborescence

```text
src/
  game/                 logique pure, sans React
    types.ts            types du domaine, BOARD_SIZE, GameState, GameAction
    pieces.ts           matrices de base, inventaire initial, formes retournables
    transforms.ts       rotations, miroirs, normalisation, orientations uniques
    placement.ts        plateau vide, colonne visée, chute et support
    connectivity.ts     composantes à huit voisins, victoire, plus grande zone, chemin gagnant
    legalMoves.ts       énumération des coups légaux, test d'existence d'un coup
    evaluation.ts       getConnectionScore, heuristique de distance aux bords
    simulation.ts       position pure simulée pour la recherche
    minimax.ts          chooseMinimaxMove, alpha-bêta et table de transposition
    reducer.ts          état initial et transitions du jeu
    boardText.ts        parseur/sérialiseur du format B/W/.
    queryState.ts       construction d'un état depuis la query string
  components/           affichage React
    Board.tsx           grille, ghost, surlignage du chemin gagnant
    DropZone.tsx        entrées de colonnes pour pointeur grossier et clavier
    PieceShape.tsx      rendu SVG d'une orientation
    PieceTray.tsx       réserve d'un joueur
    GameStatus.tsx      bandeau de tour et aperçu de la sélection
    SetupPanel.tsx      choix du mode et du premier joueur
    GameOverPanel.tsx   panneau de fin non modal
    RulesPanel.tsx      règles résumées
    pieceGeometry.ts    getCellsOutlinePath, contour de l'union des cases
    usePointerHasHover.ts  détection du survol réel du pointeur
  App.tsx               câblage du reducer, tour de l'ordinateur, raccourcis clavier
```

Les tests vivent à côté de leur module, en `*.test.ts` / `*.test.tsx`.

## Architecture

- Toute la logique de règles reste dans `src/game/`, tout l'affichage dans `src/components/`. Les fonctions de domaine sont pures, déterministes et testables sans React.
- `placement.ts` est la source de vérité pour la chute et le support. Le ghost, l'énumération des coups et la pose définitive appellent la même fonction `calculateDrop`.
- `aimedColumn` est la source de vérité pour la conversion pointeur → ancre. Le survol, les flèches d'entrée et le clavier passent tous par elle.
- Une action de dépôt transmet seulement la colonne. Le reducer recalcule toujours l'atterrissage ; ne jamais accepter des cellules finales calculées par un composant.
- `connectivity.ts` détecte les connexions sur la **couleur** des cases. Le `pieceId` identifie une pièce physique pour le rendu et l'animation, jamais pour relier les zones gagnantes.
- `pieceGeometry.ts` est la source unique des silhouettes : réserve, aperçu central, ghost et plateau appellent `getCellsOutlinePath` et partagent `OUTLINE_INSET`. Ne pas recréer une géométrie parallèle.
- `simulation.ts` fournit la position pure utilisée par `minimax.ts` ; elle rejoue les mêmes fonctions de domaine que le reducer, sans les dupliquer.
- L'état de survol, les délais et les animations restent dans l'UI tant qu'ils n'affectent pas les règles.

## Modèle de domaine

`src/game/types.ts` fait foi ; ne pas dupliquer ces définitions ailleurs.

- `PlayerId` : `'blue' | 'white'`. `ShapeId` : les sept formes. `BOARD_SIZE` vaut `9`.
- `Board` est un tableau de 9 lignes de 9 `BoardCell`, chaque case occupée portant `player`, `pieceId` et `shapeId`.
- `Inventory` compte les exemplaires restants ; `PlayedCopies` mémorise lequel des deux exemplaires a été joué, afin que la silhouette cliquée soit exactement celle qui devient pointillée.
- `DropResult` est un résultat discriminé : soit `{ valid: true, cells, anchorY }`, soit une raison structurée `horizontal-bounds`, `overflow` ou `unsupported`.
- `GameState` porte `phase`, `mode`, `aiPlayer`, `board`, `inventories`, `playedCopies`, `activePlayer`, `selection`, `consecutivePasses`, `result`, `lastEvent`, `nextPieceId` et `lastPlacedPieceId`.
- Actions du reducer : `START_GAME`, `SELECT_SHAPE`, `ROTATE_SELECTION`, `FLIP_SELECTION`, `DROP_SELECTED_SHAPE`, `PLAY_AI_MOVE`, `RESET_GAME`.
- En mode `ai`, `aiPlayer` vaut `'white'` et l'ordinateur pose uniquement via `PLAY_AI_MOVE` ; ses cases ne passent jamais par le chemin de sélection humain.

## Fixtures de position par URL

`?board=<9 lignes B/W/. séparées par />&turn=blue|white` démarre directement sur une grille non vide. Une connexion déjà gagnante ouvre le panneau final.

- Le parseur partagé est `src/game/boardText.ts`, utilisé à la fois par `queryState.ts` et par les tests d'évaluation. Ne pas recréer ce format dans un test.
- Les fixtures regroupent les cases orthogonalement connexes d'une couleur sous un même `pieceId`. Elles ne restaurent ni l'inventaire consommé, ni la frontière entre deux pièces adjacentes de même couleur.

## Tests et vérification

- Ajouter ou adapter des tests de domaine pour toute modification de règles, de transformations, de chute, de passe ou de connexion.
- Toujours couvrir le cas négatif : une action refusée ne doit modifier ni la grille, ni l'inventaire, ni le joueur actif.
- Les scénarios de plateau s'écrivent au format textuel `B/W/.` via `boardText.ts`, pas en construisant un `Board` à la main.
- Pour toute modification d'interface, faire aussi le passage navigateur décrit dans `plan.md` (étape de vérification finale) sur un viewport bureau et un viewport mobile, et vérifier l'absence de débordement horizontal et d'erreur console.

Vérification finale obligatoire :

```bash
npm test
npm run lint
npm run build
```

## Discipline de modification

- Préserver les changements existants de l'utilisateur et éviter les réécritures sans rapport avec la tâche.
- Préférer de petits composants et des fonctions nommées aux duplications de logique.
- Ne pas modifier les matrices des pièces, les règles de support ou la connectivité pour résoudre un problème purement visuel.
- Ne pas introduire de backend, de jeu en réseau, de comptes, de persistance ou d'effets sonores sans demande explicite. L'adversaire ordinateur existe déjà et reste local : `minimax.ts` tourne dans le navigateur, sans appel réseau.
- Avant de terminer, examiner le diff, exécuter `git diff --check` et résumer les vérifications effectuées.
