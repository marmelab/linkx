-- Un seul vocabulaire pour le motif de fin, celui du code.
--
-- La contrainte d'origine mélangeait deux registres : des motifs de fin de
-- partie et les motifs de refus d'une notation, en français pour les uns et en
-- anglais pour les autres. Aucun des deux ne correspondait exactement au type
-- `OutcomeReason` du module d'arbitrage, si bien qu'il aurait fallu une table
-- de correspondance à l'écriture — c'est-à-dire un endroit de plus où la vérité
-- peut diverger.
--
-- Le motif de fin reprend donc mot pour mot les huit valeurs de `OutcomeReason`.
-- Le refus exact rendu par `parseGameRecord`, qui est une information distincte
-- et plus fine, prend sa propre colonne : il n'a de sens que pour une défaite
-- sur coup illégal, et la contrainte l'exige dans ce cas et l'interdit ailleurs.
alter table public.parties
  drop constraint if exists parties_motif_fin_valide;

alter table public.parties
  add column if not exists motif_refus text;

comment on column public.parties.motif_fin is
  'Comment la partie s''est terminée. Vocabulaire de OutcomeReason (_shared/referee.ts).';
comment on column public.parties.motif_refus is
  'Refus exact rendu par la notation, renseigné seulement si motif_fin = ''illegal''.';

alter table public.parties
  add constraint parties_motif_fin_valide check (
    motif_fin is null or motif_fin in (
      'connection', 'stalemate', 'draw',
      'timeout', 'illegal', 'unreachable', 'unreadable-reply', 'interrupted'
    )
  );

-- Les sept motifs de `NotationErrorReason`, tels que le domaine les rend.
alter table public.parties
  add constraint parties_motif_refus_valide check (
    motif_refus is null or motif_refus in (
      'syntax', 'exhausted', 'horizontal-bounds',
      'overflow', 'unsupported', 'game-over', 'unexpected-pass'
    )
  );

-- Écrit en `case` et non en égalité de deux prédicats : `motif_fin` est nul
-- tant que la partie court, et une comparaison à nul rend nul, ce qu'une
-- contrainte laisse passer. Un `motif_refus` posé sur une partie en cours
-- serait alors accepté.
alter table public.parties
  add constraint parties_motif_refus_si_illegal check (
    case
      when motif_fin = 'illegal' then motif_refus is not null
      else motif_refus is null
    end
  );

-- Même raisonnement pour le résultat. Le domaine nomme les joueurs `blue` et
-- `white` (`PlayerId`, src/game/types.ts) et un nul se lit `draw` : stocker
-- « bleu » aurait imposé une traduction à chaque lecture comme à chaque
-- écriture, pour ne rien gagner — cette colonne n'est pas lue par un humain,
-- l'interface affichant « gagné par connexion », pas le contenu de la case.
alter table public.parties
  drop constraint if exists parties_resultat_valide;

update public.parties
set resultat = case resultat
  when 'bleu' then 'blue'
  when 'blanc' then 'white'
  when 'nul' then 'draw'
  else resultat
end
where resultat is not null;

alter table public.parties
  add constraint parties_resultat_valide check (
    resultat is null or resultat in ('blue', 'white', 'draw')
  );

comment on column public.parties.resultat is
  'Vainqueur, vocabulaire de PlayerId : blue, white, ou draw pour un nul.';
