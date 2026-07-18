# Consignes de développement — Linkx

## Source de vérité

- Lire entièrement `plan.md` avant toute modification fonctionnelle ou visuelle importante.
- `plan.md` est la spécification de référence : règles, topologies, algorithmes, UX, tests et critères d'acceptation doivent rester cohérents avec lui.
- Lorsqu'une décision produit ou utilisateur modifie le comportement attendu, mettre à jour `plan.md` dans le même changement. Supprimer les anciennes recommandations contradictoires au lieu de simplement en ajouter une nouvelle.

## Stack et commandes

- Utiliser `npm` ; le dépôt contient un `package-lock.json`.
- Stack : React 19, TypeScript, Vite, CSS classique, Vitest et oxlint.
- Ne pas ajouter de bibliothèque d'état ou de rendu graphique sans nécessité démontrée. Le jeu tient dans un reducer React et des fonctions TypeScript pures.
- Vite 8 demande Node `20.19+` ou une version compatible plus récente. Si le Node système est trop ancien, utiliser le runtime récent fourni par l'espace de travail.
- Vérification finale obligatoire :

```bash
npm test
npm run lint
npm run build
```

## Architecture

- Garder toute la logique de règles dans `src/game/` et les composants d'affichage dans `src/components/`.
- Les fonctions de domaine doivent rester pures, déterministes et testables sans React.
- `src/game/placement.ts` est la source de vérité pour la chute et le support. Le ghost, l'énumération des coups et la pose définitive doivent appeler la même logique.
- Une action de dépôt transmet seulement la colonne. Le reducer recalcule toujours l'atterrissage ; ne jamais accepter des cellules finales calculées par un composant.
- La détection des connexions travaille sur la couleur des cellules. Le `pieceId` sert à identifier une pièce physique pour le rendu, pas pour relier les zones gagnantes.
- Garder l'état de survol et les animations dans l'UI lorsqu'ils n'affectent pas les règles.

## Invariants métier à préserver

- Plateau fixe de 9 × 9.
- Deux joueurs, bleu et blanc.
- Sept formes exactes, deux exemplaires de chaque forme par joueur, soit 14 pièces et 42 cases de matière par joueur.
- Générer rotations et miroirs depuis les matrices de base, normaliser les coordonnées et dédupliquer les géométries.
- La pose suit une chute verticale naturelle, sans chevauchement, dépassement ni vide sous une partie de la face inférieure.
- Les connexions utilisent les huit voisins : côtés et diagonales.
- Une victoire relie gauche–droite ou haut–bas.
- Un joueur sans coup est passé automatiquement. Deux absences consécutives sans pose terminent la partie par comparaison des plus grandes zones ; une égalité est un match nul.
- Une pose invalide ne consomme ni pièce ni tour.
- Lorsqu'un tour passe à l'adversaire, vider la sélection. Si l'adversaire est passé et que le même joueur rejoue, conserver la sélection seulement si un exemplaire reste disponible.

## Pratiques d'interface

- L'interface doit rester dépouillée. Ne pas ajouter de texte visible lorsque la forme, la couleur ou l'interaction suffisent.
- Mettre les libellés nécessaires aux lecteurs d'écran et aux tests dans `aria-label`, `aria-live` ou `data-testid`, sans encombrer l'écran.
- Ne pas afficher les noms de formes, multiplicateurs, numéros de colonnes, angles de rotation ou légendes haut/bas/gauche/droite dans l'interface de jeu.
- Le survol et la sélection d'une silhouette ne doivent changer ni marge, ni padding, ni position.
- Les pièces blanches doivent rester lisibles : fond de réserve gris bleuté et contour externe sombre, sans lignes internes entre les cellules d'une même pièce.
- Le panneau de fin est compact, non modal et placé au-dessus du plateau. Il ne doit jamais masquer la grille.
- Respecter `prefers-reduced-motion` pour les animations.

## Responsive et accessibilité

- Sur bureau : réserve bleue, grille, réserve blanche.
- Sous le breakpoint tablette, placer les réserves au-dessus et au-dessous ; leurs formes défilent horizontalement à l'intérieur de la réserve.
- La page ne doit jamais déborder horizontalement. La grille reste prioritaire et jouable sur mobile et tablette paysage.
- Conserver les deux réserves visibles ou facilement accessibles, avec la réserve active clairement distinguée et l'autre non interactive.
- Toute commande doit avoir un état de focus visible et un nom accessible stable.
- Les raccourcis attendus sont `R` ou les flèches pour tourner, et `F` pour retourner les S/Z et L/J.

## Tests et validation visuelle

- Ajouter ou adapter des tests de domaine pour toute modification de règles, de transformations, de chute, de passe ou de connexion.
- Tester les cas négatifs : une action refusée ne doit modifier ni grille, ni inventaire, ni joueur actif.
- Pour une modification d'interface, vérifier dans un navigateur réel au minimum : état initial, sélection, rotation, pose valide, pose refusée et changement de joueur.
- Pour les réserves, contrôler visuellement la séquence `deux pleines → une pleine + une pointillée → deux pointillées`.
- Comparer la position document de la grille avant et après sélection/rotation pour détecter tout saut de mise en page.
- Poser réellement un L/J, un S/Z et un T lors des contrôles visuels afin de repérer les artefacts de jonction.
- Vérifier le panneau final et le chemin gagnant avec une vraie victoire jouée.
- Pour reproduire rapidement une grille, utiliser `?board=<9 lignes B/W/. séparées par />&turn=blue|white`. Une connexion déjà gagnante ouvre directement le panneau final. Le parseur partagé se trouve dans `src/game/boardText.ts` ; ne pas recréer ce format dans un test.
- Les fixtures URL regroupent les cases orthogonalement connexes d'une couleur sous un même `pieceId`. Elles ne restaurent ni l'inventaire consommé ni la frontière entre deux pièces adjacentes de même couleur.
- Contrôler au moins un viewport bureau et un viewport mobile ; vérifier l'absence de débordement horizontal et d'erreur console.

## Discipline de modification

- Préserver les changements existants de l'utilisateur et éviter les réécritures sans rapport avec la tâche.
- Préférer de petits composants et des fonctions nommées aux duplications de logique.
- Ne pas modifier les matrices des pièces, les règles de support ou la connectivité pour résoudre un problème purement visuel.
- Ne pas introduire de backend, IA, jeu en réseau, comptes, persistance ou effets sonores sans demande explicite.
- Avant de terminer, examiner le diff, exécuter `git diff --check` et résumer les vérifications effectuées.
