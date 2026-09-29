-- Les fonctions de service ne s'appellent qu'avec la clé de service.
--
-- `anon` et `authenticated` tiennent de Supabase un droit d'exécution direct sur
-- toute fonction de `public` ; retirer celui de `public` ne le leur ôte pas.
begin;
select plan(50);

create temp table fonctions_de_service (signature text) on commit drop;
insert into fonctions_de_service values
  ('public.clore_vague(uuid, jsonb)'),
  ('public.ouvrir_vague(uuid)'),
  ('public.file_coups_enfiler(uuid[], integer)'),
  ('public.file_coups_lire(integer, integer)'),
  ('public.file_coups_supprimer(bigint)'),
  ('public.file_coups_replanifier(bigint, integer)'),
  ('public.file_coups_taille()'),
  ('public.file_coups_parties_en_file()'),
  ('public.prendre_jeton_appel(uuid, uuid, integer)'),
  ('public.rendre_jeton_appel(bigint)'),
  ('public.purger_jetons_expires()'),
  ('public.appels_en_cours(uuid)'),
  ('public.appeler_fonction_edge(text)');

select ok(
  not has_function_privilege(r.role, f.signature, 'execute'),
  format('%s n''exécute pas %s', r.role, f.signature)
)
from fonctions_de_service f
cross join (values ('anon'), ('authenticated')) as r(role)
order by f.signature, r.role;

select ok(
  has_function_privilege('service_role', signature, 'execute'),
  format('service_role exécute %s', signature)
)
from fonctions_de_service
where signature <> 'public.appeler_fonction_edge(text)'
order by signature;

-- Les deux fonctions dont les écrans et les politiques ont besoin restent ouvertes.
select ok(
  has_function_privilege('anon', 'public.est_administrateur()', 'execute'),
  'anon exécute toujours est_administrateur'
);
select ok(
  has_function_privilege('authenticated', 'public.possede_bot(uuid)', 'execute'),
  'authenticated exécute toujours possede_bot'
);

-- Une fonction à venir naît fermée aux clients.
create function public.fonction_temoin() returns integer language sql as 'select 1';
select ok(
  not has_function_privilege('anon', 'public.fonction_temoin()', 'execute'),
  'une nouvelle fonction n''est pas exécutable par anon'
);
select ok(
  not has_function_privilege('authenticated', 'public.fonction_temoin()', 'execute'),
  'une nouvelle fonction n''est pas exécutable par authenticated'
);

-- Le chemin réel : un appel par la clé anon est refusé.
insert into auth.users (id, email)
values ('5e5e5e5e-5e5e-5e5e-5e5e-5e5e5e5e5e5e', 'auteur-service@example.test');
insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('5e5e0000-0000-0000-0000-000000000001', '5e5e5e5e-5e5e-5e5e-5e5e-5e5e5e5e5e5e',
   'Service-Bleue', 'https://service-bleue.example.test/coup', 'active');
insert into public.vagues (id, debut, fin, graine, statut)
values ('5e5e0000-0000-0000-0000-0000000000aa',
        now() - interval '1 hour', now() + interval '1 hour', 'graine', 'en_cours');

set local role anon;
select throws_ok(
  $$select public.clore_vague(
      '5e5e0000-0000-0000-0000-0000000000aa',
      '[{"bot_id":"5e5e0000-0000-0000-0000-000000000001","elo_apres":4000}]'
    )$$,
  '42501',
  null,
  'anon ne clôt pas une vague'
);
set local role authenticated;
select throws_ok(
  $$select public.prendre_jeton_appel('5e5e0000-0000-0000-0000-000000000001', null, 100000000)$$,
  '42501',
  null,
  'authenticated ne confisque pas les jetons d''une IA'
);
reset role;

select is(
  (select statut from public.vagues where id = '5e5e0000-0000-0000-0000-0000000000aa'),
  'en_cours',
  'la vague est restée ouverte'
);
select is(
  (select elo from public.bots where id = '5e5e0000-0000-0000-0000-000000000001'),
  1200,
  'l''Elo n''a pas bougé'
);

-- Le cron ne réveille que ses deux fonctions.
select throws_ok(
  $$select public.appeler_fonction_edge('../../rest/v1/bots')$$,
  'P0001',
  null,
  'un nom hors liste est refusé'
);
select throws_ok(
  $$select public.appeler_fonction_edge('wave-mail')$$,
  'P0001',
  null,
  'wave-mail n''est pas réveillable par le cron'
);
select lives_ok(
  $$select public.appeler_fonction_edge('scheduler')$$,
  'scheduler reste réveillable'
);
select lives_ok(
  $$select public.appeler_fonction_edge('referee-tick')$$,
  'referee-tick reste réveillable'
);

select * from finish();
rollback;
