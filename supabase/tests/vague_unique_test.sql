-- Une seule vague vivante à la fois, et un seul courriel par auteur et par vague.
--
-- L'ordonnanceur est réveillé toutes les minutes : c'est la base qui doit
-- refuser la deuxième ouverture, pas un « lire puis créer si absent » que deux
-- réveils concurrents traversent tous les deux. Une vague étant désormais datée
-- de son ouverture réelle, deux réveils ne partagent plus le même `debut` :
-- c'est la vivacité, et non la date, qui les départage.
begin;
select plan(5);

insert into auth.users (id, email)
values ('99999999-9999-9999-9999-999999999999', 'auteur-vague@example.test');

insert into public.vagues (id, debut, fin, graine)
values ('99990000-0000-0000-0000-00000000000a',
        '2026-09-02 22:00:00+00', '2026-09-03 10:00:00+00', 'graine-1');

select throws_ok(
  $$insert into public.vagues (debut, fin, graine)
    values ('2026-09-02 22:00:10+00', '2026-09-03 10:00:10+00', 'graine-2')$$,
  '23505',
  null,
  'un second réveil ne peut pas ouvrir une vague tant qu''une autre vit'
);

select throws_ok(
  $$insert into public.vagues (debut, fin, graine, statut)
    values ('2026-09-05 08:00:00+00', '2026-09-05 20:00:00+00', 'graine-3', 'en_cours')$$,
  '23505',
  null,
  'une vague à la demande ne double pas davantage celle qui vit déjà'
);

-- Close, la vague ne retient plus rien : c'est ce qui permet d'en lancer une
-- autre le jour même, sans attendre le jeudi suivant.
update public.vagues set statut = 'terminee'
where id = '99990000-0000-0000-0000-00000000000a';

select lives_ok(
  $$insert into public.vagues (debut, fin, graine)
    values ('2026-09-05 08:00:00+00', '2026-09-05 20:00:00+00', 'graine-4')$$,
  'une vague close laisse ouvrir la suivante, le même jour au besoin'
);

select is(
  (select count(*)::int from public.vagues where debut::date = '2026-09-05'),
  1,
  'la vague à la demande porte bien la date de son ouverture'
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
