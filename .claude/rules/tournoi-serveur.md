---
paths:
  - "supabase/**"
  - "src/tournament/api.ts"
---

# Plateforme de tournoi — serveur

`plan.md`, histoires 14 à 16, fait foi pour le comportement ; ce fichier pour les contrats techniques. Déploiement, secrets et amorçage de l'IA de la maison : `docs/deploiement.md`.

```text
supabase/
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

- **Les règles ne sont jamais réécrites côté serveur.** Les fonctions edge importent `src/game/*.ts` par chemin relatif (`../../../src/game/moveNotation.ts`). Ce n'est pas une hypothèse : `deno check` passe sur tout le graphe en mode strict, et le bundler de `supabase functions serve` accepte les fichiers situés hors de `supabase/`. Corollaire : ne jamais copier un module de règles dans `supabase/`, et ne jamais y redéfinir une règle.
- **Arbitrer un coup, c'est `parseGameRecord(notation + ' ' + coup)`.** Un refus rend un `NotationError` typé — sept motifs, déjà spécifiés — qui se journalise tel quel. Ce chemin ne charge ni le livre d'ouverture ni `engineSearch` : huit modules, une quinzaine de kilo-octets.
- **Le bot maison est le seul consommateur serveur de `chooseMoveForDifficulty`.** Deux pièges. Sans troisième argument `random`, `budgetMs` est ignoré et la recherche bascule en plafond de nœuds (`minimax.ts`). Et `engineSearch` **n'est pas réentrant** : table de transposition, tueurs et position de recherche sont des singletons de module, remis à zéro à chaque appel ; deux recherches simultanées dans le même isolate se corrompent. Les appels s'y sérialisent.
- **Limites de l'edge runtime** : 2 s de CPU par isolate — l'attente réseau n'y compte pas —, 150 s d'horloge, 256 Mio. L'arbitre y tient sans effort ; le bot maison, non. Son budget de recherche est de **900 ms, mesuré** (`searchQueue.ts`). Le processeur se compte **par isolate**, d'une requête à l'autre : passé 1 s, l'isolate est retiré ; à 2 s, il est coupé. Une recherche qui franchit 1 s en cours de requête perd parfois sa réponse, coup calculé. Le démarrage — livre et moteur — coûte moins de 100 ms. Toute modification de ce budget se remesure, en séquentiel, sur `npx supabase functions serve` qui applique les mêmes seuils.
- **La logique pure vit dans `supabase/functions/_shared/`** et se teste avec le Vitest du dépôt, pas avec un second lanceur. Une fonction edge ne porte que du transport : lire la requête, appeler `_shared`, répondre. Ces tests sont type-vérifiés par `tsconfig.supabase.json`, quatrième projet de `tsconfig.json` : `deno check` les exclut, parce qu'ils importent `vitest`, et sans ce projet ils étaient le seul coin du dépôt que rien ne vérifiait. `supabase/functions/deno.globals.d.ts` y déclare le fragment de l'API Deno que `_shared/` touche — le garder minimal, c'est lui qui borne ce que le code partagé s'autorise.
- **Deux constantes vivent dans `supabase/functions/_shared/` et sont lues depuis `src/`** : le libellé d'une ouverture imposée (`openings.ts`, lu par `src/tournament/games.ts`) et les chemins des écrans (`tournamentPaths.ts`, réexporté par `src/tournament/routes.ts` et lu par `wave-mail` pour les liens du courriel). Ce sont les seuls endroits du dépôt où `src/` lit `supabase/`, et le sens est délibéré : recopier ces valeurs en ferait une seconde vérité qui divergerait à la première ouverture ajoutée ou à la première route renommée. **L'inverse est interdit** — une fonction edge n'importe jamais `src/tournament/`, qui n'est pas écrit pour Deno : ses modules importent sans extension `.ts` et `config.ts` lit `import.meta.env`.
- **Contrat des fonctions edge appelées par les écrans** : `register-bot` reçoit `{ name, url }`, `probe-bot` reçoit `{ bot }`, `update-bot` reçoit `{ bot, status }`, et `scheduler` comme `referee-tick` reçoivent `{ force }` d'un administrateur ; toutes répondent un JSON portant `ok`, `message`, et `field` sur un refus, que le formulaire affiche **sous le champ nommé**. `update-bot` reçoit `{ bot, status?, url? }` et **est l'unique porte de tout ce qu'un auteur change sur son IA**, `statut` étant réservé au service par un déclencheur et `authenticated` n'ayant aucun droit d'écriture sur `bots` : elle vérifie l'identité auprès de `/auth/v1/user`, n'agit que sur une IA de l'appelant, et n'ouvre que trois transitions — retirer une IA vivante, réactiver une IA en sommeil, et **relancer la qualification d'une IA en attente** (`en_attente` → `en_attente`). `retiree` est terminal, et rien ne mène à `active` : cela reste le verdict de l'ordonnanceur. Le champ `url` corrige l'adresse, repassée par **le même contrôle qu'à la déclaration**. Ces deux derniers points ne sont pas du confort : `qualificationNeeded` ne rouvre une tentative que si la ligne a bougé depuis la dernière, et rien d'autre au monde ne peut la faire bouger — sans eux, une IA qui ratait sa première qualification y restait **à jamais**, son nom réservé et sa place prise sur les dix du compte. **`probe-bot` est authentifiée** (`verify_jwt = true`) et ne sonde qu'une IA de l'appelant : elle lit l'adresse et le secret en base pour signer l'appel **comme l'arbitre le fera**. Publique, elle recevait une adresse et ne connaissait aucun secret : elle signait donc avec un jeton d'essai, que toute IA conforme au protocole rejette — elle échouait sur ce qu'elle devait vérifier. C'est aussi ce qui lui permet de rendre le code HTTP et le corps reçu : l'appelant est le propriétaire de l'IA appelée, le critère déjà retenu pour `reponse_brute`. **Les écrans ne font que lire la base** : `authenticated` n'a aucun droit d'insertion ni de modification sur `bots` (migration `plateforme_tournoi_ecriture_reservee_bots`), sans quoi `/rest/v1/bots` contournerait le contrôle d'adresse, le motif du nom, le débit et le plafond de dix IA par compte que ces deux fonctions appliquent. Et le journal d'une partie se lit par la vue `journal_appels`, jamais par `evenements_partie` : `erreur` et `reponse_brute` y sont masquées hors du propriétaire de l'IA appelée, le reste restant visible des deux participants.
- **Sans IA de la maison active, la plateforme est inerte.** Tant qu'aucune ligne ne porte `ia_maison = true` **et** `statut = 'active'`, l'ordonnanceur rend « IA de la maison absente ou inactive » et **aucune IA ne peut se qualifier**. Aucune migration ne la crée ; l'amorçage manuel est décrit dans `docs/deploiement.md`. Son plafond d'appels simultanés tombe alors à un, imposé par un déclencheur et non laissé à la mémoire de l'opérateur : deux recherches arrivées de front dans le même isolate dépassent son budget de processeur et le font tuer — mesuré. Sans le secret `LINKX_BOT_SECRET`, `bot-linkx` **refuse tous les appels en 401** : elle est publique et calcule, un secret oublié au déploiement offrirait la recherche à qui la demande. Seule `LINKX_BOT_ALLOW_UNSIGNED=1`, réservée au développement, rouvre le mode non signé.
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
