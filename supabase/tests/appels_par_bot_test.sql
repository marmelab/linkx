-- Le plafond d'appels simultanés se lit sur l'IA et non dans le corps de la
-- fonction : deux par défaut, un pour l'IA de la maison, dont l'essai de bout
-- en bout a montré que deux recherches de front tuaient l'isolate.
begin;
select plan(7);

insert into auth.users (id, email)
values ('99999999-9999-9999-9999-999999999999', 'auteur-plafond@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('99990000-0000-0000-0000-000000000001', '99999999-9999-9999-9999-999999999999',
   'Plafond-Deux', 'https://plafond-deux.example.test/coup', 'active');

-- L'IA de la maison ne peut être créée que par le service : `ia_maison` est une
-- colonne réservée, et c'est le propos même de la procédure d'amorce.
insert into public.bots (id, proprietaire, nom, adresse_service, statut, ia_maison) values
  ('99990000-0000-0000-0000-000000000002', '99999999-9999-9999-9999-999999999999',
   'Plafond-Maison', 'https://plafond-maison.example.test/coup', 'active', true);

select is(
  (select appels_simultanes_max from public.bots where nom = 'Plafond-Deux'),
  2::smallint,
  'une IA déclarée accepte deux appels simultanés — la promesse de l''histoire 15'
);
select is(
  (select appels_simultanes_max from public.bots where nom = 'Plafond-Maison'),
  1::smallint,
  'l''IA de la maison n''en accepte qu''un : deux recherches se partageraient son budget de processeur'
);

create temp table jetons_plafond (rang integer primary key, id bigint);

insert into jetons_plafond
values (1, public.prendre_jeton_appel('99990000-0000-0000-0000-000000000001', null::uuid, 20));
insert into jetons_plafond
values (2, public.prendre_jeton_appel('99990000-0000-0000-0000-000000000001', null::uuid, 20));
insert into jetons_plafond
values (3, public.prendre_jeton_appel('99990000-0000-0000-0000-000000000001', null::uuid, 20));
insert into jetons_plafond
values (4, public.prendre_jeton_appel('99990000-0000-0000-0000-000000000002', null::uuid, 20));
insert into jetons_plafond
values (5, public.prendre_jeton_appel('99990000-0000-0000-0000-000000000002', null::uuid, 20));

select ok(
  (select id from jetons_plafond where rang = 2) is not null,
  'le deuxième appel vers une IA ordinaire est accordé'
);
select ok(
  (select id from jetons_plafond where rang = 3) is null,
  'le troisième est refusé'
);
select ok(
  (select id from jetons_plafond where rang = 4) is not null,
  'le premier appel vers l''IA de la maison est accordé'
);
select ok(
  (select id from jetons_plafond where rang = 5) is null,
  'le deuxième lui est refusé, là où une IA ordinaire l''aurait obtenu'
);

-- Le plafond se constate, il ne se déclare pas : sinon chacun demanderait deux
-- et la mesure ne servirait à rien.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}',
  true
);
select throws_ok(
  $$update public.bots set appels_simultanes_max = 2 where nom = 'Plafond-Maison'$$,
  '42501',
  null,
  'le propriétaire ne relève pas lui-même le plafond de son IA'
);

reset role;
select * from finish();
rollback;
