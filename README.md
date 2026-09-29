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

Les outils de mesure du moteur (`scripts/*.ts`) sont décrits dans `.claude/rules/moteur.md` ; le déploiement dans `docs/deploiement.md`.

## Source de vérité

- `plan.md` est la **spécification produit** : règles du jeu, topologie des pièces, algorithmes de domaine, décisions UX, critères d'acceptation et checklists de validation visuelle. Le lire entièrement avant toute modification fonctionnelle ou visuelle importante.
- Ce README est la **spécification technique** globale. Il sert aussi de `CLAUDE.md` et de `AGENTS.md`, donc il est lu **en entier à chaque session** : **1 500 mots au plus**. N'y entre que ce qui vaut pour tout le dépôt, en une ligne.
- `.claude/rules/` porte le savoir propre à un périmètre ; chaque règle déclare les chemins qui la chargent. Y écrire tout ce qui ne sert pas à chaque session.
  - `domaine.md` — `src/game/` : sources uniques, modèle, notation, tests de domaine
  - `moteur.md` — moteur du maître, livre d'ouverture, scripts et discipline de mesure
  - `interface.md` — `src/components/`, `App.tsx`, CSS : pièges de rendu et de mise en page
  - `hors-ligne.md` — `public/`, service worker, worker de recherche, sous-chemin
  - `tournoi-ecrans.md` — `src/tournament/`
  - `tournoi-serveur.md` — `supabase/`
- `docs/` porte la documentation destinée aux humains : `deploiement.md` (secrets, réglages manuels, amorçage de l'IA de la maison) et `protocole-ia.md` (ce qu'une IA du tournoi doit respecter).
- Deux documents ne se recopient jamais l'un dans l'autre. Une décision produit se reporte dans `plan.md` dans le même changement, en supprimant l'ancienne recommandation contradictoire ; une modification de stack, d'arborescence ou de contrat entre modules se documente ici ou dans la règle concernée.

## Stack

- React 19, TypeScript, Vite 8 (Node `20.19+`), CSS classique dans `src/index.css` et `src/App.css`. Vitest et oxlint. `package-lock.json` fait foi : utiliser `npm`.
- `scripts/*.ts` sont vérifiés au build via `tsconfig.scripts.json` et se lancent avec `vite-node` ; les `.mjs` restent du JS pur.
- Aucune dépendance d'état ou de rendu graphique : le jeu tient dans un reducer React et des fonctions TypeScript pures. Ne pas en ajouter sans nécessité démontrée.
- Trois dépendances, et trois seulement, servent la plateforme de tournoi : `react-router`, `@supabase/supabase-js` et `@tanstack/react-query`. Elles ne sont jamais chargées par le jeu.
- Les imports relatifs de `src/game/` portent leur extension `.ts`, pour Deno. Ne pas la retirer ni l'étendre au reste de `src/`.
- Le backend vit dans `supabase/`, en Deno. L'interface en ligne de commande Supabase s'appelle par `npx supabase …`.

## Arborescence

```text
src/game/            logique pure, sans React
src/components/      affichage React du jeu
src/tournament/      écrans de la plateforme, morceau chargé paresseusement
src/aiWorker.ts      tour de l'ordinateur hors du fil principal
src/App.tsx          câblage : reducer, tour de l'ordinateur, raccourcis clavier
src/Root.tsx         aiguillage jeu / tournoi sur le fragment, avant tout routeur
public/              manifeste, service worker, icônes
scripts/             outils de mesure du moteur, génération du livre et des icônes
fixtures/urls.md     positions prêtes à coller pour les vérifications navigateur
supabase/functions/  fonctions edge ; `_shared/` porte leur logique pure
supabase/migrations/ schéma, vues publiques, file, cron
supabase/tests/      pgTAP
docs/                déploiement, protocole des IA du tournoi
```

Les tests vivent à côté de leur module, en `*.test.ts` / `*.test.tsx`.

## Architecture

- Toute la logique de règles reste dans `src/game/`, tout l'affichage dans `src/components/`. Les fonctions de domaine sont pures, déterministes et testables sans React. `src/game/types.ts` fait foi pour le modèle.
- Une action de dépôt transmet seulement la colonne ; le reducer recalcule toujours l'atterrissage.
- Sources uniques, à ne jamais recréer à côté : `placement.ts` pour la chute et le support, `aimedColumn` pour la conversion pointeur → ancre, `pieceGeometry.ts` pour les silhouettes, `PlexiDefs.tsx` pour la matière, `bitboard.ts` pour le plateau de bits.
- `connectivity.ts` relie les zones sur la **couleur** des cases, jamais sur le `pieceId`.
- `chooseMoveForDifficulty` est l'**unique** entrée de l'ordinateur ; l'interface transmet un niveau, jamais une profondeur ni un budget.
- Le moteur du maître ne redéfinit aucune règle ; `engineBoard.test.ts` le prouve contre `src/game/`. Toucher aux règles doit faire échouer ce test avant tout le reste.
- **Aucune modification de la recherche ou de l'évaluation ne se garde sans mesure** (`.claude/rules/moteur.md`). `openingBook.data.ts` est généré, jamais édité à la main.
- L'état de survol, les délais et les animations restent dans l'UI tant qu'ils n'affectent pas les règles. `App.tsx` ne fait que câbler.

## Frontière entre le jeu et la plateforme

C'est la règle la plus importante du dépôt.

- Le jeu reste jouable intégralement hors ligne, sans compte et sans le moindre appel réseau, adversaire maître compris : aucune de ses fonctions ne dépend de `supabase/`. Comptes, persistance et service distant n'existent que pour la plateforme (`plan.md`, histoires 14 à 16).
- Sans `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`, l'entrée du tournoi disparaît et le fragment ne charge rien. C'est le cas par défaut d'un dépôt cloné, et il doit le rester.
- Rien du jeu n'importe `src/tournament/`, sauf `Root.tsx` (par `React.lazy`) et `SetupPanel.tsx` (`config.ts` et `routes.ts`).
- Les règles ne sont jamais réécrites côté serveur : les fonctions edge importent `src/game/*.ts` par chemin relatif. Une fonction edge n'importe jamais `src/tournament/`.
- `src/` ne lit `supabase/` qu'à deux endroits : `_shared/openings.ts` et `_shared/tournamentPaths.ts`.
- Côté navigateur, le seul stockage du jeu est le niveau de l'ordinateur (`useStoredDifficulty.ts`) ; l'état d'une partie n'est jamais stocké. Tout ce qui est relu du stockage se valide avant emploi.
- Pas de jeu en réseau entre humains ni d'effets sonores sans demande explicite.

## Tests et vérification

- Ajouter ou adapter des tests de domaine pour toute modification de règles, de chute, de passe ou de connexion, et toujours couvrir le cas de refus.
- Les scripts `test` relèvent `--testTimeout` à 20 s dans `package.json`, pas dans `vite.config.ts` : Vitest 3 embarque sa propre copie de Vite, dont les types ne se mêlent pas à ceux de Vite 8. Un test franchement plus long garde son délai explicite.
- Pour toute modification d'interface, faire le passage navigateur décrit dans `plan.md` sur un viewport bureau et un viewport mobile : aucun débordement horizontal, aucune erreur console. `fixtures/urls.md` fournit des positions prêtes à coller.

Vérification finale obligatoire :

```bash
npm test
npm run lint
npm run build
```

## Publication

`.github/workflows/ci.yml` fait foi : lint, tests et build sur `push` et `pull_request` vers `main`, publication de `dist/` sur `gh-pages` et déploiement du backend au seul `push` vers `main`. Le site est servi sous un sous-chemin et s'installe hors ligne : les contraintes qui en découlent sont dans `.claude/rules/hors-ligne.md`, les secrets et réglages manuels dans `docs/deploiement.md`.

## Discipline de modification

- Préserver les changements existants de l'utilisateur et éviter les réécritures sans rapport avec la tâche.
- Préférer de petits composants et des fonctions nommées aux duplications de logique.
- **Commenter peu.** Un commentaire n'explique que ce qui n'est pas clair à la lecture du code. Ne rien redire de ce que `plan.md` ou une règle spécifie déjà : le doublon se périme. Souvent, un meilleur nom suffit.
- Ne pas modifier les matrices des pièces, les règles de support ou la connectivité pour résoudre un problème purement visuel.
- Avant de terminer, examiner le diff, exécuter `git diff --check` et résumer les vérifications effectuées.
