-- Aucune écriture cliente sur `bots`, et un plafond d'IA par compte.
--
-- Pourquoi. `20260903120200` accordait `insert (nom, adresse_service)` et
-- `update` à `authenticated`. C'était une porte ouverte sur `/rest/v1/bots` qui
-- **contournait `register-bot`** : ni contrôle d'adresse — https, port par
-- défaut, nom public, résolution hors réseau privé —, ni motif de nom, ni débit.
-- Un compte quelconque pouvait donc déclarer une IA pointant sur le réseau
-- interne de la plateforme, ou en déclarer mille.
--
-- Vérifié avant de retirer ces droits : `src/tournament/api.ts` ne fait que des
-- `select` sur `bots` (`fetchMyBots`), et les deux seules écritures de l'écran
-- « Mes IA » passent par `register-bot` et `update-bot`, qui écrivent à la clé
-- de service. Aucun écran ne perd donc quoi que ce soit.
--
-- Le déclencheur des colonnes réservées (`20260903120100`) **reste** : il ne
-- protège plus rien tant qu'aucun droit d'écriture n'est accordé, mais c'est
-- exactement ce qui doit rester vrai le jour où l'on en rouvrirait un.

revoke insert (nom, adresse_service) on public.bots from authenticated;
revoke insert, update on public.bots from anon, authenticated;

-- Les politiques d'écriture n'ont plus de droit à borner : sans `grant`, elles
-- ne sont jamais consultées. Les laisser laisserait croire l'écriture permise
-- et seulement filtrée, ce qui est la lecture inverse de ce qui est vrai.
drop policy if exists bots_declaration_par_proprietaire on public.bots;
drop policy if exists bots_modification_par_proprietaire on public.bots;

-- Plafond d'IA vivantes par compte.
--
-- Le débit de `register-bot` — deux déclarations par minute — borne la vitesse,
-- pas le total : une nuit suffisait à peupler la table. Or chaque IA en attente
-- coûte à l'ordonnanceur un tour de qualification, et chaque IA active pèse sur
-- tous les appariements de la vague. Dix suffisent à qui compare des versions
-- de son IA.
--
-- Une IA retirée ne compte pas : elle ne joue plus, et son nom reste réservé de
-- toute façon par l'index d'unicité.
create or replace function public.plafonner_bots_par_proprietaire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  vivantes integer;
begin
  select pg_catalog.count(*) into vivantes
  from public.bots b
  where b.proprietaire = new.proprietaire and b.statut <> 'retiree';

  if vivantes >= 10 then
    raise exception
      'plafond de 10 IA en lice par compte atteint : retirez-en une avant d''en déclarer une autre'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Nommé pour passer **après** `bots_proteger_colonnes_reservees`, qui pose le
-- propriétaire d'une insertion cliente, et avant `bots_zz_forcer_plafond_...` :
-- l'ordre des déclencheurs de même moment est alphabétique.
drop trigger if exists bots_z_plafonner_par_proprietaire on public.bots;
create trigger bots_z_plafonner_par_proprietaire
  before insert on public.bots
  for each row execute function public.plafonner_bots_par_proprietaire();
