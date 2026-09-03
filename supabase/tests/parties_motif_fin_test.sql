-- Le motif de fin d'une partie parle le vocabulaire du code, et le refus exact
-- rendu par la notation a sa propre colonne (voir _shared/referee.ts).
begin;
select plan(6);

insert into auth.users (id, email)
values ('55555555-5555-5555-5555-555555555555', 'auteur-m@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('f0000000-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   'Motif-Bleu', 'https://motif-bleu.example.test/coup', 'active'),
  ('f0000000-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555',
   'Motif-Blanc', 'https://motif-blanc.example.test/coup', 'active');

insert into public.vagues (id, debut, fin, graine)
values ('f0000000-0000-0000-0000-00000000000a',
        '2026-09-10 00:00+02', '2026-09-10 12:00+02', 'graine-m');

create or replace function pg_temp.creer_partie(
  motif text, refus text, resultat text default 'white'
) returns void language plpgsql as $$
begin
  insert into public.parties
    (vague_id, bot_bleu, bot_blanc, statut, resultat, motif_fin, motif_refus)
  values
    ('f0000000-0000-0000-0000-00000000000a',
     'f0000000-0000-0000-0000-000000000001',
     'f0000000-0000-0000-0000-000000000002',
     'terminee', resultat, motif, refus);
end;
$$;

select lives_ok(
  $$select pg_temp.creer_partie('connection', null)$$,
  'une victoire par connexion est acceptée'
);
select lives_ok(
  $$select pg_temp.creer_partie('unreadable-reply', null)$$,
  'une réponse illisible est un motif de fin à part entière'
);
select lives_ok(
  $$select pg_temp.creer_partie('illegal', 'unsupported')$$,
  'un coup illégal porte le refus exact rendu par la notation'
);

-- Le vocabulaire français de la première migration ne doit plus passer : c'est
-- lui qui aurait imposé une table de correspondance à l'écriture.
select throws_ok(
  $$select pg_temp.creer_partie('hors_delai', null)$$,
  '23514',
  null,
  'l''ancien vocabulaire est refusé'
);
select throws_ok(
  $$select pg_temp.creer_partie('illegal', null)$$,
  '23514',
  null,
  'une défaite sur coup illégal sans refus exact est refusée'
);
select throws_ok(
  $$select pg_temp.creer_partie('connection', 'unsupported')$$,
  '23514',
  null,
  'un refus exact hors d''une défaite sur coup illégal est refusé'
);

select * from finish();
rollback;
