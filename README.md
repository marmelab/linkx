# Linkx

Une implémentation en SPA React du jeu de plateau Linkx, jouable à deux sur le même écran ou contre l'ordinateur. L'application est installable et jouable hors ligne.

Règle officielle : <https://www.jeux-abstraits.fr/wp-content/uploads/2026/07/lynkx.pdf> · fiche éditeur : <https://blueorangegames.eu/fr/jeux/linkx/>

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
- Ce README est la **spécification technique** : stack, arborescence, contrats entre modules, workflow de vérification. Il sert aussi de `CLAUDE.md` et de `AGENTS.md`, donc il est lu **en entier à chaque session** : le garder court.
- Lire entièrement `plan.md` avant toute modification fonctionnelle ou visuelle importante.
- Lorsqu'une décision produit ou utilisateur modifie le comportement attendu, mettre à jour `plan.md` dans le même changement. Supprimer l'ancienne recommandation contradictoire au lieu d'en ajouter une nouvelle à côté.
- Une modification de stack, d'arborescence ou de contrat entre modules se documente ici, pas dans `plan.md`.
- Le savoir propre à un répertoire vit dans le `CLAUDE.md` de ce répertoire : `src/game/CLAUDE.md` pour les invariants du domaine, `src/components/CLAUDE.md` pour les pièges de rendu et de mise en page. Y écrire de préférence tout ce qui ne sert pas à chaque session.

## Stack

- React 19, TypeScript, Vite 8, CSS classique dans `src/index.css` et `src/App.css`.
- Vitest pour les tests, oxlint pour le lint.
- Vite 8 demande Node `20.19+`.
- `package-lock.json` fait foi : utiliser `npm`.
- Aucune dépendance d'état, de routage ou de rendu graphique. Le jeu tient dans un reducer React et des fonctions TypeScript pures ; ne pas en ajouter sans nécessité démontrée.

## Arborescence

```text
src/
  game/                 logique pure, sans React — voir src/game/CLAUDE.md
    types.ts            types du domaine, BOARD_SIZE, GameState, GameAction
    pieces.ts           matrices de base, inventaire initial, formes retournables
    transforms.ts       rotations, miroirs, normalisation, orientations uniques
    placement.ts        plateau vide, colonne visée, chute et support
    connectivity.ts     composantes à huit voisins, victoire, plus grande zone
    legalMoves.ts       énumération des coups légaux, test d'existence d'un coup
    evaluation.ts       getConnectionScore, heuristique de distance aux bords
    simulation.ts       position pure simulée pour la recherche
    minimax.ts          alpha-bêta, table de transposition, niveaux de difficulté
    hint.ts             chooseHint et canOfferHint, conseil au joueur au trait
    reducer.ts          état initial et transitions du jeu
    boardText.ts        parseur/sérialiseur du format B/W/.
    moveNotation.ts     grammaire, parse et sérialisation d'une notation de partie
    queryState.ts       construction d'un état depuis la query string
  components/           affichage React — voir src/components/CLAUDE.md
    Board.tsx           grille, ghost, surlignage du chemin gagnant et du conseil
    DropZone.tsx        entrées de colonnes pour pointeur grossier et clavier
    PieceShape.tsx      rendu SVG d'une orientation
    PlexiDefs.tsx       `<defs>` partagés : biseau, reflet et ombre des pièces
    PieceTray.tsx       réserve d'un joueur
    GameStatus.tsx      bandeau de tour et aperçu de la sélection
    SelectedPiecePreview.tsx  pièce en main, tournée et retournée par mouvement
    pieceTurn.ts        mouvement déduit de la différence entre deux sélections
    SetupPanel, RulesPanel, GameOverPanel, Fireworks : écrans et panneaux
    winningTrail.ts     reconstruction du tracé du chemin gagnant
    pieceGeometry.ts    getCellsOutlinePath, contour de l'union des cases
    usePointerHasHover.ts  détection du survol réel du pointeur
    useStoredDifficulty.ts  niveau de l'ordinateur retenu d'une partie à l'autre
  App.tsx               câblage du reducer, tour de l'ordinateur, raccourcis clavier
  App.css, index.css    toute la mise en page
  main.tsx              montage React et enregistrement du service worker
public/                 copié tel quel : manifeste, service worker, icônes
scripts/generate-icons.mjs · fixtures/urls.md : outils et positions de test
```

Les tests vivent à côté de leur module, en `*.test.ts` / `*.test.tsx`.

## Architecture

- Toute la logique de règles reste dans `src/game/`, tout l'affichage dans `src/components/`. Les fonctions de domaine sont pures, déterministes et testables sans React.
- `src/game/types.ts` fait foi pour le modèle de domaine ; ne pas dupliquer ces définitions ailleurs.
- Une action de dépôt transmet seulement la colonne. Le reducer recalcule toujours l'atterrissage ; ne jamais accepter des cellules finales calculées par un composant.
- `placement.ts` pour la chute et le support, `aimedColumn` pour la conversion pointeur → ancre, `pieceGeometry.ts` pour les silhouettes, `PlexiDefs.tsx` pour la matière : chacun est **source unique** de son sujet. Ne pas en recréer une variante à côté.
- `connectivity.ts` détecte les connexions sur la **couleur** des cases. Le `pieceId` identifie une pièce physique pour le rendu et l'animation, jamais pour relier les zones gagnantes.
- L'état de survol, les délais et les animations restent dans l'UI tant qu'ils n'affectent pas les règles.
- `App.tsx` ne fait que câbler : reducer, tour de l'ordinateur, raccourcis clavier. Les invariants qu'il doit respecter sont détaillés dans les deux `CLAUDE.md` de répertoire.

## Tests et vérification

- Ajouter ou adapter des tests de domaine pour toute modification de règles, de chute, de passe ou de connexion, et toujours couvrir le cas de refus.
- Pour toute modification d'interface, faire aussi le passage navigateur décrit dans `plan.md` (étape de vérification finale) sur un viewport bureau et un viewport mobile, et vérifier l'absence de débordement horizontal et d'erreur console. `fixtures/urls.md` fournit des positions prêtes à coller.

Vérification finale obligatoire :

```bash
npm test
npm run lint
npm run build
```

## Publication

`.github/workflows/ci.yml` fait foi : lint, tests et build sur `push` et `pull_request` vers `main`, puis publication de `dist/` sur `gh-pages` au seul `push` vers `main`. Le site est servi par GitHub Pages sous un sous-chemin, et l'application s'installe et se relance hors ligne. D'où quatre contraintes à ne pas casser :

- `vite.config.ts` fixe `base: './'`, et toute référence à un fichier de `public/` s'écrit en relatif (`./favicon.svg`). Une base absolue rendrait la page blanche sous le sous-chemin. Même règle pour `start_url` et `scope` du manifeste, qui valent `./`, et pour le `./sw.js` enregistré par `main.tsx` — ce chemin fixe aussi la portée du worker. `public/.nojekyll` empêche GitHub Pages de filtrer les fichiers commençant par un underscore.
- `public/sw.js` applique **réseau d'abord** pour les documents, **cache d'abord** pour `assets/…` dont le nom est haché, **cache puis revalidation** pour le reste. Ne pas passer le HTML en cache d'abord : il porte les noms hachés du build courant. À l'installation le worker relit le document pour y trouver les assets à précharger, plutôt qu'une liste de noms hachés codée en dur. Toute modification des stratégies ou du contenu préchargé impose d'incrémenter `VERSION`, qui purge les anciens caches à l'activation.
- `main.tsx` n'enregistre le worker que si `import.meta.env.PROD`, pour ne pas masquer le rechargement à chaud en développement. `index.html` porte le lien vers le manifeste, `theme-color`, et les balises `apple-touch-icon` et `apple-mobile-web-app-*` qu'iOS exige faute d'implémenter le manifeste.
- Vérification manuelle après `npm run build` : servir `dist/` depuis un sous-répertoire (`…/linkx/`), contrôler que le worker atteint `activated`, puis recharger serveur arrêté.

## Discipline de modification

- Préserver les changements existants de l'utilisateur et éviter les réécritures sans rapport avec la tâche.
- Préférer de petits composants et des fonctions nommées aux duplications de logique.
- **Commenter peu.** Un commentaire n'explique que ce qui n'est pas clair à la lecture du code. Ne rien redire de ce que `plan.md` ou un `CLAUDE.md` spécifie déjà : le doublon se périme. Souvent, un meilleur nom suffit.
- Ne pas modifier les matrices des pièces, les règles de support ou la connectivité pour résoudre un problème purement visuel.
- Ne pas introduire de backend, de jeu en réseau, de comptes, de persistance ou d'effets sonores sans demande explicite. Seule exception accordée à ce jour : le niveau de l'ordinateur, retenu dans `localStorage` par `useStoredDifficulty.ts`. Rien d'autre n'est stocké — surtout pas l'état d'une partie, dont `plan.md` exige qu'elle reparte à zéro. Tout ce qui est relu du stockage se valide avant emploi. L'adversaire ordinateur existe déjà et reste local : `minimax.ts` tourne dans le navigateur, sans appel réseau.
- Avant de terminer, examiner le diff, exécuter `git diff --check` et résumer les vérifications effectuées.
