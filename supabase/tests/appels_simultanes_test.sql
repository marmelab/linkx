-- Jamais plus de deux appels simultanés vers une même IA (plan.md, histoire 15).
--
-- Le compteur est en base parce que les invocations de `referee-tick` se
-- recouvrent : ce que ce test prouve, c'est qu'il compte par IA, qu'il rend la
-- place libérée, et qu'un jeton laissé par une invocation morte ne condamne pas
-- l'IA jusqu'à la fin de la vague.
begin;
select plan(13);

insert into auth.users (id, email)
values ('88888888-8888-8888-8888-888888888888', 'auteur-jetons@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('88880000-0000-0000-0000-000000000001', '88888888-8888-8888-8888-888888888888',
   'Jeton-A', 'https://jeton-a.example.test/coup', 'active'),
  ('88880000-0000-0000-0000-000000000002', '88888888-8888-8888-8888-888888888888',
   'Jeton-B', 'https://jeton-b.example.test/coup', 'active'),
  ('88880000-0000-0000-0000-000000000003', '88888888-8888-8888-8888-888888888888',
   'Jeton-C', 'https://jeton-c.example.test/coup', 'active');

create temp table jetons (rang integer primary key, id bigint);

-- Trois ordres distincts : l'ordre des appels est ce que ce test mesure.
insert into jetons
values (1, public.prendre_jeton_appel('88880000-0000-0000-0000-000000000001', null::uuid, 20));
insert into jetons
values (2, public.prendre_jeton_appel('88880000-0000-0000-0000-000000000001', null::uuid, 20));
insert into jetons
values (3, public.prendre_jeton_appel('88880000-0000-0000-0000-000000000001', null::uuid, 20));

select isnt((select id from jetons where rang = 1), null::bigint, 'premier appel accordé');
select isnt((select id from jetons where rang = 2), null::bigint, 'deuxième appel accordé');
select is(
  (select id from jetons where rang = 3),
  null::bigint,
  'le troisième appel simultané vers la même IA est refusé'
);

select is(
  public.appels_en_cours('88880000-0000-0000-0000-000000000001'),
  2,
  'deux appels en cours, et pas trois'
);

-- Le compteur est par IA : une IA saturée n'en bloque aucune autre.
select isnt(
  public.prendre_jeton_appel('88880000-0000-0000-0000-000000000002', null::uuid, 20),
  null::bigint,
  'une autre IA garde ses deux places'
);

select ok(
  public.rendre_jeton_appel((select id from jetons where rang = 1)),
  'un jeton se rend'
);
select isnt(
  public.prendre_jeton_appel('88880000-0000-0000-0000-000000000001', null::uuid, 20),
  null::bigint,
  'la place rendue est immédiatement réutilisable'
);

-- Invocation morte : deux jetons pris pour la durée **réelle** d'un bail, et
-- jamais rendus. Les prendre avec une durée nulle les ferait naître périmés et
-- ne prouverait rien : `now()` est figé sur la transaction, et un bail de vingt
-- secondes ne s'écoulerait jamais. Le temps se simule donc en reculant les deux
-- lignes de vingt et une secondes — le seul moyen, dans une transaction, de
-- distinguer un bail vivant d'un bail échu.
select ok(
  public.prendre_jeton_appel('88880000-0000-0000-0000-000000000003', null::uuid, 20) is not null
  and public.prendre_jeton_appel('88880000-0000-0000-0000-000000000003', null::uuid, 20) is not null,
  'deux jetons de vingt secondes pris par une invocation qui ne les rendra pas'
);
select is(
  public.prendre_jeton_appel('88880000-0000-0000-0000-000000000003', null::uuid, 20),
  null::bigint,
  'un bail encore vivant bloque bien la place'
);
select is(
  public.purger_jetons_expires(),
  0,
  'la purge ne touche pas un bail encore vivant'
);

update public.appels_bot
set pris_le = pris_le - interval '21 seconds',
    expire_le = expire_le - interval '21 seconds'
where bot_id = '88880000-0000-0000-0000-000000000003';

select is(
  public.appels_en_cours('88880000-0000-0000-0000-000000000003'),
  0,
  'les vingt secondes écoulées, plus aucun appel n''est en cours'
);
select is(
  public.purger_jetons_expires(),
  2,
  'la purge emporte les deux baux échus'
);
select isnt(
  public.prendre_jeton_appel('88880000-0000-0000-0000-000000000003', null::uuid, 20),
  null::bigint,
  'des jetons expirés ne bloquent pas l''IA'
);

select * from finish();
rollback;
