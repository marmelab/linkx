-- Ce que le service adverse a répondu ne regarde pas l'adversaire.
--
-- Pourquoi. `evenements_partie` était lisible en entier par les deux
-- participants d'une partie, `erreur` et `reponse_brute` comprises. Le
-- propriétaire du bot bleu lisait donc le corps rendu par le **service du bot
-- blanc** et ses messages d'erreur : une trace d'exception, un jeton dans une
-- réponse mal réglée, l'adresse d'une machine interne — tout ce qu'un service
-- tiers laisse échapper. C'est aussi ce qui fait d'une résolution DNS non
-- épinglée (`_shared/denoDns.ts`) un canal d'exfiltration ; cette migration en
-- réduit la portée à un seul lecteur, celui qui possède déjà le service appelé.
--
-- Le reste du journal — rang du coup, IA appelée, latence, code HTTP, coup rendu
-- — reste visible des deux : c'est de lui qu'on comprend une partie perdue.
--
-- Les droits colonne ne savent pas dire « selon la ligne ». Les deux colonnes
-- sensibles sortent donc de la table pour les clients, et reviennent par une
-- vue qui les masque hors du propriétaire de l'IA appelée.

revoke select on public.evenements_partie from authenticated;
grant select (
  id, partie_id, rang_coup, bot_id, latence_ms, statut_http, coup, cree_le
) on public.evenements_partie to authenticated;

-- `security_invoker = false`, comme `classement` et `noms_bots` : en invoker,
-- la vue se heurterait aux droits colonne qu'on vient de retirer. Elle porte
-- donc elle-même le filtre de lignes de la politique `evenements_partie` —
-- participer à la partie — et le masque colonne.
create or replace view public.journal_appels
with (security_invoker = false, security_barrier = true)
as
select
  e.id,
  e.partie_id,
  e.rang_coup,
  e.bot_id,
  e.latence_ms,
  e.statut_http,
  e.coup,
  case when public.possede_bot(e.bot_id) or public.est_administrateur()
    then e.erreur
  end as erreur,
  case when public.possede_bot(e.bot_id) or public.est_administrateur()
    then e.reponse_brute
  end as reponse_brute,
  e.cree_le
from public.evenements_partie e
where exists (
  select 1 from public.parties p
  where p.id = e.partie_id
    and (
      public.possede_bot(p.bot_bleu)
      or public.possede_bot(p.bot_blanc)
      or public.est_administrateur()
    )
);

revoke all on public.journal_appels from anon, authenticated;
grant select on public.journal_appels to authenticated;

comment on view public.journal_appels is
  'Journal d''appel d''une partie, tel qu''un participant le voit : tout le monde a la latence, le code HTTP et le coup ; l''erreur et la réponse brute ne vont qu''au propriétaire de l''IA appelée.';
