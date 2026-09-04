-- Les deux unicités que seule la base peut tenir (histoire 15).
--
-- Toutes deux corrigent la même faute entre deux ordonnanceurs qui se
-- recouvrent : lire, conclure qu'il n'y a rien, écrire. Aucune relecture ne la
-- corrige ; ces index-là la corrigent.
begin;
select plan(7);

insert into auth.users (id, email)
values ('44444444-4444-4444-4444-444444444444', 'auteur-unicite@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('44440000-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   'Unicite-Candidate', 'https://unicite-candidate.example.test/coup', 'en_attente'),
  ('44440000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444',
   'Unicite-Maison', 'https://unicite-maison.example.test/coup', 'active'),
  ('44440000-0000-0000-0000-000000000003', '44444444-4444-4444-4444-444444444444',
   'Unicite-Autre', 'https://unicite-autre.example.test/coup', 'en_attente');

-- Une seule qualification ouverte par IA candidate.
insert into public.parties (id, vague_id, bot_bleu, bot_blanc, statut)
values ('44440000-0000-0000-0000-0000000000a1', null,
        '44440000-0000-0000-0000-000000000001',
        '44440000-0000-0000-0000-000000000002', 'en_attente');

select throws_ok(
  $$insert into public.parties (vague_id, bot_bleu, bot_blanc, statut)
    values (null, '44440000-0000-0000-0000-000000000001',
            '44440000-0000-0000-0000-000000000002', 'en_attente')$$,
  '23505',
  null,
  'une deuxième qualification ouverte pour la même IA est refusée'
);

select lives_ok(
  $$insert into public.parties (vague_id, bot_bleu, bot_blanc, statut)
    values (null, '44440000-0000-0000-0000-000000000003',
            '44440000-0000-0000-0000-000000000002', 'en_attente')$$,
  'une autre IA candidate ouvre bien la sienne'
);

update public.parties
set statut = 'terminee', resultat = 'draw', motif_fin = 'draw', terminee_le = now()
where id = '44440000-0000-0000-0000-0000000000a1';

select lives_ok(
  $$insert into public.parties (vague_id, bot_bleu, bot_blanc, statut)
    values (null, '44440000-0000-0000-0000-000000000001',
            '44440000-0000-0000-0000-000000000002', 'en_attente')$$,
  'la tentative terminée libère la place pour une nouvelle'
);

-- Une paire, une ouverture, une couleur : une seule partie par vague. C'est ce
-- qui rend la création des parties d'une vague rejouable.
insert into public.vagues (id, debut, fin, graine, statut)
values ('44440000-0000-0000-0000-0000000000bb',
        '2026-09-10T00:00:00+02', '2026-09-10T12:00:00+02', 'graine-2', 'planifiee');

insert into public.parties (vague_id, bot_bleu, bot_blanc, ouverture, notation, statut)
values ('44440000-0000-0000-0000-0000000000bb',
        '44440000-0000-0000-0000-000000000001',
        '44440000-0000-0000-0000-000000000002', '', '', 'en_attente');

select throws_ok(
  $$insert into public.parties (vague_id, bot_bleu, bot_blanc, ouverture, notation, statut)
    values ('44440000-0000-0000-0000-0000000000bb',
            '44440000-0000-0000-0000-000000000001',
            '44440000-0000-0000-0000-000000000002', '', '', 'en_attente')$$,
  '23505',
  null,
  'la même rencontre à la même ouverture ne se crée pas deux fois'
);

select lives_ok(
  $$insert into public.parties (vague_id, bot_bleu, bot_blanc, ouverture, notation, statut)
    values ('44440000-0000-0000-0000-0000000000bb',
            '44440000-0000-0000-0000-000000000002',
            '44440000-0000-0000-0000-000000000001', '', '', 'en_attente')$$,
  'la même paire dans l''autre couleur reste une autre partie'
);

select lives_ok(
  $$insert into public.parties (vague_id, bot_bleu, bot_blanc, ouverture, notation, statut)
    values ('44440000-0000-0000-0000-0000000000bb',
            '44440000-0000-0000-0000-000000000001',
            '44440000-0000-0000-0000-000000000002', '15', '15', 'en_attente')$$,
  'la même paire sur une autre ouverture imposée aussi'
);

-- Une insertion rejouée est absorbée : c'est ce sur quoi la reprise d'un
-- ouvreur mort en chemin s'appuie.
create temp table effets (etape text primary key, lignes bigint);

with rejeu as (
  insert into public.parties (vague_id, bot_bleu, bot_blanc, ouverture, notation, statut)
  values ('44440000-0000-0000-0000-0000000000bb',
          '44440000-0000-0000-0000-000000000001',
          '44440000-0000-0000-0000-000000000002', '', '', 'en_attente')
  on conflict (vague_id, bot_bleu, bot_blanc, ouverture) do nothing
  returning 1
)
insert into effets select 'rejeu', count(*) from rejeu;

select is(
  (select lignes from effets where etape = 'rejeu'),
  0::bigint,
  'la création d''une vague se rejoue sans dédoubler ses parties'
);

select * from finish();
rollback;
