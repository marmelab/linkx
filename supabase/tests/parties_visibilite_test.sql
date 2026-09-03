-- Une partie a deux propriétaires ; elle n'est visible que d'eux et des
-- administrateurs, journal d'appel compris (plan.md, histoire 16).
begin;
select plan(11);

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'auteur-a@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'auteur-b@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'admin@example.test');

insert into public.administrateurs (utilisateur_id)
values ('33333333-3333-3333-3333-333333333333');

insert into public.bots (id, proprietaire, nom, adresse_service, statut, ia_maison) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111',
   'Alpha', 'https://alpha.example.test/coup', 'active', false),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222',
   'Beta', 'https://beta.example.test/coup', 'active', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333',
   'Maison', 'https://maison.example.test/coup', 'active', true);

insert into public.vagues (id, debut, fin, graine, statut) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd',
   '2026-09-03 00:00+02', '2026-09-03 12:00+02', 'graine-1', 'terminee');

-- Alpha tient les bleus dans l'une, les blancs dans l'autre ; Beta ne joue que
-- la troisième.
insert into public.parties (id, vague_id, bot_bleu, bot_blanc, statut, resultat, motif_fin, nombre_coups) values
  ('e0000000-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'terminee', 'blue', 'connection', 21),
  ('e0000000-0000-0000-0000-000000000002', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
   'terminee', 'draw', 'stalemate', 40),
  ('e0000000-0000-0000-0000-000000000003', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc',
   'terminee', 'white', 'timeout', 14);

insert into public.evenements_partie (partie_id, rang_coup, bot_id, latence_ms, statut_http, coup) values
  ('e0000000-0000-0000-0000-000000000001', 0, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 120, 200, '3Ir13'),
  ('e0000000-0000-0000-0000-000000000002', 0, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 90, 200, '4Lsr27'),
  ('e0000000-0000-0000-0000-000000000003', 0, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 6100, 504, null);

-- Le propriétaire d'Alpha.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.parties),
  2::bigint,
  'le propriétaire voit ses deux parties, qu''il tienne les bleus ou les blancs'
);
select is(
  (select count(*) from public.parties where bot_bleu = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'la partie où il tient les bleus est visible'
);
select is(
  (select count(*) from public.parties where bot_blanc = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  1::bigint,
  'la partie où il tient les blancs est visible'
);
select is(
  (select count(*) from public.evenements_partie),
  2::bigint,
  'le journal suit les droits de la partie dont il dépend'
);
select is(
  (select count(*) from public.bots),
  1::bigint,
  'il ne voit que sa propre IA'
);

-- Un tiers : propriétaire de Beta, étranger aux deux premières parties.
select set_config(
  'request.jwt.claims',
  '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.parties
   where id in ('e0000000-0000-0000-0000-000000000001',
                'e0000000-0000-0000-0000-000000000002')),
  0::bigint,
  'un tiers ne voit aucune des parties d''Alpha'
);
select is(
  (select count(*) from public.evenements_partie
   where partie_id in ('e0000000-0000-0000-0000-000000000001',
                       'e0000000-0000-0000-0000-000000000002')),
  0::bigint,
  'un tiers ne voit pas le journal de ces parties'
);
select is(
  (select count(*) from public.parties),
  1::bigint,
  'un tiers ne voit que la partie de sa propre IA'
);
select throws_ok(
  $$insert into public.parties (bot_bleu, bot_blanc)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc')$$,
  '42501',
  null,
  'aucune écriture cliente sur les parties'
);

-- L'administrateur.
select set_config(
  'request.jwt.claims',
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}',
  true
);

select is(
  (select count(*) from public.parties),
  3::bigint,
  'un administrateur voit toutes les parties'
);
select is(
  (select count(*) from public.evenements_partie),
  3::bigint,
  'un administrateur voit tout le journal'
);

reset role;
select * from finish();
rollback;
