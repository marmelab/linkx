# Écrire une IA pour le tournoi Linkx

Une IA de tournoi est un service accessible par le réseau, exposant **une seule route**. La plateforme lui envoie l'état d'une partie, elle répond par un coup. Elle n'a aucune notion de partie, d'adversaire ni de score : c'est la plateforme qui enchaîne les coups en interrogeant deux IA à tour de rôle.

Les règles du jeu sont décrites dans [`plan.md`](../plan.md), section « Règles du jeu ». Ce document ne décrit que le dialogue.

## La route

```http
POST /votre-route
Content-Type: application/json
X-Linkx-Timestamp: 1756900000
X-Linkx-Signature: sha256=<empreinte>

{
  "protocol": 1,
  "game": "9f1c…",
  "color": "blue",
  "record": "b 15 3Ir13 --",
  "deadline_ms": 6000
}
```

Réponse attendue, en moins de six secondes :

```json
{ "move": "4Lsr27" }
```

Rien d'autre n'est lu dans la réponse. Le code HTTP doit être `200` ; tout autre code vaut abandon.

| Champ | Sens |
| --- | --- |
| `protocol` | version du dialogue, `1` aujourd'hui. Une version inconnue ne doit pas faire échouer votre service. |
| `game` | identifiant de la partie. Il ne sert qu'à vos journaux : la plateforme ne vous demande jamais de mémoriser quoi que ce soit entre deux appels. |
| `color` | la couleur que vous tenez, `blue` ou `white`. |
| `record` | la partie depuis son début, dans la notation décrite ci-dessous. Vide au tout premier coup d'une partie à plateau vide. |
| `deadline_ms` | le temps dont vous disposez, en millisecondes. Vaut 6000 aujourd'hui ; lisez-le plutôt que de le supposer. |

## L'état de la partie tient dans `record`

C'est le point le plus important de ce document : **la notation restitue tout**. En la rejouant depuis une partie vierge, vous obtenez le plateau, les réserves des deux joueurs, les exemplaires déjà consommés et le joueur au trait. Il n'y a donc rien d'autre à transmettre, et rien à mémoriser d'un appel à l'autre.

La grammaire complète est spécifiée dans [`plan.md`](../plan.md), section « Notation d'une partie ». En bref :

```text
partie   := [ premier ] jeton*
premier  := "b" | "w"                         défaut « b »
jeton    := coup | passe
coup     := forme [ "s" ] [ ("r"|"l") ("1"|"2"|"3") ] colonne
forme    := "1" | "2" | "3I" | "3L" | "4S" | "4T" | "4L"
colonne  := "1".."9"                          colonne d'ancrage, toujours en dernier
passe    := "--"
```

`1` mono, `2` domino, `3I` barre de trois, `3L` petit L, `4S` le S, `4T` le T, `4L` le grand L. Le `s` retourne la pièce **avant** de la tourner, et il n'a d'effet que sur le `4S` et le `4L`. La colonne est celle de la case la plus à gauche de la pièce dans son orientation finale, pas celle que vous viseriez à la souris.

Exemples : `15` mono en colonne 5 · `3Ir13` barre de trois debout en colonne 3 · `4Lsr27` grand L retourné puis tourné d'un demi-tour, ancré en colonne 7.

## Votre réponse

Un **seul jeton de coup**, dans cette même notation. Les espaces autour sont ignorés ; tout le reste est refusé — chaîne vide, deux jetons, séparateur interne.

Deux règles à ne pas manquer :

- **Ne renvoyez jamais `--`.** Un tour passé est entièrement déterminé par la position : la plateforme l'applique elle-même. Un `--` reçu d'une IA est traité comme une réponse illégale, même là où la position passe effectivement. Vous pouvez en revanche en **lire** dans le `record` qu'on vous envoie.
- **Les écritures redondantes sont acceptées.** `2r23` vaut `23`, `3Ls4` vaut `3Lr14` : inutile de canoniser vous-même.

## Perdre la partie sans jouer

Ces cas font perdre la partie en cours, et comptent comme des défaites ordinaires au classement :

| Motif | Cause |
| --- | --- |
| `timeout` | pas de réponse complète dans le délai annoncé |
| `unreachable` | connexion impossible, ou code HTTP autre que `200` |
| `unreadable` | corps illisible, champ `move` absent, ou plus d'un jeton |
| `illegal` | le coup est refusé par les règles |

Un coup illégal est toujours accompagné du motif exact rendu par l'arbitre, visible dans le journal de la partie : `syntax` (jeton mal formé), `exhausted` (les deux exemplaires de cette forme sont joués), `horizontal-bounds` (la pièce sortirait du plateau), `overflow` (la colonne est trop remplie), `unsupported` (une case vide subsisterait sous la pièce), `unexpected-pass`.

`unsupported` est le motif qui surprend le plus, et il vaut d'être compris avant d'écrire une ligne de code : une pièce doit reposer sur un appui **sous chacune de ses cases inférieures**. Un `T` tige vers le bas lâché sur un sol plat est illégal — il tiendrait sur sa seule tige, les deux extrémités de sa barre surplombant le vide.

## Les appels sont signés

Chaque appel porte deux en-têtes : `X-Linkx-Timestamp`, l'heure d'émission en secondes, et `X-Linkx-Signature`, de la forme `sha256=<empreinte hexadécimale>`. L'empreinte est le HMAC-SHA256, avec le secret remis à l'inscription, de la chaîne `<timestamp>.<corps exact de la requête>`.

Vérifier cette signature est facultatif mais recommandé : c'est ce qui vous permet de n'accepter que les appels de la plateforme. Comparez en temps constant, et refusez un horodatage trop ancien.

Le secret n'est affiché **qu'une fois**, au moment de l'inscription. Il n'est pas récupérable ensuite.

## Le tournoi

- Une **vague par semaine**, le jeudi de 0 h à 12 h, heure de Paris. Aucune inscription à faire : être active suffit.
- **Toutes contre toutes.** Chaque paire se rencontre plusieurs fois, autant de fois dans chaque couleur : deux parties à plateau vide, puis plusieurs parties à ouverture imposée — votre premier appel reçoit alors un `record` déjà entamé.
- **Jamais plus de deux appels simultanés** vers une même IA. Un service qui traite ses requêtes une par une joue la vague entière sans jamais dépasser son délai.
- **Elo** classique, départ à 1200. Une IA qui échoue techniquement sur la totalité de ses parties pendant trois vagues consécutives est mise en sommeil, son auteur prévenu ; elle se réactive d'un clic.

## Mettre au point

- La **sonde** appelle votre IA sur une position d'essai et vous rend « OK » avec le temps de réponse, ou le motif d'échec exact. C'est l'outil à utiliser avant d'inscrire quoi que ce soit.
- Une IA nouvellement déclarée joue une **partie de qualification** contre l'IA de la maison. Elle n'entre au classement qu'après l'avoir terminée sans faute technique.
- Vos parties sont consultables coup par coup, avec un **journal** donnant pour chaque appel la latence, le code HTTP et l'erreur éventuelle.

## Contraintes sur l'adresse déclarée

`https` obligatoire, sur le port 443, avec un nom d'hôte public. Sont refusées les adresses IP littérales, `localhost`, les suffixes internes et les plages privées : la plateforme ne doit pas pouvoir servir de relais vers un réseau interne.

## L'IA de la maison

L'adversaire du jeu est lui-même inscrit et joue les vagues comme les autres. Il sert de mètre-étalon, mais **il est un peu moins fort que le maître de l'application** : la plateforme borne le temps de calcul d'un service à moins de deux secondes de processeur, là où le jeu lui en accorde six dans le navigateur. Le battre ici ne veut donc pas dire le battre là-bas.
