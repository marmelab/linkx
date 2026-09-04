-- Une seule vague par jeudi (histoire 15).
--
-- L'ordonnanceur est réveillé toutes les minutes de la fenêtre, et plusieurs
-- réveils peuvent se recouvrir. Aucun « lire puis créer si absent » ne suffit :
-- c'est exactement le point où l'on ouvre douze vagues.
--
-- L'unicité est donc portée par la base. `debut` n'est pas une heure
-- quelconque : c'est l'instant d'ouverture calculé par `_shared/waveWindow.ts`,
-- minuit à Paris du jeudi visé, identique pour tous les réveils de la fenêtre.
-- La deuxième insertion échoue en 23505, et l'ordonnanceur y lit « une autre
-- invocation a déjà ouvert la vague », relit la ligne et passe à la suite.
create unique index if not exists vagues_debut_unique_idx on public.vagues (debut);

comment on column public.vagues.debut is
  'Minuit à Paris du jeudi de la vague. Unique : c''est la clé d''une vague.';

-- Courriels de fin de vague (histoire 15).
--
-- La clôture d'une vague ne fait qu'en **demander** l'envoi : composer et
-- expédier est un autre métier, et une autre fonction (`wave-mail`). Cette
-- table est ce qui garantit qu'un auteur n'est pas servi deux fois — la
-- réservation se prend en posant `envoye_le` sous condition qu'il soit nul, et
-- l'unicité (vague, destinataire) départage deux envois simultanés. `contenu`
-- conserve ce qui est parti.
create table if not exists public.courriels_vague (
  id bigint generated always as identity primary key,
  vague_id uuid not null references public.vagues (id) on delete cascade,
  destinataire uuid not null references auth.users (id) on delete cascade,
  contenu jsonb not null,
  cree_le timestamptz not null default now(),
  envoye_le timestamptz,
  constraint courriels_vague_unique unique (vague_id, destinataire)
);

create index if not exists courriels_vague_a_envoyer_idx
  on public.courriels_vague (cree_le)
  where envoye_le is null;

alter table public.courriels_vague enable row level security;
revoke all on public.courriels_vague from anon, authenticated;

comment on table public.courriels_vague is
  'File des bilans hebdomadaires à envoyer. Écrite à la clôture d''une vague.';
