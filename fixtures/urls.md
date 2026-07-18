# URLs de test

Positions chargées par notation de partie (`?moves=`). Contrairement à `?board=`,
la notation restaure aussi les réserves : les silhouettes déjà jouées apparaissent
en pointillé dans les deux réserves.

Les espaces séparant les coups s'écrivent `+` dans une URL. Démarrer le serveur
avec `npm run dev`, puis coller l'une des adresses ci-dessous.

## Partie en cours, au milieu

<http://localhost:5173/?moves=4Lr32+3Ir12+3Ir12+3Ir13+4Tr24+4Lr38+3Ir15+15+2r13+2r15+15+2r13>

Douze coups joués, aux bleus de jouer : deux colonnes imbriquées au centre gauche,
un début d'empilement blanc à droite. Chaque joueur a consommé ses deux barres de
trois et voit donc quatre silhouettes pointillées en réserve.

## Partie presque gagnée

<http://localhost:5173/?moves=4Lr32+4Ss3+4Lr32+3Ir12+3Ir13+3Ir14>

Aux bleus de jouer, à un coup de la victoire : la colonne bleue monte jusqu'à la
troisième ligne. Poser le domino debout en colonne 3 (`2r13`) relie le haut au bas
et déclenche immédiatement le panneau final et le surlignage du chemin gagnant.

## Partie terminée, victoire bleue par connexion

<http://localhost:5173/?moves=4Lr32+4Ss3+4Lr32+3Ir12+3Ir13+3Ir14+2r13>

La partie précédente après le coup gagnant : panneau de fin non modal au-dessus de
la grille et chemin bleu vertical surligné, sans que la grille remonte.

## Partie terminée, victoire blanche par connexion

<http://localhost:5173/?moves=4Tr21+4Lr34+3Ir12+3Ir12+4Lsr33+4Lr33+3Ir15+4Ss4+4Lsr26+4Ss8+4Tr16+3Lr17+27+3Ir16+12+2r13>

Partie plus dense ouverte par les bleus : les blancs relient le bord gauche au bord
droit en passant par le milieu du plateau. Utile pour vérifier la lisibilité du
chemin surligné sur des pièces blanches.

## Partie terminée par blocage, avec passe forcée

<http://localhost:5173/?moves=w+2r16+3Ir17+24+4Ssr12+4Ss4+16+3I5+3Ir16+3Ir19+3L2+4Ssr12+14+18+4Tr32+18+3L8+3Lr12+2r16+4Lsr27+2r18+4Lr18+4Lsr37+--+4Lr14+3Lr24>

Partie ouverte par les blancs (préfixe `w`). Les bleus sont passés une fois faute de
coup légal (jeton `--`), puis plus personne ne peut jouer : le panneau final annonce
un blocage remporté par les blancs, 23 cases contre 20.
