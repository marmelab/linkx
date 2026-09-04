-- Clôture d'une vague, en une seule transaction (histoire 15).
--
-- La clôture réclamait la vague — `statut` passé à `terminee` — **avant**
-- d'écrire l'historique d'Elo et les classements, en trois aller-retours
-- PostgREST distincts. Une invocation qui meurt entre les deux laisse une vague
-- close sans aucun Elo appliqué, sans courriel, et sans chemin de reprise : la
-- réclamation étant conditionnée à `en_cours`, la clôture n'est plus jamais
-- retentée et le classement de la semaine est perdu.
--
-- La réclamation et les écritures qu'elle autorise appartiennent donc à la même
-- transaction, c'est-à-dire à une fonction SQL. L'ordonnanceur calcule toujours
-- le classement — c'est du domaine pur, `_shared/wavePlan.ts` — et le passe ici
-- tout fait ; cette fonction n'en décide rien, elle l'écrit ou ne l'écrit pas.
--
-- `classements` est un tableau d'objets, un par IA, aux noms des colonnes :
--   bot_id, elo_avant, elo_apres, victoires, nuls, defaites,
--   parties_classees, vagues_echouees_consecutives, endormie
--
-- Le statut `en_cours` est exigé : une vague `planifiee` est une vague dont les
-- parties sont encore en train d'être créées, et la clore reviendrait à la vider
-- de rencontres qui n'existent pas encore.
create or replace function public.clore_vague(
  vague uuid,
  classements jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  reclamee uuid;
  classees integer;
begin
  update public.vagues
  set statut = 'terminee'
  where id = vague and statut = 'en_cours'
  returning id into reclamee;

  if reclamee is null then
    return jsonb_build_object('reclamee', false, 'classees', 0);
  end if;

  insert into public.historique_elo (
    bot_id, vague_id, elo_avant, elo_apres, victoires, nuls, defaites
  )
  select
    (c ->> 'bot_id')::uuid,
    vague,
    (c ->> 'elo_avant')::integer,
    (c ->> 'elo_apres')::integer,
    (c ->> 'victoires')::integer,
    (c ->> 'nuls')::integer,
    (c ->> 'defaites')::integer
  from jsonb_array_elements(coalesce(classements, '[]'::jsonb)) as c
  on conflict (bot_id, vague_id) do nothing;

  -- Une IA endormie sort des appariements ; les autres gardent leur statut.
  update public.bots as b
  set
    elo = (c ->> 'elo_apres')::integer,
    parties_classees = (c ->> 'parties_classees')::integer,
    vagues_echouees_consecutives = (c ->> 'vagues_echouees_consecutives')::integer,
    statut = case
      when (c ->> 'endormie')::boolean then 'sommeil'
      else b.statut
    end
  from jsonb_array_elements(coalesce(classements, '[]'::jsonb)) as c
  where b.id = (c ->> 'bot_id')::uuid;

  get diagnostics classees = row_count;
  return jsonb_build_object('reclamee', true, 'classees', classees);
end;
$$;

revoke all on function public.clore_vague(uuid, jsonb) from public;
grant execute on function public.clore_vague(uuid, jsonb) to service_role;

comment on function public.clore_vague(uuid, jsonb) is
  'Réclame une vague en_cours et écrit son classement, tout ou rien.';

-- Ouverture d'une vague, en deux temps (histoire 15).
--
-- Deux réveils qui se recouvrent pouvaient clore une vague à vide : A crée la
-- vague et commence à insérer ses 192 parties ; B, lancé pendant ce temps, ne la
-- crée pas, appelle la clôture, ne voit aucune partie, en conclut que tout est
-- fini et réclame la vague. Les parties de A naissaient alors sous une vague
-- déjà close.
--
-- Une vague naît donc `planifiee` — le statut existe déjà au schéma — et ne
-- passe `en_cours` qu'une fois ses parties créées. B, qui voit `planifiee`,
-- n'a rien à clore.
create or replace function public.ouvrir_vague(vague uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ouverte uuid;
begin
  update public.vagues
  set statut = 'en_cours'
  where id = vague and statut = 'planifiee'
  returning id into ouverte;
  return ouverte is not null;
end;
$$;

revoke all on function public.ouvrir_vague(uuid) from public;
grant execute on function public.ouvrir_vague(uuid) to service_role;

comment on function public.ouvrir_vague(uuid) is
  'Passe une vague planifiee à en_cours, une fois ses parties créées.';
