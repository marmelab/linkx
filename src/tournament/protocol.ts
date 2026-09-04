/**
 * Spécification que doit suivre une IA candidate : route, état envoyé, réponse
 * attendue, signature des appels, délai.
 *
 * Module à part, et non une constante de `routes.ts` : celui-ci est importé par
 * le point d'entrée du jeu, donc son contenu entre dans le bundle du jeu, qui
 * n'a rien à savoir du tournoi. Ici, seuls les écrans le lisent, et il reste
 * dans leur morceau.
 *
 * Le document vit dans le dépôt plutôt que dans un écran : c'est le même pour
 * qui lit le classement et pour qui déclare son programme, et il doit rester
 * lisible sans compte.
 */
export const PROTOCOL_URL =
  'https://github.com/marmelab/linkx/blob/main/docs/protocole-ia.md'
