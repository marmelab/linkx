-- Vagues à la demande : une vague commence quand elle est ouverte.
--
-- Jusqu'ici `debut` valait minuit du jeudi visé, et son index unique servait de
-- garde-fou contre deux réveils concurrents qui auraient ouvert la même vague.
-- Il interdisait aussi, de fait, toute seconde vague dans la semaine : un
-- administrateur ne pouvait pas en lancer une le mardi.
--
-- `debut` porte désormais l'instant réel de l'ouverture, si bien que deux
-- réveils concurrents ne produiraient plus le même `debut` et que l'index ne
-- protégerait plus de rien. Le garde-fou devient ce qu'il aurait toujours dû
-- dire : **une seule vague vivante à la fois**. Il vaut pour le cron du jeudi
-- comme pour l'ouverture à la main.

drop index if exists public.vagues_debut_unique_idx;

create unique index if not exists vagues_vivante_unique_idx
  on public.vagues ((true))
  where statut in ('planifiee', 'en_cours');

comment on index public.vagues_vivante_unique_idx is
  'Une seule vague planifiée ou en cours : deux ouvertures concurrentes se départagent ici.';
