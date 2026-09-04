-- Ouverture et clôture d'une vague : ce qui doit être atomique (histoire 15).
--
-- La clôture réclamait la vague avant d'écrire les Elo, en trois aller-retours.
-- Une invocation morte au milieu laissait une vague close, aucun classement
-- appliqué, et plus rien pour réessayer. Réclamation et écritures sont
-- désormais la même transaction : `clore_vague`.
begin;
select plan(12);

insert into auth.users (id, email)
values ('55555555-5555-5555-5555-555555555555', 'auteur-cloture@example.test');

insert into public.bots
  (id, proprietaire, nom, adresse_service, statut, elo, parties_classees,
   vagues_echouees_consecutives)
values
  ('55550000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   'Cloture-A', 'https://cloture-a.example.test/coup', 'active', 1200, 10, 0),
  ('55550000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555',
   'Cloture-B', 'https://cloture-b.example.test/coup', 'active', 1200, 10, 2);

insert into public.vagues (id, debut, fin, graine, statut)
values ('55550000-0000-0000-0000-0000000000aa',
        '2026-09-03T00:00:00+02', '2026-09-03T12:00:00+02', 'graine-1', 'planifiee');

-- Une vague planifiée n'est pas close : ses rencontres n'existent pas encore.
select is(
  public.clore_vague('55550000-0000-0000-0000-0000000000aa', '[]'::jsonb) ->> 'reclamee',
  'false',
  'une vague planifiee ne se clôt pas'
);
select is(
  (select statut from public.vagues where id = '55550000-0000-0000-0000-0000000000aa'),
  'planifiee',
  'et son statut n''a pas bougé'
);

select ok(
  public.ouvrir_vague('55550000-0000-0000-0000-0000000000aa'),
  'ses parties créées, la vague passe en_cours'
);
select ok(
  not public.ouvrir_vague('55550000-0000-0000-0000-0000000000aa'),
  'une vague déjà ouverte ne se rouvre pas'
);

-- Clôture réelle : réclamation, historique et classements, tout d'un coup.
select is(
  public.clore_vague(
    '55550000-0000-0000-0000-0000000000aa',
    '[
      {"bot_id": "55550000-0000-0000-0000-000000000001", "elo_avant": 1200,
       "elo_apres": 1216, "victoires": 3, "nuls": 1, "defaites": 0,
       "parties_classees": 14, "vagues_echouees_consecutives": 0,
       "endormie": false},
      {"bot_id": "55550000-0000-0000-0000-000000000002", "elo_avant": 1200,
       "elo_apres": 1184, "victoires": 0, "nuls": 1, "defaites": 3,
       "parties_classees": 14, "vagues_echouees_consecutives": 3,
       "endormie": true}
    ]'::jsonb
  ) ->> 'reclamee',
  'true',
  'la vague en cours est réclamée'
);

select is(
  (select statut from public.vagues where id = '55550000-0000-0000-0000-0000000000aa'),
  'terminee',
  'la vague est close'
);
select is(
  (select count(*) from public.historique_elo
   where vague_id = '55550000-0000-0000-0000-0000000000aa'),
  2::bigint,
  'l''historique d''Elo est écrit dans la même transaction'
);
select is(
  (select elo from public.bots where id = '55550000-0000-0000-0000-000000000001'),
  1216,
  'le classement de chaque IA est appliqué'
);
select is(
  (select statut from public.bots where id = '55550000-0000-0000-0000-000000000002'),
  'sommeil',
  'une IA au bout de ses trois vagues ratées s''endort'
);
select is(
  (select statut from public.bots where id = '55550000-0000-0000-0000-000000000001'),
  'active',
  'les autres gardent leur statut'
);

-- Deux réveils concurrents : le second ne réclame rien et n'écrit rien.
select is(
  public.clore_vague(
    '55550000-0000-0000-0000-0000000000aa',
    '[{"bot_id": "55550000-0000-0000-0000-000000000001", "elo_avant": 1216,
       "elo_apres": 1300, "victoires": 9, "nuls": 0, "defaites": 0,
       "parties_classees": 23, "vagues_echouees_consecutives": 0,
       "endormie": false}]'::jsonb
  ) ->> 'reclamee',
  'false',
  'une vague déjà close n''est pas réclamée deux fois'
);
select is(
  (select elo from public.bots where id = '55550000-0000-0000-0000-000000000001'),
  1216,
  'et le second calcul n''écrase pas le classement du premier'
);

select * from finish();
rollback;
