# Linkx — spécification produit

## Objet et portée

Ce document décrit **ce que fait le jeu**, assez précisément pour le reconstruire depuis zéro sans accès à une implémentation existante. Il ne suppose ni langage, ni bibliothèque, ni support : la même spécification doit permettre d'écrire le jeu en Java, en Rust, dans un terminal ou dans une application native.

- Ce qui relève de la pile technique, de l'arborescence des fichiers et des conventions de code vit dans `README.md`, pas ici.
- Le document est découpé en **histoires utilisateur** ordonnées. Chacune est livrable et vérifiable seule, s'appuie uniquement sur les précédentes, et n'exige aucune des suivantes.
- Certaines histoires sont **liées à un support** : lien partageable, écran tactile, installation sur téléphone. Elles sont signalées comme telles. Une réimplémentation en terminal les ignore sans que le jeu cesse d'être Linkx.
- Les sections « Règles du jeu » et « Notation d'une partie » sont transverses : plusieurs histoires y renvoient, elles ne sont énoncées qu'une fois.

Règle officielle : <https://www.jeux-abstraits.fr/wp-content/uploads/2026/07/lynkx.pdf> · fiche éditeur : <https://blueorangegames.eu/fr/jeux/linkx/>. En cas de divergence, le présent document fait foi : ses dimensions et son inventaire ont été validés explicitement.

**Convention de lecture.** Le jeu de plateau ne couvre pas tout ce qu'une application doit trancher. Partout où ce document arbitre un cas que la règle imprimée laisse ouvert, ou s'en écarte délibérément, il le signale par la mention **« Choix de cette version »**. Une réimplémentation est libre de trancher autrement sur ces points-là, et sur ceux-là seulement : tout le reste est la règle du jeu.

---

## Règles du jeu

Source de vérité du domaine. Les histoires y renvoient au lieu de la recopier.

### Plateau et repères

- Une grille carrée de **9 colonnes sur 9 lignes**, soit 81 cases, tenue verticalement.
- Repère employé dans tout le document : la colonne `0` est à gauche, la colonne `8` à droite ; la ligne `0` est en haut, la ligne `8` est **le fond**, celle où les pièces s'accumulent.
- Deux joueurs, désignés par une couleur : **bleu** et **blanc**.

### Réserve de chaque joueur

Sept formes, **deux exemplaires de chacune** par joueur, soit 14 pièces et 42 cases par joueur. Les deux exemplaires d'une forme sont interchangeables au jeu ; ils ne se distinguent que dans l'affichage de la réserve.

Chaque forme est un polyomino, décrit par sa matrice d'occupation de référence (`X` occupé, `.` vide) :

```text
MONO (1)   DOMINO (2)   BARRE (3)   PETIT L (3)
X          XX           XXX         XX
                                    X.

S (4)      T (4)        GRAND L (4)
.X         XXX          XXX
XX         .X.          X..
X.
```

Contrôles de cohérence : 7 formes ; 1, 2, 3, 3, 4, 4 et 4 cases respectivement ; 2 exemplaires chacune ; 14 pièces et 42 cases par joueur. Il n'existe **ni carré de quatre cases, ni barre de quatre**.

### Orientations

Une pièce peut être tournée par quarts de tour et, pour certaines formes, retournée comme un miroir. Tourner ou retourner ne consomme rien : c'est une orientation du même exemplaire.

Le nombre d'orientations **géométriquement distinctes** compte, car c'est lui qui borne les coups possibles. Deux orientations sont identiques si, ramenées à l'origine, elles occupent le même ensemble de cases.

| Forme | Orientations distinctes | Remarque |
| --- | --- | --- |
| Mono | 1 | invariante |
| Domino | 2 | couché, debout |
| Barre de 3 | 2 | couchée, debout |
| Petit L | 4 | son miroir est déjà une de ses rotations |
| S | 4 | 2 rotations × 2 miroirs ; le miroir donne le Z |
| T | 4 | miroir redondant |
| Grand L | 8 | 4 rotations × 2 miroirs ; le miroir donne le J |

Seuls le **S** et le **grand L** gagnent quelque chose à être retournés. Pour les cinq autres formes, le miroir ne produit aucune géométrie nouvelle : la commande de retournement doit être **indisponible** sur ces formes plutôt que sans effet.

Méthode pour obtenir cette table sans la coder en dur : engendrer les quatre rotations de la forme et les quatre rotations de son miroir, ramener chacune à l'origine, puis dédupliquer. La rotation d'un quart de tour horaire envoie la case `(x, y)` sur `(-y, x)` ; le miroir envoie `(x, y)` sur `(-x, y)` ; ramener à l'origine consiste à soustraire le minimum des abscisses et le minimum des ordonnées.

### Déroulement d'un tour

À son tour, un joueur choisit une forme dont il lui reste un exemplaire, choisit son orientation, choisit une colonne d'entrée, et la pièce descend verticalement jusqu'à sa position d'arrêt. Le tour ne se termine que si la pose est légale.

Les joueurs alternent. Un joueur qui n'a **aucun** coup légal voit son tour passé automatiquement ; il ne peut jamais choisir de passer.

### Chute

La pièce entre par le haut, entièrement au-dessus de la grille, alignée sur une **colonne d'ancrage** — la colonne de sa case la plus à gauche. Elle descend d'une ligne tant que la position suivante n'entre pas en collision, et s'arrête à la dernière position sans collision.

Il y a collision quand une case de la pièce sortirait latéralement de la grille, passerait sous la ligne du fond, ou recouvrirait une case déjà occupée. Tant qu'une case de la pièce est encore au-dessus de la grille, elle ne peut pas entrer en collision : c'est ce qui permet à une pièce d'entrer partiellement dans la grille puis de s'y arrêter.

Une pièce ne peut jamais être posée plus haut que sa position naturelle de chute.

### Légalité d'une pose

Une pose est légale si et seulement si les trois conditions suivantes sont réunies. Chacune correspond à un **motif de refus distinct**, qui doit être restituable et affichable au joueur.

1. **Débordement latéral** — la pièce, dans son orientation courante, tient entièrement dans les neuf colonnes depuis sa colonne d'ancrage. Sinon : refus, sans même simuler la chute.
2. **Débordement par le haut** — après la chute, aucune case de la pièce ne reste au-dessus de la ligne `0`. Une colonne trop remplie pour l'accueillir produit ce refus.
3. **Support intégral** — aucune case vide ne subsiste directement sous la pièce. Formellement, pour chaque case `(x, y)` de la pièce posée, il faut que `(x, y+1)` soit elle-même une case de cette pièce, ou que `y` soit la ligne du fond, ou que `(x, y+1)` soit déjà occupée, quelle que soit sa couleur. Sinon : refus.

Le support intégral est la règle la moins intuitive et la plus souvent mal reconstruite. Elle interdit qu'une pièce repose sur un seul point d'appui en surplombant un vide : un `T` **tige vers le bas, barre en haut**, lâché sur un sol plat, est **illégal**. Il s'immobiliserait sur sa tige seule, et les deux extrémités de sa barre surplomberaient le vide. Retourné — barre en bas, tige en l'air — le même `T` est légal sur ce sol plat.

Elle autorise en revanche un surplomb dont **toutes** les faces inférieures sont soutenues : le `T` tige vers le bas devient légal au-dessus de deux cases occupées séparées d'une case, la tige tombant dans le creux et chaque extrémité de la barre reposant sur un appui.

Un refus ne consomme rien : ni la pièce, ni le tour. Ni le plateau, ni les réserves, ni le joueur au trait ne changent.

### Connexion et victoire

Deux cases de **même couleur** sont connectées si elles se touchent par un côté **ou par un angle** : le voisinage compte les huit cases entourantes, diagonales comprises.

La connexion se lit sur la **couleur seule**. Deux pièces distinctes de même couleur qui se touchent forment une seule zone ; l'identité des pièces physiques ne sert qu'à l'affichage.

Immédiatement après une pose légale, le joueur qui vient de poser gagne si l'une de ses zones connectées touche à la fois :

- le bord gauche et le bord droit ; **ou**
- le bord haut et le bord bas.

Les deux paires de bords valent pour les deux joueurs : **aucun joueur ne se voit assigner un axe à l'avance**. Une connexion obtenue uniquement par des contacts diagonaux est valable. Seul le joueur qui vient de poser est examiné, et la victoire est immédiate — la partie ne continue pas jusqu'à la fin du tour.

### Fin par blocage et départage

Quand plus personne ne peut jouer, la partie s'arrête et se départage aux points.

Après une pose légale qui ne gagne pas, trois cas et trois seulement :

1. l'adversaire a au moins un coup légal → c'est son tour ;
2. l'adversaire n'a aucun coup légal mais le joueur qui vient de poser en a un → le tour de l'adversaire est **passé** et le même joueur rejoue ;
3. aucun des deux n'a de coup légal → la partie est **terminée par blocage**.

Le départage compare la **taille de la plus grande zone connectée** de chaque joueur, au sens du voisinage à huit cases, en nombre de cases. La plus grande l'emporte. Les deux scores sont affichés.

**Choix de cette version** — la règle imprimée ne dit pas ce qu'il advient de deux plus grandes zones **exactement égales**. Ce cas est ici déclaré **match nul**, annoncé comme tel et distingué d'une victoire.

Un joueur bloqué ne l'est pas définitivement : une pièce adverse posée ensuite peut lui créer un appui et lui rendre un coup. Le blocage ne doit donc jamais être mémorisé comme un état du joueur, seulement recalculé à partir du plateau et de la réserve.

### Premier joueur

La couleur qui ouvre la partie est **tirée au sort** au lancement, et annoncée avant la partie. Le joueur ne la choisit pas.

**Choix de cette version** — la règle imprimée fait commencer le plus jeune joueur, ce qu'une application ne peut pas vérifier. Le tirage au sort en tient lieu. Une notation de partie (voir plus bas) peut en revanche imposer le premier joueur, puisqu'elle rejoue une partie déjà arbitrée.

---

## Notation d'une partie

Format d'échange, à spécifier exactement : une autre implémentation doit lire et écrire les mêmes notations. Une partie s'écrit comme une suite de jetons courts, lisible et recopiable à la main, qui tient dans un message ou dans une adresse.

### Grammaire

```text
partie   := [ premier ] jeton*
premier  := "b" | "w" | "blue" | "white"      défaut « b », omis à l'écriture
jeton    := coup | passe
coup     := forme [ miroir ] [ rotation ] colonne
forme    := "1" | "2" | "3I" | "3L" | "4S" | "4T" | "4L"
miroir   := "s"                               appliqué AVANT la rotation
rotation := ("r" | "l") ("1" | "2" | "3")     quarts de tour horaires / antihoraires
colonne  := "1".."9"                          toujours le dernier caractère
passe    := "--"                              tour passé faute de coup légal
```

- Le nom de forme reprend le **nombre de cases** suivi de la silhouette : `1` mono, `2` domino, `3I` barre de trois, `3L` petit L, `4S` le S/Z, `4T` le T, `4L` le grand L/J.
- La colonne est la **colonne d'ancrage**, celle de la case la plus à gauche de la pièce dans son orientation finale, numérotée de `1` à `9`. Ce n'est pas la colonne visée par le pointeur (voir l'histoire 2) : à l'écriture comme à la lecture, seule l'ancre compte.
- Les jetons se séparent par une espace, une virgule ou un `+`, ce dernier permettant d'écrire une partie dans une adresse sans échappement.
- La casse est libre à la lecture, normalisée à l'écriture.
- Exemples : `15` mono en colonne 5 · `3Ir13` barre de trois debout en colonne 3 · `4Lsr27` grand L retourné puis tourné d'un demi-tour, ancré en colonne 7.

### Canonicité

Une géométrie donnée ne possède qu'**une seule** écriture canonique : celle de son orientation distincte, la première rencontrée en énumérant d'abord les rotations non retournées `0, 1, 2, 3`, puis les rotations retournées. Les écritures redondantes restent acceptées en lecture et ramenées à cette forme ; seule la forme canonique est produite à l'écriture. Réécrire une partie déjà canonique la laisse identique, caractère pour caractère.

Table complète des jetons canoniques, ici en colonne 1 :

| Forme | Jetons canoniques |
| --- | --- |
| Mono | `11` |
| Domino | `21` `2r11` |
| Barre de 3 | `3I1` `3Ir11` |
| Petit L | `3L1` `3Lr11` `3Lr21` `3Lr31` |
| S | `4S1` `4Sr11` `4Ss1` `4Ssr11` |
| T | `4T1` `4Tr11` `4Tr21` `4Tr31` |
| Grand L | `4L1` `4Lr11` `4Lr21` `4Lr31` `4Ls1` `4Lsr11` `4Lsr21` `4Lsr31` |

Exemples de normalisation : `2r23` → `23` (demi-tour sans effet sur un domino) · `1r27` → `17` · `2l13` → `2r13` (quart antihoraire ramené à son complément horaire) · `3Ls4` → `3Lr14` (miroir redondant du petit L) · `4Ls5` reste `4Ls5` (miroir utile) · `4Ssr21` → `4Ss1`.

### Passes

Un tour passé est entièrement déterminé par la position : le jeton `--` est donc **facultatif à la lecture** mais **toujours écrit**. Un `--` placé là où aucun tour n'est réellement passé est refusé.

### Validation

Toute notation est vérifiée coup par coup en la rejouant depuis une partie vierge, avec les mêmes règles de légalité que le jeu. Un coup impossible est refusé en indiquant **lequel** — son rang à partir du premier coup, hors indication de premier joueur — et **pourquoi**, parmi : syntaxe invalide, pièce épuisée, débordement latéral, débordement par le haut, support insuffisant, partie déjà terminée, passe non forcée.

Un refus n'applique **rien** : aucune partie partielle n'est restituée.

### Ce que la notation restitue

Rejouer une notation reconstitue la position exacte : plateau, réserves des deux joueurs, exemplaires consommés, joueur au trait, et résultat si la partie est finie — victoire par connexion comme fin par blocage, scores de départage compris.

---

## Histoires utilisateur

Ordre d'implémentation. Chaque histoire suppose les précédentes livrées et n'anticipe sur aucune suivante. Les critères d'acceptation sont rédigés pour être vérifiables sans interprétation.

Trois exigences transverses valent dans **toutes** les histoires, à traiter au fil de l'eau plutôt qu'en fin de projet :

- **Refus sans effet de bord** — toute action refusée laisse le plateau, les réserves, le joueur au trait et la sélection strictement inchangés.
- **Distinction non chromatique** — les deux camps ne doivent jamais se distinguer par la seule couleur : silhouette, contour, position à l'écran ou libellé doivent suffire.
- **Annonce des changements d'état** — tout changement important (tour, refus, tour passé, fin de partie) est perceptible sans voir l'écran.

---

### Histoire 1 — Ouvrir une position depuis un lien

*Lié au support : suppose un lien ouvrable. En terminal, la même capacité se lit depuis un argument ou un fichier.*

**Pour qui, pourquoi** — pour toute personne qui reproduit un bug, prépare une démonstration ou vérifie un rendu : arriver directement sur une position donnée, sans rejouer la partie à la main.

**Ce que ça recouvre** — l'affichage d'un plateau 9×9 et de ses pièces, et le chargement d'une position décrite sous forme de grille dans le lien. Aucun coup n'est encore jouable.

Format de grille : neuf lignes de neuf caractères, `B` pour une case bleue, `W` pour une case blanche, `.` pour une case vide. Les lignes se séparent par `/`, `|` ou un retour à la ligne ; une chaîne compacte de 81 caractères est également acceptée. Un second paramètre facultatif désigne le joueur au trait, `blue` ou `white` — les initiales `B` et `W` sont acceptées —, bleu par défaut.

Ce format décrit **des cases, pas des pièces** : il ne restitue ni les réserves consommées, ni la frontière entre deux pièces adjacentes de même couleur. Les réserves restent donc complètes. Pour l'affichage, les cases d'une même couleur connectées **orthogonalement** sont regroupées en une silhouette unique. Restituer une partie exacte est le rôle de la notation (histoire 6).

**Critères d'acceptation**

- Une grille valide ouvre directement la partie sur la position décrite, sans passer par l'écran de démarrage.
- Les trois écritures — lignes séparées par `/`, lignes séparées par retour à la ligne, chaîne compacte de 81 caractères — donnent la même position.
- Toute autre dimension que 9×9, ou tout symbole autre que `B`, `W` et `.`, est refusée avec un message ; le jeu retombe sur son écran de démarrage plutôt que sur une position partielle.
- Un joueur au trait inconnu est refusé de la même façon.
- Les cases d'une même couleur qui se touchent par un côté forment une silhouette continue ; deux zones qui ne se touchent que par un angle restent deux silhouettes.
- Le plateau est annoncé comme une grille de 9 lignes sur 9 colonnes, et chaque case est désignable par sa ligne, sa colonne et son occupant.

Le cas d'une position **déjà gagnante** relève de l'histoire 4 : tant que la victoire n'est pas détectée, une telle grille s'affiche simplement telle quelle.

---

### Histoire 2 — Choisir une pièce et la faire tomber

**Pour qui, pourquoi** — pour deux joueurs sur le même écran : prendre une pièce dans sa réserve, l'orienter, viser une colonne et la voir tomber. À ce stade la pièce s'empile sur ce qu'elle rencontre ; les poses interdites ne sont pas encore refusées, c'est l'objet de l'histoire 3.

**Ce que ça recouvre** — le lancement d'une partie, les deux réserves, la sélection d'un exemplaire, la rotation, le retournement, la visée d'une colonne, l'aperçu de la position d'arrivée, la pose, la consommation de l'exemplaire et l'alternance des tours.

**Lancement.** Un écran de départ lance une partie à deux joueurs sur le même écran et donne accès à un résumé des règles. Il montre en fond une photo du jeu de plateau et en crédite l'éditeur, en pied de carte, par un lien vers sa fiche produit. Il n'annonce pas le tirage au sort de la couleur qui commence : c'est le bandeau de tour qui dit d'emblée qui joue, et l'écran de départ n'a pas à préparer à une information qu'il ne porte pas encore. Une fois la partie lancée, un résumé des règles reste consultable sans quitter la partie, et une commande permet à tout moment de recommencer.

**Réserves.** Chaque joueur voit ses sept formes, chacune représentée par **deux silhouettes** côte à côte. Un exemplaire disponible est plein et sélectionnable ; un exemplaire joué reste visible en **contour pointillé** et n'est plus sélectionnable. La séquence d'une forme est donc : deux pleines, puis une pleine et une pointillée, puis deux pointillées. Aucun nom de forme ni compteur numérique n'est affiché ; ces informations restent disponibles pour qui n'a pas accès à l'image. La réserve adverse est visible mais inerte.

**Exemplaire en main.** L'exemplaire sélectionné passe lui aussi en contour pointillé : il a quitté la réserve, et c'est l'aperçu central qui le montre en matière. Aucun cadre ni liseré de sélection ne s'y ajoute — l'empreinte vide dit déjà où la pièce a été prise, et un second marquage ferait doublon. Le pointillé reste assez clair pour ne pas peser plus lourd à l'œil que les silhouettes pleines qui l'entourent.

**Orientation de présentation.** Les silhouettes de réserve gardent une orientation fixe : elles ne tournent ni ne se retournent jamais, quelle que soit la sélection en cours. Cette orientation compte, car sélectionner une pièce l'arme **exactement** dans la pose où sa silhouette est dessinée : c'est le point de départ des rotations, et donc la première chose que le joueur voit bouger.

Les sept silhouettes de présentation, toutes non retournées, sont :

```text
MONO       DOMINO     BARRE      PETIT L
X          XX         XXX        XX
                                 X.

S          T          GRAND L
XX.        XXX        XXX
.XX        .X.        X..
```

Le principe : chaque forme est présentée **couchée**, dans son orientation la plus large et la moins haute, pour ne pas creuser la hauteur de la réserve. C'est ce qui explique le `S` allongé plutôt que dressé sur trois lignes, et le `T` barre en haut. Ce principe fixe six formes sur sept : les quatre rotations du **petit L** tiennent toutes dans un carré de deux cases, sa présentation est donc un choix libre, que le schéma ci-dessus arrête. Ce qui importe alors n'est pas laquelle, mais qu'elle soit **stable** et que la sélection l'adopte.

**Sélection et orientation.** Le premier choix d'un exemplaire disponible le sélectionne, dans exactement l'orientation où sa silhouette est dessinée dans la réserve. Choisir l'autre exemplaire de la même forme change la sélection sans rien tourner. Choisir à nouveau l'exemplaire déjà sélectionné le fait tourner d'un quart de tour. Une commande distincte retourne la pièce, disponible seulement pour le `S` et le grand `L`.

La pièce sélectionnée est montrée en grand dans une zone dédiée, à l'échelle du plateau. Cette zone est elle-même une commande de proximité : y agir tourne la pièce, et l'action secondaire la retourne. Les commandes explicites de rotation et de retournement restent visibles — ce sont elles qui font découvrir la manipulation.

**La pièce tourne, elle n'est pas remplacée.** Dans cette zone, un quart de tour et un retournement sont des **mouvements** : l'aperçu part de l'orientation qu'on quitte et va jusqu'à celle qu'on demande, en une animation brève. Le joueur voit ainsi laquelle des deux commandes il vient d'employer et dans quel sens elle agit, ce qu'une substitution d'une image à l'autre ne dit pas.

Le mouvement est purement visuel : la pièce est armée dans sa nouvelle orientation dès la commande, si bien que viser, poser ou tourner encore pendant l'animation obéit déjà à celle-ci. Un mouvement interrompu par le suivant ne revient jamais en arrière — le nouveau part de l'orientation d'arrivée du précédent. Enchaîner les quarts de tour n'accumule donc aucun retard. Ni la réserve, ni l'aperçu de chute sur le plateau ne sont animés : la réserve ne tourne pas du tout, et l'aperçu de chute suit la visée, où un mouvement le ferait traîner derrière le pointeur.

**Visée.** La colonne visée porte le **centre** de la pièce, jamais son bord gauche, et la pièce est retenue contre les bords du plateau au lieu de dépasser. Précisément : colonne d'ancrage = colonne visée − partie entière de `(largeur − 1) / 2`, ramenée dans l'intervalle `[0, 9 − largeur]`. Une largeur paire penche donc à gauche. Viser le bord droit avec une barre de trois la pose sur les trois dernières colonnes.

Cette conversion est **unique** et partagée par tous les modes de visée. La pose, elle, ne transmet jamais que la colonne : la position d'arrivée est toujours recalculée par les règles, jamais fournie par l'affichage.

**Aperçu.** Dès qu'une pièce est sélectionnée, un aperçu occupe exactement les cases où elle atterrirait, dans la couleur du joueur et en transparence. Il suit la visée et l'orientation.

**La pièce tombe, elle n'apparaît pas.** Une pose n'ajoute pas une pièce à sa place : la pièce **entre par le bord haut du plateau** et descend jusqu'à sa case d'arrivée. C'est le geste que nomme le jeu — faire tomber une pièce — et c'est aussi ce qui montre *quelle* colonne vient d'être jouée, sans quoi le plateau change sans qu'on voie où. Elle est masquée tant qu'elle est au-dessus du plateau : la chute commence au bord haut du cadre, jamais par-dessus lui.

La descente obéit à une **chute libre**, ce qui veut dire une seule chose mais une chose stricte : toutes les pièces tombent avec la **même accélération**, quelle que soit la ligne où elles s'arrêtent. La durée suit donc la racine carrée de la hauteur tombée, et rien d'autre. Le piège est d'y ajouter une durée plancher ou un temps de départ constants : les pièces qui s'arrêtent haut dans la grille reçoivent alors une gravité plus faible que les autres et se mettent à flotter, ce qui se voit immédiatement. Une pièce lâchée d'une case tombe lentement mais brièvement ; une pièce qui traverse tout le plateau arrive vite. Elle rebondit à l'impact, d'autant plus qu'elle est tombée de haut.

**Choix de cette version.** La pièce de l'ordinateur (histoire 10) tombe **exactement comme celle du joueur**. Sa mise en évidence attend la fin de la chute au lieu de la recouvrir : la chute dit où le coup a été joué, le reste laisse le temps de le lire.

**Trois façons de viser, selon le support.** Là où le pointeur sait survoler, le plateau entier **et la bande qui le surmonte** deviennent la surface de visée : la pièce suit la colonne survolée et l'action la pose ; aucune rangée de commandes n'est alors affichée. La bande supérieure est indispensable, un plateau presque plein n'offrant plus de case libre à survoler. Là où le pointeur ne survole pas, neuf zones d'entrée apparaissent au-dessus du plateau, uniquement quand une pièce est sélectionnée, chacune réduite à une flèche sans numéro visible.

**Le jeu se pilote intégralement au clavier**, et c'est une exigence d'accessibilité autant qu'une commodité : un joueur qui ne peut pas se servir d'un pointeur doit pouvoir jouer une partie entière. Six fonctions doivent être atteignables sans pointeur :

| Fonction | Comportement attendu |
| --- | --- |
| Parcourir la réserve et choisir un exemplaire | atteint les mêmes exemplaires que le pointeur, dans l'ordre où ils sont affichés |
| Déplacer la colonne visée | d'une colonne vers la gauche ou vers la droite, bornée aux deux bords ; à la première visée, part de la colonne centrale |
| Tourner la pièce | d'un quart de tour, comme la commande visible |
| Retourner la pièce | seulement pour le `S` et le grand `L` |
| Poser | à la colonne visée, refus compris |
| Consulter et fermer le résumé des règles, recommencer | atteignables comme n'importe quelle commande |

Cette capacité doit survivre au cas où **aucune zone d'entrée n'est affichée à l'écran** — c'est-à-dire là où le pointeur sait survoler. Le clavier ne doit jamais dépendre de la présence des flèches de colonne.

L'attribution des touches relève de l'implémentation. À titre indicatif, cette version retient : flèches gauche et droite pour viser, flèches haut et bas ou `R` pour tourner, `F` pour retourner, `Entrée` ou `Espace` pour poser. Il n'existe **pas** de commande d'annulation de la sélection : on change de pièce en en choisissant une autre, conformément au principe qu'une pièce posée ne se reprend pas.

**Critères d'acceptation**

- Une partie lancée depuis l'écran de départ commence sur un plateau vide, réserves complètes, avec une couleur de départ tirée au sort et annoncée.
- La commande de recommencement restaure exactement un plateau vide et deux réserves complètes.
- Un résumé des règles est consultable depuis l'écran de départ et depuis la partie en cours, sans perdre la position.
- Seule la réserve du joueur au trait est interactive ; celle de l'adversaire ne répond à rien.
- Un premier choix sélectionne l'exemplaire visé, dans l'orientation exacte de sa silhouette de réserve.
- Choisir l'autre exemplaire de la même forme change la sélection sans modifier l'orientation.
- Choisir à nouveau le même exemplaire tourne la pièce d'un quart de tour.
- Tourner ou retourner fait passer l'aperçu de sélection d'une orientation à l'autre par un mouvement, non par une substitution ; changer d'exemplaire, lui, n'anime rien.
- Enchaîner les quarts de tour plus vite que l'animation ne fait jamais reculer la pièce, et la pose obéit à l'orientation demandée, pas à celle qui est peinte.
- La commande de retournement transforme le grand `L` en `J` et le `S` en `Z` ; elle est indisponible pour les cinq autres formes.
- Le retournement est le **miroir de la pièce affichée**, quelle que soit sa rotation : la silhouette d'arrivée est celle de départ vue dans un miroir d'axe vertical, et retourner deux fois de suite ramène à l'orientation de départ.
- Les silhouettes de réserve ne tournent jamais, quelle que soit l'orientation de la sélection.
- Une pose consomme **exactement** l'exemplaire choisi : c'est cette silhouette-là qui devient pointillée, pas l'autre.
- Après une pose, le tour passe à l'adversaire et la sélection est vidée.
- La pièce s'arrête sur la première case qu'elle rencontre en descendant et ne traverse jamais une case occupée.
- Une pièce posée descend depuis le bord haut du plateau jusqu'à sa case d'arrivée ; elle n'apparaît jamais directement à sa place.
- Une pièce en cours de chute n'est visible nulle part au-dessus du plateau : ni sur sa bordure, ni sur son cadre.
- Deux pièces qui s'arrêtent à des hauteurs différentes tombent avec la même accélération : celle qui vient de loin arrive plus vite, et aucune ne flotte.
- Les pièces déjà posées ne retombent pas quand une nouvelle pièce est jouée, ni au chargement d'une position depuis un lien.
- L'aperçu et la pose définitive désignent toujours les mêmes cases.
- Viser une colonne avec une barre de trois couvre cette colonne et ses deux voisines ; viser un bord retient la pièce contre ce bord au lieu de la faire dépasser.
- Sélectionner, tourner ou retourner ne déplace aucun autre élément à l'écran : le bord supérieur du plateau ne bouge pas.
- Une partie entière se joue au clavier seul, sans jamais toucher un pointeur, y compris là où les zones d'entrée de colonne ne sont pas affichées.
- Les six fonctions du tableau ci-dessus sont chacune atteignables au clavier.
- La première visée au clavier part de la colonne centrale ; viser au-delà d'un bord laisse la colonne sur ce bord.
- Le nom de chaque forme et le nombre d'exemplaires restants sont accessibles sans voir l'image, bien qu'ils ne soient pas écrits à l'écran.

---

### Histoire 3 — Refuser les poses illégales

**Pour qui, pourquoi** — pour que le jeu soit le jeu : sans support intégral ni contrôle des débordements, Linkx n'est qu'un empilement.

**Ce que ça recouvre** — les trois motifs de refus décrits dans « Légalité d'une pose », leur restitution au joueur, et l'énumération des coups légaux qui en découle.

L'aperçu distingue désormais deux états : valide, dans la couleur du joueur ; invalide, nettement différencié, accompagné d'une raison courte. Agir sur une position invalide ne change rien.

L'énumération des coups légaux d'un joueur — toutes ses formes encore en réserve, toutes leurs orientations distinctes, toutes les colonnes d'ancrage possibles, filtrées par la légalité — devient la source de vérité pour savoir si un joueur peut jouer. Elle sert aux histoires 5, 10 et 11. Sur une grille vide, elle produit **95** coups légaux ; ce nombre retombe sous 20 en fin de partie.

**Critères d'acceptation**

- Une pièce qui laisserait un vide sous une partie de sa face inférieure ne peut pas être posée.
- Un `T` tige vers le bas, lâché sur un sol plat, est refusé pour cette raison ; le même `T` barre en bas est accepté.
- Un `T` tige vers le bas lâché au-dessus de deux cases occupées séparées d'une case est accepté : chacun de ses appuis repose sur quelque chose.
- Une pièce qui, dans son orientation courante, sortirait latéralement du plateau est refusée sans qu'aucune chute soit simulée.
- Une pièce qui ne peut pas entrer entièrement dans une colonne trop remplie est refusée pour débordement par le haut.
- Chacun de ces trois refus produit une raison distincte, restituée au joueur en clair.
- Une pose refusée ne modifie ni le plateau, ni les réserves, ni le joueur au trait, ni la sélection.
- L'aperçu invalide se distingue de l'aperçu valide autrement que par la seule couleur.
- Sur une grille vide, l'énumération des coups légaux d'un joueur dont la réserve est complète en produit 95.
- Une forme dont les deux exemplaires sont joués n'apparaît jamais dans cette énumération.

---

### Histoire 4 — Gagner en reliant deux bords

**Pour qui, pourquoi** — pour que la partie ait une condition de victoire, détectée sans que les joueurs aient à la constater eux-mêmes.

**Ce que ça recouvre** — la détection de connexion décrite dans « Connexion et victoire », l'arrêt immédiat de la partie, et un panneau de fin.

Le panneau de fin **n'est jamais modal et ne recouvre jamais le plateau** : il remplace le bandeau de tour au-dessus de la grille, pour que le dernier coup reste visible. Il annonce le vainqueur, la raison, et propose de rejouer. Le passage à l'état final ne doit déplacer aucun élément : les hauteurs réservées au bandeau, à la sélection et aux zones d'entrée restent les mêmes, le bord supérieur du plateau ne remonte pas.

**Critères d'acceptation**

- Une zone reliant le bord gauche au bord droit gagne ; une zone reliant le bord haut au bord bas gagne.
- Les deux paires de bords valent pour les deux joueurs ; aucun axe n'est assigné à un joueur.
- Une connexion composée uniquement de contacts diagonaux gagne.
- Deux zones de même couleur séparées d'une case ne sont pas connectées.
- Une case adverse ne relie jamais deux zones.
- Une zone qui ne touche qu'un seul bord ne gagne pas.
- La victoire est détectée immédiatement après le coup qui complète la connexion, et seulement pour le joueur qui vient de poser.
- Le panneau de fin ne recouvre à aucun moment le plateau.
- Le passage à l'état final ne change pas la position verticale du plateau.
- Le résultat est annoncé sans qu'il faille voir l'écran, et la commande qui permet de rejouer est atteignable au clavier immédiatement après la fin.
- Une position chargée par un lien (histoire 1) déjà gagnante pour une seule couleur ouvre directement sur l'état final.
- Une position chargée où les deux couleurs gagnent simultanément est refusée : elle ne peut pas résulter d'une partie réelle, la victoire étant détectée dès le coup qui la produit.

---

### Histoire 5 — Tour passé, blocage et départage

**Pour qui, pourquoi** — pour que les fins de partie serrées, où le plateau se referme, se terminent proprement au lieu de bloquer les joueurs.

**Ce que ça recouvre** — le tour automatiquement passé, la fin par blocage et le départage à la plus grande zone, tels que décrits dans « Fin par blocage et départage ».

**Critères d'acceptation**

- Un joueur qui n'a aucun coup légal voit son tour passé automatiquement ; il ne peut jamais choisir de passer.
- Un tour passé est annoncé explicitement, en nommant le joueur concerné.
- Quand le tour de l'adversaire est passé, le joueur qui vient de poser rejoue immédiatement, et sa sélection est conservée s'il lui reste un exemplaire de la forme choisie — il n'a pas à la reprendre. Un changement de joueur, lui, vide toujours la sélection.
- Un joueur qui n'avait aucun coup peut rejouer normalement si une pose adverse lui a créé un appui.
- La partie ne se termine par blocage que lorsque **aucun** des deux joueurs n'a de coup légal ; une absence de coup suivie d'une pose ne termine pas la partie.
- Le blocage compare la plus grande zone connectée de chaque joueur, en nombre de cases, voisinage à huit cases compris ; la plus grande l'emporte.
- Les deux scores sont affichés dans le panneau de fin.
- Des plus grandes zones égales donnent un match nul, annoncé comme tel et distingué d'une victoire.
- La résolution d'un blocage examine au plus les deux joueurs : elle ne peut pas boucler.

---

### Histoire 6 — Rejouer une partie depuis sa notation

*Lié au support pour la partie « lien » ; le format lui-même est indépendant du support et doit être implémenté partout.*

**Pour qui, pourquoi** — pour partager une partie, reprendre une position exacte, ou décrire un bug de façon reproductible. Contrairement à la grille de l'histoire 1, la notation restitue **tout**.

**Ce que ça recouvre** — la lecture et l'écriture du format décrit dans « Notation d'une partie », et l'ouverture d'une partie depuis une notation fournie dans un lien.

Quand les deux entrées sont fournies, la notation l'emporte sur la grille : elle est strictement plus riche. Le paramètre de joueur au trait ne s'applique qu'à la grille, une notation portant elle-même son premier joueur.

**Critères d'acceptation**

- Rejouer une notation restitue le plateau, les réserves des deux joueurs, les exemplaires consommés, le joueur au trait et, le cas échéant, le résultat.
- Une partie terminée par connexion et une partie terminée par blocage sont toutes deux restituées, la seconde avec ses scores de départage.
- Un tour passé apparaît explicitement dans la notation écrite.
- Une notation lue puis réécrite est identique caractère pour caractère, y compris la notation vide.
- Chaque orientation distincte possède exactement une écriture ; deux orientations distinctes n'ont jamais la même.
- Les écritures redondantes sont acceptées en lecture et ramenées à leur forme canonique.
- La casse est libre à la lecture ; les trois séparateurs sont acceptés.
- Un `--` absent est déduit de la position ; un `--` placé là où aucun tour n'est passé est refusé.
- Un coup impossible est refusé en indiquant son rang, son jeton et la raison, parmi les sept motifs listés.
- Un refus n'applique rien : la position atteinte par le préfixe légal n'est ni restituée, ni modifiée.

---

### Histoire 7 — Jouer confortablement sur un téléphone

*Lié au support : suppose un écran tactile étroit.*

**Pour qui, pourquoi** — pour deux joueurs qui se passent un téléphone. C'est le support le plus contraint : le plateau, deux réserves et les commandes doivent tenir sans que rien ne bouge sous le doigt.

**Ce que ça recouvre** — la disposition en une colonne, la permutation des réserves à chaque tour, les cibles tactiles, et la stabilité de la mise en page.

**Disposition.** Le plateau occupe le milieu de l'écran et reste l'élément le plus grand. Au-dessus de lui, la bande réservée à la pièce en main ; juste en dessous vient la réserve de celui qui joue ; en dessous encore, celle de l'adversaire, atténuée. À chaque tour les deux réserves **échangent leur place**, si bien que ses propres pièces sont toujours les plus proches du plateau. Cette permutation est en elle-même l'annonce du changement de tour ; elle est **aussi annoncée à voix haute**, en nommant le joueur et en disant quelle réserve devient jouable — un déplacement purement visuel n'existe pas pour qui ne voit pas l'écran.

L'échange se **joue** plutôt qu'il ne se substitue : les deux réserves partent chacune de la place de l'autre et rejoignent la leur, l'une en montant, l'autre en descendant. Elles se croisent donc, et c'est celle qui prend la main qui passe **devant** — le mouvement dit alors de lui-même laquelle des deux vient vers le plateau. Il est court, sans rebond, et disparaît sous `prefers-reduced-motion`, où la permutation redevient instantanée.

Chaque réserve montre ses sept formes sur **deux rangées**, sans rien à faire défiler latéralement. Chaque forme y occupe la largeur de sa silhouette, plus la **même marge** que ses voisines : sept colonnes de largeur égale se régleraient sur la forme la plus large, ce qui noierait le mono dans du vide pendant que les pièces de trois cases toucheraient presque leurs voisines. La largeur ainsi rendue profite à toutes les silhouettes, qui se dessinent d'autant plus grandes. La zone tactile d'un exemplaire couvre toute sa colonne, marge comprise, et garde en hauteur la taille d'un doigt. Les exemplaires joués restent visibles en pointillé.

**Bande réservée.** Une bande au-dessus du plateau est réservée en permanence à la pièce sélectionnée, à ses commandes de rotation et de retournement, aux messages de refus et, en fin de partie, à l'annonce du vainqueur. Elle est **au-dessus** et non en dessous parce que c'est par le haut que la pièce entre sur le plateau : la voir tourner là où elle va tomber, c'est le même geste des deux côtés du jeu, et c'est aussi la disposition du grand écran. Sa hauteur ne dépend pas de son contenu : **rien ne bouge quand on choisit une pièce, quand un refus s'affiche, ni quand la partie se termine**.

Un message qui ne concerne aucune pièce en main — l'attente pendant que l'ordinateur cherche son coup, par exemple — occupe cette bande **en son milieu**, et non dans un coin : c'est alors le seul contenu qu'elle porte.

Sur un grand écran, la même matière se répartit en trois colonnes — une réserve, le plateau, l'autre réserve — les deux réserves restant visibles simultanément. La permutation n'a alors plus lieu d'être : le joueur au trait est désigné autrement, par une indication pointant vers sa réserve.

**Critères d'acceptation**

- Sur un écran de téléphone, aucun débordement horizontal de la page, en portrait comme en paysage.
- Le plateau est le plus grand élément de l'écran et reste entièrement visible sans défilement.
- La réserve du joueur au trait est celle qui touche le plateau par en dessous ; celle de l'adversaire est encore en dessous et visiblement atténuée.
- La pièce prise en main apparaît au-dessus du plateau, entre lui et le haut de l'écran, jamais en dessous.
- Un changement de tour permute les deux réserves et est annoncé, en nommant le joueur et sa réserve.
- La permutation se joue en mouvement, les deux réserves se croisant, celle qui prend la main passant devant ; la première image du mouvement montre exactement la disposition d'avant le tour, la dernière exactement celle d'après.
- Les sept formes d'une réserve tiennent sur deux rangées, sans défilement latéral.
- Chaque exemplaire disponible offre une cible tactile confortable au doigt en hauteur, et déborde sa silhouette de la marge qui l'écarte de ses voisines.
- Deux silhouettes voisines d'une même réserve sont séparées du même écart, quelles que soient leurs largeurs.
- Sélectionner une pièce, tourner, essuyer un refus ou terminer la partie ne déplace jamais le plateau ni les réserves.
- En plein écran installé, aucun contenu ne passe sous l'encoche ni sous la barre de gestes.

---

### Histoire 8 — Donner aux pièces une matière lisible

**Pour qui, pourquoi** — pour que le plateau se lise d'un coup d'œil : reconnaître une pièce, distinguer deux voisines de même couleur, et voir la grille au travers.

**Ce que ça recouvre** — l'apparence des pièces, dans la réserve, dans l'aperçu de sélection, dans l'aperçu de chute et sur le plateau.

**La matière.** Chaque pièce est une dalle de plexiglas teinté, épaisse et polie, posée à plat dans le plateau. On voit le quadrillage au travers : la couleur est un **filtre**, pas un aplat. La tranche est plus dense que le corps, et c'est elle qui détache deux pièces voisines de même couleur.

**La lumière appartient à l'écran, jamais à la pièce.** Une lumière unique éclaire toute la scène depuis le haut à gauche, avec une ombre courte, si bien que la pièce a l'air de reposer dans le plateau. Tourner ou retourner une pièce fait pivoter **sa forme, pas son reflet** : l'éclairage est ancré sur le plateau, pas sur la pièce. Corollaire : une orientation doit être décrite par les cases qu'elle occupe, jamais obtenue en faisant tourner un dessin déjà éclairé.

La règle porte sur les états **stables**, les seuls où l'on puisse comparer un reflet à son voisin. Elle admet une exception, et une seule : le temps du mouvement de rotation ou de retournement de l'aperçu de sélection (histoire 7), le dessin éclairé tourne avec la pièce. C'est le prix du mouvement, et il est borné — l'image d'arrivée retrouve la lumière de l'écran, et aucun état au repos, nulle part, ne montre un reflet de travers.

**Une pièce est une dalle, pas un assemblage de carrés.** Aucune case d'une même pièce ne doit se distinguer de ses voisines. La silhouette est le contour de l'**union** de ses cases, sans aucune arête interne : dans le creux d'un `L`, d'un `T` ou d'un `S`, aucune encoche ni artefact de jonction ne doit apparaître. Empiler un dessin par case produit exactement ce défaut et doit être évité.

C'est aussi une contrainte d'échelle, et c'est le piège principal : une pièce est un polyomino, ses divisions internes tombent donc exactement sur la grille. **Tout effet de matière dont la portée avoisine la taille d'une case s'aligne sur ces divisions et fait lire la pièce comme un patchwork de carrés.** Les seules échelles sûres sont très en dessous de la case — les liserés de tranche — ou très au-dessus — le reflet, étalé sur tout le plateau.

Une même forme présente exactement le même contour, le même retrait et la même épaisseur de trait dans la réserve, dans l'aperçu de sélection, dans l'aperçu de chute et sur le plateau ; seule la teinte distingue les deux joueurs. Une pièce en attente de pose est plus transparente et plane au-dessus du plateau. Un exemplaire absent de la réserve — déjà joué, ou en main — reprend le même contour, en pointillé clair et sans remplissage.

**Critères d'acceptation**

- Les cases d'une même pièce forment une silhouette continue, sans bordure interne, dans la réserve, dans l'aperçu et sur le plateau.
- Un `L`, un `J`, un `S`, un `Z` et un `T` posés ne présentent aucune encoche dans leurs angles rentrants.
- Aucune case d'une pièce ne se distingue de ses voisines par sa teinte ou sa luminosité, y compris sur une barre de trois.
- Le quadrillage du plateau reste visible à travers les pièces.
- Deux pièces distinctes de même couleur, adjacentes, restent visuellement séparables par leur tranche.
- Tourner ou retourner une pièce ne déplace pas son reflet ni son ombre : la lumière vient toujours du haut à gauche. Seul le mouvement de l'aperçu de sélection y déroge, et il rend cette lumière dès son image d'arrivée.
- Une même forme a le même contour et la même épaisseur de trait dans les quatre contextes d'affichage.
- Les pièces blanches restent nettement lisibles sur le fond du plateau et sur celui de leur réserve.
- Une pièce en attente de pose se distingue d'une pièce posée par sa transparence.

---

### Histoire 9 — Célébrer la victoire et montrer le chemin

**Pour qui, pourquoi** — pour que le gagnant voie **pourquoi** il a gagné : quelle chaîne de pièces relie les deux bords, et par où elle passe.

**Ce que ça recouvre** — le tracé du chemin gagnant, la célébration, et leur comportement quand le joueur a demandé moins d'animations.

**Le chemin.** Au moment où la connexion se referme, un chemin lumineux court sur le plateau. Il part du bord d'où vient la victoire — de la **gauche** pour une liaison horizontale, du **bas** pour une verticale — et remonte la chaîne case après case, virages arrondis compris, jusqu'à toucher le bord opposé. Il se prolonge jusqu'aux deux bords : sans cela, il s'arrêterait au centre de la première et de la dernière case et ne montrerait pas que les bords sont bien reliés.

Il **ne colorie rien** : il glisse par-dessus les pièces, cerné d'un liseré sombre qui le garde net sur les deux couleurs. Là où la connexion passe en diagonale, le trait file en oblique, ce qui rend le trajet exact lisible d'un coup d'œil.

Le chemin est un vrai chemin dans la zone gagnante, reconstruit avec la **même** connectivité à huit voisins que la détection de victoire : il peut donc comporter des pas diagonaux. Quand plusieurs chemins existent, n'importe lequel convient, mais la reconstruction doit être déterministe. Le chemin horizontal est cherché en premier ; le vertical seulement s'il n'en existe aucun.

**La célébration.** Pendant que le chemin se dessine, des gerbes d'étincelles éclatent au-dessus du plateau. Elles partent en cascade plutôt que toutes ensemble, sont écartées du centre pour qu'à aucun instant la position finale ne soit illisible, et **l'ensemble s'éteint de lui-même en quatre secondes environ** — dernier bouquet compris. Elles ne cachent jamais la position ni le panneau du vainqueur, ne captent aucun clic, et ne tournent jamais en boucle.

**Moins d'animations.** Pour qui a exprimé cette préférence au niveau du système, tout arrive d'emblée à son état final : le chemin est affiché entièrement tracé, et **les étincelles ne sont pas jouées du tout** — une célébration est précisément le genre d'effet à ne pas accélérer.

**Critères d'acceptation**

- Une victoire horizontale trace le chemin depuis le bord gauche ; une victoire verticale depuis le bord bas.
- Le tracé relie effectivement les deux bords opposés, prolongements compris.
- Un chemin comportant des pas diagonaux est tracé en oblique et non en escalier.
- Le tracé n'altère ni la couleur, ni la lisibilité des pièces qu'il traverse, bleues comme blanches.
- Le tracé reste lisible sur les deux couleurs de pièces.
- Les étincelles ne recouvrent ni le plateau ni le panneau de fin, et disparaissent seules en quatre secondes environ, sans reprendre.
- Sous préférence de mouvement réduit, le chemin s'affiche immédiatement dans son état final et aucune étincelle n'est jouée.
- La reconstruction du chemin est déterministe : la même position gagnante donne toujours le même tracé.

---

### Histoire 10 — Jouer contre l'ordinateur

**Pour qui, pourquoi** — pour jouer seul, à une force choisie, sans attendre.

**Ce que ça recouvre** — le choix du niveau avant la partie, le tour de l'ordinateur, et le budget de réflexion.

**Les niveaux.** L'écran de départ de l'histoire 2 propose désormais deux modes : à deux joueurs sur le même écran, ou contre l'ordinateur. Avant de lancer une partie contre l'ordinateur, le joueur choisit son niveau : **débutant**, **confirmé** ou **expert**. Le débutant joue au coup par coup et laisse passer les menaces. Le confirmé, proposé par défaut, anticipe la réponse de son adversaire. L'expert pousse son analyse plus loin dès que le plateau se resserre. Le choix vaut pour toute la partie, et il est **retenu d'une partie à l'autre** : le joueur qui a réglé son niveau une fois ne le règle plus, y compris après avoir fermé puis rouvert le jeu. C'est la seule préférence conservée, et elle est traitée comme une donnée du dehors — une valeur illisible ou écrite par une version antérieure est ignorée au profit du niveau par défaut, qui reste **confirmé** au tout premier lancement.

**Choix de cette version** — le joueur humain tient toujours les bleus et l'ordinateur les blancs, ce qui fixe leur place à l'écran et évite un réglage de plus. Qui **ouvre** la partie reste tiré au sort : l'ordinateur joue donc le premier coup une fois sur deux.

**Le budget de réflexion prime sur la profondeur.** Quel que soit le niveau, l'ordinateur annonce qu'il réfléchit et répond en une ou deux secondes : la partie ne s'interrompt jamais sur une attente, y compris sur téléphone. Le **pire cas est l'ouverture** : le plateau vide offre 95 coups légaux, et chaque niveau d'anticipation supplémentaire multiplie le travail par ce facteur de branchement. Un niveau fixe donc une profondeur **visée**, pas une promesse d'attente : tant que la position reste large, l'analyse s'arrête plus tôt ; elle va au bout quand le plateau se resserre, c'est-à-dire là où l'anticipation décide de la partie. Valeur de référence : au-delà de **24** coups légaux, l'anticipation est ramenée à un tour de réponse. Ce seuil se règle sur la machine cible, la contrainte tenable étant le temps, pas le nombre.

**Ce que l'ordinateur cherche.** Une position se juge d'abord par la distance qui sépare chaque joueur de la victoire : le nombre minimal de cases encore à conquérir pour relier une paire de bords opposés, en traversant ses propres cases sans coût, les cases vides à l'unité, et sans jamais traverser une case adverse, avec le même voisinage à huit cases que la victoire. Une grille vide vaut ainsi 9, une grille gagnante 0, une position dont les deux axes sont coupés vaut l'infini. L'ordinateur maximise l'écart entre la distance de son adversaire et la sienne, et départage à égalité par la différence des plus grandes zones. Une partie terminée domine toujours cette estimation, avec une préférence pour une victoire plus rapide et une défaite plus tardive.

Cette évaluation est **indicative** : c'est une heuristique qui fonctionne, pas une obligation. Ce qui est exigé, ce sont les niveaux perçus et le temps de réponse.

**Deux parties identiques n'ont aucun intérêt.** Une évaluation ne classe pas 95 ouvertures en 95 rangs : elle en juge beaucoup **exactement égales** — quatorze à l'ouverture, au niveau confirmé. Départager ces ex æquo par l'ordre d'énumération donne un adversaire qui ouvre toujours pareil et rejoue la même partie face à la même suite de coups, ce qui se remarque vite et lasse. L'ordinateur **tire donc au sort parmi les coups de valeur strictement égale**. C'est gratuit en force : le tirage ne porte que sur des coups que la recherche juge indiscernables, jamais sur un coup moins bon. Le conseil de l'histoire 11, lui, ne tire rien au sort : on attend d'un conseil qu'il soit stable, et le redemander sur une même position ne doit pas changer la recommandation.

Reconnaître une égalité demande une précaution : l'élagage alpha-bêta n'a pas besoin de calculer la valeur exacte d'un coup dont il sait déjà qu'il ne dépassera pas le meilleur, et rend alors une borne, pas un score. Un ex æquo passerait donc pour un coup moins bon. La recherche doit garder ouverte la fenêtre qui distingue « égal » de « strictement moins bon », sans quoi le tirage ne trouve qu'un seul candidat et ne varie rien.

**Retour au joueur.** L'ordinateur annonce qu'il réfléchit avant de chercher, pas après. Sa pièce **tombe comme celle du joueur** (histoire 2) : c'est cette descente qui dit dans quelle colonne le coup est parti. Elle est ensuite mise en évidence quelques secondes, une fois posée : sans ces deux signaux le plateau change tout seul et le joueur ne voit pas ce qui s'est passé. La mise en évidence attend la fin de la chute plutôt que de la recouvrir, sinon les deux signaux se disputent le même instant.

**Critères d'acceptation**

- Le niveau se choisit avant le lancement de la partie et reste inchangé jusqu'à sa fin.
- Sans choix explicite, la partie démarre au niveau intermédiaire ; une nouvelle partie y revient.
- Le niveau expert produit un jeu au moins aussi fort que le niveau confirmé, lui-même plus fort que le débutant.
- L'ordinateur ne joue que des coups légaux et ne consomme que des pièces qu'il possède encore.
- L'ordinateur reconnaît un coup qui gagne immédiatement et le joue.
- Plusieurs parties d'affilée ne commencent pas toutes par le même coup de l'ordinateur, et une même suite de coups du joueur n'obtient pas toujours les mêmes réponses.
- Le tirage ne porte que sur des coups de valeur strictement égale : un coup qui gagne, ou l'unique parade à une menace, reste joué à coup sûr.
- Le message d'attente est visible **avant** que la recherche commence, pas après.
- Aucune position ne fait attendre plus de deux secondes, ouverture comprise, sur un appareil modeste.
- La pièce de l'ordinateur descend depuis le bord haut du plateau, comme celle du joueur.
- La pièce que vient de poser l'ordinateur est mise en évidence assez longtemps pour être repérée, une fois sa chute terminée.
- Un coup de l'ordinateur hors de son tour est ignoré ; une pose manuelle pendant son tour est ignorée.
- L'ordinateur ne passe jamais par le circuit de sélection du joueur humain : la réserve blanche n'est jamais interactive.
- Tout se calcule sur l'appareil : aucun appel réseau n'est nécessaire pour jouer un coup.

---

### Histoire 11 — Demander conseil

**Pour qui, pourquoi** — pour apprendre le jeu, ou se débloquer sur une position fermée, sans quitter la partie.

**Ce que ça recouvre** — une commande « Conseil » disponible quand c'est à vous de jouer, et l'affichage éphémère du coup recommandé.

La commande se tient avec les autres commandes de coup, autour de la pièce sélectionnée, et non dans le bandeau d'état : c'est une action du joueur, pas une information sur la partie. Elle s'efface tant que son conseil est affiché — le surlignage tient lieu de réponse, et la redemander ne servirait à rien.

Le jeu montre **d'un même geste** la pièce à prendre dans votre réserve et l'emplacement précis où la poser, déjà tournée dans le bon sens. Les deux ensemble : l'une sans l'autre ne servirait à rien. L'exemplaire mis en évidence dans la réserve est celui que la pose consommerait réellement.

La suggestion s'efface **dès que vous touchez à quoi que ce soit** ou que la main passe à l'adversaire. Rien ne reste affiché en permanence : une partie à deux n'est donc jamais éventée. Une action refusée, elle, ne change rien et laisse donc le conseil en place — c'est cohérent, rien ne s'est passé.

Le conseil vise toujours la force la plus haute, indépendamment du niveau choisi pour l'adversaire : un conseil calculé au niveau débutant recommanderait un coup qu'on ne souhaite conseiller à personne. Il reste soumis au même budget de réflexion que l'histoire 10, et n'est donc jamais plus lent.

**Critères d'acceptation**

- La commande n'est proposée que pendant qu'un humain a la main dans une partie en cours.
- Elle n'est proposée ni pendant que l'ordinateur réfléchit, ni une fois la partie terminée, ni avant qu'elle commence.
- Elle est proposée qu'une pièce soit sélectionnée ou non : c'est sans pièce en main qu'on ignore laquelle prendre.
- Elle disparaît tant que son conseil est affiché, et revient dès que celui-ci s'efface.
- Son apparition et sa disparition ne déplacent ni l'aperçu de la pièce, ni les commandes de rotation, ni le plateau.
- Le conseil désigne simultanément une pièce de la réserve et les cases exactes où elle atterrirait.
- L'orientation montrée est celle qu'il faut jouer, sans que le joueur ait à la retrouver.
- L'exemplaire mis en évidence est celui que la pose consommerait effectivement.
- Le conseil ne propose jamais une forme dont les deux exemplaires sont joués.
- Aucun conseil n'est rendu si le joueur au trait n'a plus aucun coup légal.
- Demander conseil ne modifie ni le plateau, ni les réserves, ni le joueur au trait, ni la sélection en cours.
- Deux demandes sur une même position rendent le même conseil.
- Le conseil disparaît à la première action du joueur et au changement de joueur.
- Un état d'attente est visible pendant la recherche.

---

### Histoire 12 — Installer le jeu et y jouer hors ligne

*Lié au support : suppose une plateforme où une application web s'installe.*

**Pour qui, pourquoi** — pour retrouver le jeu sur son écran d'accueil et y jouer dans le métro.

**Ce que ça recouvre** — l'installation sur l'appareil et la disponibilité hors ligne.

Le jeu s'ajoute à l'écran d'accueil comme une application : une icône, un nom, un lancement en plein écran, sans compte ni magasin d'applications. Après une première visite, il reste disponible **sans connexion**, adversaire ordinateur compris, puisque tout se calcule sur l'appareil.

La dernière version est servie dès que le réseau revient : le joueur ne doit jamais rester bloqué sur une version ancienne. Hors ligne, la partie en cours **n'est pas conservée** d'une session à l'autre : c'est le jeu qui est disponible, pas l'état de la partie. Un joueur qui veut garder une position en cours utilise la notation de l'histoire 6.

**Critères d'acceptation**

- Le jeu est proposé à l'installation et se lance en plein écran, avec son icône et son nom.
- Après une première visite complète, le jeu se lance et se joue entièrement sans connexion, partie contre l'ordinateur comprise.
- Aucun compte n'est demandé à aucun moment.
- Une version plus récente est prise en compte dès le retour du réseau, sans intervention du joueur.
- Une coupure réseau en cours de partie n'interrompt pas la partie.
- L'état de la partie n'est pas restauré après fermeture ; le jeu redémarre sur son écran de départ. Seul le niveau de l'ordinateur y est retrouvé.

---

## Hors périmètre

Ne pas ajouter sans demande explicite : jeu en réseau, comptes, backend ou base de données, matchmaking, chronomètre, historique persistant, effets sonores.

L'annulation d'un coup n'est pas prévue : le jeu physique ne permet pas de reprendre une pièce posée. La notation de partie couvre le besoin de revenir à une position antérieure.
