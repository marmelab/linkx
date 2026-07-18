# src/components — affichage

Ce que doit **montrer** l'interface est spécifié dans `plan.md` (histoires 7, 8, 9 et 11). Ce fichier ne consigne que les pièges techniques : les erreurs qui coûtent cher à rediagnostiquer. La mise en page vit dans `src/App.css` et `src/index.css`.

## Silhouettes et matière

- `pieceGeometry.ts` est la source unique des silhouettes : réserve, aperçu central, ghost et plateau appellent `getCellsOutlinePath` et partagent `OUTLINE_INSET`. Ne pas recréer une géométrie parallèle.
- `PlexiDefs.tsx` est la source unique de la **matière**, comme `pieceGeometry.ts` l'est de la forme. Il rend une fois par document un jeu de `<defs>` que toutes les silhouettes référencent en `filter: url(#…)` depuis le CSS. Ne pas ajouter de fichier SVG par pièce ni par orientation : la géométrie y serait dupliquée et l'éclairage deviendrait solidaire de la pièce.
- L'éclairage doit rester **invariant par rotation et par miroir** : la lumière vient toujours du haut à gauche de l'écran. Les liserés de tranche sont donc des `feOffset` d'espace utilisateur, et le reflet un `linearGradient` en `gradientUnits="userSpaceOnUse"` ancré sur la scène. Proscrire les dégradés en `objectBoundingBox`, qui s'étirent avec la boîte de la forme, et les `transform` SVG sur une silhouette : `getOrientation` cuit déjà l'orientation dans les coordonnées du chemin.
- **L'unité utilisateur SVG vaut une case, jamais un pixel.** Le plateau et la réserve dessinent une case par unité, donc une longueur de filtre garde la même épaisseur relative à toutes les échelles. Même piège dans un `transform` CSS sur un élément SVG, où une longueur s'exprime aussi en unités de case.
- **Aucune couche de matière ne doit avoir une portée proche de la case.** Une pièce est un polyomino : ses divisions internes tombent sur la grille, donc tout effet à cette échelle s'aligne dessus et découpe la dalle en carrés de teintes différentes. Les longueurs du filtre restent bien en deçà (~0,06 case), le reflet bien au-delà (la diagonale du plateau).
- Ne pas employer `feSpecularLighting` ni `feDiffuseLighting`. Ces filtres dérivent une normale du canal alpha avec un pas d'échantillonnage que la spécification ne fixe pas : Gecko le prend à l'unité d'espace utilisateur, qui vaut ici une case, et chaque case reçoit sa propre lumière — une barre 1×3, pourtant un simple rectangle, se rend en trois bandes. Blink échantillonne en pixels de sortie et masque le défaut ; c'est Blink l'exception. Le reflet doit venir d'un dégradé, qui ne dérive rien du contour.
- `PlexiDefs.test.tsx` verrouille ces points : dégradés tous en `userSpaceOnUse`, aucun filtre d'éclairage, aucune longueur de filtre à l'échelle de la case, et huit orientations d'une forme asymétrique qui ne diffèrent que par leur tracé.

## Conseil et chemin gagnant

- Le conseil est rattaché dans `App.tsx` à l'**état exact** pour lequel il a été demandé, jamais à un drapeau. Toute action produit un nouvel état, donc la demande en cours et le conseil affiché cessent d'y correspondre et disparaissent sans qu'aucun effet n'ait à les nettoyer, y compris si le joueur agit pendant la recherche. Une action refusée renvoie l'état inchangé et laisse le conseil en place, ce qui est le comportement voulu.
- La mise en évidence du conseil est un mécanisme **distinct** du chemin gagnant : classes, calque et teinte propres. Le chemin gagnant est un contour transparent sur des pièces posées ; le conseil désigne des cases vides et porte un fond. Ne pas fondre les deux rendus.

## Ordre des réserves

`App.tsx` rend le plateau d'abord, puis les deux réserves **dans l'ordre du tour**, la réserve du joueur actif en tête. L'ordre du DOM est donc toujours l'ordre visuel, y compris pour un lecteur d'écran ou une tabulation.

- Sur trois colonnes, cet ordre ne doit rien décider : `App.css` pose chaque réserve sur la colonne de sa couleur avec `grid-area`, la bleue à gauche comme l'annonce la flèche du bandeau. Ne pas revenir à un placement automatique, il suivrait le tour. Les réserves y sont donc ancrées par couleur et ne permutent jamais : le bandeau est alors le seul indicateur de tour et doit rester.
- En une seule colonne, la permutation des deux réserves porte le tour à elle seule ; le bandeau visuel y est supprimé, il répétait cette information au prix de 88px de haut. Sa région `aria-live` est en revanche conservée : une permutation muette serait invisible pour un lecteur d'écran. Ne pas retirer cette région en même temps que le bandeau.
- Les sélecteurs `.play-area + .piece-tray` et `.piece-tray + .piece-tray` désignent respectivement la réserve active et l'adverse. Ils tiennent de l'ordre du DOM, donc aucune classe d'état n'est à câbler côté React.
- La réserve empilée est une grille de sept colonnes, un groupe de forme par colonne, les deux exemplaires empilés. `--piece-cell` s'y déduit de la largeur de colonne : la silhouette rétrécit, la cible tactile reste à 44px. Ne pas réintroduire de défilement horizontal dans la réserve.

## Mise en page du téléphone

Le plateau est l'élément principal : **son bord haut ne bouge jamais**, ni à la sélection, ni à la rotation, ni à la victoire. Deux blocs de hauteur variable le menaçaient et sont traités séparément.

- `play-head` — le bandeau et l'aperçu de la pièce sélectionnée — est regroupé dans un conteneur et renvoyé **sous** le plateau par `order`. L'ordre du DOM est inchangé, si bien que `Tourner`/`Retourner` précèdent toujours les flèches de colonne à la tabulation.
- Sa hauteur y est **réservée en permanence** (`--head-height`), pièce sélectionnée ou non. Choisir une pièce ne doit rien déplacer, et surtout pas la réserve que le doigt vient de toucher. Ne pas la rendre escamotable pour gagner de la place : c'est un arbitrage explicite en faveur de la stabilité.
- La valeur est calée sur le contenu réel — trois cases d'aperçu, soit 84px — et non sur les 150px du bureau. Le panneau de fin de partie s'affiche dans cette même zone déjà payée, sur toute la largeur : rien ne bouge non plus à la victoire. Sur les écrans les plus étroits, un panneau de blocage très bavard peut la dépasser de quelques pixels ; la partie est alors finie et plus rien n'est à cliquer dans les réserves.
- La rangée se découpe en **trois colonnes symétriques** : message à gauche, aperçu centré sur la largeur du plateau, commandes contre le bord droit. Les deux commandes sont côte à côte et non empilées — c'est ce qui permet de tenir deux cibles de 44px dans une rangée de 84.
- Le bouton de conseil vit dans la **colonne de gauche**, avec le message, empilés et calés en bas. C'est la seule colonne au contenu variable : les deux autres ont une géométrie fixe, donc ni l'aperçu ni les commandes de rotation ne bougent quand le conseil apparaît ou disparaît en cours de partie. Toute nouvelle commande de ce genre a sa place ici, pas ailleurs.
- Le message est tronqué à deux lignes dans cette colonne étroite, sinon il pousserait la rangée et donc les réserves. Le texte complet reste annoncé : la région `aria-live` ne dépend pas de ce qui est peint. Les libellés doivent donc porter leur sens dans leur premier membre de phrase.
- La rangée de flèches de dépôt ne réserve pas de hauteur : elle se **superpose** au haut du plateau, alignée sur ses colonnes par `--board-inset`, qui vaut la somme marge du cadre + bordure + marge intérieure. Modifier l'un de ces trois padding sans mettre `--board-inset` à jour désaligne les flèches.
- Cette superposition est réservée au téléphone. Au-delà, le pointeur sait survoler et cette bande est le prolongement haut de la surface de visée : elle doit rester au-dessus du plateau pour qu'on puisse l'approcher par le haut.

## Zone sûre iOS

`index.html` déclare `viewport-fit=cover` et `apple-mobile-web-app-status-bar-style: black-translucent`. Les deux vont ensemble : sans les retraits, la barre d'état translucide recouvrirait le bandeau. `App.css` reprend `env(safe-area-inset-*)` sur le bandeau, la grille de jeu, la dernière réserve et les écrans plein écran. Repasser la barre d'état en `default` sans retirer ces retraits laisserait une bande vide en haut.

## Vérification

Toute modification visuelle se vérifie dans le navigateur, sur un viewport bureau et un viewport téléphone (375×812) : aucun débordement horizontal en portrait comme en paysage, aucune erreur console, et le bord haut du plateau immobile à la sélection, à la rotation et à la victoire.

- Vérifier en **Chromium et en Firefox** : les deux moteurs divergent sur les filtres SVG et c'est Blink qui masque les défauts. Un rendu correct sous Chromium seul ne prouve rien.
- Mesurer plutôt que constater : relever la position du haut du plateau et la hauteur de `play-head` avant et après, et les comparer. Une différence de quelques pixels ne se voit pas à l'œil mais saute au doigt.
- `fixtures/urls.md` fournit des positions prêtes à coller, y compris des fins de partie.
