-- Droits de lecture et d'écriture de la plateforme de tournoi.
--
-- Deux étages complémentaires : les `grant` disent quelles colonnes un rôle peut
-- seulement nommer, RLS dit quelles lignes il peut voir. Le secret de signature
-- est retiré au premier étage — RLS, qui ne raisonne que par ligne, ne saurait
-- pas le cacher à un propriétaire qui a le droit de lire sa propre IA.

create or replace function public.est_administrateur()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.administrateurs a
    where a.utilisateur_id = (select auth.uid())
  );
$$;

-- `security definer` : appelée depuis les politiques de `parties` et du journal,
-- où l'appelant n'a aucun droit sur les lignes de `bots` qu'elle consulte.
create or replace function public.possede_bot(bot uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.bots b
    where b.id = bot and b.proprietaire = (select auth.uid())
  );
$$;

grant execute on function public.est_administrateur() to anon, authenticated;
grant execute on function public.possede_bot(uuid) to anon, authenticated;

alter table public.administrateurs enable row level security;
alter table public.bots enable row level security;
alter table public.vagues enable row level security;
alter table public.parties enable row level security;
alter table public.evenements_partie enable row level security;
alter table public.historique_elo enable row level security;

revoke all on public.administrateurs from anon, authenticated;
revoke all on public.bots from anon, authenticated;
revoke all on public.vagues from anon, authenticated;
revoke all on public.parties from anon, authenticated;
revoke all on public.evenements_partie from anon, authenticated;
revoke all on public.historique_elo from anon, authenticated;

-- Toutes les colonnes sauf `secret_signature`, qui n'est montré qu'une fois, à
-- la déclaration, par le service qui vient de le tirer (histoire 14).
-- Conséquence à connaître côté client : un `select *` sur `bots` est refusé,
-- il faut nommer les colonnes voulues.
grant select (
  id, proprietaire, nom, adresse_service, statut, elo, parties_classees,
  vagues_echouees_consecutives, ia_maison, cree_le, modifie_le
) on public.bots to authenticated;
grant insert (nom, adresse_service) on public.bots to authenticated;
-- L'écriture est ouverte sur la table et bornée par le déclencheur des colonnes
-- réservées, seul endroit où cette liste est tenue (20260903120100).
grant update on public.bots to authenticated;

grant select on public.parties to authenticated;
grant select on public.evenements_partie to authenticated;
grant select on public.administrateurs to authenticated;

-- Publiques en lecture, et rien d'autre : le classement s'ouvre sans compte
-- (histoire 16) et affiche le compte à rebours de la prochaine vague ainsi que
-- l'avancement de la vague en cours.
grant select on public.vagues to anon, authenticated;
-- Décision : l'historique d'Elo est public. Il ne contient que des valeurs déjà
-- publiques — Elo, parties classées, bilan victoires/nuls/défaites d'une IA au
-- classement — et c'est de lui que sort l'« écart depuis la vague précédente »
-- qu'exige l'écran public. Il ne porte ni adresse électronique, ni adresse de
-- service : le rendre privé ne protégerait rien et priverait le curieux de la
-- seule série chronologique du tournoi.
grant select on public.historique_elo to anon, authenticated;

drop policy if exists administrateurs_lecture_par_administrateur on public.administrateurs;
drop policy if exists bots_lecture_par_proprietaire on public.bots;
drop policy if exists bots_declaration_par_proprietaire on public.bots;
drop policy if exists bots_modification_par_proprietaire on public.bots;
drop policy if exists parties_lecture_par_participants on public.parties;
drop policy if exists evenements_lecture_par_participants on public.evenements_partie;
drop policy if exists vagues_lecture_publique on public.vagues;
drop policy if exists historique_elo_lecture_publique on public.historique_elo;

create policy administrateurs_lecture_par_administrateur
  on public.administrateurs for select to authenticated
  using (public.est_administrateur());

create policy bots_lecture_par_proprietaire
  on public.bots for select to authenticated
  using (proprietaire = (select auth.uid()) or public.est_administrateur());

create policy bots_declaration_par_proprietaire
  on public.bots for insert to authenticated
  with check (proprietaire = (select auth.uid()));

create policy bots_modification_par_proprietaire
  on public.bots for update to authenticated
  using (proprietaire = (select auth.uid()))
  with check (proprietaire = (select auth.uid()));

-- Une partie a deux propriétaires : celui du bot bleu et celui du bot blanc.
-- Elle n'est visible que d'eux — décision de produit de l'histoire 16 — et de
-- l'administrateur. Aucune écriture cliente : la plateforme seule joue.
create policy parties_lecture_par_participants
  on public.parties for select to authenticated
  using (
    public.possede_bot(bot_bleu)
    or public.possede_bot(bot_blanc)
    or public.est_administrateur()
  );

-- Les mêmes droits que la partie, par jointure : la sous-requête traverse la
-- politique ci-dessus, il n'y a donc pas deux définitions à tenir d'accord.
create policy evenements_lecture_par_participants
  on public.evenements_partie for select to authenticated
  using (
    exists (select 1 from public.parties p where p.id = evenements_partie.partie_id)
  );

create policy vagues_lecture_publique
  on public.vagues for select to anon, authenticated
  using (true);

create policy historique_elo_lecture_publique
  on public.historique_elo for select to anon, authenticated
  using (true);
