# Linkx

Une implémentation en SPA React du jeu de plateau Linkx, jouable à deux sur le même écran ou contre l'ordinateur. L'application est installable et jouable hors ligne.

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
| `node scripts/generate-icons.mjs` | régénère les icônes PNG de `public/` |

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
    minimax.ts          chooseMinimaxMove, niveaux de difficulté, alpha-bêta et table de transposition
    reducer.ts          état initial et transitions du jeu
    boardText.ts        parseur/sérialiseur du format B/W/.
    moveNotation.ts     grammaire, parse et sérialisation d'une notation de partie
    queryState.ts       construction d'un état depuis la query string
  components/           affichage React
    Board.tsx           grille, ghost, surlignage du chemin gagnant
    DropZone.tsx        entrées de colonnes pour pointeur grossier et clavier
    PieceShape.tsx      rendu SVG d'une orientation
    PlexiDefs.tsx       `<defs>` partagés : biseau, reflets et ombre des pièces
    PieceTray.tsx       réserve d'un joueur
    GameStatus.tsx      bandeau de tour et aperçu de la sélection
    SetupPanel.tsx      choix du mode et du niveau de l'ordinateur
    GameOverPanel.tsx   panneau de fin non modal
    RulesPanel.tsx      règles résumées
    pieceGeometry.ts    getCellsOutlinePath, contour de l'union des cases
    usePointerHasHover.ts  détection du survol réel du pointeur
  App.tsx               câblage du reducer, tour de l'ordinateur, raccourcis clavier
  main.tsx              montage React et enregistrement du service worker
public/                 copié tel quel à la racine du site publié
  manifest.webmanifest  manifeste de l'application installable
  sw.js                 service worker : hors-ligne et stratégies de cache
  icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png
  favicon.svg, icons.svg
scripts/
  generate-icons.mjs    régénère les PNG d'icônes, sans dépendance npm
```

Les tests vivent à côté de leur module, en `*.test.ts` / `*.test.tsx`.

## Architecture

- Toute la logique de règles reste dans `src/game/`, tout l'affichage dans `src/components/`. Les fonctions de domaine sont pures, déterministes et testables sans React.
- `placement.ts` est la source de vérité pour la chute et le support. Le ghost, l'énumération des coups et la pose définitive appellent la même fonction `calculateDrop`.
- `aimedColumn` est la source de vérité pour la conversion pointeur → ancre. Le survol, les flèches d'entrée et le clavier passent tous par elle.
- Une action de dépôt transmet seulement la colonne. Le reducer recalcule toujours l'atterrissage ; ne jamais accepter des cellules finales calculées par un composant.
- `connectivity.ts` détecte les connexions sur la **couleur** des cases. Le `pieceId` identifie une pièce physique pour le rendu et l'animation, jamais pour relier les zones gagnantes.
- `pieceGeometry.ts` est la source unique des silhouettes : réserve, aperçu central, ghost et plateau appellent `getCellsOutlinePath` et partagent `OUTLINE_INSET`. Ne pas recréer une géométrie parallèle.
- `PlexiDefs.tsx` est la source unique de la **matière** des pièces, comme `pieceGeometry.ts` l'est de leur forme. Il rend une fois par document un jeu de `<defs>` que toutes les silhouettes référencent en `filter: url(#…)` depuis le CSS. Ne pas ajouter de fichier SVG par pièce ni par orientation : la géométrie y serait dupliquée et l'éclairage deviendrait solidaire de la pièce.
- L'éclairage doit rester **invariant par rotation et par miroir** : la lumière vient toujours du haut à gauche de l'écran. Il n'est donc exprimé qu'avec des primitives d'espace utilisateur — `feDistantLight`, `feOffset`, `feDropShadow`. Proscrire les dégradés en `objectBoundingBox`, qui s'étirent avec la boîte de la forme, et les `transform` SVG sur une silhouette : `getOrientation` cuit déjà l'orientation dans les coordonnées du chemin. `PlexiDefs.test.tsx` verrouille ces deux points.
- Les longueurs du filtre sont en **unités de case**, jamais en pixels : le plateau et la réserve dessinent une case par unité utilisateur, donc le relief garde la même épaisseur relative à toutes les échelles.
- `simulation.ts` fournit la position pure utilisée par `minimax.ts` ; elle rejoue les mêmes fonctions de domaine que le reducer, sans les dupliquer.
- `minimax.ts` traduit seul un niveau en profondeur : `DIFFICULTY_DEPTHS` donne la profondeur visée, `getAffordableDepth` l'abaisse tant que la position offre trop de coups légaux, et `chooseMoveForDifficulty` enchaîne les deux pour le joueur au trait. L'interface transmet un niveau, jamais une profondeur.
- L'état de survol, les délais et les animations restent dans l'UI tant qu'ils n'affectent pas les règles.

### Ordre des réserves et mise en page

`App.tsx` rend le plateau d'abord, puis les deux réserves **dans l'ordre du tour**, la réserve du joueur actif en tête. L'ordre du DOM est donc toujours l'ordre visuel, y compris pour un lecteur d'écran ou une tabulation.

- Sur trois colonnes, cet ordre ne doit rien décider : `App.css` pose chaque réserve sur la colonne de sa couleur avec `grid-area`, la bleue à gauche comme l'annonce la flèche du bandeau. Ne pas revenir à un placement automatique, il suivrait le tour.
- En une seule colonne, la permutation des deux réserves est le signal de tour principal. Elle n'est jamais le seul : le bandeau garde sa flèche et sa teinte, et sa région `aria-live` annonce le changement. Une permutation muette serait invisible pour un lecteur d'écran.
- Les sélecteurs `.play-area + .piece-tray` et `.piece-tray + .piece-tray` désignent respectivement la réserve active et l'adverse. Ils tiennent de l'ordre du DOM, donc aucune classe d'état n'est à câbler côté React.
- La réserve empilée est une grille de sept colonnes — un groupe de forme par colonne, les deux exemplaires empilés. `--piece-cell` s'y déduit de la largeur de colonne : la silhouette rétrécit, la cible tactile reste à 44px. Ne pas réintroduire de défilement horizontal dans la réserve.

### Zone sûre iOS

`index.html` déclare `viewport-fit=cover` et `apple-mobile-web-app-status-bar-style: black-translucent`. Les deux vont ensemble : sans les retraits, la barre d'état translucide recouvrirait le bandeau. `App.css` reprend `env(safe-area-inset-*)` sur le bandeau, la grille de jeu, la dernière réserve et les écrans plein écran. Repasser la barre d'état en `default` sans retirer ces retraits laisserait une bande vide en haut.

## Modèle de domaine

`src/game/types.ts` fait foi ; ne pas dupliquer ces définitions ailleurs.

- `PlayerId` : `'blue' | 'white'`. `ShapeId` : les sept formes. `BOARD_SIZE` vaut `9`.
- `Board` est un tableau de 9 lignes de 9 `BoardCell`, chaque case occupée portant `player`, `pieceId` et `shapeId`.
- `Inventory` compte les exemplaires restants ; `PlayedCopies` mémorise lequel des deux exemplaires a été joué, afin que la silhouette cliquée soit exactement celle qui devient pointillée.
- `DropResult` est un résultat discriminé : soit `{ valid: true, cells, anchorY }`, soit une raison structurée `horizontal-bounds`, `overflow` ou `unsupported`.
- `GameState` porte `phase`, `mode`, `aiPlayer`, `difficulty`, `firstPlayer`, `history`, `board`, `inventories`, `playedCopies`, `activePlayer`, `selection`, `consecutivePasses`, `result`, `lastEvent`, `nextPieceId` et `lastPlacedPieceId`.
- `history` est la suite des `HistoryEntry` : une pose (`RecordedMove`) ou une passe forcée, dans l'ordre. Les joueurs alternent d'une entrée à l'autre, ce qui suffit à re-sérialiser la partie depuis `firstPlayer`.
- Actions du reducer : `START_GAME`, `SELECT_SHAPE`, `ROTATE_SELECTION`, `FLIP_SELECTION`, `DROP_SELECTED_SHAPE`, `PLAY_AI_MOVE`, `RESET_GAME`.
- En mode `ai`, `aiPlayer` vaut `'white'` et l'ordinateur pose uniquement via `PLAY_AI_MOVE` ; ses cases ne passent jamais par le chemin de sélection humain.
- `Difficulty` énumère les niveaux de l'ordinateur (`DIFFICULTY_IDS`, défaut `DEFAULT_DIFFICULTY`). `START_GAME` transporte le niveau choisi, que `GameState.difficulty` conserve jusqu'à la fin de la partie.

### Notation de partie par URL

`?moves=<notation>` rejoue une partie coup par coup et restaure donc la position complète : plateau, réserves, exemplaires pointillés, joueur actif et issue éventuelle.

- La grammaire, la règle de canonicité et le jeton de passe sont documentés en tête de `src/game/moveNotation.ts` : `<forme>[s][r|l N]<colonne>`, formes `1`, `2`, `3I`, `3L`, `4S`, `4T`, `4L`, colonne d'ancrage de 1 à 9 toujours en dernier, `--` pour un tour passé.
- `parseGameRecord` rejoue les coups en dispatchant les actions du reducer : légalité, victoire, passes et blocage restent calculés par le moteur, jamais recopiés. Il renvoie un résultat discriminé et, en cas de refus, l'index du jeton fautif avec une raison structurée.
- Une orientation donnée n'a qu'une écriture canonique, celle des orientations uniques de `transforms.ts`. Les écritures redondantes sont acceptées en lecture puis normalisées, donc `serializeGameRecord(parseGameRecord(x).state) === x` pour toute notation canonique.
- `GameState` porte `firstPlayer` et `history` pour re-sérialiser une partie en cours ; le reducer y ajoute chaque pose et chaque passe forcée.
- `fixtures/urls.md` contient des URLs prêtes à coller pour les vérifications navigateur.

## Tests et vérification

- Ajouter ou adapter des tests de domaine pour toute modification de règles, de transformations, de chute, de passe ou de connexion.
- Toujours couvrir le cas négatif : une action refusée ne doit modifier ni la grille, ni l'inventaire, ni le joueur actif.
- Les scénarios de plateau s'écrivent au format textuel `B/W/.` via `boardText.ts`, pas en construisant un `Board` à la main.
- Pour toute modification d'interface, faire aussi le passage navigateur décrit dans `plan.md` (étape de vérification finale) sur un viewport bureau et un viewport mobile, et vérifier l'absence de débordement horizontal et d'erreur console.
- Le duel entre profondeurs de recherche (`src/game/depthDuel.test.ts`) dure une trentaine de secondes et reste donc hors de `npm test`. Le lancer après toute modification de l'évaluation ou de la recherche : `LINKX_DEPTH_DUEL=1 npx vitest run src/game/depthDuel.test.ts`.

Vérification finale obligatoire :

```bash
npm test
npm run lint
npm run build
```

## Intégration continue et déploiement

`.github/workflows/ci.yml` tourne sur `push` vers `main`, sur `pull_request` vers `main` et manuellement (`workflow_dispatch`). Un `concurrency` par branche annule les runs obsolètes.

- Job `quality` : Node 22, cache npm, `npm ci`, puis `npm run lint`, `npm test` et `npm run build`. Il téléverse `dist/` en artefact.
- Job `deploy` : dépend de `quality` et ne s'exécute que sur un `push` vers `main`, jamais sur une PR. Il publie `dist/` sur la branche `gh-pages` via `peaceiris/actions-gh-pages@v4`.
- Le workflow est en `contents: read` ; seul le job `deploy` élève ses droits à `contents: write`.

Le site est servi par GitHub Pages sous un sous-chemin. Les liens vers les assets doivent donc rester **relatifs** :

- `vite.config.ts` fixe `base: './'`. Ne pas repasser à une base absolue : les balises générées deviendraient `/assets/...` et la page serait blanche sous le sous-chemin.
- Toute référence à un fichier de `public/` s'écrit en relatif (`./favicon.svg`), jamais `/favicon.svg`.
- `public/.nojekyll` empêche GitHub Pages de filtrer les fichiers commençant par un underscore.

## Application installable (PWA)

Le jeu s'installe sur l'écran d'accueil et se relance hors ligne. Tout est écrit à la main : aucune dépendance PWA n'est nécessaire pour une application d'un seul bundle sans découpage de code.

- `public/manifest.webmanifest` déclare le nom, les icônes, `display: standalone` et l'orientation. `start_url` et `scope` valent `./` : le manifeste se résout donc sous n'importe quel sous-chemin de publication. Ne pas y écrire de chemin absolu.
- `index.html` porte le lien vers le manifeste, `theme-color`, et les balises `apple-touch-icon` et `apple-mobile-web-app-*` qu'iOS exige faute d'implémenter le manifeste.
- `src/main.tsx` enregistre `./sw.js` seulement si `import.meta.env.PROD`, pour ne pas masquer le rechargement à chaud en développement. Le chemin relatif fixe aussi la portée du worker.
- `public/sw.js` applique trois stratégies : **réseau d'abord** pour les documents, **cache d'abord** pour `assets/…` dont le nom est haché, **cache puis revalidation** pour le reste de l'origine. Un déploiement ne peut donc pas enfermer un joueur sur une version périmée. Ne pas passer le HTML en cache d'abord : il porte les noms hachés du build courant.
- À l'installation, le worker relit le document pour y trouver les assets du build et les précharger : le hors-ligne fonctionne dès la fin de la première visite, sans liste de fichiers hachés codée en dur.
- Changer les stratégies ou le contenu préchargé impose d'incrémenter `VERSION` dans `public/sw.js` : les anciens caches sont purgés à l'activation.

Les icônes sont produites par `node scripts/generate-icons.mjs`, qui écrit des PNG valides à partir de `zlib` seul. Régénérer après toute retouche du motif ou de la palette, puis vérifier les dimensions (`file public/icon-192.png`).

Vérification manuelle après `npm run build` : servir `dist/` depuis un sous-répertoire (`…/linkx/`) pour reproduire le sous-chemin, contrôler que le worker atteint `activated`, puis recharger serveur arrêté.

## Discipline de modification

- Préserver les changements existants de l'utilisateur et éviter les réécritures sans rapport avec la tâche.
- Préférer de petits composants et des fonctions nommées aux duplications de logique.
- Ne pas modifier les matrices des pièces, les règles de support ou la connectivité pour résoudre un problème purement visuel.
- Ne pas introduire de backend, de jeu en réseau, de comptes, de persistance ou d'effets sonores sans demande explicite. L'adversaire ordinateur existe déjà et reste local : `minimax.ts` tourne dans le navigateur, sans appel réseau.
- Avant de terminer, examiner le diff, exécuter `git diff --check` et résumer les vérifications effectuées.
