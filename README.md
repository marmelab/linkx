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
| `npx supabase start` | pile Supabase locale, dans Docker |
| `npx supabase functions serve <nom> --no-verify-jwt` | sert une fonction edge en local |
| `node node_modules/vite-node/dist/cli.mjs scripts/duel-maitre.ts` | duel du maître contre son propre passé, hors de Vitest |
| `node node_modules/vite-node/dist/cli.mjs scripts/generate-opening-book.ts --depth 9 --jobs 8` | régénère le livre d'ouverture du maître (hors ligne, ~8 h 30 à huit lots) |
| `node node_modules/vite-node/dist/cli.mjs scripts/audit-livre.ts` | compare chaque coup du livre à la recherche en direct |
| `node node_modules/vite-node/dist/cli.mjs scripts/audit-recolte.ts a.ts b.ts` | juge les entrées qu'un livre ajoute à un autre, y compris hors du premier coup |
| `node node_modules/vite-node/dist/cli.mjs scripts/duel-livre.ts` | duel apparié avec et sans livre, à ouverture imposée |
| `node node_modules/vite-node/dist/cli.mjs scripts/bench-moteur.ts` | coût de chaque palier de recherche, profondeur jouée, budget perdu |
| `node node_modules/vite-node/dist/cli.mjs scripts/duel-appariee.ts --a X --b Y` | duel apparié entre deux réglages du moteur, 48 parties |
| `node node_modules/vite-node/dist/cli.mjs scripts/pecher-bevues.ts` | fabrique des positions de test là où le moteur se trompe |
| `node node_modules/vite-node/dist/cli.mjs scripts/empreinte-evaluation.ts` | empreinte et coût de l'évaluation, pour prouver qu'une réécriture ne change aucune valeur |
| `node node_modules/vite-node/dist/cli.mjs scripts/choisir-ouvertures.ts` | mesure l'équilibre des 50 ouvertures et propose les débuts imposés aux vagues |

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
- `scripts/*.ts` sont vérifiés au build via `tsconfig.scripts.json` (résolution bundler, types Node), et se lancent avec `vite-node` ; les `.mjs` restent du JS pur.
- Aucune dépendance d'état ou de rendu graphique. Le jeu tient dans un reducer React et des fonctions TypeScript pures ; ne pas en ajouter sans nécessité démontrée.
- **Deux dépendances, et deux seulement, servent la plateforme de tournoi** : `react-router` (v7, `createHashRouter`) et `@supabase/supabase-js`. Elles ne sont **jamais** chargées par le jeu — `src/Root.tsx` les tient derrière un `React.lazy`, si bien qu'elles vivent dans un morceau à part et n'entrent pas dans le bundle d'entrée. Le routage est en **mode hash** parce que GitHub Pages sert des fichiers statiques : `/linkx/classement` rendrait une 404 au rechargement. La query string reste au jeu, dont `?moves=` ouvre une partie.
- **Les imports relatifs de `src/game/` portent leur extension `.ts`**. Ce n'est pas une coquetterie : Deno l'exige, et c'est ce qui permet aux fonctions edge d'importer les règles sans copie (voir « Plateforme de tournoi »). `tsconfig.app.json` l'autorise déjà par `allowImportingTsExtensions`. Ne pas la retirer, et ne pas l'étendre au reste de `src/`, qui n'est **jamais** chargé par Deno — seuls font exception les deux imports qui vont de `src/tournament/` **vers** `supabase/functions/_shared/`, dont la cible, elle, est un module Deno. Le générateur du livre d'ouverture écrit lui aussi cette forme : `scripts/generate-opening-book.ts` la produit dans son en-tête.
- Le backend vit dans `supabase/`, en Deno. L'interface en ligne de commande Supabase est une dépendance de développement : `npx supabase …`, jamais un binaire global.

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
    bitboard.ts         plateau de bits : 81 cases en trois mots, voisinage, distances
    engineBoard.ts      position compacte de recherche : coups, chute, connexion
    engineSearch.ts     recherche du maître : itératif, PVS, fin de partie exacte
    openingBook.ts      livre d'ouverture du maître : clé canonique et lecture
    openingBook.data.ts livre généré hors ligne à profondeur 9, 472 entrées
    referenceGame.ts    partie de référence figée, partagée par les tests et le banc
    hint.ts             chooseHint et canOfferHint, conseil au joueur au trait
    reducer.ts          état initial et transitions du jeu
    boardText.ts        parseur/sérialiseur du format B/W/.
    moveNotation.ts     grammaire, parse et sérialisation d'une notation de partie
                        `parseGameTimeline` rend toutes les positions traversées
    queryState.ts       état **et provenance** depuis la query string (`LoadedGame`)
  components/           affichage React — voir src/components/CLAUDE.md
    Board.tsx           grille, ghost, surlignage du chemin gagnant et du conseil
    DropZone.tsx        entrées de colonnes : geste maintenu au doigt, clavier
    dropAim.ts          colonne visée par une abscisse d'écran sur la bande
    PieceShape.tsx      rendu SVG d'une orientation
    PlexiDefs.tsx       `<defs>` partagés : biseau, reflet et ombre des pièces
    PieceTray.tsx       réserve d'un joueur
    GameStatus.tsx      bandeau de tour et aperçu de la sélection
    SelectedPiecePreview.tsx  pièce en main, tournée et retournée par mouvement
    pieceTurn.ts        mouvement déduit de la différence entre deux sélections
    SetupPanel, RulesPanel, GameOverPanel, Fireworks : écrans et panneaux
    SharePositionButton.tsx  copie un lien ?moves= de la position courante
    PlaybackBar.tsx     barre de lecture d'une partie ouverte depuis une notation
    playback.ts         curseur de lecture : rangs, lecture seule, pas animé
    winningTrail.ts     reconstruction du tracé du chemin gagnant
    pieceGeometry.ts    getCellsOutlinePath, contour de l'union des cases
    usePointerHasHover.ts  détection du survol réel du pointeur
    useStoredDifficulty.ts  niveau de l'ordinateur retenu d'une partie à l'autre
    useAiMove.ts        recherche du coup de l'ordinateur, worker et repli synchrone
  tournament/           écrans de la plateforme de tournoi, chargés paresseusement
    config.ts           lecture des variables de build ; sans elles, pas de tournoi
    routes.ts           chemins du fragment, retour et refus du lien magique, module pur
    protocol.ts         adresse de la spécification d'une IA, tenue hors du bundle du jeu
    schedule.ts         prochaine vague du jeudi 0 h, heure de Paris, et rebours
    outcomes.ts         vocabulaire de la base traduit en français, à un seul endroit
    ranking.ts          ordre du classement et écart signé
    games.ts            parties vues du côté de l'auteur, et filtres
    gamesExport.ts      export JSON des parties affichées, module pur
    botSummary.ts       bilan de la dernière vague d'une IA
    types.ts            lignes lues de la base
    api.ts              client Supabase, lectures et fonctions edge
    session.ts          session de l'auteur, un seul abonnement
    useAsync.ts, AsyncPanel.tsx  chargement, panne et reprise
    TournamentApp.tsx   routeur de fragment, cible du React.lazy
    TournamentLayout.tsx  mise en page, navigation, et droit d'administration partagé
    LeaderboardScreen, LoginScreen, MyBotsScreen, MyGamesScreen, AdminScreen
  aiWorker.ts           tour de l'ordinateur hors du fil principal
  App.tsx               câblage du reducer, tour de l'ordinateur, raccourcis clavier
  Root.tsx              aiguillage jeu / tournoi sur le fragment, avant tout routeur
  App.css, index.css    toute la mise en page
  main.tsx              montage React et enregistrement du service worker
public/                 copié tel quel : manifeste, service worker, icônes
scripts/generate-icons.mjs · scripts/generate-opening-book.ts · scripts/duel-maitre.ts · scripts/audit-livre.ts · scripts/duel-livre.ts · scripts/bench-moteur.ts · scripts/duel-appariee.ts · scripts/pecher-bevues.ts · scripts/empreinte-evaluation.ts · fixtures/urls.md : outils de mesure et positions de test

supabase/               backend de la plateforme de tournoi, en Deno
  config.toml           configuration du projet local
  functions/
    deno.globals.d.ts   le fragment de l'API Deno que `tsc` doit connaître
    _shared/            logique partagée, testée par le Vitest du dépôt
      referee.ts        arbitrage d'une partie entre deux IA, sans aucun appel
      elo.ts            classement Elo et écart type des joueurs
      schedule.ts       vagues, appariements et avancement d'un tournoi
      openings.ts       ouvertures imposées, tirées de la partie de référence
      tournamentPaths.ts  chemins des écrans : source unique du routeur et du courriel
      safeUrl.ts        contrôle pur d'une adresse d'IA, résolveur DNS injecté
      denoDns.ts        résolveur DNS de Deno, et contrôle d'adresse complet
      botClient.ts      appel signé d'une IA distante, avec délai et sans redirection
      rest.ts           accès PostgREST des fonctions d'ordonnancement, `fetch` injecté
      waveWindow.ts     fenêtre d'une vague : jeudi 0 h – 12 h à Paris, sans décalage en dur
      wavePlan.ts       ouverture, qualification, clôture et mise en sommeil d'une vague
      gameTick.ts       coup suivant d'une partie, et écriture idempotente de son issue
      tickBudget.ts     budget d'un tour d'arbitrage, et les trois délais de la file
      waveMail.ts       composition du bilan hebdomadaire, sans réseau
      waveMailDelivery.ts  ordre des envois, réservation et non-doublon
      platformAuth.ts   qui appelle le cron : clé de service, ou administrateur
      botStatus.ts      transitions de statut ouvertes à un auteur, et leur écriture
    register-bot/       déclaration d'une IA par son auteur, secret rendu une fois
    update-bot/         retrait et réactivation d'une IA, seules transitions ouvertes
    probe-bot/          sonde authentifiée : appelle une IA de l'appelant, signée de son secret
    bot-linkx/          l'IA de la maison, le moteur du jeu exposé comme bot
    wave-mail/          transport du bilan de fin de vague, par Resend
    scheduler/          ouvre la vague, qualifie tous les jours, remet en file, clôt à midi
    referee-tick/       dépile la file et joue un coup par partie, sous budget d'horloge
  migrations/           schéma, vues publiques, file pgmq, jetons d'appel, cron des vagues
  tests/                pgTAP : ce qui ne se prouve qu'en base — droits, file, jetons
```

Les tests vivent à côté de leur module, en `*.test.ts` / `*.test.tsx`.

## Architecture

- Toute la logique de règles reste dans `src/game/`, tout l'affichage dans `src/components/`. Les fonctions de domaine sont pures, déterministes et testables sans React.
- `src/game/types.ts` fait foi pour le modèle de domaine ; ne pas dupliquer ces définitions ailleurs.
- Une action de dépôt transmet seulement la colonne. Le reducer recalcule toujours l'atterrissage ; ne jamais accepter des cellules finales calculées par un composant.
- `placement.ts` pour la chute et le support, `aimedColumn` pour la conversion pointeur → ancre, `pieceGeometry.ts` pour les silhouettes, `PlexiDefs.tsx` pour la matière : chacun est **source unique** de son sujet. Ne pas en recréer une variante à côté.
- `connectivity.ts` détecte les connexions sur la **couleur** des cases. Le `pieceId` identifie une pièce physique pour le rendu et l'animation, jamais pour relier les zones gagnantes.
- Le **maître** a son propre moteur, `engineBoard.ts` + `engineSearch.ts`, distinct de `minimax.ts` : position sur tableaux typés, coups empaquetés dans un entier, make/unmake, Zobrist et table de transposition à taille fixe. `bitboard.ts` est la source **unique** du plateau de bits que ces deux modules partagent — zones connexes d'un côté, distances de connexion de l'autre ; aucun des deux ne réécrit de décalage. `src/game/` reste la **source de vérité des règles** ; ce moteur n'en redéfinit aucune et son équivalence est prouvée par test différentiel (`engineBoard.test.ts`) contre `enumerateLegalMoves` et `simulateLegalMove`. Il exploite deux conséquences des règles, vérifiées par ce même test : une colonne n'a jamais de trou, et la légalité se réduit à un test de planéité. Toucher aux règles doit faire échouer ce test avant tout le reste.
- `chooseMoveForDifficulty` reste l'**unique** entrée : elle détourne le maître vers `engineSearch.ts` et laisse les autres niveaux au barème de `minimax.ts`. L'interface transmet un niveau, jamais une profondeur ni un budget.
- **Aucune modification de la recherche ou de l'évaluation ne se garde sans mesure.** `bench-moteur.ts` dit ce que coûte chaque palier et ce que le budget gaspille ; `duel-appariee.ts` oppose deux réglages sur 48 parties appariées et rend un test des signes ; `pecher-bevues.ts` fabrique les positions de non-régression. Seule exception à la règle du duel : une réécriture qui rend **exactement** les mêmes valeurs ne peut pas changer un coup joué — `empreinte-evaluation.ts` le prouve sur 9 305 valeurs, et il suffit alors de chiffrer ce qu'elle fait gagner. Les réglages comparables sont des options de `MasterSearchOptions` — jamais un moteur modifié à la volée, qui ne se rejouerait pas.
- Le livre d'ouverture (`openingBook.ts`) ne guide que le **maître**, sur son premier coup, et retombe sur la recherche en dehors de son périmètre. `openingBook.data.ts` est **généré** par `scripts/generate-opening-book.ts` à `--depth 9 --jobs 8`, deux paliers au-delà de ce que le jeu atteint, en huit heures et demie ; ne pas l'éditer à la main. Cette profondeur suit le moteur : à chaque fois qu'il gagne un palier en direct, le livre doit en gagner un aussi, sinon il ne fait plus que répéter ce que le jeu trouve seul. Il doit être engendré par le moteur courant : un livre hérité d'une autre évaluation affaiblit la recherche. Engendré par le moteur qui le lit, **deux** paliers au-dessus de ce que le jeu atteint, il la renforce — mesuré au budget du jeu, arbitré à profondeur 8 : contre la recherche en direct, meilleur 34 fois sur 50, à égalité 16, jamais moins bon ; et comparé au livre de profondeur 7 sur les 26 ouvertures où ils diffèrent, **26 à 0** (p < 10⁻⁷). **Un seul palier d'avance ne suffit pas** : le livre de profondeur 7 était moins bon que le jeu direct sur 14 ouvertures sur 50. Les entrées **récoltées** ne sont qu'à un palier au-dessus du jeu direct, deux plis étant perdus depuis la racine : auditées une à une contre la recherche en direct au budget du jeu, elles sont meilleures 7 fois, à égalité 8, moins bonnes 3 (p = 0,34). C'est un petit positif sans significativité, gardé parce que l'alternative pour ces positions-là n'est pas un meilleur coup de livre mais **aucune entrée du tout**. Ne pas confondre avec la mesure du premier coup blanc, où un palier d'avance était nuisible : là, l'alternative était un livre à deux paliers. Et l'arbitre doit voir plus loin que les deux coups qu'il départage, sans quoi il ratifie celui qu'il aurait joué — c'est un arbitre trop court qui avait laissé croire ce livre-là inoffensif. Ses seules clés sont `white|`, l'ordinateur jouant toujours blanc : un duel qui alterne les couleurs le rend inerte une partie sur deux et ne peut donc pas le mesurer. C'est `scripts/duel-livre.ts` qui le mesure, apparié et à ouverture imposée, jamais `duel-maitre.ts`.
- L'état de survol, les délais et les animations restent dans l'UI tant qu'ils n'affectent pas les règles.
- `App.tsx` ne fait que câbler : reducer, tour de l'ordinateur, raccourcis clavier. Les invariants qu'il doit respecter sont détaillés dans les deux `CLAUDE.md` de répertoire.

## Plateforme de tournoi

Périmètre séparé du jeu. `plan.md`, histoires 14 à 16, fait foi pour le comportement ; cette section pour les contrats techniques.

- **Les règles ne sont jamais réécrites côté serveur.** Les fonctions edge importent `src/game/*.ts` par chemin relatif (`../../../src/game/moveNotation.ts`). Ce n'est pas une hypothèse : `deno check` passe sur tout le graphe en mode strict, et le bundler de `supabase functions serve` accepte les fichiers situés hors de `supabase/`. Corollaire : ne jamais copier un module de règles dans `supabase/`, et ne jamais y redéfinir une règle.
- **Arbitrer un coup, c'est `parseGameRecord(notation + ' ' + coup)`.** Un refus rend un `NotationError` typé — sept motifs, déjà spécifiés — qui se journalise tel quel. Ce chemin ne charge ni le livre d'ouverture ni `engineSearch` : huit modules, une quinzaine de kilo-octets.
- **Le bot maison est le seul consommateur serveur de `chooseMoveForDifficulty`.** Deux pièges. Sans troisième argument `random`, `budgetMs` est ignoré et la recherche bascule en plafond de nœuds (`minimax.ts`). Et `engineSearch` **n'est pas réentrant** : table de transposition, tueurs et position de recherche sont des singletons de module, remis à zéro à chaque appel ; deux recherches simultanées dans le même isolate se corrompent. Les appels s'y sérialisent.
- **Limites de l'edge runtime** : 2 s de CPU par requête — l'attente réseau n'y compte pas —, 150 s d'horloge, 256 Mio. L'arbitre y tient sans effort ; le bot maison, non. Son budget de recherche est de **700 ms, mesuré** : à 1000 ms, 26 réponses sur 60 étaient coupées. Et la limite de processeur est atteinte au **démarrage de l'isolate** — livre d'ouverture et moteur —, pas par la recherche : c'est le premier appel qui coûte, pas le calcul. Toute modification de ce budget se remesure.
- **La logique pure vit dans `supabase/functions/_shared/`** et se teste avec le Vitest du dépôt, pas avec un second lanceur. Une fonction edge ne porte que du transport : lire la requête, appeler `_shared`, répondre. Ces tests sont type-vérifiés par `tsconfig.supabase.json`, quatrième projet de `tsconfig.json` : `deno check` les exclut, parce qu'ils importent `vitest`, et sans ce projet ils étaient le seul coin du dépôt que rien ne vérifiait. `supabase/functions/deno.globals.d.ts` y déclare le fragment de l'API Deno que `_shared/` touche — le garder minimal, c'est lui qui borne ce que le code partagé s'autorise.
- **Le service worker ne voit pas l'API** : il rend la main sur toute requête qui n'est pas un GET de même origine (`public/sw.js`), et l'API est servie depuis un autre domaine. Ne pas lui ajouter d'exception, ce serait incrémenter `VERSION` et revalider le mode hors ligne pour rien. Et **il ne précharge pas le morceau du tournoi** : son second balayage nomme le seul fragment qu'il doit emporter, `aiWorker-…js`, et non tout nom haché cité par le bundle d'entrée. Un balayage large embarquerait des écrans qui ne servent qu'en ligne, alors que le jeu ne doit rien devoir à la plateforme. Ce morceau se met en cache à l'usage, comme n'importe quel asset haché.
- **Les cinq écrans vivent dans `src/tournament/`**, logique pure et rendu ensemble : la règle « domaine dans `src/game/`, affichage dans `src/components/` » borne le jeu, pas la plateforme. Ce répertoire est **un morceau à part** ; rien du jeu ne doit l'importer, sauf `Root.tsx` (par `React.lazy`) et `SetupPanel.tsx` (pour `config.ts` et `routes.ts`, deux modules sans dépendance).
- **`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` décident de tout** : sans elles, `config.ts` rend `null`, l'entrée du tournoi disparaît de l'écran d'accueil et le fragment ne charge rien. C'est le cas par défaut d'un dépôt cloné, et il doit le rester : le jeu se joue hors ligne, sans compte et sans appel réseau.
- **Deux constantes vivent dans `supabase/functions/_shared/` et sont lues depuis `src/`** : le libellé d'une ouverture imposée (`openings.ts`, lu par `src/tournament/games.ts`) et les chemins des écrans (`tournamentPaths.ts`, réexporté par `src/tournament/routes.ts` et lu par `wave-mail` pour les liens du courriel). Ce sont les seuls endroits du dépôt où `src/` lit `supabase/`, et le sens est délibéré : recopier ces valeurs en ferait une seconde vérité qui divergerait à la première ouverture ajoutée ou à la première route renommée. **L'inverse est interdit** — une fonction edge n'importe jamais `src/tournament/`, qui n'est pas écrit pour Deno : ses modules importent sans extension `.ts` et `config.ts` lit `import.meta.env`.
- **Contrat des fonctions edge appelées par les écrans** : `register-bot` reçoit `{ name, url }`, `probe-bot` reçoit `{ bot }`, `update-bot` reçoit `{ bot, status }`, et `scheduler` comme `referee-tick` reçoivent `{ force }` d'un administrateur ; toutes répondent un JSON portant `ok`, `message`, et `field` sur un refus, que le formulaire affiche **sous le champ nommé**. `update-bot` reçoit `{ bot, status?, url? }` et **est l'unique porte de tout ce qu'un auteur change sur son IA**, `statut` étant réservé au service par un déclencheur et `authenticated` n'ayant aucun droit d'écriture sur `bots` : elle vérifie l'identité auprès de `/auth/v1/user`, n'agit que sur une IA de l'appelant, et n'ouvre que trois transitions — retirer une IA vivante, réactiver une IA en sommeil, et **relancer la qualification d'une IA en attente** (`en_attente` → `en_attente`). `retiree` est terminal, et rien ne mène à `active` : cela reste le verdict de l'ordonnanceur. Le champ `url` corrige l'adresse, repassée par **le même contrôle qu'à la déclaration**. Ces deux derniers points ne sont pas du confort : `qualificationNeeded` ne rouvre une tentative que si la ligne a bougé depuis la dernière, et rien d'autre au monde ne peut la faire bouger — sans eux, une IA qui ratait sa première qualification y restait **à jamais**, son nom réservé et sa place prise sur les dix du compte. **`probe-bot` est authentifiée** (`verify_jwt = true`) et ne sonde qu'une IA de l'appelant : elle lit l'adresse et le secret en base pour signer l'appel **comme l'arbitre le fera**. Publique, elle recevait une adresse et ne connaissait aucun secret : elle signait donc avec un jeton d'essai, que toute IA conforme au protocole rejette — elle échouait sur ce qu'elle devait vérifier. C'est aussi ce qui lui permet de rendre le code HTTP et le corps reçu : l'appelant est le propriétaire de l'IA appelée, le critère déjà retenu pour `reponse_brute`. **Les écrans ne font que lire la base** : `authenticated` n'a aucun droit d'insertion ni de modification sur `bots` (migration `plateforme_tournoi_ecriture_reservee_bots`), sans quoi `/rest/v1/bots` contournerait le contrôle d'adresse, le motif du nom, le débit et le plafond de dix IA par compte que ces deux fonctions appliquent. Et le journal d'une partie se lit par la vue `journal_appels`, jamais par `evenements_partie` : `erreur` et `reponse_brute` y sont masquées hors du propriétaire de l'IA appelée, le reste restant visible des deux participants.
- **L'IA de la maison s'amorce à la main, une fois par projet, et rien ne marche avant.** Aucune migration ne la crée : `bots.proprietaire` référence `auth.users`, et `ia_maison` comme `statut` sont réservés au service par un déclencheur, donc hors de portée de `register-bot`. Tant qu'aucune ligne ne porte `ia_maison = true` **et** `statut = 'active'`, l'ordonnanceur rend « IA de la maison absente ou inactive » et **aucune IA ne peut se qualifier** : la plateforme est inerte. La marche à suivre, sur un projet neuf : ouvrir un compte pour elle par lien magique, déclarer l'IA par `register-bot` en donnant l'adresse publique de la fonction `bot-linkx`, puis, en SQL avec le rôle de service, `update public.bots set ia_maison = true, statut = 'active' where nom = '…'`. Son plafond d'appels simultanés tombe alors à un, imposé par un déclencheur et non laissé à la mémoire de l'opérateur : deux recherches arrivées de front dans le même isolate dépassent son budget de processeur et le font tuer — mesuré. Le secret rendu par `register-bot` se dépose alors dans le secret `LINKX_BOT_SECRET` de la fonction `bot-linkx`, **sans quoi elle refuse tous les appels en 401** : elle est publique et calcule, un secret oublié au déploiement offrirait la recherche à qui la demande. Seule `LINKX_BOT_ALLOW_UNSIGNED=1`, réservée au développement, rouvre le mode non signé.
- **La fenêtre du jeudi borne l'*ouverture* d'une vague, et rien d'autre.** Le cron réveille les deux fonctions **chaque minute, tous les jours** (migration 20260904120000), et ce sont elles qui se gardent. `scheduler` qualifie les IA en attente et remet en file les parties immobiles **à chaque réveil, quel que soit le jour** — c'est la première chose qu'il fait, avant même de regarder une vague, pour qu'une vague coincée ne gèle pas les qualifications ; il fait avancer et clôt une vague **déjà ouverte** n'importe quel jour ; il n'*ouvre* une vague que dans la fenêtre du jeudi, sauf `force`. `referee-tick`, lui, **ignore entièrement le calendrier** : une partie dépilée se joue, de vague ou de qualification. Sans le réveil quotidien, une IA déclarée le lundi attendait le jeudi pour entrer au classement, quand l'histoire 14 la veut qualifiée pendant que son auteur regarde l'écran ; c'est aussi ce qui a supprimé les entrées de cron « veille », qui rattrapaient à la main les deux heures de la vague tombant le mercredi UTC.
- **Le contrôle d'adresse d'une IA ne connaît aucune exception** (`_shared/safeUrl.ts`, `_shared/denoDns.ts`) : https, port 443, nom d'hôte public, résolution DNS exigée et refus des réseaux privés, à chaque appel comme à la déclaration. Il n'existe **aucune liste d'hôtes dispensés**, et aucune variable d'environnement pour en rouvrir une. Conséquence assumée : une IA servie en local n'est pas appelable par la plateforme, même locale — pour l'éprouver, il faut l'exposer sous un nom public.
- **Un administrateur déclenche les deux réveils de cron à la main** (`_shared/platformAuth.ts`). `scheduler` et `referee-tick` acceptent deux appelants : la clé de service, que présente `pg_cron`, et une session dont l'utilisateur figure dans `administrateurs`. L'identité vient de `/auth/v1/user` et de nulle part ailleurs ; l'appartenance se lit avec la clé de service, la table n'étant lisible que de ses membres ; un authentifié non administrateur est refusé **mot pour mot comme un inconnu**, la réponse n'apprenant pas que cette table existe. La réponse est le compte rendu du cron, tel quel.

  ```bash
  # JETON = access_token d'une session d'administrateur (l'écran « Mes IA » le porte déjà)
  curl -s -X POST "$SUPABASE_URL/functions/v1/scheduler" \
    -H "authorization: Bearer $JETON" -H "apikey: $SUPABASE_ANON_KEY" \
    -H 'content-type: application/json' -d '{"force":false}'
  curl -s -X POST "$SUPABASE_URL/functions/v1/referee-tick" \
    -H "authorization: Bearer $JETON" -H "apikey: $SUPABASE_ANON_KEY" \
    -H 'content-type: application/json' -d '{"force":true}'
  ```

  **`force` ouvre une vague maintenant**, et rien d'autre. Une vague porte désormais l'instant de son ouverture, non le jeudi qu'elle vise : le cron l'ouvre le jeudi à minuit, un administrateur peut l'ouvrir un mardi. Sans `force`, `scheduler` se comporte exactement comme le cron — qualifications, avancement, clôture — et n'ouvre de vague que dans la fenêtre du jeudi, une seule par fenêtre (`waveOpenedSince`). `referee-tick` ne lit pas le calendrier du tout : une vague ouverte est faite pour être jouée, et `force` ne lui sert plus à rien. Le garde-fou contre deux ouvertures concurrentes n'est plus l'unicité de `debut` — deux réveils ne partagent plus la même — mais celle de la vague **vivante** (migration `plateforme_tournoi_vague_a_la_demande`, prouvée en pgTAP). Chaque déclenchement manuel est journalisé par la fonction et nommé dans son compte rendu (`declenchement`, `force`). L'écran « Admin » porte les trois commandes — réveil, ouverture d'une vague, tour d'arbitrage — et l'état de la file.

- **Ce que les écrans publics lisent** : la vue `classement`, la table `vagues` — dont les colonnes `parties_jouees` / `parties_totales`, tenues par un déclencheur sur `parties`, donnent l'avancement d'une vague que la table des parties, privée, ne dirait jamais —, `historique_elo`, et la vue `noms_bots`, qui associe l'identifiant d'une IA à son seul nom pour que « Mes parties » nomme l'adversaire. Toute vue publique est une frontière : n'y ajouter une colonne qu'en sachant qu'elle devient publique, et le prouver en pgTAP.

## Tests et vérification

- Ajouter ou adapter des tests de domaine pour toute modification de règles, de chute, de passe ou de connexion, et toujours couvrir le cas de refus.
- Les scripts `test` relèvent `--testTimeout` à 20 s : plusieurs tests lancent une vraie recherche et dépassent, sur un runner de CI chargé, les cinq secondes du défaut — ils échouaient sur le temps, jamais sur leur résultat. Un test franchement plus long garde en plus son délai explicite, passé en troisième argument de `it`. Le délai vit dans `package.json` et non dans `vite.config.ts` : Vitest 3 embarque sa propre copie de Vite, dont les types ne se mêlent pas à ceux de Vite 8, et `tsc -b` vérifie ce fichier.
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
- Le tour de l'ordinateur part dans un **Web Worker** (`src/aiWorker.ts`, piloté par `useAiMove.ts`), qui n'appelle que `chooseMoveForDifficulty` et ne porte aucune règle. C'est ce qui permet au maître de dépasser le seuil de force mesuré sans figer l'écran. Le chemin synchrone reste en **repli** : worker indisponible, la partie continue avec le budget réduit. Un worker par recherche, terminé à la réponse ou à l'annulation — c'est la seule façon d'arrêter réellement une recherche abandonnée.
- `public/sw.js` applique **réseau d'abord** pour les documents, **cache d'abord** pour `assets/…` dont le nom est haché, **cache puis revalidation** pour le reste. Ne pas passer le HTML en cache d'abord : il porte les noms hachés du build courant. À l'installation le worker relit le document pour y trouver les assets à précharger, plutôt qu'une liste de noms hachés codée en dur. Il **balaie aussi les scripts trouvés** : le fragment du worker de recherche n'est cité que par le bundle d'entrée, sous son seul nom haché résolu relativement à ce bundle, donc il n'apparaît ni dans le HTML ni sous la forme `assets/…`. Sans ce second balayage, qui déclencherait un tour d'ordinateur en ligne oublierait le worker et perdrait l'adversaire fort hors ligne. Toute modification des stratégies ou du contenu préchargé impose d'incrémenter `VERSION`, qui purge les anciens caches à l'activation.
- `main.tsx` n'enregistre le worker que si `import.meta.env.PROD`, pour ne pas masquer le rechargement à chaud en développement. `index.html` porte le lien vers le manifeste, `theme-color`, et les balises `apple-touch-icon` et `apple-mobile-web-app-*` qu'iOS exige faute d'implémenter le manifeste.
- Vérification manuelle après `npm run build` : servir `dist/` depuis un sous-répertoire (`…/linkx/`), contrôler que le worker atteint `activated`, puis recharger serveur arrêté.

### Déploiement du backend

Le même workflow porte un job `backend` — type-vérification Deno et tests pgTAP sur une base neuve — et un job `deploy-backend` qui, au seul `push` vers `main`, applique les migrations puis déploie les fonctions.

Il faut pour cela une **variable** de dépôt `SUPABASE_PROJECT_REF` et deux **secrets**, `SUPABASE_ACCESS_TOKEN` et `SUPABASE_DB_PASSWORD`. Sans la variable, le job réussit sans rien faire : le dépôt reste utilisable par qui n'a pas de projet Supabase.

`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont des **variables**, pas des secrets : elles partent dans le bundle, où n'importe qui les lit. La clé « anon » est publique par construction — c'est RLS qui protège les données, et les tests pgTAP qui le prouvent. En leur absence, le jeu se construit à l'identique et les écrans du tournoi ne s'affichent pas.

**Trois réglages ne se déploient pas et se font à la main dans le tableau de bord du projet**, une fois. Rien dans le dépôt ne les porte : `supabase/config.toml` ne configure que la pile locale, et le workflow ne pousse pas cette configuration. Les oublier ne casse aucun build — cela casse l'usage.

1. **Les adresses de retour d'authentification** (Authentication → URL Configuration, `…/project/<ref>/auth/url-configuration` — pas dans Project Settings). `Site URL` vaut l'adresse publiée, **sous-chemin compris** (`https://<compte>.github.io/linkx/`), et les `Redirect URLs` doivent contenir l'adresse de retour de la SPA, `https://<compte>.github.io/linkx/#/connexion`. Un motif `…/linkx/**` fait l'affaire et couvre les retours à venir, le globstar étant nécessaire : les séparateurs de ces motifs sont `.` et `/`, qu'un simple `*` ne traverse pas. Laissées au défaut, elles valent `http://localhost:3000` : le service **rejette silencieusement** l'adresse demandée, retombe sur `Site URL`, et tout lien de connexion mène à une page inexistante. Les liens déjà envoyés restent morts, il faut en redemander un.
2. **Le serveur d'envoi** (Project Settings → Authentication → SMTP Settings). Celui de Supabase est bridé à quelques courriels par heure et réservé aux essais. C'est GoTrue qui poste les liens de connexion, en SMTP ; `wave-mail`, lui, passe par l'API de Resend — deux chemins d'envoi, à ne pas confondre.
3. **L'amorçage de l'IA de la maison**, décrit plus haut : sans elle, aucune IA ne se qualifie.

Deux différences avec le local méritent d'être connues : la **confirmation d'adresse** est active par défaut sur un projet hébergé, si bien que le premier courriel d'un nouveau compte est un « Confirm signup » et non un lien magique ; et `npx supabase config push` **ne doit pas** servir à régler le premier point, puisqu'il pousserait le `[auth]` local — dont un `site_url` en `localhost`.

## Discipline de modification

- Préserver les changements existants de l'utilisateur et éviter les réécritures sans rapport avec la tâche.
- Préférer de petits composants et des fonctions nommées aux duplications de logique.
- **Commenter peu.** Un commentaire n'explique que ce qui n'est pas clair à la lecture du code. Ne rien redire de ce que `plan.md` ou un `CLAUDE.md` spécifie déjà : le doublon se périme. Souvent, un meilleur nom suffit.
- Ne pas modifier les matrices des pièces, les règles de support ou la connectivité pour résoudre un problème purement visuel.
- **Le jeu et la plateforme sont deux périmètres, et la frontière est la règle la plus importante du dépôt.** Le jeu reste jouable intégralement hors ligne, sans compte et sans le moindre appel réseau, adversaire maître compris : aucune de ses fonctions ne doit dépendre de `supabase/`. Comptes, persistance et service distant n'existent que pour la plateforme de tournoi (`plan.md`, histoires 14 à 16). Ne rien ajouter au jeu qui l'y rattache, et ne pas introduire de jeu en réseau entre humains ni d'effets sonores sans demande explicite.
- Côté navigateur, le seul stockage du jeu reste le niveau de l'ordinateur, retenu dans `localStorage` par `useStoredDifficulty.ts` ; l'état d'une partie n'est jamais stocké, `plan.md` exigeant qu'elle reparte à zéro. Tout ce qui est relu du stockage se valide avant emploi.
- Avant de terminer, examiner le diff, exécuter `git diff --check` et résumer les vérifications effectuées.
