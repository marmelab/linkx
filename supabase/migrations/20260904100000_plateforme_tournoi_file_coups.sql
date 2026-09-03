-- File des coups à jouer (histoire 15).
--
-- Un message = **une partie en attente de son prochain coup**. Le message ne
-- porte donc que l'identifiant de la partie : la notation en base fait foi, et
-- c'est elle, relue à chaque dépilage, qui dit à qui l'on doit demander quoi.
--
-- Délais, et pourquoi ceux-là (voir aussi `_shared/tickBudget.ts`, qui les
-- tient côté code) :
--
--   délai d'appel 6 s  <  jeton d'appel 20 s  <  invisibilité d'un message 30 s
--
-- Un coup peut prendre six secondes ; l'invisibilité doit donc les couvrir, et
-- couvrir en plus l'écriture qui suit. Elle doit surtout dépasser la durée du
-- jeton d'appel pris vers l'IA (20 s), sans quoi une seconde invocation
-- reprendrait la partie pendant que la première tient encore son appel.
--
-- **Un message rejoué est sans effet.** Une visibilité qui expire — invocation
-- morte, appel qui traîne — remet le message en circulation, et un empilage de
-- rattrapage peut aussi le doubler. Trois garde-fous, dans cet ordre :
--
--   1. l'écriture du coup est conditionnée à la notation sur laquelle il a été
--      décidé (`expectedNotation`, `_shared/gameTick.ts`) : si un autre passage
--      a déjà avancé la partie, le `update` ne touche aucune ligne ;
--   2. `evenements_partie` porte un index unique sur (partie_id, rang_coup) :
--      le journal ne se dédouble pas davantage ;
--   3. une partie déjà terminée ressort en `settle`, qui réécrit exactement les
--      mêmes colonnes.
--
-- Rejouer un message coûte donc un appel d'IA de plus, jamais un coup de plus.

create extension if not exists pgmq;

-- `pgmq.create` échoue si la file existe : la migration doit pouvoir se rejouer.
do $$
begin
  if to_regclass('pgmq.q_coups_a_jouer') is null then
    perform pgmq.create('coups_a_jouer');
  end if;
end;
$$;

-- Empile une ou plusieurs parties. Le tableau permet d'ouvrir une vague entière
-- en un aller-retour, là où la boucle de `referee-tick` empile à l'unité.
create or replace function public.file_coups_enfiler(
  parties uuid[],
  delai_s integer default 0
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  partie uuid;
  empiles integer := 0;
begin
  foreach partie in array coalesce(parties, '{}'::uuid[]) loop
    perform pgmq.send(
      'coups_a_jouer',
      jsonb_build_object('partie_id', partie),
      delai_s
    );
    empiles := empiles + 1;
  end loop;
  return empiles;
end;
$$;

-- Dépile jusqu'à `nombre` messages et les rend invisibles pour `invisibilite_s`
-- secondes. Deux invocations concurrentes ne voient donc jamais la même partie.
create or replace function public.file_coups_lire(
  nombre integer,
  invisibilite_s integer
)
returns table (msg_id bigint, tentatives integer, partie_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select m.msg_id, m.read_ct, (m.message ->> 'partie_id')::uuid
    from pgmq.read('coups_a_jouer', invisibilite_s, nombre) as m;
end;
$$;

create or replace function public.file_coups_supprimer(msg bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return pgmq.delete('coups_a_jouer', msg);
end;
$$;

-- Rend un message visible dans `delai_s` secondes : c'est ainsi qu'une partie
-- qui vient d'avancer d'un coup revient dans la file pour le suivant, et qu'une
-- partie dont l'IA est déjà à deux appels attend son tour sans être perdue.
create or replace function public.file_coups_replanifier(
  msg bigint,
  delai_s integer default 0
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  touche bigint;
begin
  select m.msg_id into touche
  from pgmq.set_vt('coups_a_jouer', msg, delai_s) as m;
  return touche is not null;
end;
$$;

create or replace function public.file_coups_taille()
returns bigint
language sql
security definer
set search_path = ''
as $$
  select count(*) from pgmq.q_coups_a_jouer;
$$;

-- Seule la plateforme empile et dépile. Un client authentifié n'a rien à y
-- faire : il ne joue pas les parties, il les regarde.
revoke all on function public.file_coups_enfiler(uuid[], integer) from public;
revoke all on function public.file_coups_lire(integer, integer) from public;
revoke all on function public.file_coups_supprimer(bigint) from public;
revoke all on function public.file_coups_replanifier(bigint, integer) from public;
revoke all on function public.file_coups_taille() from public;

grant execute on function public.file_coups_enfiler(uuid[], integer) to service_role;
grant execute on function public.file_coups_lire(integer, integer) to service_role;
grant execute on function public.file_coups_supprimer(bigint) to service_role;
grant execute on function public.file_coups_replanifier(bigint, integer) to service_role;
grant execute on function public.file_coups_taille() to service_role;
