/**
 * Chemins des écrans de la plateforme, **source unique**.
 *
 * Ils vivent ici et non dans `src/tournament/routes.ts` parce que deux mondes
 * les lisent : le routeur du navigateur, et `wave-mail`, qui écrit les liens du
 * courriel hebdomadaire. Les recopier dans le second en ferait une seconde
 * vérité qui se périmerait à la première route renommée — un courriel menant à
 * des pages introuvables est pire que pas de courriel.
 *
 * Le sens de la dépendance suit le précédent d'`openings.ts` : c'est `src/` qui
 * lit `supabase/`, jamais Deno qui charge `src/tournament/`. Ce répertoire-là
 * n'est pas écrit pour Deno — ses modules importent sans extension `.ts`, et
 * `config.ts` lit `import.meta.env` —, si bien qu'un import depuis une fonction
 * edge se serait cassé au premier `import` ajouté à `routes.ts`.
 *
 * Module **pur**, sans dépendance : `SetupPanel.tsx` le tire dans le bundle
 * d'entrée du jeu par `routes.ts`, et il ne doit rien y emporter.
 */
export const TOURNAMENT_PATHS = {
  leaderboard: '/classement',
  login: '/connexion',
  bots: '/mes-ia',
  games: '/mes-parties',
  admin: '/admin',
} as const

export type TournamentPath =
  (typeof TOURNAMENT_PATHS)[keyof typeof TOURNAMENT_PATHS]
