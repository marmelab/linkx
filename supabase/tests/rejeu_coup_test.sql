-- L'écriture conditionnelle d'un coup : la protection centrale contre le rejeu.
--
-- Un message de la file peut être joué deux fois — visibilité expirée,
-- invocation morte, empilage de rattrapage. Ce qui empêche alors la partie
-- d'avancer deux fois n'est ni le code de `referee-tick` ni celui de
-- `_shared/gameTick.ts` : c'est le **filtre** de l'`update`, en base. Comparer
-- deux appels d'une fonction pure ne l'exerce pas ; seul ce test le fait.
begin;
select plan(10);

-- Une CTE qui écrit ne peut vivre que tout en haut d'une requête : chaque
-- écriture compte donc ses lignes dans cette table, que les assertions relisent.
create temp table effets (etape text primary key, lignes bigint);

insert into auth.users (id, email)
values ('66666666-6666-6666-6666-666666666666', 'auteur-rejeu@example.test');

insert into public.bots (id, proprietaire, nom, adresse_service, statut) values
  ('66660000-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666',
   'Rejeu-Bleue', 'https://rejeu-bleue.example.test/coup', 'active'),
  ('66660000-0000-0000-0000-000000000002', '66666666-6666-6666-6666-666666666666',
   'Rejeu-Blanche', 'https://rejeu-blanche.example.test/coup', 'active');

insert into public.parties (id, bot_bleu, bot_blanc, notation, nombre_coups, statut)
values ('66660000-0000-0000-0000-0000000000aa',
        '66660000-0000-0000-0000-000000000001',
        '66660000-0000-0000-0000-000000000002',
        '15', 1, 'en_cours');

-- Premier passage : la partie porte bien le coup sur lequel il a décidé.
with maj as (
  update public.parties
  set notation = '15 3Ir13', nombre_coups = 2
  where id = '66660000-0000-0000-0000-0000000000aa'
    and statut <> 'terminee'
    and nombre_coups = 1
  returning 1
)
insert into effets select 'premier', count(*) from maj;

select is(
  (select lignes from effets where etape = 'premier'),
  1::bigint,
  'le premier passage avance la partie'
);

-- Rejeu du même message : il a décidé sur `nombre_coups = 1`, la ligne en porte
-- deux. Le filtre ne correspond plus, et rien n'est touché.
with maj as (
  update public.parties
  set notation = '15 24', nombre_coups = 2
  where id = '66660000-0000-0000-0000-0000000000aa'
    and statut <> 'terminee'
    and nombre_coups = 1
  returning 1
)
insert into effets select 'rejeu', count(*) from maj;

select is(
  (select lignes from effets where etape = 'rejeu'),
  0::bigint,
  'le rejeu du même message ne touche aucune ligne'
);

select is(
  (select notation from public.parties
   where id = '66660000-0000-0000-0000-0000000000aa'),
  '15 3Ir13',
  'la notation reste celle du passage qui a gagné la course'
);
select is(
  (select nombre_coups from public.parties
   where id = '66660000-0000-0000-0000-0000000000aa'),
  2,
  'et le compte de coups avec elle'
);

-- Le journal n'est écrit qu'après une écriture de coup réussie, et son index
-- unique (partie, rang) dédouble encore ce qui passerait deux fois.
insert into public.evenements_partie (partie_id, rang_coup, bot_id, coup)
values ('66660000-0000-0000-0000-0000000000aa', 2,
        '66660000-0000-0000-0000-000000000002', '3Ir13');

with journal as (
  insert into public.evenements_partie (partie_id, rang_coup, bot_id, coup)
  values ('66660000-0000-0000-0000-0000000000aa', 2,
          '66660000-0000-0000-0000-000000000002', '24')
  on conflict (partie_id, rang_coup) do nothing
  returning 1
)
insert into effets select 'journal', count(*) from journal;

select is(
  (select lignes from effets where etape = 'journal'),
  0::bigint,
  'un second journal au même rang n''écrit rien'
);
select is(
  (select coup from public.evenements_partie
   where partie_id = '66660000-0000-0000-0000-0000000000aa' and rang_coup = 2),
  '3Ir13',
  'le journal garde le coup réellement appliqué'
);

-- Clôture : même filtre, plus la partie non terminée.
with maj as (
  update public.parties
  set statut = 'terminee', resultat = 'draw', motif_fin = 'interrupted',
      terminee_le = now()
  where id = '66660000-0000-0000-0000-0000000000aa'
    and statut <> 'terminee'
    and nombre_coups = 2
  returning 1
)
insert into effets select 'cloture', count(*) from maj;

select is(
  (select lignes from effets where etape = 'cloture'),
  1::bigint,
  'la clôture prend sur le compte courant'
);

with maj as (
  update public.parties
  set statut = 'terminee', resultat = 'blue', motif_fin = 'connection',
      terminee_le = now()
  where id = '66660000-0000-0000-0000-0000000000aa'
    and statut <> 'terminee'
    and nombre_coups = 2
  returning 1
)
insert into effets select 'cloture-rejeu', count(*) from maj;

select is(
  (select lignes from effets where etape = 'cloture-rejeu'),
  0::bigint,
  'une partie déjà terminée ne se réécrit pas, même à compte égal'
);
select is(
  (select resultat from public.parties
   where id = '66660000-0000-0000-0000-0000000000aa'),
  'draw',
  'le résultat reste celui de la clôture qui a pris'
);

-- Une notation illisible en base garde un compte de coups vrai : c'est le seul
-- filtre qui reste pour la sortir en nul technique (`interruptMutation`).
insert into public.parties (id, bot_bleu, bot_blanc, notation, nombre_coups, statut)
values ('66660000-0000-0000-0000-0000000000bb',
        '66660000-0000-0000-0000-000000000001',
        '66660000-0000-0000-0000-000000000002',
        'pas-un-coup', 7, 'en_cours');

with maj as (
  update public.parties
  set statut = 'terminee', resultat = 'draw', motif_fin = 'interrupted',
      nombre_coups = 7, terminee_le = now()
  where id = '66660000-0000-0000-0000-0000000000bb'
    and statut <> 'terminee'
    and nombre_coups = 7
  returning 1
)
insert into effets select 'illisible', count(*) from maj;

select is(
  (select lignes from effets where etape = 'illisible'),
  1::bigint,
  'une notation illisible se clôt sur le compte de la ligne, jamais sur zéro'
);

select * from finish();
rollback;
