-- Le journal se lit à deux, sauf ce que le service adverse a répondu.
--
-- `erreur` et `reponse_brute` disent ce qu'un service tiers a laissé échapper :
-- trace d'exception, corps brut, adresse d'une machine. Elles ne vont qu'au
-- propriétaire de l'IA appelée ; le reste — latence, code HTTP, coup — reste
-- visible des deux, puisqu'il sert à comprendre la partie.
begin;
select plan(9);

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'auteur-g@example.test'),
  ('99999999-9999-9999-9999-999999999999', 'auteur-h@example.test'),
  ('a0000000-0000-0000-0000-00000000000a', 'admin-b@example.test');

insert into public.administrateurs (utilisateur_id)
values ('a0000000-0000-0000-0000-00000000000a');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('88880000-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
   'Journal-Bleue', 'https://bleue.example.test/coup', 'active'),
  ('99990000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999',
   'Journal-Blanche', 'https://blanche.example.test/coup', 'active');

insert into public.parties (id, bot_bleu, bot_blanc, statut)
values ('b0000000-0000-0000-0000-000000000001',
        '88880000-0000-0000-0000-000000000001',
        '99990000-0000-0000-0000-000000000001',
        'en_cours');

insert into public.evenements_partie
  (partie_id, rang_coup, bot_id, latence_ms, statut_http, coup, erreur, reponse_brute)
values
  ('b0000000-0000-0000-0000-000000000001', 0, '88880000-0000-0000-0000-000000000001',
   120, 200, '3Ir13', null, '{"move":"3Ir13"}'),
  ('b0000000-0000-0000-0000-000000000001', 1, '99990000-0000-0000-0000-000000000001',
   6100, 500, null, 'code HTTP 500', 'Traceback: secret-interne');

-- Les colonnes sensibles sortent de la table pour tout client, quel qu'il soit.
select ok(
  not has_column_privilege('authenticated', 'public.evenements_partie', 'erreur', 'SELECT'),
  'la colonne « erreur » n''est plus lisible depuis la table'
);
select ok(
  not has_column_privilege('authenticated', 'public.evenements_partie', 'reponse_brute', 'SELECT'),
  'la colonne « reponse_brute » n''est plus lisible depuis la table'
);
select ok(
  has_column_privilege('authenticated', 'public.evenements_partie', 'latence_ms', 'SELECT'),
  'la latence, elle, reste lisible'
);

-- Le propriétaire du bot bleu.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"88888888-8888-8888-8888-888888888888","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.journal_appels
   where partie_id = 'b0000000-0000-0000-0000-000000000001'),
  2::bigint,
  'un participant voit les deux appels de sa partie'
);
select is(
  (select statut_http from public.journal_appels where rang_coup = 1),
  500,
  'il voit le code HTTP de l''appel adverse, qui explique la partie'
);
select is(
  (select erreur from public.journal_appels where rang_coup = 1),
  null,
  'mais pas l''erreur rendue par le service adverse'
);
select is(
  (select reponse_brute from public.journal_appels where rang_coup = 1),
  null,
  'ni le corps brut que ce service a renvoyé'
);

-- Le propriétaire du bot appelé, lui, lit tout de son propre service.
select set_config(
  'request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}',
  true
);
select is(
  (select reponse_brute from public.journal_appels where rang_coup = 1),
  'Traceback: secret-interne',
  'le propriétaire de l''IA appelée lit la réponse de son propre service'
);

-- Un tiers ne voit rien de cette partie, journal compris.
select set_config(
  'request.jwt.claims',
  '{"sub":"a0000000-0000-0000-0000-00000000000b","role":"authenticated"}',
  true
);
select is(
  (select count(*) from public.journal_appels),
  0::bigint,
  'un tiers ne voit aucune ligne du journal'
);

reset role;
select * from finish();
rollback;
