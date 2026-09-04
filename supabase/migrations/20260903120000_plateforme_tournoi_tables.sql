-- Plateforme de tournoi des IA — tables, contraintes et index.
-- Comportement attendu : plan.md, histoires 14 à 16.

create extension if not exists pgcrypto with schema extensions;

-- Utilisateurs qui voient tout. Une ligne par compte auth.users.
create table if not exists public.administrateurs (
  utilisateur_id uuid primary key references auth.users (id) on delete cascade,
  cree_le timestamptz not null default now()
);

create table if not exists public.bots (
  id uuid primary key default gen_random_uuid(),
  proprietaire uuid not null references auth.users (id) on delete cascade,
  nom text not null,
  adresse_service text not null,
  -- Remis une seule fois à son auteur (histoire 14). Jamais relu par un client :
  -- les droits colonne de 20260903120200 le réservent au service.
  secret_signature text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  statut text not null default 'en_attente',
  elo integer not null default 1200,
  parties_classees integer not null default 0,
  vagues_echouees_consecutives integer not null default 0,
  ia_maison boolean not null default false,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  constraint bots_statut_valide
    check (statut in ('en_attente', 'active', 'sommeil', 'retiree')),
  constraint bots_nom_non_vide check (length(btrim(nom)) between 1 and 64),
  constraint bots_adresse_https check (adresse_service like 'https://%'),
  constraint bots_elo_borne check (elo between 0 and 4000),
  constraint bots_compteurs_positifs
    check (parties_classees >= 0 and vagues_echouees_consecutives >= 0)
);

-- Insensible à la casse : le nom est public, deux noms qui ne diffèrent que par
-- la casse se feraient passer l'un pour l'autre au classement.
create unique index if not exists bots_nom_unique_idx on public.bots (lower(nom));
create index if not exists bots_proprietaire_idx on public.bots (proprietaire);

create table if not exists public.vagues (
  id uuid primary key default gen_random_uuid(),
  debut timestamptz not null,
  fin timestamptz not null,
  -- Le tirage des ouvertures ne dépend que de cette graine et de la paire d'IA :
  -- la conserver suffit à reconstruire la vague à l'identique (histoire 15).
  graine text not null,
  statut text not null default 'planifiee',
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  constraint vagues_statut_valide
    check (statut in ('planifiee', 'en_cours', 'terminee')),
  constraint vagues_fenetre_valide check (fin > debut)
);

create index if not exists vagues_debut_idx on public.vagues (debut desc);

create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  -- Nul pour une partie de qualification, qui n'appartient à aucune vague.
  vague_id uuid references public.vagues (id) on delete restrict,
  -- Notation de l'ouverture imposée ; vide pour une partie à plateau vide.
  ouverture text not null default '',
  bot_bleu uuid not null references public.bots (id) on delete restrict,
  bot_blanc uuid not null references public.bots (id) on delete restrict,
  notation text not null default '',
  statut text not null default 'en_attente',
  resultat text,
  motif_fin text,
  bot_fautif uuid references public.bots (id) on delete restrict,
  nombre_coups integer not null default 0,
  cree_le timestamptz not null default now(),
  modifie_le timestamptz not null default now(),
  terminee_le timestamptz,
  constraint parties_statut_valide
    check (statut in ('en_attente', 'en_cours', 'terminee')),
  constraint parties_adversaires_distincts check (bot_bleu <> bot_blanc),
  constraint parties_resultat_valide
    check (resultat is null or resultat in ('bleu', 'blanc', 'nul')),
  -- Fins de jeu, puis fautes techniques : les sept motifs de refus d'une
  -- notation (plan.md, « Notation d'une partie ») et les trois de l'histoire 14.
  constraint parties_motif_fin_valide check (motif_fin is null or motif_fin in (
    'connexion', 'blocage', 'nul_technique',
    'syntax', 'exhausted', 'horizontal-bounds', 'overflow',
    'unsupported', 'game-over', 'unexpected-pass',
    'hors_delai', 'reponse_illisible', 'erreur_service'
  )),
  -- Une partie terminée porte toujours son résultat, et elle seule.
  constraint parties_resultat_si_terminee
    check ((statut = 'terminee') = (resultat is not null)),
  constraint parties_fautif_est_un_participant
    check (bot_fautif is null or bot_fautif in (bot_bleu, bot_blanc)),
  constraint parties_nombre_coups_positif check (nombre_coups >= 0)
);

create index if not exists parties_bot_bleu_idx on public.parties (bot_bleu, cree_le desc);
create index if not exists parties_bot_blanc_idx on public.parties (bot_blanc, cree_le desc);
create index if not exists parties_vague_idx on public.parties (vague_id);
create index if not exists parties_en_cours_idx
  on public.parties (statut, cree_le)
  where statut <> 'terminee';

-- Journal d'appel : un enregistrement par coup demandé à une IA.
create table if not exists public.evenements_partie (
  id bigint generated always as identity primary key,
  partie_id uuid not null references public.parties (id) on delete cascade,
  rang_coup integer not null,
  bot_id uuid not null references public.bots (id) on delete restrict,
  latence_ms integer,
  statut_http integer,
  coup text,
  erreur text,
  reponse_brute text,
  cree_le timestamptz not null default now(),
  constraint evenements_rang_positif check (rang_coup >= 0),
  constraint evenements_latence_positive check (latence_ms is null or latence_ms >= 0),
  -- Borne de troncature de la réponse brute : le journal sert au débogage,
  -- pas à archiver ce qu'un service mal réglé renvoie. Appliquée avant écriture
  -- par tronquer_reponse_brute(), cette contrainte n'est qu'un garde-fou.
  constraint evenements_reponse_bornee check (length(reponse_brute) <= 2000)
);

create unique index if not exists evenements_partie_rang_idx
  on public.evenements_partie (partie_id, rang_coup);

create table if not exists public.historique_elo (
  id bigint generated always as identity primary key,
  bot_id uuid not null references public.bots (id) on delete cascade,
  vague_id uuid not null references public.vagues (id) on delete cascade,
  elo_avant integer not null,
  elo_apres integer not null,
  ecart integer generated always as (elo_apres - elo_avant) stored,
  victoires integer not null default 0,
  nuls integer not null default 0,
  defaites integer not null default 0,
  cree_le timestamptz not null default now(),
  constraint historique_bilan_positif
    check (victoires >= 0 and nuls >= 0 and defaites >= 0),
  constraint historique_bot_vague_unique unique (bot_id, vague_id)
);

create index if not exists historique_elo_vague_idx on public.historique_elo (vague_id);

create or replace function public.toucher_modifie_le()
returns trigger
language plpgsql
as $$
begin
  new.modifie_le := now();
  return new;
end;
$$;

create or replace function public.tronquer_reponse_brute()
returns trigger
language plpgsql
as $$
begin
  new.reponse_brute := left(new.reponse_brute, 2000);
  return new;
end;
$$;

drop trigger if exists bots_toucher_modifie_le on public.bots;
create trigger bots_toucher_modifie_le
  before update on public.bots
  for each row execute function public.toucher_modifie_le();

drop trigger if exists vagues_toucher_modifie_le on public.vagues;
create trigger vagues_toucher_modifie_le
  before update on public.vagues
  for each row execute function public.toucher_modifie_le();

drop trigger if exists parties_toucher_modifie_le on public.parties;
create trigger parties_toucher_modifie_le
  before update on public.parties
  for each row execute function public.toucher_modifie_le();

drop trigger if exists evenements_tronquer_reponse on public.evenements_partie;
create trigger evenements_tronquer_reponse
  before insert or update on public.evenements_partie
  for each row execute function public.tronquer_reponse_brute();
