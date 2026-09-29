---
paths:
  - "src/tournament/**"
  - "src/Root.tsx"
---

# Plateforme de tournoi — écrans

`plan.md`, histoires 14 à 16, fait foi pour le comportement. Les contrats des fonctions edge que ces écrans appellent sont dans `tournoi-serveur.md`.

```text
src/tournament/
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
  AsyncPanel.tsx      chargement, panne et reprise d'une lecture
  TournamentApp.tsx   routeur de fragment, cible du React.lazy
  TournamentLayout.tsx  mise en page, navigation, et droit d'administration partagé
  LeaderboardScreen, LoginScreen, MyBotsScreen, MyGamesScreen, AdminScreen
```

- **Les cinq écrans vivent dans `src/tournament/`**, logique pure et rendu ensemble : la règle « domaine dans `src/game/`, affichage dans `src/components/` » borne le jeu, pas la plateforme. Ce répertoire est **un morceau à part** ; rien du jeu ne doit l'importer, sauf `Root.tsx` (par `React.lazy`) et `SetupPanel.tsx` (pour `config.ts` et `routes.ts`, deux modules sans dépendance).
- `react-router` (v7, `createHashRouter`), `@supabase/supabase-js` et `@tanstack/react-query` (v5) ne sont **jamais** chargées par le jeu : elles vivent dans ce morceau et n'entrent pas dans le bundle d'entrée. Le routage est en **mode hash** parce que GitHub Pages sert des fichiers statiques : `/linkx/classement` rendrait une 404 au rechargement. La query string reste au jeu, dont `?moves=` ouvre une partie.
- **Toute lecture d'écran passe par `useQuery`, et son rendu par `AsyncPanel`.** Aucun `useEffect` de chargement, aucun état de requête tenu à la main : un écran démonté à la navigation repartirait de rien et clignoterait le temps de la réponse. Le magasin vit dans `TournamentApp.tsx`, hors du routeur, et **rien n'y est tenu pour frais** — pas de `staleTime` : chaque montage relit, et c'est la réponse précédente qui occupe l'écran en attendant la nouvelle. Trois conséquences à respecter. La **clé** porte tout ce dont la lecture dépend, l'identité de l'auteur comprise, sans quoi deux comptes ou deux filtres se partageraient une réponse ; ce qui change à l'horloge est un `refetchInterval`, jamais un instant glissé dans la clé, qui vaudrait une entrée neuve à chaque tour et donc un vide à chaque minute. `skipToken` à la place de la fonction **suspend** la lecture tant que ce qu'elle demande manque — la session, une vague ouverte —, et c'est ce qui prouve au typage que la valeur est là. Et **aucune reprise automatique** (`retry: false`) : les écrans en offrent une, explicite. `AsyncPanel` garde à l'écran ce qu'il montrait pendant une revalidation, mais pas quand elle **échoue** : une panne se dit plutôt que de laisser croire à jour ce qui ne l'est plus.
