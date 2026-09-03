-- L'avancement d'une vague est tenu par la base (plan.md, histoire 16).
--
-- Le classement est public, `parties` ne l'est pas : la part des parties jouées
-- ne peut venir que de compteurs portés par la vague. Ce qui se vérifie ici est
-- qu'ils suivent, quel que soit le chemin — création, clôture, retour en
-- arrière, suppression — et sans que le code applicatif ait à y penser.
begin;
select plan(8);

insert into auth.users (id, email)
values ('77777777-7777-7777-7777-777777777777', 'auteur-f@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('77770000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'Iota', 'https://iota.example.test/coup', 'active'),
  ('77770000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777',
   'Kappa', 'https://kappa.example.test/coup', 'active');

insert into public.vagues (id, debut, fin, graine)
values ('77770000-0000-0000-0000-00000000000a',
        '2026-09-16 22:00:00+00', '2026-09-17 10:00:00+00', 'graine-avancement');

select is(
  (select parties_totales from public.vagues where id = '77770000-0000-0000-0000-00000000000a'),
  0,
  'une vague ouverte ne compte encore aucune partie'
);

-- L'ordonnanceur crée les parties d'une vague en un seul insert.
insert into public.parties (id, vague_id, bot_bleu, bot_blanc, statut) values
  ('77770000-0000-0000-0000-0000000000b1', '77770000-0000-0000-0000-00000000000a',
   '77770000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-000000000002', 'en_attente'),
  ('77770000-0000-0000-0000-0000000000b2', '77770000-0000-0000-0000-00000000000a',
   '77770000-0000-0000-0000-000000000002', '77770000-0000-0000-0000-000000000001', 'en_attente');

-- Une qualification n'appartient à aucune vague : elle ne doit rien compter.
insert into public.parties (id, vague_id, bot_bleu, bot_blanc, statut)
values ('77770000-0000-0000-0000-0000000000b3', null,
        '77770000-0000-0000-0000-000000000001', '77770000-0000-0000-0000-000000000002',
        'en_attente');

select is(
  (select parties_totales from public.vagues where id = '77770000-0000-0000-0000-00000000000a'),
  2,
  'le total suit la création des parties, qualification exclue'
);
select is(
  (select parties_jouees from public.vagues where id = '77770000-0000-0000-0000-00000000000a'),
  0,
  'aucune n''est encore jouée'
);

-- Un coup joué avance la notation sans rien terminer.
update public.parties
set statut = 'en_cours', notation = '15 3Ir13', nombre_coups = 1
where id = '77770000-0000-0000-0000-0000000000b1';

select is(
  (select parties_jouees from public.vagues where id = '77770000-0000-0000-0000-00000000000a'),
  0,
  'une partie qui avance d''un coup ne compte pas comme jouée'
);

update public.parties
set statut = 'terminee', resultat = 'blue', motif_fin = 'connection', nombre_coups = 21
where id = '77770000-0000-0000-0000-0000000000b1';

select is(
  (select parties_jouees from public.vagues where id = '77770000-0000-0000-0000-00000000000a'),
  1,
  'la clôture d''une partie fait avancer le compteur'
);

-- Clôture de la seconde, y compris le nul technique de fin de vague.
update public.parties
set statut = 'terminee', resultat = 'draw', motif_fin = 'interrupted', nombre_coups = 12
where id = '77770000-0000-0000-0000-0000000000b2';

select is(
  (select parties_jouees || '/' || parties_totales from public.vagues
   where id = '77770000-0000-0000-0000-00000000000a'),
  '2/2',
  'la vague close affiche toutes ses parties jouées'
);

-- Un retour en arrière — une partie rouverte, une partie effacée — ne laisse
-- pas le compteur en avance sur la réalité.
update public.parties
set statut = 'en_cours', resultat = null, motif_fin = null
where id = '77770000-0000-0000-0000-0000000000b2';

select is(
  (select parties_jouees from public.vagues where id = '77770000-0000-0000-0000-00000000000a'),
  1,
  'une partie rouverte redescend le compteur'
);

delete from public.parties where id = '77770000-0000-0000-0000-0000000000b2';

select is(
  (select parties_jouees || '/' || parties_totales from public.vagues
   where id = '77770000-0000-0000-0000-00000000000a'),
  '1/1',
  'une partie effacée sort des deux compteurs'
);

select * from finish();
rollback;
