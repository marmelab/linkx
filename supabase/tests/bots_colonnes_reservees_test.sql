-- Un propriétaire modifie son IA, mais pas ce que la plateforme tient pour elle
-- (plan.md, histoires 14 et 15).
begin;
select plan(10);

insert into auth.users (id, email)
values ('55555555-5555-5555-5555-555555555555', 'auteur-d@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut, elo, parties_classees)
values ('55550000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
        'Zeta', 'https://zeta.example.test/coup', 'en_attente', 1380, 42);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',
  true
);

select lives_ok(
  $$update public.bots set adresse_service = 'https://zeta.example.test/v2'
    where id = '55550000-0000-0000-0000-000000000001'$$,
  'le propriétaire change l''adresse de son service'
);
select throws_ok(
  $$update public.bots set elo = 3000
    where id = '55550000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'le propriétaire ne modifie pas l''Elo de son IA'
);
select throws_ok(
  $$update public.bots set statut = 'active'
    where id = '55550000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'le propriétaire ne se qualifie pas lui-même en passant son IA à active'
);
select throws_ok(
  $$update public.bots set parties_classees = 999
    where id = '55550000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'le propriétaire ne modifie pas son nombre de parties classées'
);
select throws_ok(
  $$update public.bots set ia_maison = true
    where id = '55550000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'le propriétaire ne se déclare pas IA de la maison'
);
select throws_ok(
  'select secret_signature from public.bots',
  '42501',
  null,
  'le secret de signature n''est jamais relu, même par son propriétaire'
);

-- Une déclaration cliente part toujours en attente de qualification, à 1200.
insert into public.bots (nom, adresse_service)
values ('Eta', 'https://eta.example.test/coup');

select is(
  (select statut from public.bots where nom = 'Eta'),
  'en_attente',
  'une IA déclarée depuis un client entre en attente de qualification'
);
select is(
  (select elo from public.bots where nom = 'Eta'),
  1200,
  'une IA déclarée depuis un client part à 1200'
);

reset role;

-- Le service, lui, écrit ces colonnes : c'est lui qui classe et qui qualifie.
set local role service_role;
select lives_ok(
  $$update public.bots set elo = 1412, statut = 'active', parties_classees = 43
    where id = '55550000-0000-0000-0000-000000000001'$$,
  'le service écrit l''Elo et le statut'
);
reset role;

select throws_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('55555555-5555-5555-5555-555555555555', 'zETA', 'https://autre.example.test/coup')$$,
  '23505',
  null,
  'le nom d''une IA est unique, à la casse près'
);

select * from finish();
rollback;
