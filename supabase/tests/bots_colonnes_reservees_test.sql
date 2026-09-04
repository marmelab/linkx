-- Aucune écriture cliente sur `bots`, un déclencheur qui tient quand même, et
-- un nom contraint en base (plan.md, histoires 14 et 15).
begin;
select plan(18);

insert into auth.users (id, email)
values ('55555555-5555-5555-5555-555555555555', 'auteur-d@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut, elo, parties_classees)
values ('55550000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
        'Zeta', 'https://zeta.example.test/coup', 'en_attente', 1380, 42);

-- 1. Les droits. Toute écriture passe par `register-bot` et `update-bot`, qui
-- contrôlent l'adresse, le nom et le débit ; `/rest/v1/bots` n'est plus une
-- porte dérobée vers ces trois contrôles.
select ok(
  not has_any_column_privilege('authenticated', 'public.bots', 'INSERT'),
  'aucun droit d''insertion, pas même sur une colonne'
);
select ok(
  not has_any_column_privilege('authenticated', 'public.bots', 'UPDATE'),
  'aucun droit de modification, pas même sur une colonne'
);
select ok(
  has_column_privilege('authenticated', 'public.bots', 'nom', 'SELECT'),
  'la lecture de ses propres IA reste ouverte'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',
  true
);

select throws_ok(
  $$update public.bots set adresse_service = 'https://zeta.example.test/v2'
    where id = '55550000-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'le propriétaire ne change plus l''adresse de son service sans passer par le service'
);
select throws_ok(
  $$insert into public.bots (nom, adresse_service)
    values ('Eta', 'https://eta.example.test/coup')$$,
  '42501',
  null,
  'une IA ne se déclare plus directement dans la table'
);
select throws_ok(
  'select secret_signature from public.bots',
  '42501',
  null,
  'le secret de signature n''est jamais relu, même par son propriétaire'
);

reset role;

-- 2. Le second barrage. Le déclencheur des colonnes réservées ne sert plus tant
-- qu'aucun droit ne le sollicite ; il doit rester juste le jour où l'on en
-- rouvrirait un, et sa réécriture à `search_path` figé ne l'a pas cassé. Le
-- droit et les politiques qui allaient avec sont donc rendus ici, dans les
-- termes exacts de `20260903120200`, et pour cette transaction seulement.
grant insert (nom, adresse_service), update on public.bots to authenticated;
create policy bots_declaration_par_proprietaire
  on public.bots for insert to authenticated
  with check (proprietaire = (select auth.uid()));
create policy bots_modification_par_proprietaire
  on public.bots for update to authenticated
  using (proprietaire = (select auth.uid()))
  with check (proprietaire = (select auth.uid()));

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}',
  true
);

select lives_ok(
  $$update public.bots set adresse_service = 'https://zeta.example.test/v2'
    where id = '55550000-0000-0000-0000-000000000001'$$,
  'sous un droit rendu, le propriétaire change l''adresse de son service'
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

-- 3. Le nom. Le motif de `register-bot` est tenu en base, parce que ce nom part
-- dans `classement` et `noms_bots`, que tout le monde lit.
select lives_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('55555555-5555-5555-5555-555555555555', 'Élan_2 v1.0',
            'https://elan.example.test/coup')$$,
  'un nom accentué, chiffré et ponctué reste accepté'
);
select throws_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('55555555-5555-5555-5555-555555555555', '<b>Theta</b>',
            'https://theta.example.test/coup')$$,
  '23514',
  null,
  'un nom portant une balise est refusé par la base, et pas seulement par register-bot'
);
select throws_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('55555555-5555-5555-5555-555555555555', ' Iota',
            'https://iota.example.test/coup')$$,
  '23514',
  null,
  'un nom qui ne commence pas par une lettre ou un chiffre est refusé'
);

select throws_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('55555555-5555-5555-5555-555555555555', 'zETA', 'https://autre.example.test/coup')$$,
  '23505',
  null,
  'le nom d''une IA est unique, à la casse près'
);

select * from finish();
rollback;
