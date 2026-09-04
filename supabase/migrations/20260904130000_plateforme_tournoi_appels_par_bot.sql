-- Le plafond d'appels simultanés devient une propriété de l'IA.
--
-- Deux, c'est la promesse faite aux participants : personne ne doit avoir à
-- écrire un service concurrent pour jouer (plan.md, histoire 15). Elle ne
-- change pas.
--
-- Mais l'essai de bout en bout a montré qu'une IA peut avoir besoin de moins,
-- et que la nôtre en fait partie : `bot-linkx` calcule, et l'edge runtime
-- compte deux secondes de processeur **par isolate**, pas par requête. Deux
-- recherches de 700 ms arrivées de front dans le même isolate le dépassent, et
-- le superviseur le tue — 503, donc défaite technique, sur exactement les deux
-- appels que la plateforme s'autorise. Sérialiser les recherches, ce que fait
-- déjà le bot, ne suffit pas : la seconde requête attend, mais son attente est
-- dans le même isolate que le calcul de la première.
--
-- D'où un plafond par IA. Par défaut deux, la promesse tenue pour tout le
-- monde ; un pour l'IA de la maison, dont la contrainte est réelle et mesurée.
-- Une IA tierce lente pourra demander la même chose sans qu'on touche au code.
alter table public.bots
  add column if not exists appels_simultanes_max smallint not null default 2;

alter table public.bots
  add constraint bots_appels_simultanes_plage
    check (appels_simultanes_max between 1 and 2);

comment on column public.bots.appels_simultanes_max is
  'Appels simultanés que la plateforme s''autorise vers cette IA : 2 par défaut, 1 pour une IA qui ne le supporte pas.';

update public.bots set appels_simultanes_max = 1 where ia_maison;

-- Le plafond n'est plus une constante du corps : il se lit sur l'IA, sous le
-- même verrou que le comptage. Le reste de la fonction est inchangé.
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
  maximum integer;
  actifs integer;
  jeton bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(bot::text, 0)
  );

  select b.appels_simultanes_max into maximum
  from public.bots b
  where b.id = bot;

  -- IA inconnue : aucun appel, plutôt qu'un plafond nul silencieux.
  if maximum is null then
    return null;
  end if;

  delete from public.appels_bot
  where bot_id = bot and expire_le <= pg_catalog.now();

  select pg_catalog.count(*) into actifs
  from public.appels_bot
  where bot_id = bot;

  if actifs >= maximum then
    return null;
  end if;

  insert into public.appels_bot (bot_id, partie_id, expire_le)
  values (bot, partie, pg_catalog.now() + pg_catalog.make_interval(secs => duree_s))
  returning id into jeton;

  return jeton;
end;
$$;

-- `appels_simultanes_max` rejoint les colonnes que son propriétaire ne modifie
-- pas : c'est la plateforme qui constate ce qu'une IA supporte, pas son auteur
-- qui le déclare — sans quoi chacun demanderait deux et la mesure ne servirait
-- à rien.
create or replace function public.proteger_colonnes_reservees_bot()
returns trigger
language plpgsql
as $$
declare
  ecriture_de_service constant boolean :=
    current_user in ('postgres', 'supabase_admin', 'service_role');
begin
  if ecriture_de_service then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Un auteur déclare un nom et une adresse ; tout le reste part de zéro,
    -- sans qu'il ait à omettre les colonnes qu'il ne tient pas.
    new.proprietaire := coalesce((select auth.uid()), new.proprietaire);
    new.statut := 'en_attente';
    new.elo := 1200;
    new.parties_classees := 0;
    new.vagues_echouees_consecutives := 0;
    new.ia_maison := false;
    new.appels_simultanes_max := 2;
    new.cree_le := now();
    new.modifie_le := now();
    return new;
  end if;

  if new.id is distinct from old.id
     or new.proprietaire is distinct from old.proprietaire
     or new.secret_signature is distinct from old.secret_signature
     or new.statut is distinct from old.statut
     or new.elo is distinct from old.elo
     or new.parties_classees is distinct from old.parties_classees
     or new.vagues_echouees_consecutives is distinct from old.vagues_echouees_consecutives
     or new.ia_maison is distinct from old.ia_maison
     or new.appels_simultanes_max is distinct from old.appels_simultanes_max
     or new.cree_le is distinct from old.cree_le
  then
    raise exception
      'colonne réservée au service : identité, propriétaire, secret, statut, elo et compteurs ne se modifient pas depuis un client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

-- Le plafond de l'IA de la maison ne se met pas à la main.
--
-- L'`update` ci-dessus ne touche que les lignes existantes ; une IA de la
-- maison créée plus tard repartirait à deux, et c'est précisément le cas
-- courant, puisqu'elle s'amorce à la main sur un projet neuf. La contrainte
-- vaut donc à chaque écriture. Le déclencheur est nommé pour passer **après**
-- `bots_proteger_colonnes_reservees`, l'ordre étant alphabétique : la
-- protection compare d'abord ce qu'un client tente de changer, et la valeur
-- imposée est posée ensuite.
create or replace function public.forcer_plafond_ia_maison()
returns trigger
language plpgsql
as $$
begin
  if new.ia_maison then
    new.appels_simultanes_max := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bots_zz_forcer_plafond_ia_maison on public.bots;
create trigger bots_zz_forcer_plafond_ia_maison
  before insert or update on public.bots
  for each row execute function public.forcer_plafond_ia_maison();
