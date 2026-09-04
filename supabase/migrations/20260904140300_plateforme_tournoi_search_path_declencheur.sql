-- `proteger_colonnes_reservees_bot` fige son `search_path`.
--
-- Pourquoi. C'était la dernière fonction sensible sans `search_path` figé,
-- alors que toutes les autres — `est_administrateur`, `possede_bot`,
-- `prendre_jeton_appel` — l'ont. Une fonction qui décide d'un droit et laisse
-- son chemin de recherche à l'appelant peut se voir substituer un `now()` ou un
-- `auth.uid()` maison par un schéma temporaire placé en tête.
--
-- Le corps est celui de `20260904130000`, à trois changements près : le
-- `search_path` vide, `pg_catalog.now()` et la qualification explicite de
-- `auth.uid()` — qui l'était déjà. Rien d'autre ne bouge, et
-- `bots_colonnes_reservees_test.sql` rejoue le déclencheur après coup.

create or replace function public.proteger_colonnes_reservees_bot()
returns trigger
language plpgsql
set search_path = ''
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
    new.cree_le := pg_catalog.now();
    new.modifie_le := pg_catalog.now();
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
