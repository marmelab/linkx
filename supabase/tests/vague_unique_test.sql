-- Une seule vague par jeudi, et un seul courriel par auteur et par vague.
--
-- L'ordonnanceur est réveillé toutes les minutes de la fenêtre : c'est la base
-- qui doit refuser la deuxième ouverture, pas un « lire puis créer si absent »
-- que deux réveils concurrents traversent tous les deux.
begin;
select plan(4);

insert into auth.users (id, email)
values ('99999999-9999-9999-9999-999999999999', 'auteur-vague@example.test');

-- Minuit à Paris du jeudi 3 septembre 2026, tel que `waveWindow.ts` le calcule.
insert into public.vagues (id, debut, fin, graine)
values ('99990000-0000-0000-0000-00000000000a',
        '2026-09-02 22:00:00+00', '2026-09-03 10:00:00+00', 'graine-1');

select throws_ok(
  $$insert into public.vagues (debut, fin, graine)
    values ('2026-09-02 22:00:00+00', '2026-09-03 10:00:00+00', 'graine-2')$$,
  '23505',
  null,
  'un second réveil ne peut pas ouvrir une deuxième vague le même jeudi'
);

-- Le même instant écrit dans un autre fuseau désigne la même vague.
select throws_ok(
  $$insert into public.vagues (debut, fin, graine)
    values ('2026-09-03 00:00:00+02', '2026-09-03 12:00:00+02', 'graine-3')$$,
  '23505',
  null,
  'l''unicité porte sur l''instant, pas sur son écriture'
);

select lives_ok(
  $$insert into public.vagues (debut, fin, graine)
    values ('2026-09-09 22:00:00+00', '2026-09-10 10:00:00+00', 'graine-4')$$,
  'le jeudi suivant ouvre bien sa propre vague'
);

insert into public.courriels_vague (vague_id, destinataire, contenu)
values ('99990000-0000-0000-0000-00000000000a',
        '99999999-9999-9999-9999-999999999999', '{}'::jsonb);

select throws_ok(
  $$insert into public.courriels_vague (vague_id, destinataire, contenu)
    values ('99990000-0000-0000-0000-00000000000a',
            '99999999-9999-9999-9999-999999999999', '{}'::jsonb)$$,
  '23505',
  null,
  'un auteur ne reçoit qu''un bilan par vague'
);

select * from finish();
rollback;
