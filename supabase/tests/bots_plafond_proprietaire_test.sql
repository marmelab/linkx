-- Dix IA en lice par compte, et pas onze.
--
-- Le débit de `register-bot` borne la vitesse des déclarations, pas leur
-- total : sans ce plafond, un compte pouvait peupler la table à loisir, peser
-- sur tous les appariements d'une vague et sur chaque réveil de l'ordonnanceur.
begin;
select plan(4);

insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'auteur-e@example.test'),
  ('77777777-7777-7777-7777-777777777777', 'auteur-f@example.test');

insert into public.bots (proprietaire, nom, adresse_service)
select '66666666-6666-6666-6666-666666666666',
       'Plafond-' || rang,
       'https://plafond' || rang || '.example.test/coup'
from generate_series(1, 10) as rang;

select throws_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('66666666-6666-6666-6666-666666666666', 'Plafond-11',
            'https://plafond11.example.test/coup')$$,
  '23514',
  null,
  'la onzième IA d''un même compte est refusée'
);

select lives_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('77777777-7777-7777-7777-777777777777', 'Voisine',
            'https://voisine.example.test/coup')$$,
  'le plafond est par compte, il n''empêche personne d''autre de déclarer'
);

-- Une IA retirée ne joue plus : elle ne doit pas garder sa place au plafond.
update public.bots set statut = 'retiree'
where proprietaire = '66666666-6666-6666-6666-666666666666' and nom = 'Plafond-1';

select lives_ok(
  $$insert into public.bots (proprietaire, nom, adresse_service)
    values ('66666666-6666-6666-6666-666666666666', 'Plafond-11',
            'https://plafond11.example.test/coup')$$,
  'retirer une IA rend sa place'
);

select is(
  (select count(*) from public.bots
   where proprietaire = '66666666-6666-6666-6666-666666666666'
     and statut <> 'retiree'),
  10::bigint,
  'le compte reste à dix IA en lice'
);

select * from finish();
rollback;
