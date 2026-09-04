-- Le nom d'une IA est public, et lui seul (plan.md, histoire 16).
--
-- « Mes parties » doit nommer l'adversaire, dont la ligne de `bots` est hors de
-- portée. La vue `noms_bots` est la frontière exacte de ce que cela demande :
-- un identifiant et un nom. La preuve tient à ce qu'aucune autre colonne n'y
-- existe — il ne suffit pas d'espérer qu'un `select` les évite.
begin;
select plan(6);

insert into auth.users (id, email)
values ('66666666-6666-6666-6666-666666666666', 'auteur-e@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('66660000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666',
   'Eta', 'https://eta.example.test/coup', 'active'),
  ('66660000-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666',
   'Theta', 'https://theta.example.test/coup', 'retiree');

select columns_are(
  'public', 'noms_bots',
  array['id', 'nom'],
  'la vue publique ne porte que l''identifiant et le nom'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(
  (select nom from public.noms_bots where id = '66660000-0000-0000-0000-000000000001'),
  'Eta',
  'un visiteur anonyme lit le nom d''une IA depuis son identifiant'
);
-- Une partie passée contre une IA retirée reste consultable de son adversaire :
-- elle doit donc rester nommable, là où le classement, lui, la masque.
select is(
  (select nom from public.noms_bots where id = '66660000-0000-0000-0000-000000000002'),
  'Theta',
  'une IA retirée garde son nom, que ses anciens adversaires lisent encore'
);
select is(
  (select count(*) from public.classement where nom = 'Theta'),
  0::bigint,
  'la même IA retirée reste hors du classement'
);
select throws_ok(
  'select * from public.bots',
  '42501',
  null,
  'la table des IA reste, elle, hors de portée d''un visiteur anonyme'
);
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'noms_bots'
      and column_name in ('proprietaire', 'adresse_service', 'secret_signature', 'elo', 'statut')
  ),
  'la vue ne porte ni propriétaire, ni adresse de service, ni secret'
);

reset role;
select * from finish();
rollback;
