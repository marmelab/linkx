-- Les fonctions de service ne s'exécutent plus qu'avec la clé de service.
--
-- Pourquoi. Supabase accorde par défaut `execute` à `anon` et `authenticated`
-- sur toute fonction que `postgres` crée dans `public`. Les migrations
-- précédentes n'en retiraient que `public` : ces droits directs survivaient, et
-- la clé anon du bundle suffisait à clore une vague avec un classement inventé,
-- à confisquer les jetons d'appel d'une IA ou à vider la file des coups par
-- `/rest/v1/rpc/*`. Le cron n'est pas concerné : il tourne en `postgres`,
-- propriétaire de ces fonctions.

revoke execute on function
  public.clore_vague(uuid, jsonb),
  public.ouvrir_vague(uuid),
  public.file_coups_enfiler(uuid[], integer),
  public.file_coups_lire(integer, integer),
  public.file_coups_supprimer(bigint),
  public.file_coups_replanifier(bigint, integer),
  public.file_coups_taille(),
  public.file_coups_parties_en_file(),
  public.prendre_jeton_appel(uuid, uuid, integer),
  public.rendre_jeton_appel(bigint),
  public.purger_jetons_expires(),
  public.appels_en_cours(uuid),
  public.appeler_fonction_edge(text)
from public, anon, authenticated;

-- Une fonction à venir naît fermée aux clients : l'ouvrir se fait par un
-- `grant` explicite, comme pour `est_administrateur` et `possede_bot`.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- `nom` était concaténé tel quel à l'adresse des fonctions edge, qui part avec
-- la clé de service : seules les fonctions réveillées par le cron passent.
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
  if nom is null or nom not in ('scheduler', 'referee-tick') then
    raise exception 'Fonction edge non réveillable par le cron : « % ».', nom;
  end if;

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
