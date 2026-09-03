-- Réveil des deux fonctions d'ordonnancement (histoire 15).
--
-- ## La clé de service n'est pas dans ce fichier
--
-- Une migration est versionnée : y écrire la clé `service_role` reviendrait à
-- la publier. Elle est lue dans le **coffre** (`vault`), où elle est déposée une
-- seule fois, à la main, sur le projet distant :
--
--   select vault.create_secret(
--     'https://<ref>.supabase.co/functions/v1', 'url_fonctions_edge',
--     'Racine des fonctions edge du tournoi');
--   select vault.create_secret(
--     '<clé service_role>', 'cle_service',
--     'Clé de service employée par le cron des vagues');
--
-- Supabase n'offre pas d'autre chemin : les secrets d'un projet ne sont pas
-- accessibles depuis SQL, et `pg_net` a besoin de l'en-tête d'autorisation en
-- clair au moment de l'appel. Tant que ces deux secrets sont absents, la
-- fonction ci-dessous ne fait rien et le dit ; rien n'échoue.
--
-- ## Pourquoi ce calendrier
--
-- Le cron tourne en UTC et la fenêtre est **parisienne** : jeudi 0 h – 12 h,
-- soit mercredi 22 h – jeudi 10 h UTC en été, mercredi 23 h – jeudi 11 h UTC en
-- hiver. Les minutes du jeudi UTC ne couvrent donc pas le début de la vague :
-- il y manque les deux dernières heures du mercredi UTC, c'est-à-dire les deux
-- premières heures de la vague, dont son ouverture à 0 h. D'où deux entrées par
-- fonction. Aucune des deux ne décide de rien : c'est `_shared/waveWindow.ts`
-- qui convertit et qui tranche, et hors fenêtre les fonctions rendent la main
-- sans rien écrire. C'est aussi ce qui les rend inoffensives si le calendrier
-- déborde d'un côté ou de l'autre.
--
-- `net.http_post` est asynchrone : le job rend la main aussitôt, sans attendre
-- la fonction. Deux invocations d'un même tour d'arbitrage se recouvrent donc,
-- et c'est prévu — l'invisibilité des messages et les jetons d'appel en base
-- (20260904100000 et 20260904100100) sont là pour ça.

do $$
begin
  create extension if not exists pg_cron with schema pg_catalog;
exception when others then
  raise notice
    'pg_cron indisponible (%) : programmer les vagues à la main sur ce projet.',
    sqlerrm;
end;
$$;

do $$
begin
  create extension if not exists pg_net;
exception when others then
  raise notice
    'pg_net indisponible (%) : le cron ne pourra pas appeler les fonctions edge.',
    sqlerrm;
end;
$$;

-- Corps résolu à l'exécution : la fonction se crée même là où `net` et `vault`
-- n'existent pas, et se contente alors de ne rien faire.
create or replace function public.appeler_fonction_edge(nom text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  racine text;
  cle text;
  requete bigint;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'Coffre absent : la fonction « % » n''a pas été appelée.', nom;
    return null;
  end if;

  execute $q$
    select
      max(case when name = 'url_fonctions_edge' then decrypted_secret end),
      max(case when name = 'cle_service' then decrypted_secret end)
    from vault.decrypted_secrets
    where name in ('url_fonctions_edge', 'cle_service')
  $q$ into racine, cle;

  if racine is null or cle is null then
    raise notice
      'Secrets « url_fonctions_edge » ou « cle_service » absents : « % » n''a pas été appelée.',
      nom;
    return null;
  end if;

  select net.http_post(
    url := rtrim(racine, '/') || '/' || nom,
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'authorization', 'Bearer ' || cle
    ),
    body := jsonb_build_object('source', 'pg_cron'),
    timeout_milliseconds := 5000
  ) into requete;

  return requete;
end;
$$;

revoke all on function public.appeler_fonction_edge(text) from public;

do $$
declare
  planifie text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron absent : aucune vague ne sera déclenchée toute seule.';
    return;
  end if;

  foreach planifie in array array[
    'vagues-ordonnanceur', 'vagues-ordonnanceur-veille',
    'vagues-arbitre', 'vagues-arbitre-veille'
  ] loop
    if exists (select 1 from cron.job where jobname = planifie) then
      perform cron.unschedule(planifie);
    end if;
  end loop;

  -- Chaque minute du jeudi UTC : le cœur de la fenêtre parisienne.
  perform cron.schedule(
    'vagues-ordonnanceur', '* * * * 4',
    $j$select public.appeler_fonction_edge('scheduler')$j$
  );
  perform cron.schedule(
    'vagues-arbitre', '* * * * 4',
    $j$select public.appeler_fonction_edge('referee-tick')$j$
  );

  -- Les deux dernières heures du mercredi UTC : l'ouverture de la vague, à
  -- minuit à Paris, y tombe été comme hiver.
  perform cron.schedule(
    'vagues-ordonnanceur-veille', '* 22,23 * * 3',
    $j$select public.appeler_fonction_edge('scheduler')$j$
  );
  perform cron.schedule(
    'vagues-arbitre-veille', '* 22,23 * * 3',
    $j$select public.appeler_fonction_edge('referee-tick')$j$
  );
end;
$$;
