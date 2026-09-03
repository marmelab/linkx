-- Jamais plus de deux appels simultanés vers une même IA (histoire 15).
--
-- C'est une promesse faite aux auteurs : personne ne doit avoir à écrire un
-- service concurrent pour participer. Elle doit donc tenir **entre invocations**
-- de `referee-tick`, qui se recouvrent — le cron en lance une par minute et
-- chacune vit cinquante secondes. Une variable d'isolate ne compterait que pour
-- elle-même : le compteur vit en base.
--
-- Un jeton est une ligne, prise avant l'appel et rendue après. Deux garde-fous :
--
--   * un **verrou consultatif de transaction** sur l'identifiant de l'IA
--     sérialise le « compter puis insérer ». Sans lui, deux transactions
--     concurrentes liraient toutes deux « un appel en cours » et en ouvriraient
--     chacune un second, soit trois appels simultanés ;
--   * un jeton **expire**. Une invocation tuée en plein appel ne rend rien ;
--     sans expiration, l'IA resterait bloquée à deux appels fantômes jusqu'à la
--     fin de la vague. La durée couvre le délai de six secondes et l'écriture
--     qui suit, et reste inférieure à l'invisibilité d'un message de la file :
--     un message ne redevient jouable qu'une fois son jeton périmé.

create table if not exists public.appels_bot (
  id bigint generated always as identity primary key,
  bot_id uuid not null references public.bots (id) on delete cascade,
  partie_id uuid references public.parties (id) on delete cascade,
  pris_le timestamptz not null default now(),
  expire_le timestamptz not null
);

create index if not exists appels_bot_actifs_idx
  on public.appels_bot (bot_id, expire_le);

-- Aucune politique, aucun droit : la table n'existe que pour le service, qui
-- écrit avec la clé de service et ne passe donc pas par RLS.
alter table public.appels_bot enable row level security;
revoke all on public.appels_bot from anon, authenticated;

comment on table public.appels_bot is
  'Jetons d''appel en cours vers une IA. Deux au plus par IA, expirés d''office.';

create or replace function public.prendre_jeton_appel(
  bot uuid,
  partie uuid default null,
  duree_s integer default 20
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Décision de conception, pas limite technique : plan.md, histoire 15.
  maximum constant integer := 2;
  actifs integer;
  jeton bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(bot::text, 0)
  );

  delete from public.appels_bot
  where bot_id = bot and expire_le <= pg_catalog.now();

  select pg_catalog.count(*) into actifs
  from public.appels_bot
  where bot_id = bot;

  if actifs >= maximum then
    return null;
  end if;

  insert into public.appels_bot (bot_id, partie_id, expire_le)
  values (
    bot,
    partie,
    pg_catalog.now() + pg_catalog.make_interval(secs => duree_s)
  )
  returning id into jeton;

  return jeton;
end;
$$;

create or replace function public.rendre_jeton_appel(jeton bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  rendu bigint;
begin
  delete from public.appels_bot where id = jeton returning id into rendu;
  return rendu is not null;
end;
$$;

-- Appelée au début d'un tour d'arbitrage : les jetons d'une invocation morte ne
-- doivent pas attendre qu'une autre partie de la même IA vienne les balayer.
create or replace function public.purger_jetons_expires()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  purges integer;
begin
  delete from public.appels_bot where expire_le <= pg_catalog.now();
  get diagnostics purges = row_count;
  return purges;
end;
$$;

create or replace function public.appels_en_cours(bot uuid)
returns integer
language sql
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.appels_bot
  where bot_id = bot and expire_le > pg_catalog.now();
$$;

revoke all on function public.prendre_jeton_appel(uuid, uuid, integer) from public;
revoke all on function public.rendre_jeton_appel(bigint) from public;
revoke all on function public.purger_jetons_expires() from public;
revoke all on function public.appels_en_cours(uuid) from public;

grant execute on function public.prendre_jeton_appel(uuid, uuid, integer) to service_role;
grant execute on function public.rendre_jeton_appel(bigint) to service_role;
grant execute on function public.purger_jetons_expires() to service_role;
grant execute on function public.appels_en_cours(uuid) to service_role;
