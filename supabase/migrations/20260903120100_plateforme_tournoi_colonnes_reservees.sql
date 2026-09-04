-- Colonnes de `bots` que seul le service écrit.
--
-- La clé de service contourne RLS, mais RLS ne raisonne que par ligne : un
-- propriétaire a le droit de modifier sa ligne, donc rien n'empêcherait à ce
-- niveau qu'il s'attribue 3000 d'Elo ou se déclare `active` sans qualification.
-- Le garde est donc un déclencheur, qui refuse toute écriture cliente sur les
-- colonnes tenues par la plateforme, quel que soit le chemin emprunté.
-- Retrait et réactivation d'une IA (histoires 14 et 16) passent par le service,
-- pas par un `update` direct du statut.

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
     or new.cree_le is distinct from old.cree_le
  then
    raise exception
      'colonne réservée au service : identité, propriétaire, secret, statut, elo et compteurs ne se modifient pas depuis un client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists bots_proteger_colonnes_reservees on public.bots;
-- Nommé pour passer avant `bots_toucher_modifie_le`, les déclencheurs de même
-- moment s'exécutant dans l'ordre alphabétique.
create trigger bots_proteger_colonnes_reservees
  before insert or update on public.bots
  for each row execute function public.proteger_colonnes_reservees_bot();
