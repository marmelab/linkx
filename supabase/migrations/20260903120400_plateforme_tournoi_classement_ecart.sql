-- L'histoire 16 demande que le classement public affiche, à côté de l'Elo,
-- « l'écart depuis la vague précédente avec son signe écrit ».
--
-- La vue ne nommait pas l'identifiant de l'IA, pour ne rien exposer d'inutile.
-- Un visiteur anonyme ne pouvait donc pas retrouver la ligne correspondante
-- dans `historique_elo` : il lui manquait la clé de jointure. Plutôt que de
-- publier cette clé — qui n'a d'usage pour personne d'autre —, la vue porte
-- désormais l'écart lui-même. Rien de nouveau n'est divulgué : `historique_elo`
-- est déjà lisible sans compte, ne contenant que des valeurs publiques.
--
-- `create or replace view` n'autorise l'ajout d'une colonne qu'en fin de liste :
-- les cinq premières sont donc reprises à l'identique, dans le même ordre.
create or replace view public.classement
with (security_invoker = false, security_barrier = true)
as
select
  rank() over (order by b.elo desc, b.parties_classees desc, lower(b.nom)) as rang,
  b.nom,
  b.elo,
  b.parties_classees,
  b.statut,
  derniere.ecart as ecart_derniere_vague
from public.bots b
-- `left join lateral` et non un agrégat : une IA qui n'a encore joué aucune
-- vague garde sa ligne au classement, avec un écart nul au sens de « inconnu ».
left join lateral (
  select h.ecart
  from public.historique_elo h
  where h.bot_id = b.id
  order by h.cree_le desc, h.id desc
  limit 1
) derniere on true
where b.statut <> 'retiree';

comment on view public.classement is
  'Classement public des IA : rang, nom, Elo, parties classées, statut, écart de la dernière vague. Aucune donnée privée.';
