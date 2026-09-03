-- Nom d'une IA, associé à son identifiant, lisible sans compte.
--
-- Pourquoi. « Mes parties » (histoire 16) doit nommer l'adversaire. Or `bots`
-- n'est lisible que de son propriétaire, et `classement` ne porte aucune clé de
-- jointure : la ligne de partie donne bien `bot_blanc`, mais rien ne permettait
-- d'en tirer un nom, et l'écran écrivait « non divulgué » — c'est-à-dire moins
-- que ce que le classement public affiche déjà de cette IA.
--
-- Ce que la vue expose : **deux colonnes, l'identifiant et le nom.** Jamais le
-- propriétaire, jamais l'adresse du service, jamais le secret de signature.
--
-- Ce que l'identifiant permet à un tiers, puisqu'il devient public à son tour :
--
--   * joindre `historique_elo`, déjà public, à un nom — donc lire la série
--     hebdomadaire d'une IA nommée : Elo avant, Elo après, victoires, nuls,
--     défaites. Le classement en publie déjà l'état courant et l'écart de la
--     dernière vague ; c'est la même matière, en plus long ;
--   * énumérer les IA, **retirées comprises**, là où le classement les masque.
--     C'est nécessaire, et non un effet de bord : une partie passée contre une
--     IA retirée reste consultable de son adversaire, et doit rester nommée.
--     Le nom d'une IA retirée a de toute façon été public tant qu'elle jouait.
--
-- Ce qu'il ne permet pas : rien de plus. Ce n'est pas une capacité, seulement
-- une clé primaire tirée au hasard. Les politiques de `bots`, `parties` et
-- `evenements_partie` vérifient toutes le propriétaire ou la participation, pas
-- la connaissance d'un identifiant.
--
-- `security_invoker = false`, comme `classement` : une vue en invoker hériterait
-- des politiques de `bots` et ne rendrait rien à un visiteur anonyme. Elle se
-- lit donc comme une frontière, et ne nomme que ces deux colonnes.
create or replace view public.noms_bots
with (security_invoker = false, security_barrier = true)
as
select b.id, b.nom
from public.bots b;

revoke all on public.noms_bots from anon, authenticated;
grant select on public.noms_bots to anon, authenticated;

comment on view public.noms_bots is
  'Identifiant et nom des IA, et rien d''autre. Publique : c''est de là que « Mes parties » tire le nom de l''adversaire.';
