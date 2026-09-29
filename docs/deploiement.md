# Déploiement

`.github/workflows/ci.yml` fait foi : lint, tests et build sur `push` et `pull_request` vers `main`, puis publication de `dist/` sur `gh-pages` au seul `push` vers `main`.

## Backend

Le même workflow porte un job `backend` — type-vérification Deno et tests pgTAP sur une base neuve — et un job `deploy-backend` qui, au seul `push` vers `main`, applique les migrations puis déploie les fonctions.

Il faut pour cela une **variable** de dépôt `SUPABASE_PROJECT_REF` et deux **secrets**, `SUPABASE_ACCESS_TOKEN` et `SUPABASE_DB_PASSWORD`. Sans la variable, le job réussit sans rien faire : le dépôt reste utilisable par qui n'a pas de projet Supabase.

`VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` sont des **variables**, pas des secrets : elles partent dans le bundle, où n'importe qui les lit. La clé « anon » est publique par construction — c'est RLS qui protège les données, et les tests pgTAP qui le prouvent. En leur absence, le jeu se construit à l'identique et les écrans du tournoi ne s'affichent pas.

## Trois réglages manuels

**Trois réglages ne se déploient pas et se font à la main dans le tableau de bord du projet**, une fois. Rien dans le dépôt ne les porte : `supabase/config.toml` ne configure que la pile locale, et le workflow ne pousse pas cette configuration. Les oublier ne casse aucun build — cela casse l'usage.

1. **Les adresses de retour d'authentification** (Authentication → URL Configuration, `…/project/<ref>/auth/url-configuration` — pas dans Project Settings). `Site URL` vaut l'adresse publiée, **sous-chemin compris** (`https://<compte>.github.io/linkx/`), et les `Redirect URLs` doivent contenir l'adresse de retour de la SPA, `https://<compte>.github.io/linkx/#/connexion`. Un motif `…/linkx/**` fait l'affaire et couvre les retours à venir, le globstar étant nécessaire : les séparateurs de ces motifs sont `.` et `/`, qu'un simple `*` ne traverse pas. Laissées au défaut, elles valent `http://localhost:3000` : le service **rejette silencieusement** l'adresse demandée, retombe sur `Site URL`, et tout lien de connexion mène à une page inexistante. Les liens déjà envoyés restent morts, il faut en redemander un.
2. **L'adresse publiée et le serveur d'envoi.** `WAVE_MAIL_SITE_URL` porte les trois liens du bilan hebdomadaire et vaut l'adresse **réellement servie**, sous-chemin compris — un domaine personnalisé (`https://exemple.fr/linkx/`) et non l'adresse `github.io` par défaut, si le dépôt en a un. Sans elle, `wave-mail` compose le courriel mais **refuse de l'envoyer** plutôt que de poster des liens morts, et le dit dans son compte rendu. Le serveur d'envoi, lui, se règle dans Project Settings → Authentication → SMTP Settings. Celui de Supabase est bridé à quelques courriels par heure et réservé aux essais. C'est GoTrue qui poste les liens de connexion, en SMTP ; `wave-mail`, lui, passe par l'API de Resend — deux chemins d'envoi, à ne pas confondre.
3. **L'amorçage de l'IA de la maison**, décrit ci-dessous : sans elle, aucune IA ne se qualifie.

Deux différences avec le local méritent d'être connues : la **confirmation d'adresse** est active par défaut sur un projet hébergé, si bien que le premier courriel d'un nouveau compte est un « Confirm signup » et non un lien magique ; et `npx supabase config push` **ne doit pas** servir à régler le premier point, puisqu'il pousserait le `[auth]` local — dont un `site_url` en `localhost`.

## Amorçage de l'IA de la maison

**L'IA de la maison s'amorce à la main, une fois par projet, et rien ne marche avant.** Aucune migration ne la crée : `bots.proprietaire` référence `auth.users`, et `ia_maison` comme `statut` sont réservés au service par un déclencheur, donc hors de portée de `register-bot`. Tant qu'aucune ligne ne porte `ia_maison = true` **et** `statut = 'active'`, l'ordonnanceur rend « IA de la maison absente ou inactive » et **aucune IA ne peut se qualifier** : la plateforme est inerte.

Sur un projet neuf :

1. Ouvrir un compte pour elle par lien magique.
2. Déclarer l'IA par `register-bot` en donnant l'adresse publique de la fonction `bot-linkx`.
3. En SQL avec le rôle de service : `update public.bots set ia_maison = true, statut = 'active' where nom = '…'`.
4. Déposer le secret rendu par `register-bot` dans le secret `LINKX_BOT_SECRET` de la fonction `bot-linkx`, **sans quoi elle refuse tous les appels en 401**.

Son plafond d'appels simultanés tombe alors à un, imposé par un déclencheur.
