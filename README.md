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
    hint.ts             chooseHint et canOfferHint, conseil au joueur au trait
    reducer.ts          état initial et transitions du jeu
    boardText.ts        parseur/sérialiseur du format B/W/.
    moveNotation.ts     grammaire, parse et sérialisation d'une notation de partie
    queryState.ts       construction d'un état depuis la query string
  components/           affichage React
    Board.tsx           grille, ghost, surlignage du chemin gagnant et du conseil
    DropZone.tsx        entrées de colonnes pour pointeur grossier et clavier
    PieceShape.tsx      rendu SVG d'une orientation
    PlexiDefs.tsx       `<defs>` partagés : biseau, reflet et ombre des pièces
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
- L'éclairage doit rester **invariant par rotation et par miroir** : la lumière vient toujours du haut à gauche de l'écran. Les liserés de tranche sont donc des `feOffset` d'espace utilisateur, et le reflet un `linearGradient` en `gradientUnits="userSpaceOnUse"` ancré sur la scène. Proscrire les dégradés en `objectBoundingBox`, qui s'étirent avec la boîte de la forme, et les `transform` SVG sur une silhouette : `getOrientation` cuit déjà l'orientation dans les coordonnées du chemin.
- **Aucune couche de matière ne doit avoir une portée proche de la case.** Une pièce est un polyomino : ses divisions internes tombent sur la grille, donc tout effet à cette échelle s'aligne dessus et découpe la dalle en carrés de teintes différentes. Les longueurs du filtre restent bien en deçà (~0,06 case), le reflet bien au-delà (la diagonale du plateau).
- Ne pas employer `feSpecularLighting` ni `feDiffuseLighting`. Ces filtres dérivent une normale du canal alpha avec un pas d'échantillonnage que la spécification ne fixe pas : Gecko le prend à l'unité d'espace utilisateur, qui vaut ici une case, et chaque case reçoit sa propre lumière — une barre 1×3, pourtant un simple rectangle, se rend en trois bandes. Blink échantillonne en pixels de sortie et masque le défaut ; c'est Blink l'exception. Le reflet doit venir d'un dégradé, qui ne dérive rien du contour.
- Les longueurs du filtre sont en **unités de case**, jamais en pixels : le plateau et la réserve dessinent une case par unité utilisateur, donc le relief garde la même épaisseur relative à toutes les échelles. Même piège dans un `transform` CSS sur un élément SVG, où une longueur s'exprime aussi en unités de case et non en pixels d'écran.
- `PlexiDefs.test.tsx` verrouille ces points : dégradés tous en `userSpaceOnUse`, aucun filtre d'éclairage, aucune longueur de filtre à l'échelle de la case, et huit orientations d'une forme asymétrique qui ne diffèrent que par leur tracé.
- `simulation.ts` fournit la position pure utilisée par `minimax.ts` ; elle rejoue les mêmes fonctions de domaine que le reducer, sans les dupliquer.
- `minimax.ts` traduit seul un niveau en profondeur : `DIFFICULTY_DEPTHS` donne la profondeur visée, `getAffordableDepth` l'abaisse tant que la position offre trop de coups légaux, et `chooseMoveForDifficulty` enchaîne les deux pour le joueur au trait. L'interface transmet un niveau, jamais une profondeur.
- `hint.ts` conseille le joueur au trait en réutilisant la recherche existante : `chooseHint` délègue à `chooseMoveForDifficulty` et hérite donc du plafond adaptatif, sans second mécanisme de budget. Il ne réimplémente ni l'énumération des coups ni l'évaluation. `canOfferHint` dit à lui seul quand la commande a un sens — partie en cours et joueur au trait humain.
- Le conseil est rattaché dans `App.tsx` à l'**état exact** pour lequel il a été demandé, jamais à un drapeau. Toute action produit un nouvel état, donc la demande en cours et le conseil affiché cessent d'y correspondre et disparaissent sans qu'aucun effet n'ait à les nettoyer, y compris si le joueur agit pendant la recherche. Une action refusée renvoie l'état inchangé et laisse le conseil en place, ce qui est le comportement voulu.
- La mise en évidence du conseil est un mécanisme **distinct** du chemin gagnant : classes, calque et teinte propres. Le chemin gagnant reste un contour transparent sur des pièces posées ; le conseil désigne des cases vides et porte un fond. Ne pas fondre les deux rendus.
- L'état de survol, les délais et les animations restent dans l'UI tant qu'ils n'affectent pas les règles.

### Ordre des réserves et mise en page

`App.tsx` rend le plateau d'abord, puis les deux réserves **dans l'ordre du tour**, la réserve du joueur actif en tête. L'ordre du DOM est donc toujours l'ordre visuel, y compris pour un lecteur d'écran ou une tabulation.

- Sur trois colonnes, cet ordre ne doit rien décider : `App.css` pose chaque réserve sur la colonne de sa couleur avec `grid-area`, la bleue à gauche comme l'annonce la flèche du bandeau. Ne pas revenir à un placement automatique, il suivrait le tour.
- En une seule colonne, la permutation des deux réserves porte le tour à elle seule : le bandeau visuel y est supprimé, il répétait cette information au prix de 88px de haut. Le signal reste doublé pour qui ne le voit pas — la région `aria-live` du bandeau, elle, est conservée et continue d'annoncer le changement. Une permutation muette serait invisible pour un lecteur d'écran ; ne pas retirer cette région en même temps que le bandeau.
- Sur trois colonnes en revanche, les réserves sont ancrées par couleur et ne permutent jamais : le bandeau y est le seul indicateur de tour et doit rester.
- Les sélecteurs `.play-area + .piece-tray` et `.piece-tray + .piece-tray` désignent respectivement la réserve active et l'adverse. Ils tiennent de l'ordre du DOM, donc aucune classe d'état n'est à câbler côté React.
- La réserve empilée est une grille de sept colonnes — un groupe de forme par colonne, les deux exemplaires empilés. `--piece-cell` s'y déduit de la largeur de colonne : la silhouette rétrécit, la cible tactile reste à 44px. Ne pas réintroduire de défilement horizontal dans la réserve.

### Hauteur au-dessus du plateau, sur téléphone

Le plateau est l'élément principal : sur téléphone il commence immédiatement sous l'en-tête et **son bord haut ne bouge jamais**, ni à la sélection, ni à la rotation, ni à la victoire. Deux blocs de hauteur variable le menaçaient et sont traités séparément :

- `play-head` — le bandeau et l'aperçu de la pièce sélectionnée — est regroupé dans un conteneur et renvoyé **sous** le plateau par `order`. L'ordre du DOM est inchangé, si bien que `Tourner`/`Retourner` précèdent toujours les flèches de colonne à la tabulation.
- Sa hauteur y est **réservée en permanence** (`--head-height`), pièce sélectionnée ou non. Choisir une pièce ne doit rien déplacer, et surtout pas la réserve que le doigt vient de toucher. Ne pas la rendre escamotable pour gagner de la place : c'est un arbitrage explicite en faveur de la stabilité.
- La valeur est calée sur le contenu réel — trois cases d'aperçu — et non sur les 150px du bureau. Le panneau de fin de partie vient s'afficher dans cette même zone déjà payée, sur toute la largeur : rien ne bouge non plus à la victoire. Sur les écrans les plus étroits, un panneau de blocage très bavard peut la dépasser de quelques pixels ; la partie est alors finie et plus rien n'est à cliquer dans les réserves.
- La rangée se découpe en trois colonnes symétriques : message à gauche, aperçu centré sur la largeur du plateau, commandes contre le bord droit. Les deux commandes sont côte à côte et non empilées — c'est ce qui permet de tenir deux cibles de 44px dans une rangée de 84.
- Le bouton de conseil vit dans la colonne de gauche, avec le message, empilés et calés en bas. C'est la seule colonne au contenu variable : les deux autres ont une géométrie fixe, donc ni l'aperçu ni les commandes de rotation ne bougent quand le conseil apparaît ou disparaît en cours de partie. Toute nouvelle commande de ce genre a sa place ici, pas ailleurs.
- Le message est tronqué à deux lignes dans cette colonne étroite, sinon il pousserait la rangée et donc les réserves. Le texte complet reste annoncé : la région `aria-live` ne dépend pas de ce qui est peint. Les libellés doivent donc porter leur sens dans leur premier membre de phrase.
- La rangée de flèches de dépôt ne réserve plus de hauteur : elle se **superpose** au haut du plateau, alignée sur ses colonnes par `--board-inset`, qui vaut la somme marge du cadre + bordure + marge intérieure. Modifier l'un de ces trois padding sans mettre `--board-inset` à jour désaligne les flèches.
- Cette superposition est réservée au téléphone. Au-delà, le pointeur sait survoler et cette bande est le prolongement haut de la surface de visée : elle doit rester au-dessus du plateau pour qu'on puisse l'approcher par le haut.

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
