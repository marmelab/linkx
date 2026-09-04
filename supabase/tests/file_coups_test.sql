-- La file des coups : ce qui ne se prouve qu'en base.
--
-- Un message dépilé devient invisible, ce qui est la garantie d'exclusivité
-- entre deux invocations de `referee-tick` ; il redevient jouable sur demande,
-- ce qui est la façon dont une partie enchaîne ses coups.
begin;
select plan(12);

insert into auth.users (id, email)
values ('77777777-7777-7777-7777-777777777777', 'auteur-file@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('77770000-0000-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777',
   'File-Bleue', 'https://file-bleue.example.test/coup', 'active'),
  ('77770000-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777',
   'File-Blanche', 'https://file-blanche.example.test/coup', 'active');

insert into public.parties (id, bot_bleu, bot_blanc)
values ('77770000-0000-0000-0000-0000000000aa',
        '77770000-0000-0000-0000-000000000001',
        '77770000-0000-0000-0000-000000000002');

select is(
  public.file_coups_enfiler(array['77770000-0000-0000-0000-0000000000aa']::uuid[]),
  1,
  'une partie empilée rend un message'
);

create temp table lu as select * from public.file_coups_lire(10, 30);

select is((select count(*) from lu), 1::bigint, 'le message se dépile une fois');
select is(
  (select partie_id from lu),
  '77770000-0000-0000-0000-0000000000aa'::uuid,
  'le message ne porte que la partie : la notation en base fait foi'
);

select is(
  (select count(*) from public.file_coups_lire(10, 30)),
  0::bigint,
  'un message dépilé est invisible : deux invocations ne jouent pas la même partie'
);

-- L'ordonnanceur réempile les parties immobiles. Une partie qui attend son tour
-- derrière une IA saturée ne touche pourtant pas sa ligne : sans savoir ce que
-- la file contient, il lui donnerait un second message, puis un troisième.
-- Un message **invisible** en fait partie : il est en cours de traitement.
select is(
  public.file_coups_parties_en_file(),
  array['77770000-0000-0000-0000-0000000000aa']::uuid[],
  'un message invisible compte comme déjà en file'
);

select ok(
  public.file_coups_replanifier((select msg_id from lu), 0),
  'une partie qui vient d''avancer se remet en file'
);

select is(
  (select count(*) from public.file_coups_lire(10, 30)),
  1::bigint,
  'replanifié à zéro seconde, le message redevient jouable aussitôt'
);

select is(
  public.file_coups_enfiler(array['77770000-0000-0000-0000-0000000000aa']::uuid[]),
  1,
  'un doublon s''empile bel et bien : rien en base ne l''en empêche'
);
select is(
  public.file_coups_parties_en_file(),
  array['77770000-0000-0000-0000-0000000000aa']::uuid[],
  'et la partie n''est nommée qu''une fois, si nombreux que soient ses messages'
);
select is(public.file_coups_taille(), 2::bigint, 'deux messages pour une partie');

select ok(
  public.file_coups_supprimer((select msg_id from lu)),
  'une partie terminée sort de la file'
);

select is(
  public.file_coups_parties_en_file(),
  array['77770000-0000-0000-0000-0000000000aa']::uuid[],
  'son doublon reste, et la partie reste donc en file'
);

select * from finish();
rollback;
