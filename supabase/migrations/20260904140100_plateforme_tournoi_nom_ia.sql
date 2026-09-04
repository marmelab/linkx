-- Le motif du nom d'une IA devient une contrainte de base.
--
-- Pourquoi. Le nom part dans deux vues publiques — `classement` et `noms_bots` —
-- et la base n'en contrôlait que la longueur. Le motif ne vivait que dans
-- `register-bot`, en TypeScript : toute autre écriture — un service, un script
-- d'administration, une porte rouverte par mégarde — y échappait, et un nom
-- portant une balise ou un caractère de contrôle serait entré au classement.
--
-- Le motif est celui de `register-bot/index.ts`, transcrit :
--
--     /^[\p{L}\p{N}][\p{L}\p{N} '._+-]*$/u
--
-- PostgreSQL ne connaît pas `\p{L}` ni `\p{N}` ; `[[:alnum:]]` en tient lieu et
-- suit la classification Unicode du serveur — vérifié : « Élan » et « 漢字 »
-- passent, « <b> », un emoji et un saut de ligne sont refusés. Les deux
-- barrières ne sont donc pas au même grain, et c'est l'ordre voulu : la
-- contrainte SQL est la borne grossière que **rien** ne contourne, le contrôle
-- de `register-bot` reste le message clair rendu à l'auteur.
--
-- `bots_nom_non_vide` garde la longueur ; ce motif n'en dit rien.

alter table public.bots
  add constraint bots_nom_motif
    check (nom ~ '^[[:alnum:]][[:alnum:] ''._+-]*$');

comment on constraint bots_nom_motif on public.bots is
  'Lettres, chiffres, espaces et . _ + - '' seulement, une lettre ou un chiffre en tête. Motif de register-bot, tenu en base parce que le nom est public.';
