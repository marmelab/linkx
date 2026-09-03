-- La réponse brute d'un service est bornée en base, pas seulement dans le code
-- qui l'écrit.
begin;
select plan(2);

insert into auth.users (id, email)
values ('66666666-6666-6666-6666-666666666666', 'auteur-e@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service) values
  ('66660000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666',
   'Theta', 'https://theta.example.test/coup'),
  ('66660000-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666',
   'Iota', 'https://iota.example.test/coup');

insert into public.parties (id, bot_bleu, bot_blanc)
values ('66660000-0000-0000-0000-0000000000ff',
        '66660000-0000-0000-0000-000000000001',
        '66660000-0000-0000-0000-000000000002');

insert into public.evenements_partie (partie_id, rang_coup, bot_id, reponse_brute)
values ('66660000-0000-0000-0000-0000000000ff', 0,
        '66660000-0000-0000-0000-000000000001', repeat('x', 5000));

select is(
  (select length(reponse_brute) from public.evenements_partie
   where partie_id = '66660000-0000-0000-0000-0000000000ff'),
  2000,
  'une réponse trop longue est tronquée à 2000 caractères à l''écriture'
);

select throws_ok(
  $$insert into public.evenements_partie (partie_id, rang_coup, bot_id)
    values ('66660000-0000-0000-0000-0000000000ff', 0,
            '66660000-0000-0000-0000-000000000001')$$,
  '23505',
  null,
  'un seul enregistrement par coup demandé'
);

select * from finish();
rollback;
