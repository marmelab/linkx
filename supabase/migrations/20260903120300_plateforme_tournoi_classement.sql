-- Classement public (histoire 16) : consultable sans compte.
--
-- `security_invoker = false`, donc « definer » : une vue en invoker hériterait
-- des politiques de `bots`, qui ne rendent rien à un visiteur anonyme, et le
-- classement serait vide pour son premier public. La contrepartie est que cette
-- vue doit être lue comme une frontière : tout ce qu'elle nomme devient public.
-- Elle ne nomme donc que les cinq colonnes de l'écran — jamais le propriétaire,
-- jamais l'adresse du service, jamais le secret — et pas même l'identifiant de
-- l'IA, qui n'y sert à rien.
create or replace view public.classement
with (security_invoker = false, security_barrier = true)
as
select
  rank() over (order by b.elo desc, b.parties_classees desc, lower(b.nom)) as rang,
  b.nom,
  b.elo,
  b.parties_classees,
  b.statut
from public.bots b
-- Une IA retirée sort des appariements et du classement ; ses parties passées
-- restent, et les classements déjà calculés ne sont pas récrits.
where b.statut <> 'retiree';

revoke all on public.classement from anon, authenticated;
grant select on public.classement to anon, authenticated;

comment on view public.classement is
  'Classement public des IA : rang, nom, Elo, parties classées, statut. Aucune donnée privée.';
