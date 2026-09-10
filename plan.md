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

Une pose est légale si et seulement si les trois conditions suivantes sont réunies. Chacune correspond à un **motif de refus distinct**, qui doit être restituable au joueur.

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

**Partager en retour.** L'écran de jeu propose un bouton qui copie un lien vers la position courante. Le lien est au format **notation** (voir « Notation d'une partie »), non au format grille : il restitue donc la position *exacte* — réserves consommées et joueur au trait compris —, ce que la grille ne fait pas. C'est le pendant de la lecture décrite ici : reproduire un coup douteux de l'ordinateur ou soumettre une position ne demande plus de la ressaisir à la main.

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

**Trois façons de viser, selon le support.** Là où le pointeur sait survoler, le plateau entier **et la bande qui le surmonte** deviennent la surface de visée : la pièce suit la colonne survolée et l'action la pose ; aucune rangée de commandes n'est alors affichée. La bande supérieure est indispensable, un plateau presque plein n'offrant plus de case libre à survoler. Là où le pointeur ne survole pas, neuf zones d'entrée apparaissent au-dessus du plateau, uniquement quand une pièce est sélectionnée, chacune réduite à une flèche sans numéro visible. Ces flèches ne portent **aucun état** : ni la colonne visée, ni le refus. L'aperçu de chute dit déjà les deux, et il les dit sur le plateau, là où la pièce tombera, plutôt que sous le doigt qui couvre la bande.

**Au doigt, viser et poser sont deux temps d'un même geste.** Une pièce couvre plusieurs colonnes : la flèche pressée ne dit pas à elle seule où la pièce tomberait, et c'est exactement le doute que le survol lève ailleurs. L'appui **vise et ne pose rien** — l'aperçu de chute apparaît, en rouge quand la pose est refusée ; glisser le long de la bande sans relâcher déplace la visée d'une colonne à l'autre ; **seul le relâchement pose**, sur la colonne où le doigt se trouve alors. Relâcher sur une colonne refusée ne pose rien et ne consomme rien : la pièce reste en main, son aperçu rouge sous les yeux, et le joueur la tourne, la change ou vise ailleurs. La surface de visée du geste est **la bande et le plateau qu'elle surmonte** : le doigt qui descend sur la grille continue de viser, et il dérive donc sans rien perdre. Sortir de cette surface — vers la pièce en main au-dessus, vers les réserves en dessous — **éteint l'aperçu**, et relâcher là **abandonne** le geste sans rien poser. C'est l'extinction qui rend l'abandon lisible : tant qu'un aperçu est peint, relâcher pose ; dès qu'il n'y en a plus, relâcher ne fait rien. Revenir sur la surface sans avoir relâché rétablit la visée.

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
- Sur un écran tactile, appuyer sur une zone d'entrée montre l'aperçu de chute sans rien poser ; la pièce ne tombe qu'au relâchement.
- Glisser le doigt d'une zone d'entrée à l'autre sans relâcher déplace l'aperçu, et c'est la colonne relâchée qui est jouée, non celle de l'appui.
- Relâcher sur une colonne où la pose est refusée ne pose rien, ne change pas de tour, et laisse l'aperçu rouge affiché.
- Le doigt descendu de la bande sur le plateau vise toujours ; sorti de l'un et de l'autre, il n'affiche plus d'aperçu et n'a plus de colonne mise en évidence.
- Relâcher hors de la bande et du plateau n'a aucun effet : rien n'est posé, le tour ne change pas, et la pièce reste en main dans son orientation.
- Sélectionner, tourner ou retourner ne déplace aucun autre élément à l'écran : le bord supérieur du plateau ne bouge pas.
- Une partie entière se joue au clavier seul, sans jamais toucher un pointeur, y compris là où les zones d'entrée de colonne ne sont pas affichées.
- Les six fonctions du tableau ci-dessus sont chacune atteignables au clavier.
- La première visée au clavier part de la colonne centrale ; viser au-delà d'un bord laisse la colonne sur ce bord.
- Le nom de chaque forme et le nombre d'exemplaires restants sont accessibles sans voir l'image, bien qu'ils ne soient pas écrits à l'écran.

---

### Histoire 3 — Refuser les poses illégales

**Pour qui, pourquoi** — pour que le jeu soit le jeu : sans support intégral ni contrôle des débordements, Linkx n'est qu'un empilement.

**Ce que ça recouvre** — les trois motifs de refus décrits dans « Légalité d'une pose », leur restitution au joueur, et l'énumération des coups légaux qui en découle.

L'aperçu distingue désormais deux états : valide, dans la couleur du joueur ; invalide, dans une teinte de refus. Agir sur une position invalide ne change rien.

**Le motif du refus ne s'écrit pas à l'écran.** L'aperçu apparaît là où la pièce tomberait, dans une teinte qui dit déjà l'échec, et à l'instant même où le joueur vise : une phrase à côté redit une information qu'il a déjà lue, et le refus est de toute façon sans conséquence. Le motif reste en revanche **annoncé** — la couleur n'existe pas pour qui ne voit pas l'écran — et il reste restituable, la vérification d'une notation de partie (histoire 11) le nommant en clair.

L'énumération des coups légaux d'un joueur — toutes ses formes encore en réserve, toutes leurs orientations distinctes, toutes les colonnes d'ancrage possibles, filtrées par la légalité — devient la source de vérité pour savoir si un joueur peut jouer. Elle sert aux histoires 5, 10 et 11. Sur une grille vide, elle produit **95** coups légaux ; ce nombre retombe sous 20 en fin de partie.

**Critères d'acceptation**

- Une pièce qui laisserait un vide sous une partie de sa face inférieure ne peut pas être posée.
- Un `T` tige vers le bas, lâché sur un sol plat, est refusé pour cette raison ; le même `T` barre en bas est accepté.
- Un `T` tige vers le bas lâché au-dessus de deux cases occupées séparées d'une case est accepté : chacun de ses appuis repose sur quelque chose.
- Une pièce qui, dans son orientation courante, sortirait latéralement du plateau est refusée sans qu'aucune chute soit simulée.
- Une pièce qui ne peut pas entrer entièrement dans une colonne trop remplie est refusée pour débordement par le haut.
- Chacun de ces trois refus produit une raison distincte, annoncée sans voir l'écran et nommée en clair par la vérification d'une notation.
- Une pose refusée ne modifie ni le plateau, ni les réserves, ni le joueur au trait, ni la sélection.
- L'aperçu invalide se distingue de l'aperçu valide au premier coup d'œil, sans qu'aucun texte ne l'accompagne.
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

**Bande réservée.** Une bande au-dessus du plateau est réservée en permanence à la pièce sélectionnée, à ses commandes de rotation et de retournement, aux messages que rien à l'écran ne dit déjà — l'attente de l'ordinateur, un tour passé — et, en fin de partie, à l'annonce du vainqueur. Elle est **au-dessus** et non en dessous parce que c'est par le haut que la pièce entre sur le plateau : la voir tourner là où elle va tomber, c'est le même geste des deux côtés du jeu, et c'est aussi la disposition du grand écran. Sa hauteur ne dépend pas de son contenu : **rien ne bouge quand on choisit une pièce, quand un refus s'affiche, ni quand la partie se termine**.

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
- Sélectionner une pièce, tourner, viser une pose refusée ou terminer la partie ne déplace jamais le plateau ni les réserves.
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

**Les niveaux.** L'écran de départ de l'histoire 2 propose désormais deux modes : à deux joueurs sur le même écran, ou contre l'ordinateur. Avant de lancer une partie contre l'ordinateur, le joueur choisit son niveau : **débutant**, **confirmé**, **expert** ou **maître**. Le débutant joue au coup par coup et laisse passer les menaces. Le confirmé, proposé par défaut, anticipe la réponse de son adversaire. L'expert pousse son analyse plus loin dès que le plateau se resserre. Le maître ne se règle plus du tout de la même façon (voir plus bas) : il ne vise aucune profondeur, il approfondit tant que son temps le permet, et il **résout exactement** la fin de partie. Le choix vaut pour toute la partie, et il est **retenu d'une partie à l'autre** : le joueur qui a réglé son niveau une fois ne le règle plus, y compris après avoir fermé puis rouvert le jeu. C'est la seule préférence conservée, et elle est traitée comme une donnée du dehors — une valeur illisible ou écrite par une version antérieure est ignorée au profit du niveau par défaut, qui reste **confirmé** au tout premier lancement.

**Choix de cette version** — le joueur humain tient toujours les bleus et l'ordinateur les blancs, ce qui fixe leur place à l'écran et évite un réglage de plus. Qui **ouvre** la partie reste tiré au sort : l'ordinateur joue donc le premier coup une fois sur deux.

**Le budget de réflexion prime sur la profondeur.** Aux trois premiers niveaux, l'ordinateur annonce qu'il réfléchit et répond en une ou deux secondes : la partie ne s'interrompt jamais sur une attente, y compris sur téléphone. Le maître fait exception et l'assume : voir plus bas. Le **pire cas est l'ouverture** : le plateau vide offre 95 coups légaux, et chaque niveau d'anticipation supplémentaire multiplie le travail par ce facteur de branchement. Un niveau fixe donc une profondeur **visée**, pas une promesse d'attente : tant que la position reste large, l'analyse s'arrête plus tôt ; elle va au bout quand le plateau se resserre, c'est-à-dire là où l'anticipation décide de la partie. Le rabattement se fait par paliers, propres à chaque niveau : au-delà de **24** coups légaux, l'expert retombe à un tour de réponse. Le maître, lui, accepte de réfléchir un peu plus longtemps — deux à trois secondes au pire sur téléphone plutôt qu'une à deux — pour rester un cran au-dessus : il tient sa pleine anticipation jusqu'à **30** coups, puis un tour de moins jusqu'à **48**, et ne se réduit à une réponse immédiate qu'au tout début de la partie. C'est ce budget plus large, et non un simple palier décalé, qui le garde plus profond que l'expert partout sauf sur les premiers coups, où le plateau est trop ouvert pour que l'anticipation change quoi que ce soit. Ces seuils se règlent sur la machine cible, la contrainte tenable étant le temps, pas le nombre.

**Le maître ne vise pas une profondeur, il consomme un budget.** Les trois premiers niveaux annoncent un nombre de tours d'anticipation et rabattent ce nombre quand le plateau est trop large. Le maître fait l'inverse : il **approfondit par paliers successifs** — un tour, puis deux, puis trois — et joue le résultat du **dernier palier achevé** quand son temps est écoulé. Il a donc toujours un coup sous la main, et il va d'autant plus loin que la position est resserrée ou la machine rapide, sans jamais dépasser son budget. Mesuré sur la partie de référence, à six secondes : six tours d'anticipation dans l'ouverture, sept en milieu de partie, huit dès que le plateau se resserre, et la **résolution complète** dès que la fin approche — où il répond alors instantanément.

Trois conséquences à ne pas perdre :

- **Il corrige l'avantage du trait au lieu de jeter un palier sur deux.** Un nombre impair de tours s'arrête juste après un de ses propres coups : il voit son gain sans voir la réponse, et se croit mieux placé qu'il ne l'est. Le biais existe bel et bien — mesuré sur la partie de référence, un palier impair revient en moyenne 1 250 points au-dessus de ses voisins pairs, soit plus d'un cran de menace. Mais il se corrige à sa source, en accordant à l'évaluation une valeur constante pour le trait, ce qui ramène l'écart moyen à 20 points ; les paliers impairs redeviennent alors aussi jouables que les pairs. Les jeter coûtait cher : sur cette même partie, un palier impair s'achevait dans le budget puis se voyait remplacé par un palier moins profond. Cette valeur du trait est **mesurée, pas réglée à la main** — elle se recalibre à chaque modification de l'évaluation, et un test l'exige.
- **Il n'entame pas un palier qu'il ne finira pas, et il estime ce coût par une constante.** Un palier interrompu est jeté : tout ce qu'on y passe est perdu. Le maître compare donc ce qui lui reste à ce que coûterait le suivant — **quatre fois** le dernier achevé. Ce facteur a été mesuré, et il est délibérément fixe : une version antérieure l'**observait** sur les deux derniers paliers, ce qui était plus savant et moins bon, le rapport observé prédisant mal le suivant. La constante gagne trois paliers sur la partie de référence — dont un tour entier d'anticipation au premier coup, où le maître rendait la main après 1,3 seconde sur les 6 qu'il avait — pour un dixième de temps de réflexion en plus. Un pari perdu ne coûte d'ailleurs pas de la force mais de l'attente : le coup joué reste celui du dernier palier achevé.
- **Sa force dépend de son budget, avec un seuil.** En dessous d'environ 60 000 positions examinées, il ne fait que 5 à 3 contre son barème précédent ; au-dessus, 24 à 0. Le seuil correspond au moment où sa recherche dépasse, dans l'ouverture, ce que le livre lui apportait. Réduire son budget ne le rend pas un peu plus faible : cela le fait basculer.

**Le maître réfléchit plus longtemps, sans jamais figer l'écran.** Il s'accorde jusqu'à **six secondes**, là où les autres niveaux répondent en une ou deux. C'est un écart assumé, et il n'est tenable que parce que sa recherche ne tourne **pas** là où l'écran se dessine : pendant qu'il cherche, la page reste entièrement vivante — on peut faire défiler, ouvrir les règles, lancer une nouvelle partie. Une recherche abandonnée parce que le joueur a changé quelque chose s'arrête réellement.

Ces six secondes sont un **plafond, pas une attente systématique**. Un palier coûte environ quatre fois le précédent : le maître regarde ce que le dernier lui a pris et ne s'engage dans le suivant que s'il a de quoi le finir. Il rend donc son coup dès qu'approfondir n'est plus à sa portée, au lieu de dépenser le reste du budget dans un calcul qu'il jettera — deux secondes en moyenne sur la partie de référence, six au pire. Et dès qu'il peut **résoudre** la partie, il s'arrête sur-le-champ : en fin de partie il répond presque instantanément.

Là où le worker manque — moteur trop ancien, ou fragment jamais mis en cache avant un passage hors ligne —, la recherche retombe sur le fil principal avec le budget réduit des autres niveaux. Le joueur perd de la force adverse, jamais sa partie.

**Sa pleine force suppose une machine de bureau.** Le seuil des 60 000 positions se franchit largement en six secondes sur un ordinateur ; sur un téléphone trois à quatre fois plus lent, le maître peut rester en deçà et jouer alors nettement moins fort, sans jamais retomber au niveau de l'expert. La recherche s'adaptant au temps disponible, cette perte est **progressive** : elle n'a jamais pour effet un coup illégal, une attente plus longue, ni un écran figé.

**Le maître résout la fin de partie.** Une partie fait au plus 28 poses, et chaque pose consomme une pièce : le nombre de demi-coups restants est donc **connu et borné**. Dès que le maître peut explorer jusque-là, il ne juge plus la position, il la **résout** : le score qu'il rend n'est plus une estimation mais le résultat de la partie en jeu parfait — gagnée, perdue ou nulle. En pratique la seconde moitié de chaque partie est jouée parfaitement, et il s'arrête de chercher dès qu'il tient cette certitude. C'est la même recherche qui joue le milieu de partie et qui résout la fin ; il n'y a pas deux moteurs.

**Ce qu'il regarde en plus.** À l'estimation décrite plus bas, le maître ajoute trois mesures que les autres niveaux n'ont pas. La **largeur d'un chemin** : à distance égale de la victoire, un chemin qu'on peut emprunter de plusieurs façons vaut mieux qu'un chemin unique, que l'adversaire coupe d'une seule pièce — c'est la faiblesse classique d'une évaluation qui ne compte que le plus court chemin. Le **départage au blocage**, qui pèse d'autant plus lourd que le plateau se remplit : c'est le critère qui décide les fins de partie fermées, et le négliger revient à perdre les parties où personne ne connecte. Et la **réserve** : une case vide ne vaut d'être convoitée que si quelqu'un peut encore la remplir. Faire monter une pile jusqu'à elle coûte des pièces, et relier deux bords en coûte autant que le chemin est long ; passé ce que les réserves permettent, le chemin est mort et le compter reviendrait à défendre contre une menace que l'adversaire n'a plus les moyens de conclure.

**Le livre d'ouverture doit garder deux paliers d'avance.** Au tout début de partie le plateau offre 60 à 95 coups légaux, et la recherche en direct n'y dépasse pas la profondeur 6. Le livre, calculé hors ligne à profondeur **9**, donne l'anticipation qui manque là où elle manque le plus. Mesuré au budget du jeu et non au seuil de force qui sert d'ordinaire aux duels, un arbitre commun notant les coups à profondeur 8 sur les 50 ouvertures distinctes de l'adversaire : le livre est meilleur que le jeu direct **34 fois**, à égalité 16, **moins bon zéro fois**, et aucune ouverture ne lui manque.

**Un seul palier d'avance ne suffit pas.** Le même livre calculé à profondeur 7 — un palier au-dessus des 6 du jeu — est **moins bon que la recherche en direct sur 14 ouvertures**. Comparés l'un à l'autre sur les 26 ouvertures où ils diffèrent, le livre de profondeur 9 l'emporte **26 à 0**. L'avance a fondu à mesure que la recherche s'approfondissait : elle valait deux paliers quand le jeu plafonnait à 4 et que le livre en offrait 6, elle était retombée à un. Le livre doit donc gagner un palier chaque fois que le moteur en gagne un, sous peine de nuire au lieu d'aider.

**Deux pièges de mesure, tous deux rencontrés.** Le premier : l'**arbitre doit voir plus loin que les deux coups qu'il départage**, sans quoi il ne fait que ratifier celui qu'il aurait joué lui-même — arbitré à profondeur 6, le livre de profondeur 7 paraissait n'être jamais moins bon, et c'est un arbitre trop court qui le disait. Le second : une mesure trop courte ne se lit pas, dans un sens comme dans l'autre — un duel de parties sur 12 ouvertures avait rendu 8 contre 10, un autre sur 48 l'inverse, quatre ouvertures discordantes ne distinguant rien du hasard. La comparaison appariée coup par coup, elle, tranche sur 50 ouvertures parce qu'une différence de coup n'y est pas diluée dans les vingt autres coups d'une partie.

**Comment mesurer un livre.** Le livre ne couvre que l'ordinateur, qui joue toujours blanc. Un duel qui alterne les couleurs le rend donc inerte dans une partie sur deux : ces parties-là opposent deux moteurs identiques et diluent l'effet mesuré jusqu'à l'inverser. C'est l'erreur qui avait fait croire, un temps, que le livre coûtait des parties. Un livre se mesure **apparié** : même position de départ, même moteur des deux côtés, seul le recours au livre changeant.

Le livre doit être engendré par le **moteur courant**. Il n'offre alors que ce que la recherche aurait trouvé avec plus de temps, ce qui ne peut pas nuire. Un livre hérité d'une autre évaluation, lui, propose des coups que l'évaluateur qui les lit ne sait pas exploiter ; c'est le seul cas où un livre est à proscrire.

**Ce que l'ordinateur cherche.** Une position se juge d'abord par la distance qui sépare chaque joueur de la victoire : le nombre minimal de cases encore à conquérir pour relier une paire de bords opposés, en traversant ses propres cases sans coût, les cases vides à l'unité, et sans jamais traverser une case adverse, avec le même voisinage à huit cases que la victoire. Chaque joueur vise **deux** paires de bords : l'axe le plus proche compte d'abord — c'est la vraie menace, puisqu'un seul suffit à gagner —, mais le second **départage**. À menace principale égale, on préfère la position où l'autre axe avance aussi, ou celui de l'adversaire recule. C'est ce second axe qui rend l'évaluation sensible au blocage d'un chemin adverse qui n'était pas le plus court, lequel, sans lui, passait inaperçu. Une grille vide vaut 9 sur chaque axe, une grille gagnante 0, un axe infranchissable l'infini. L'ordinateur maximise l'écart entre ce potentiel chez son adversaire et le sien, puis départage ce qui reste par la différence des plus grandes zones. Une partie terminée domine toujours cette estimation, avec une préférence pour une victoire plus rapide et une défaite plus tardive.

Cette évaluation est **indicative** : c'est une heuristique qui fonctionne, pas une obligation. Ce qui est exigé, ce sont les niveaux perçus et le temps de réponse.

**Deux parties identiques n'ont aucun intérêt.** Une évaluation ne classe pas 95 ouvertures en 95 rangs : elle en juge certaines **exactement égales**. L'évaluation à deux axes, plus fine, en laisse peu à faible profondeur — deux à l'ouverture au niveau confirmé —, mais la recherche profonde du maître en retrouve plusieurs. Départager ces ex æquo par l'ordre d'énumération donne un adversaire qui ouvre toujours pareil et rejoue la même partie face à la même suite de coups, ce qui se remarque vite et lasse. L'ordinateur **tire donc au sort parmi les coups de valeur strictement égale**. C'est gratuit en force : le tirage ne porte que sur des coups que la recherche juge indiscernables, jamais sur un coup moins bon. Le conseil de l'histoire 11, lui, ne tire rien au sort : on attend d'un conseil qu'il soit stable, et le redemander sur une même position ne doit pas changer la recommandation. Le conseil visant la force la plus haute, il hérite du maître, dont la recherche s'arrête au temps — ce qui, d'un appel à l'autre, ne s'arrêterait pas au même endroit. Pour le conseil, elle s'arrête donc sur un **nombre de positions examinées** et non sur l'horloge : la recommandation redevient identique à elle-même, à position égale, sur n'importe quelle machine.

Reconnaître une égalité demande une précaution : l'élagage alpha-bêta n'a pas besoin de calculer la valeur exacte d'un coup dont il sait déjà qu'il ne dépassera pas le meilleur, et rend alors une borne, pas un score. Un ex æquo passerait donc pour un coup moins bon. La recherche doit garder ouverte la fenêtre qui distingue « égal » de « strictement moins bon », sans quoi le tirage ne trouve qu'un seul candidat et ne varie rien.

**Retour au joueur.** L'ordinateur annonce qu'il réfléchit avant de chercher, pas après. Sa pièce **tombe comme celle du joueur** (histoire 2) : c'est cette descente qui dit dans quelle colonne le coup est parti. Elle est ensuite mise en évidence quelques secondes, une fois posée : sans ces deux signaux le plateau change tout seul et le joueur ne voit pas ce qui s'est passé. La mise en évidence attend la fin de la chute plutôt que de la recouvrir, sinon les deux signaux se disputent le même instant.

**Critères d'acceptation**

- Le niveau se choisit avant le lancement de la partie et reste inchangé jusqu'à sa fin.
- Sans choix explicite, la partie démarre au niveau intermédiaire ; une nouvelle partie y revient.
- Chaque niveau produit un jeu au moins aussi fort que le précédent : le maître au moins aussi fort que l'expert, lui-même au moins aussi fort que le confirmé, lui-même plus fort que le débutant.
- Le maître, lui, ne se contente pas de « au moins aussi fort » : il bat **nettement** la version précédente de lui-même, et non à la marge.
- Pendant que le maître réfléchit, l'interface répond toujours : le défilement, les règles et le bouton de nouvelle partie restent utilisables.
- Le jeu reste jouable hors ligne contre le maître dès la première visite, sans avoir eu à déclencher un tour d'ordinateur au préalable.
- Le maître ne perd jamais une position qu'il a annoncée gagnée : passé le point où il résout la partie, son verdict est exact.
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
- Aucun compte n'est demandé à aucun moment pour jouer.
- Une version plus récente est prise en compte dès le retour du réseau, sans intervention du joueur.
- Une coupure réseau en cours de partie n'interrompt pas la partie.
- L'état de la partie n'est pas restauré après fermeture ; le jeu redémarre sur son écran de départ. Seul le niveau de l'ordinateur y est retrouvé.

---

### Histoire 13 — Dérouler une partie coup par coup

*Lié au support pour l'entrée par lien ; la lecture pas à pas ne suppose qu'une notation et vaut donc partout.*

**Pour qui, pourquoi** — pour qui reçoit une partie et veut comprendre comment elle s'est jouée. Un lien de notation (histoire 6) restitue une **position** : on voit où la partie en est, jamais comment elle y est arrivée. Le coup qui a tout décidé se devine au mieux, et une partie de vingt-cinq coups reçue en un seul jeton de position ne s'étudie pas.

**Ce que ça recouvre** — une barre de lecture sur l'écran de jeu, présente **uniquement** quand la partie affichée vient d'une notation, et le déplacement d'un curseur le long des coups de cette partie.

**État par défaut : la fin, sans animation.** Ouvrir un lien de notation affiche la **dernière** position, d'emblée, sans qu'aucune pièce ne tombe — c'est le comportement d'aujourd'hui et il ne change pas. Le curseur de la barre est alors sur le dernier coup, et rien ne distingue cette position de la même position atteinte en jouant.

**Commandes.** Aller au début, coup précédent, coup suivant, aller à la fin ; un curseur qui se déplace le long de la partie et qui **dit toujours son rang**, « coup 7 sur 23 » ; et le libellé du coup courant dans la notation du document (voir « Notation d'une partie »), `4Lsr27` plutôt qu'une paraphrase — c'est le même vocabulaire que le lien qu'on vient d'ouvrir. Le début de la partie est une position à part entière : le plateau y est vide, et la barre affiche « coup 0 sur 23 ».

**Le pas en avant anime une seule pièce.** Avancer d'un coup fait tomber **la pièce de ce coup-là**, depuis le bord haut du plateau, exactement comme un coup joué (histoire 2). Toute autre façon de déplacer le curseur — reculer, aller au début, aller à la fin, sauter à un coup éloigné — arrive à sa position **sans animation aucune** : la position s'y substitue. La raison est immédiate à voir : animer un saut ferait retomber toutes les pièces à chaque déplacement du curseur, et déplacer le curseur est justement ce qu'on fait sans cesse. Un tour passé se franchit comme un coup : il avance le curseur et n'anime rien, puisque rien n'est posé.

**Hors du dernier coup, le plateau est en lecture seule.** Aucune pièce ne se sélectionne, aucune pose n'est possible, aucun conseil n'est rendu, et la barre **le dit en toutes lettres** plutôt que de laisser le joueur découvrir que rien ne répond. Revenu au dernier coup, tout se comporte exactement comme aujourd'hui : la réserve du joueur au trait redevient interactive, et la partie peut se poursuivre.

**Ce n'est pas une annulation de coup.** On ne repart jamais d'une position intermédiaire pour jouer autre chose : reculer puis poser est impossible, et c'est délibéré. La barre donne à **lire** une partie, elle n'ouvre aucune bifurcation. Le principe de l'histoire 2 reste entier — une pièce posée ne se reprend pas —, et la section « Hors périmètre », qui exclut l'annulation, n'est pas amendée par cette histoire.

**Continuer une partie lue.** Au dernier coup, poser ajoute un coup à la partie affichée : le curseur reste à la fin et le total augmente d'une unité — « coup 24 sur 24 ». C'est la seule façon dont le total change.

**Mise en page.** La contrainte de l'histoire 7 vaut ici sans atténuation : **le bord haut du plateau ne bouge jamais**. La barre est donc placée au-dessus de la bande réservée à la pièce en main, et sa hauteur est acquise **dès le chargement**. **Choix de cette version** — elle ne se montre ni ne se cache en cours de partie : ou bien la partie vient d'une notation et la barre est là du premier au dernier instant, ou bien elle n'en vient pas et la barre n'existe pas. Une barre qui apparaîtrait au premier recul redimensionnerait le plateau sous le doigt, ce que l'histoire 7 interdit.

**Clavier.** Le jeu se pilote intégralement au clavier (histoire 2) et la barre ne fait pas exception : ses cinq fonctions — début, précédent, suivant, fin, et la lecture du rang courant — sont atteignables sans pointeur. **Choix de cette version** — les flèches gauche et droite pilotent le curseur, alors qu'elles visent une colonne dans l'histoire 2. Il n'y a pas de conflit : hors du dernier coup aucune visée n'est possible, les flèches y déplacent donc toujours le curseur ; au dernier coup elles visent comme avant, et le curseur se déplace alors depuis la barre elle-même quand elle a le focus.

**Critères d'acceptation**

- Un lien de notation ouvre la partie sur sa **dernière** position, curseur au dernier coup, sans qu'aucune pièce ne tombe au chargement.
- La barre de lecture n'est affichée que si la partie affichée vient d'une notation : une partie lancée depuis l'écran de départ, ou une position ouverte au format grille (histoire 1), n'en montre aucune.
- La barre indique à tout instant le rang du curseur et le nombre total de coups, et le libellé du coup courant est écrit dans la notation du document.
- Aller au début affiche un plateau vide, deux réserves complètes, et un rang de 0.
- Avancer d'un coup fait descendre **la seule pièce de ce coup**, depuis le bord haut du plateau ; aucune pièce déjà posée ne bouge.
- Reculer d'un coup, aller au début, aller à la fin et sauter à un coup éloigné n'animent rien : la position s'affiche directement.
- Franchir un tour passé avance le curseur d'un rang sans rien animer.
- Tant que le curseur n'est pas sur le dernier coup, aucune pièce n'est sélectionnable et aucune pose n'aboutit ; la barre annonce en toutes lettres que le plateau est en lecture seule.
- Ramené au dernier coup, le plateau redevient jouable et la partie peut se poursuivre ; le coup joué porte le total à un de plus et le curseur reste à la fin.
- Reculer puis tenter de poser ne pose rien et ne crée aucune variante : la partie lue n'est jamais tronquée.
- Les cinq fonctions de la barre sont atteignables au clavier, y compris là où aucune zone d'entrée de colonne n'est affichée.
- Déplacer le curseur, du premier au dernier coup et retour, ne change ni la position verticale du bord haut du plateau, ni celle des réserves, sur téléphone comme sur grand écran.

---

### Histoire 14 — Inscrire son IA et vérifier qu'elle répond

*Lié au support : suppose un service joignable par le réseau. Le jeu lui-même ne dépend d'aucune des histoires 14 à 16.*

**Pour qui, pourquoi** — pour un développeur qui veut écrire un programme jouant à Linkx et le confronter à d'autres. Le jeu spécifie déjà des règles complètes et un format d'échange lisible : il ne manque qu'un endroit où brancher un programme et une preuve qu'il répond.

**Ce que ça recouvre** — ce qu'est une IA du point de vue de la plateforme, ce qu'elle reçoit et ce qu'elle renvoie, l'inscription de son auteur, la vérification qu'elle fonctionne, et les fautes qui font perdre une partie.

**Une IA est un service accessible par le réseau, exposant une seule route.** La plateforme lui envoie l'état d'une partie, elle répond par un coup. Rien d'autre. Elle n'a aucune notion de partie, de score, d'adversaire ni de tour précédent : c'est la plateforme qui enchaîne les coups en interrogeant deux IA à tour de rôle, et chaque appel se suffit à lui-même. Un auteur peut donc écrire une IA sans état, et une IA qui garde un état ne doit jamais en dépendre.

**Ce qu'elle reçoit.** Trois choses : la **notation de la partie depuis son début**, au format de la section « Notation d'une partie » ; la **couleur** qu'elle tient ; et le **délai** dont elle dispose pour répondre. Rien d'autre n'est nécessaire, et c'est un résultat déjà acquis : rejouer une notation restitue le plateau, les réserves des deux joueurs, les exemplaires consommés et le joueur au trait. Selon la partie, cette notation peut être **vide** — l'IA ouvre alors sur un plateau nu — ou déjà entamée, une partie de vague pouvant partir d'une ouverture imposée (histoire 15). Une IA qui suppose toujours recevoir une notation vide à son premier appel est fautive.

**Ce qu'elle répond.** Un **seul jeton de coup** dans cette même notation, `3Ir13` ou `4Lsr27`. Ni une partie, ni une liste, ni une position. Elle ne renvoie **jamais** le jeton de passe `--` : un tour passé est entièrement déterminé par la position, il est forcé par les règles et appliqué par la plateforme, qui n'interroge tout simplement pas une IA dont le tour est passé. Un `--` reçu est traité comme une passe non forcée, donc comme un coup illégal.

**Les appels sont signés.** Chaque appel de la plateforme porte une empreinte calculée avec un **secret propre à l'IA**, remis une seule fois à son auteur lors de la déclaration. L'auteur peut ainsi vérifier qu'un appel vient bien de la plateforme, et refuser les autres. Le secret ne sert qu'à cela : il n'authentifie pas la réponse, qui n'engage que le service.

**Délai de six secondes par coup.** Au-delà, la partie est perdue. Le délai est le même pour toutes les IA et il est annoncé dans chaque appel, pour qu'une IA qui approfondit par paliers, comme le maître de l'histoire 10, sache sur quoi se régler.

**Les fautes techniques font perdre la partie, et comptent comme des défaites ordinaires.** Un **coup illégal** fait perdre, et le motif est nommé parmi les sept motifs de refus déjà spécifiés dans « Notation d'une partie » : syntaxe invalide, pièce épuisée, débordement latéral, débordement par le haut, support insuffisant, partie déjà terminée, passe non forcée. Une **absence de réponse** dans le délai, une **réponse illisible** et une **erreur du service** font perdre de la même façon, chacune sous son propre motif. **Choix de cette version** — ces défaites entrent au classement comme n'importe quelle défaite, sans catégorie à part ni annulation : une IA indisponible est une IA qui perd, faute de quoi une IA fragile serait protégée de ses propres pannes et son classement mentirait sur ce qu'elle vaut. Le motif exact et le rang du coup sont conservés et rendus à son auteur (histoire 16), car c'est de cela qu'il a besoin pour corriger.

**Inscription.** On s'inscrit **depuis le jeu lui-même**, sans quitter l'application. On donne une adresse électronique, on reçoit un lien de connexion **à usage unique**, et le clic sur ce lien vaut confirmation de l'adresse. **Aucun mot de passe n'existe nulle part** : il n'y en a ni à choisir, ni à retenir, ni à réinitialiser. Un lien **périmé ou déjà consommé** ramène sur l'écran de connexion en disant lequel des deux, et non sur l'accueil du jeu : rien n'est plus décourageant qu'un clic qui semble sans effet. Une fois connecté, on déclare son IA en donnant un nom, qui sera public, et une adresse, qui ne le sera jamais. Le formulaire de déclaration s'ouvre sur demande, par un bouton **Ajouter une IA** : l'écran s'ouvre sur les IA qu'on a déjà, pas sur celle qu'on pourrait ajouter. Ce formulaire **renvoie à la spécification du protocole** — route, état envoyé, réponse attendue, signature, délai — car c'est là qu'on en a besoin, et non seulement depuis le classement : personne ne doit avoir à deviner ce que son service doit présenter.

**L'adresse d'une IA est contrôlée.** Elle doit être en `https`, et elle ne peut désigner **aucune machine du réseau interne de la plateforme** : une adresse qui s'y résout est refusée à la déclaration comme à l'usage. Le nombre d'inscriptions est **limité par personne et par provenance**, pour qu'un même auteur ne puisse pas peupler le classement de dizaines de variantes de la même IA. Un refus est rendu en clair, en nommant ce qui ne va pas.

**Partie de qualification.** Une IA nouvellement déclarée ne rejoint pas immédiatement les vagues : elle joue d'abord une **partie complète contre l'IA de la maison**. Elle n'entre au classement qu'après l'avoir terminée **sans faute technique** — sans hors-délai, sans coup illégal, sans erreur ni réponse illisible. Perdre cette partie ne l'empêche pas d'entrer ; ne pas la terminer, si. C'est ce qui élimine sur-le-champ les adresses mortes et les protocoles mal compris, au moment exact où leur auteur regarde l'écran, plutôt qu'une semaine plus tard dans un bilan de vague. L'issue de la qualification est rendue avec son motif ; une qualification échouée peut être relancée après correction, autant de fois que nécessaire.

**Sonde.** À tout moment, l'auteur peut demander à la plateforme d'appeler son IA sur une **position d'essai**. La réponse est immédiate : soit « OK », avec le coup renvoyé et le temps de réponse, soit le **motif d'échec exact**, dans le même vocabulaire que les défaites techniques. Elle est suivie de **l'échange lui-même** — l'adresse appelée, la manière dont l'appel a été signé, le corps envoyé, le code HTTP obtenu et le corps rendu —, sans quoi un verdict ne se débogue pas : « injoignable » ne distingue pas une route absente d'une signature refusée. L'appel est signé **du vrai secret de l'IA**, comme le sera celui de l'arbitre : une sonde qui signerait autrement échouerait sur toute IA qui vérifie sa signature, c'est-à-dire sur toute IA conforme. On sonde donc une IA déjà déclarée, et l'on doit être connecté. C'est l'outil de mise au point, et il doit rester utilisable sur une IA en sommeil comme sur une IA en qualification.

**L'IA de la maison participe.** L'adversaire du jeu (histoire 10) est lui-même inscrit comme IA et joue les vagues comme les autres. Il sert de **mètre-étalon** : un auteur sait ce que vaut son programme dès qu'il le voit au-dessus ou au-dessous de lui. **Choix de cette version** — il dispose d'un budget de réflexion **plus court** que dans le jeu, la plateforme bornant à six secondes le temps de réponse d'un service, appel réseau compris. Il est donc un peu moins fort que le maître qu'on affronte dans l'application, et l'histoire 10 le dit assez : sa force dépend de son budget, avec un seuil. Cela doit être **annoncé** sur son profil plutôt que masqué, sans quoi le classement laisserait croire qu'on a battu l'adversaire du jeu alors qu'on a battu une version bridée.

**Retirer une IA** est possible à tout moment, sans délai ni justification. Elle sort des appariements dès le retrait. Ses **parties passées restent**, et les classements déjà calculés ne sont pas récrits : une victoire contre une IA retirée reste une victoire.

**Critères d'acceptation**

- Une IA expose une **seule** route ; la plateforme n'en appelle jamais d'autre et ne lui demande jamais autre chose qu'un coup.
- Chaque appel porte la notation de la partie depuis son début, la couleur tenue et le délai imparti ; ces trois éléments suffisent à reconstituer la position.
- Une IA appelée sur une notation vide et une IA appelée sur une notation déjà entamée reçoivent le même format et répondent de la même façon.
- Une réponse valide est **un seul** jeton de coup dans la notation du document ; une réponse contenant plusieurs jetons est illisible et fait perdre.
- Une réponse contenant le jeton de passe est refusée comme passe non forcée et fait perdre la partie.
- Une IA dont le tour est passé n'est pas appelée.
- Chaque appel porte une empreinte calculée avec le secret de l'IA, vérifiable par son auteur.
- Une réponse arrivant après six secondes fait perdre la partie, au même titre qu'une absence de réponse.
- Un coup illégal fait perdre la partie, et le motif rendu est l'un des sept motifs de « Notation d'une partie ».
- Une erreur du service et une réponse illisible font chacune perdre sous leur propre motif.
- Une défaite technique compte au classement exactement comme une défaite de jeu.
- L'inscription se fait depuis le jeu, par adresse électronique et lien à usage unique ; aucun mot de passe n'est demandé ni stocké, à aucune étape.
- Un lien de connexion expiré ou déjà utilisé ramène sur l'écran de connexion, avec le motif et de quoi en redemander un ; il ne ramène jamais au jeu sans explication.
- Le formulaire de déclaration d'une IA n'apparaît qu'après un appui sur « Ajouter une IA ».
- Un administrateur peut ouvrir une vague à tout moment ; elle porte la date de son ouverture et se classe comme celle du jeudi.
- Il n'existe jamais deux vagues vivantes à la fois, et une vague ouverte se joue quel que soit le jour.
- Le formulaire de déclaration renvoie à la spécification du protocole, accessible sans compte.
- Une adresse d'IA qui n'est pas en `https`, ou qui désigne une machine du réseau interne de la plateforme, est refusée avec un motif en clair.
- Le nombre d'IA déclarables est limité par personne et par provenance, et le dépassement est refusé en le disant.
- Une IA nouvellement déclarée n'entre au classement qu'après avoir terminé une partie complète contre l'IA de la maison sans faute technique ; perdre cette partie ne l'en empêche pas.
- Une qualification échouée est rendue avec son motif et peut être relancée après correction.
- La sonde rend soit « OK » avec le coup et le temps de réponse, soit le motif d'échec exact, dans le même vocabulaire que les défaites techniques.
- La sonde montre en outre l'échange : adresse appelée, mode de signature, corps envoyé, code HTTP et corps reçu.
- La sonde signe du vrai secret de l'IA et n'est ouverte qu'à son auteur connecté.
- Le secret d'une IA n'est affiché **qu'une seule fois**, à sa déclaration, et n'est jamais réaffiché ensuite.
- L'IA de la maison figure au classement, et son budget de réflexion réduit est annoncé sur son profil.
- Retirer une IA la sort des appariements immédiatement et laisse ses parties passées consultables.

---

### Histoire 15 — Faire jouer les IA chaque semaine et les classer

*Lié au support : suppose la plateforme de l'histoire 14.*

**Pour qui, pourquoi** — pour que les IA inscrites se mesurent réellement les unes aux autres, à intervalle connu, et qu'un auteur puisse voir progresser son programme d'une semaine à l'autre.

**Ce que ça recouvre** — le calendrier des rencontres, le tirage des ouvertures, le calcul du classement, la mise en sommeil des IA muettes et le compte rendu envoyé aux auteurs.

**Une vague par semaine.** Les rencontres se jouent le **jeudi, de 0 h à 12 h**, heure de Paris. Toutes les IA actives y participent, sans inscription à faire : être active suffit. Une IA déclarée en cours de semaine et qualifiée avant le jeudi joue la vague suivante.

**Toutes contre toutes.** Chaque paire d'IA se rencontre plusieurs fois dans la vague, et **autant de fois dans chaque couleur** : le trait et la couleur ne doivent jamais être un avantage de tirage. Un nombre impair de rencontres par paire est donc impossible.

**Pourquoi les ouvertures sont en partie imposées.** C'est le point le moins évident du dispositif, et il tient à une propriété des programmes : deux IA **déterministes** qui se rencontrent deux fois dans les mêmes couleurs, à plateau vide, rejouent **exactement la même partie**, coup pour coup. Compter deux fois ce résultat ne mesure rien de plus et gonfle artificiellement l'écart de classement — c'est un seul événement compté deux fois. La réponse évidente, imposer l'ouverture de toutes les parties, est mauvaise pour une autre raison : le **choix de l'ouverture est une compétence**, et pas une compétence marginale. L'adversaire du jeu embarque justement un livre d'ouverture (histoire 10), calculé pour cela ; tout imposer retirerait du concours ce que ce livre sait faire.

D'où **deux étages** dans chaque rencontre. Chaque paire joue d'abord **deux parties à plateau vide**, une dans chaque couleur : là, l'ouverture est jugée, et le déterminisme n'est pas un problème puisque les deux parties diffèrent par les couleurs. Puis elle joue plusieurs paires de parties **à ouverture imposée**, tirées d'un jeu de **débuts canoniques** — des positions courtes, légales et équilibrées, communes à toute la vague — chacune jouée **deux fois, couleurs échangées**. Le tirage est **reproductible** : il ne dépend que de l'identité de la vague et de celle de la paire, si bien que reconstruire une vague redonne exactement les mêmes ouvertures.

**Le nombre d'ouvertures imposées s'adapte au nombre d'IA.** L'objectif est qu'une IA joue de l'ordre d'une **centaine de parties par vague** quel que soit le nombre d'inscrits : assez pour que son classement veuille dire quelque chose, pas au point de faire de la participation une charge. Avec `n` IA actives, chaque IA rencontre `n − 1` adversaires et joue `2 + 2k` parties contre chacun, où `k` est le nombre d'ouvertures imposées par paire. **Choix de cette version** — `k` est le plus grand entier tel que `(n − 1) × (2 + 2k)` ne dépasse pas cent, et vaut **zéro** dès que l'aller-retour à plateau vide suffit à atteindre ce total. Il est en outre borné par le nombre de débuts canoniques disponibles : une paire ne joue jamais deux fois la même ouverture imposée, et à deux ou trois IA la formule seule en réclamerait plus qu'il n'en existe. Avec beaucoup d'IA, il ne reste donc que les deux parties à plateau vide, et c'est le bon comportement : le nombre d'adversaires fournit alors seul la matière du classement.

**Aucune IA n'est jamais laissée sans adversaire.** Le tournoi étant toutes contre toutes, la parité du nombre d'inscrits n'entre pas en jeu : il n'y a pas de tour à apparier, donc jamais d'IA exemptée. Une IA qui attend son créneau le retrouve dès qu'un autre se libère ; aucune paire n'est sautée. Le seul cas où une IA ne joue pas est celui où elle est **seule active**, et la vague est alors vide de rencontres, le classement restant inchangé.

**Classement Elo.** Chaque IA part à **1200**. Une victoire vaut un point, un **nul une demi-victoire**, une défaite — technique comprise (histoire 14) — zéro. **Choix de cette version** — le coefficient est **plus élevé sur les dix premières parties classées** d'une IA, 40 contre 20 ensuite, pour qu'une nouvelle IA rejoigne vite son niveau réel au lieu de traîner un 1200 imméritée pendant des semaines. Le classement est **recalculé en fin de vague**, et **la vague entière se juge d'un seul coup**, par **point fixe** : on cherche les classements tels que l'écart de chacun soit exactement celui que ses résultats justifient une fois ces classements admis. L'espérance se relit donc sur les classements obtenus, et non sur ceux du départ. **Choix de cette version** — mettre à jour le classement après chaque partie le rendait dépendant de l'**ordre** des rencontres, et lourdement : une vague fait s'affronter deux IA des dizaines de fois de suite, si bien que leurs classements s'écartaient de plusieurs centaines de points *à l'intérieur d'une même vague*. Une IA ayant gagné tôt voyait ensuite chaque défaite lui coûter près de quarante points contre un adversaire artificiellement effondré, au point que **dix-neuf victoires sur trente-quatre pouvaient rendre un écart négatif** — mesuré, non supposé. Juger la ronde d'un bloc rend le résultat **indépendant de l'ordre** et **reproductible** : rejouer le calcul sur les mêmes parties redonne exactement les mêmes classements, au point près. **Le point fixe n'est pas un raffinement, il remplace le frein que l'Elo perd en bloc.** Jugée sur les seuls classements de départ, une vague déplaçait proportionnellement au **nombre** de parties : à quinze IA et quatre-vingt-quatre parties chacune, trois victoires valaient −1560 points et envoyaient l'IA sous le zéro que la base interdit — une vague de production s'y est arrêtée, sa clôture échouant en boucle. À l'équilibre, la même vague rend le même **ordre** sans l'emballement : 855 au lieu de −360, 1389 au lieu de 2240. Le coefficient devient ainsi le plafond de ce qu'une vague peut déplacer, jamais le montant : une victoire seule entre pairs vaut dix-huit points à K = 40, non vingt, l'espérance se relisant sur un classement déjà passé devant. Battre plus fort que soi rapporte toujours davantage.

**Deux appels simultanés au maximum par IA.** La plateforme n'appelle jamais une même IA plus de deux fois à la fois, quel que soit le nombre de parties en cours dans la vague. C'est une décision de conception, pas une limite technique : personne ne doit avoir à écrire un service capable de traiter plusieurs parties en parallèle pour participer. Une IA qui traite ses appels un par un joue la vague entière sans jamais dépasser son délai.

**Mise en sommeil.** Une IA qui échoue **techniquement sur la totalité de ses parties pendant trois vagues consécutives** sort des appariements : son classement est **gelé** à sa dernière valeur, et son auteur est prévenu par courriel. Trois vagues, et non une, parce qu'une indisponibilité d'une nuit ne doit pas coûter sa place à un programme correct. La totalité des parties, et non une majorité, parce qu'une IA qui répond parfois est une IA vivante. Son auteur peut la **réactiver** à tout moment ; elle repasse alors par la qualification de l'histoire 14 et reprend avec le classement qui avait été gelé.

**Courriel hebdomadaire.** À la fin de chaque vague, chaque auteur reçoit le nouveau classement et le **bilan de ses IA** : classement, écart avec la vague précédente, parties gagnées, perdues et nulles, et le nombre de défaites techniques avec leur motif dominant. C'est le seul envoi périodique, et il ne part qu'aux auteurs ayant au moins une IA.

**Une partie encore en cours à midi** est **close en nul technique** et compte comme un nul pour les deux IA. La vague ne déborde jamais de sa fenêtre.

**Critères d'acceptation**

- Les vagues se jouent le jeudi de 0 h à 12 h, heure de Paris, et toutes les IA actives y participent sans démarche.
- Chaque paire d'IA se rencontre autant de fois dans chaque couleur ; aucune paire ne joue un nombre impair de parties.
- Chaque paire joue exactement deux parties à plateau vide, une dans chaque couleur.
- Les parties à ouverture imposée sont jouées deux fois chacune, couleurs échangées, depuis une ouverture tirée d'un jeu de débuts canoniques.
- Le tirage des ouvertures est reproductible : reconstruire la même vague pour la même paire redonne les mêmes ouvertures.
- Le nombre d'ouvertures imposées s'ajuste au nombre d'IA actives, de sorte qu'aucune IA ne joue plus de cent parties dans une vague ; avec beaucoup d'IA, il ne reste que les deux parties à plateau vide.
- Aucune IA active n'est laissée sans adversaire, que leur nombre soit pair ou impair ; une IA seule active donne une vague sans rencontre et un classement inchangé.
- À aucun instant la plateforme n'a plus de deux appels en cours vers une même IA.
- Une IA nouvellement classée part de 1200 ; un nul vaut une demi-victoire pour chacun.
- Le coefficient appliqué aux dix premières parties classées d'une IA est plus élevé que celui appliqué aux suivantes.
- Le classement est recalculé en fin de vague sur les parties prises dans l'ordre chronologique, et deux calculs sur les mêmes parties donnent exactement le même résultat.
- Une IA qui échoue techniquement sur toutes ses parties de trois vagues consécutives est mise en sommeil, son classement gelé, son auteur prévenu par courriel ; deux vagues n'y suffisent pas.
- Une IA en sommeil peut être réactivée par son auteur, repasse par la qualification et reprend au classement gelé.
- Chaque auteur d'au moins une IA reçoit, en fin de vague, le classement et le bilan de ses IA.
- Une partie encore en cours à midi est close en nul technique et comptée comme un nul pour les deux IA.

---

### Histoire 16 — Consulter le classement et ses parties

*Lié au support : suppose la plateforme des histoires 14 et 15.*

**Pour qui, pourquoi** — pour deux publics distincts. Le curieux, qui veut savoir quelle IA est la meilleure et n'a aucune raison de créer un compte pour cela. Et l'auteur d'une IA, qui vient chercher **pourquoi il a perdu** : c'est le seul endroit où il peut le savoir.

**Ce que ça recouvre** — quatre écrans : la découverte depuis le jeu, le classement public, la connexion, puis « Mes IA » et « Mes parties » une fois connecté.

**Découverte.** L'écran de départ du jeu (histoires 2 et 10) propose une **troisième entrée** à côté de « À deux joueurs » et « Contre l'ordinateur » : le tournoi des IA. Elle est **aussi visible que les deux autres** — même traitement, même place dans la liste, pas un lien discret en pied de carte. Un développeur qui ouvre le jeu doit voir qu'il peut y brancher un programme, sans le savoir d'avance.

**Classement, public, sans compte.** Il s'ouvre sans être connecté et ne demande jamais de l'être. En tête, un **compte à rebours** vers la prochaine vague, écrit en clair : « dans 3 j 04 h 12 min — jeudi à 0 h ». Pendant la vague, il cède la place à l'**avancement** — la part des parties jouées — et à l'heure de fin. Puis le tableau, une ligne par IA : **rang**, **nom de l'IA**, **Elo**, **écart depuis la vague précédente avec son signe écrit** (`+18`, `−7`, `=`), **nombre de parties classées**, et l'**état de l'IA en toutes lettres** lorsqu'elle n'est pas simplement active — « en sommeil », « en qualification ». **Aucune adresse électronique ni adresse d'IA n'y figure jamais**, ni sur cet écran ni sur aucun autre écran public : le nom de l'IA est la seule chose que son auteur rend public. **Sur un téléphone, ce tableau se resserre** : une IA tient sur une ligne — rang, nom, Elo —, l'écart et le nombre de parties classées s'effaçant, et son état ne prenant une seconde ligne que lorsqu'elle en a un. Six lignes intitulées par IA, comme le repli ordinaire les produit, faisaient défiler un classement de quinze IA sur plusieurs écrans pour lire ce que trois colonnes disent. L'écran perd aussi son cadre : il vient de l'accueil du jeu, une vitrine posée sur une photo, quand ces pages-là se lisent — sa bordure et ses marges ne rognaient que la largeur utile.

**Connexion.** Une adresse électronique, un envoi de lien, une confirmation à l'écran disant que le courriel est parti. Rien d'autre : **aucun mot de passe** n'est demandé, ni à la première connexion ni aux suivantes, conformément à l'histoire 14. Une adresse inconnue et une adresse déjà inscrite se comportent de la même façon à l'écran.

**Mes IA.** La liste de ses IA, chacune avec son **état en toutes lettres** et son **bilan de la dernière vague** : classement, écart, parties gagnées, perdues, nulles, et défaites techniques. Quatre actions par IA : la **tester** — c'est la sonde de l'histoire 14, dont le résultat s'affiche sur place —, **voir ses parties**, la **retirer**, et la **réactiver** lorsqu'elle est en sommeil. En dessous, le formulaire de **déclaration d'une nouvelle IA** : nom, adresse. Ses refus — adresse non `https`, machine interne, limite d'inscriptions atteinte, nom déjà pris — s'affichent **en clair sous le champ concerné**, jamais dans un message général qui laisserait chercher lequel des deux champs est en cause. À la déclaration, le **secret** est affiché **une seule fois**, accompagné d'un avertissement disant qu'il ne sera **jamais réaffiché** et qu'il faut le conserver maintenant.

**Une vague commence quand elle est ouverte.** Le jeudi reste le rendez-vous : le réveil automatique ouvre la vague ce jour-là, et une seule par fenêtre. Mais un administrateur peut en **ouvrir une à tout moment**, sans attendre le jeudi — elle porte alors la date de son ouverture, dure autant qu'une autre et se classe comme elle. Il n'y a **jamais deux vagues vivantes à la fois**, et c'est la base qui le garantit : deux ouvertures concurrentes s'y départagent. Une fois une vague ouverte, le calendrier ne la retient plus — l'arbitrage la fait avancer quel que soit le jour, puisqu'elle n'existe que parce qu'on a voulu la jouer.

**Admin.** Les commandes réservées aux administrateurs ont leur **écran à part**, et leur entrée de navigation, plutôt que d'alourdir « Mes IA » d'un bloc que presque personne ne voit. Chaque action y dit **ce qu'elle fait** avant de dire comment on la lance : les noms de code du serveur ne parlent qu'à qui l'a lu. L'entrée n'existe que pour un administrateur, et l'adresse tapée à la main renvoie au classement sans apprendre qu'un écran se trouve là.

**Mes parties.** Filtrables par **IA**, par **vague** et par **issue**. Chaque ligne donne la **date**, l'**ouverture** — « plateau vide », ou le libellé du début canonique imposé —, la **couleur tenue**, l'**adversaire**, l'**issue en toutes lettres** et le **nombre de coups**. L'issue est une phrase, pas un symbole : « gagné par connexion », « perdu — hors délai au coup 14 », « nul par blocage », « perdu — coup illégal au coup 9, support insuffisant ». Chaque partie s'ouvre dans l'**écran de jeu**, avec la barre de lecture de l'histoire 13 : on la déroule coup par coup comme n'importe quelle partie reçue par lien. Et elle déplie un **journal** donnant, **coup par coup**, le temps de réponse de chaque IA et l'erreur éventuelle. C'est ce que l'auteur d'un bot vient chercher après une défaite, et rien d'autre ne le lui dira : un hors-délai au coup 14 se comprend en voyant les treize temps de réponse qui l'ont précédé. Un bouton **Exporter** rend en JSON les parties **que les filtres montrent**, et rien d'autre : l'auteur choisit son périmètre avec les commandes qu'il vient d'employer, plutôt qu'une découpe figée décidée pour lui. Chaque partie y porte sa **notation complète** et le **camp tenu** par son IA — sans lequel une notation ne dit pas qui a gagné pour elle —, de quoi la rejouer et réentraîner un programme hors de la plateforme.

**Confidentialité.** Le classement est **public** ; une partie n'est visible que de ses **deux** participants. **Choix de cette version** — on aurait pu rendre toutes les parties publiques, ce qui aurait permis à chacun d'étudier une IA adverse pour la contrer, et aurait fait du tournoi un objet d'étude ouvert. Le choix inverse a été fait : une IA se juge sur son classement, et son auteur reste seul maître de ce qu'il publie de son programme. L'IA de la maison ne fait pas exception, et une partie qui l'oppose à une IA inscrite reste visible de l'auteur de celle-ci.

**Exigences transverses.** Elles valent ici comme partout ailleurs dans ce document. **Trois niveaux de texte** au plus : un titre, un intertitre, un corps ; les tableaux ne créent pas un quatrième niveau. **Aucun débordement horizontal sur téléphone**, en portrait comme en paysage — un tableau de classement se replie plutôt que de faire défiler la page. Et **un état n'est jamais porté par la seule couleur** : chaque pastille d'état porte **son mot**, « active », « en sommeil », « en qualification », et chaque issue de partie est écrite.

**Critères d'acceptation**

- L'écran de départ du jeu propose une troisième entrée vers le tournoi des IA, présentée au même niveau que « À deux joueurs » et « Contre l'ordinateur ».
- Le classement s'ouvre sans compte et sans invitation à en créer un.
- Hors vague, un compte à rebours vers la prochaine vague est affiché avec ses jours, heures et minutes, et le jour et l'heure de départ en clair.
- Pendant une vague, le compte à rebours cède la place à l'avancement des parties et à l'heure de fin.
- Chaque ligne du classement donne le rang, le nom de l'IA, son Elo, l'écart depuis la vague précédente avec son signe écrit, et le nombre de parties classées.
- Le classement d'une vague ne dépend pas de l'ordre de ses parties, et une IA qui gagne la majorité des siennes n'y perd jamais de points.
- L'état d'une IA qui n'est pas simplement active est écrit en toutes lettres sur sa ligne.
- Aucune adresse électronique ni adresse d'IA n'apparaît sur un écran public, en aucune circonstance.
- La connexion ne demande qu'une adresse électronique et n'expose aucun champ de mot de passe.
- « Mes IA » liste ses IA avec leur état en toutes lettres et le bilan de la dernière vague, et propose tester, voir ses parties, retirer, et réactiver une IA en sommeil.
- Un refus de déclaration s'affiche sous le champ en cause, et non dans un message général.
- Le secret d'une IA est affiché une seule fois, avec un avertissement disant qu'il ne sera jamais réaffiché.
- « Mes parties » se filtre par IA, par vague et par issue, et chaque ligne donne la date, l'ouverture, la couleur tenue, l'adversaire, l'issue en toutes lettres et le nombre de coups.
- Une partie s'ouvre dans l'écran de jeu avec la barre de lecture de l'histoire 13, et se déroule coup par coup.
- Le journal d'une partie donne, pour chaque coup, le temps de réponse et l'erreur éventuelle.
- Une partie n'est consultable que par ses deux participants ; toute autre demande est refusée, connecté ou non.
- Sur un écran de téléphone, aucun des quatre écrans ne produit de débordement horizontal, en portrait comme en paysage.
- Aucun état ni aucune issue n'est distingué par la seule couleur : chaque pastille porte son mot.

---

## Hors périmètre

**Ce qui reste hors périmètre.** Ne pas ajouter sans demande explicite : le **jeu en réseau entre deux humains**, les **effets sonores**, l'**annulation d'un coup**, le **chronomètre en partie humaine**, et la **sauvegarde d'une partie humaine en cours**.

**Ce qui entre au périmètre, et à quelles conditions.** Les histoires 14 à 16 introduisent des **comptes**, une **persistance** et un **service distant**. Ces trois choses existent **pour la plateforme de tournoi seulement**. Le jeu, lui, reste jouable **intégralement hors ligne, sans compte et sans aucun appel réseau**, adversaire ordinateur compris : l'histoire 12 n'est pas amendée, et **aucune fonction du jeu ne doit dépendre de la plateforme**. Lancer une partie, jouer contre l'ordinateur au niveau maître, demander conseil, ouvrir un lien de position, dérouler une partie coup par coup : tout cela fonctionne sans réseau et sans être connecté. La plateforme est une destination de plus depuis l'écran de départ, jamais un passage obligé.

**L'annulation d'un coup n'est pas prévue** : le jeu physique ne permet pas de reprendre une pièce posée. L'histoire 13 ne l'introduit pas — sa barre de lecture donne à **voir** une partie passée, elle ne permet pas d'en reprendre le cours autrement. On peut revenir sur un coup, on ne peut pas en rejouer un autre à sa place. Le besoin de conserver ou de retrouver une position antérieure est couvert par la notation de partie (histoire 6).
