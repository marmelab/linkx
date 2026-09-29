---
paths:
  - "public/**"
  - "index.html"
  - "vite.config.ts"
  - "src/main.tsx"
  - "src/aiWorker.ts"
  - "src/components/useAiMove.ts"
---

# Publication sous un sous-chemin et jeu hors ligne

Le site est servi par GitHub Pages sous un sous-chemin, et l'application s'installe et se relance hors ligne.

- `vite.config.ts` fixe `base: './'`, et toute référence à un fichier de `public/` s'écrit en relatif (`./favicon.svg`). Une base absolue rendrait la page blanche sous le sous-chemin. Même règle pour `start_url` et `scope` du manifeste, qui valent `./`, et pour le `./sw.js` enregistré par `main.tsx` — ce chemin fixe aussi la portée du worker. `public/.nojekyll` empêche GitHub Pages de filtrer les fichiers commençant par un underscore.
- Le tour de l'ordinateur part dans un **Web Worker** (`src/aiWorker.ts`, piloté par `useAiMove.ts`), qui n'appelle que `chooseMoveForDifficulty` et ne porte aucune règle. C'est ce qui permet au maître de dépasser le seuil de force mesuré sans figer l'écran. Le chemin synchrone reste en **repli** : worker indisponible, la partie continue avec le budget réduit. Un worker par recherche, terminé à la réponse ou à l'annulation — c'est la seule façon d'arrêter réellement une recherche abandonnée.
- `public/sw.js` applique **réseau d'abord** pour les documents, **cache d'abord** pour `assets/…` dont le nom est haché, **cache puis revalidation** pour le reste. Ne pas passer le HTML en cache d'abord : il porte les noms hachés du build courant. À l'installation le worker relit le document pour y trouver les assets à précharger, plutôt qu'une liste de noms hachés codée en dur. Il **balaie aussi les scripts trouvés** : le fragment du worker de recherche n'est cité que par le bundle d'entrée, sous son seul nom haché résolu relativement à ce bundle, donc il n'apparaît ni dans le HTML ni sous la forme `assets/…`. Sans ce second balayage, qui déclencherait un tour d'ordinateur en ligne oublierait le worker et perdrait l'adversaire fort hors ligne. Toute modification des stratégies ou du contenu préchargé impose d'incrémenter `VERSION`, qui purge les anciens caches à l'activation.
- **Le service worker ne voit pas l'API** : il rend la main sur toute requête qui n'est pas un GET de même origine, et l'API est servie depuis un autre domaine. Ne pas lui ajouter d'exception, ce serait incrémenter `VERSION` et revalider le mode hors ligne pour rien. Et **il ne précharge pas le morceau du tournoi** : son second balayage nomme le seul fragment qu'il doit emporter, `aiWorker-…js`, et non tout nom haché cité par le bundle d'entrée. Un balayage large embarquerait des écrans qui ne servent qu'en ligne, alors que le jeu ne doit rien devoir à la plateforme. Ce morceau se met en cache à l'usage, comme n'importe quel asset haché.
- `main.tsx` n'enregistre le worker que si `import.meta.env.PROD`, pour ne pas masquer le rechargement à chaud en développement. `index.html` porte le lien vers le manifeste, `theme-color`, et les balises `apple-touch-icon` et `apple-mobile-web-app-*` qu'iOS exige faute d'implémenter le manifeste.
- Vérification manuelle après `npm run build` : servir `dist/` depuis un sous-répertoire (`…/linkx/`), contrôler que le worker atteint `activated`, puis recharger serveur arrêté.
