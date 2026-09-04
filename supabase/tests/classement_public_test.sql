-- Le classement s'ouvre sans compte, et il est tout ce qu'un visiteur anonyme
-- atteint (plan.md, histoire 16).
begin;
select plan(12);

insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'auteur-c@example.test');

insert into public.bots (proprietaire, nom, adresse_service, statut, elo, parties_classees) values
  ('44444444-4444-4444-4444-444444444444', 'Gamma', 'https://gamma.example.test/coup', 'active', 1450, 120),
  ('44444444-4444-4444-4444-444444444444', 'Delta', 'https://delta.example.test/coup', 'sommeil', 1310, 80),
  ('44444444-4444-4444-4444-444444444444', 'Epsilon', 'https://epsilon.example.test/coup', 'retiree', 1500, 60);

insert into public.vagues (debut, fin, graine)
values ('2026-09-10 00:00+02', '2026-09-10 12:00+02', 'graine-2');

-- Gamma a joué la vague, Delta non : l'écart est renseigné pour l'une et
-- inconnu pour l'autre, ce qui doit la laisser au classement malgré tout.
insert into public.historique_elo (bot_id, vague_id, elo_avant, elo_apres, victoires, nuls, defaites)
select b.id, v.id, 1420, 1450, 9, 1, 4
from public.bots b, public.vagues v
where b.nom = 'Gamma';

select columns_are(
  'public', 'classement',
  array['rang', 'nom', 'elo', 'parties_classees', 'statut', 'ecart_derniere_vague'],
  'le classement n''expose que rang, nom, Elo, parties classées, statut et écart'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(
  (select count(*) from public.classement),
  2::bigint,
  'un visiteur anonyme lit le classement, IA retirée exclue'
);
select is(
  (select nom from public.classement where rang = 1),
  'Gamma',
  'le rang suit l''Elo décroissant'
);
select is(
  (select statut from public.classement where nom = 'Delta'),
  'sommeil',
  'le statut d''une IA en sommeil est rendu'
);
select is(
  (select ecart_derniere_vague from public.classement where nom = 'Gamma'),
  30,
  'le classement porte l''écart de la dernière vague, sans clé de jointure à publier'
);
select is(
  (select ecart_derniere_vague from public.classement where nom = 'Delta'),
  null::integer,
  'une IA qui n''a joué aucune vague reste au classement, écart inconnu'
);
select throws_ok(
  'select * from public.bots',
  '42501',
  null,
  'un visiteur anonyme n''atteint pas la table des IA'
);
select throws_ok(
  'select * from public.parties',
  '42501',
  null,
  'un visiteur anonyme n''atteint aucune partie'
);
select throws_ok(
  'select * from public.evenements_partie',
  '42501',
  null,
  'un visiteur anonyme n''atteint aucun journal'
);
select throws_ok(
  'select * from public.administrateurs',
  '42501',
  null,
  'un visiteur anonyme n''atteint pas la liste des administrateurs'
);
select ok(
  (select count(*) from public.vagues) >= 1,
  'les vagues restent publiques : le compte à rebours et l''avancement le sont'
);
-- La preuve tient à ce qu'aucune de ces colonnes n'existe dans la vue : nul
-- besoin d'espérer qu'un `select` les évite.
select ok(
  not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'classement'
      and column_name in ('email', 'proprietaire', 'adresse_service', 'secret_signature')
  ),
  'le classement ne porte ni email, ni adresse de service, ni secret'
);

reset role;
select * from finish();
rollback;
