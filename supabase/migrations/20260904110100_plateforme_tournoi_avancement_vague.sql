-- Avancement d'une vague : « la part des parties jouées » (histoire 16).
--
-- Le classement est public et `parties` ne l'est pas — une partie n'est visible
-- que de ses deux participants. Le décompte ne peut donc pas se calculer à la
-- lecture : il doit être **porté par la vague**, qui, elle, est publique.
--
-- Tenu par la base, et non par le code applicatif. Trois fonctions edge créent
-- ou closent des parties (`scheduler` à l'ouverture et à la clôture,
-- `referee-tick` à chaque coup) ; un compteur qu'elles devraient toutes penser
-- à mettre à jour dériverait au premier chemin oublié. Le déclencheur, lui, ne
-- peut pas être contourné : la partie n'existe pas sans lui.
--
-- Les qualifications n'appartiennent à aucune vague (`vague_id` nul) et ne
-- comptent donc nulle part, ce qui est le bon comportement : l'avancement
-- affiché est celui des rencontres de la vague.

alter table public.vagues
  add column if not exists parties_totales integer not null default 0,
  add column if not exists parties_jouees integer not null default 0;

alter table public.vagues
  drop constraint if exists vagues_compteurs_coherents;

alter table public.vagues
  add constraint vagues_compteurs_coherents
    check (parties_jouees between 0 and parties_totales);

comment on column public.vagues.parties_totales is
  'Parties créées pour cette vague. Tenu par le déclencheur parties_compter_dans_la_vague.';
comment on column public.vagues.parties_jouees is
  'Parties terminées de cette vague. Même déclencheur ; leur rapport est l''avancement affiché.';

-- `security definer` : la vague est comptée quel que soit le rôle qui écrit la
-- partie, sans lui donner par ailleurs le droit de toucher à `vagues`.
create or replace function public.compter_parties_de_la_vague()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Une partie avance à chaque coup : sans ce filtre, chaque écriture de la
  -- notation viendrait verrouiller la ligne de la vague, que les vingt parties
  -- en cours se disputeraient.
  if tg_op = 'UPDATE'
     and new.vague_id is not distinct from old.vague_id
     and (new.statut = 'terminee') = (old.statut = 'terminee')
  then
    return null;
  end if;

  -- Retrancher l'ancien état puis ajouter le nouveau : le changement de vague,
  -- la clôture, la réouverture et la suppression se traitent alors du même
  -- geste, sans énumérer les cas.
  if tg_op in ('UPDATE', 'DELETE') and old.vague_id is not null then
    update public.vagues
    set parties_totales = parties_totales - 1,
        parties_jouees = parties_jouees
          - (case when old.statut = 'terminee' then 1 else 0 end)
    where id = old.vague_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') and new.vague_id is not null then
    update public.vagues
    set parties_totales = parties_totales + 1,
        parties_jouees = parties_jouees
          + (case when new.statut = 'terminee' then 1 else 0 end)
    where id = new.vague_id;
  end if;

  return null;
end;
$$;

drop trigger if exists parties_compter_dans_la_vague on public.parties;
-- `update of` borne le réveil aux deux colonnes qui comptent ; le filtre du
-- corps rattrape les écritures qui les mentionnent sans les changer.
create trigger parties_compter_dans_la_vague
  after insert or delete or update of vague_id, statut on public.parties
  for each row execute function public.compter_parties_de_la_vague();

-- Reprise des vagues déjà en base : le déclencheur ne compte que ce qui passe
-- après lui.
update public.vagues v
set parties_totales = coalesce(compte.totales, 0),
    parties_jouees = coalesce(compte.jouees, 0)
from (
  select
    v2.id,
    count(p.id) as totales,
    count(p.id) filter (where p.statut = 'terminee') as jouees
  from public.vagues v2
  left join public.parties p on p.vague_id = v2.id
  group by v2.id
) compte
where compte.id = v.id
  and (v.parties_totales, v.parties_jouees)
      is distinct from (coalesce(compte.totales, 0)::integer, coalesce(compte.jouees, 0)::integer);
