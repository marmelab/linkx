-- Deux unicités que seule la base peut tenir (histoire 15).
--
-- Les deux fautes sont la même : un « lire, conclure qu'il n'y a rien, écrire »
-- entre deux ordonnanceurs qui se recouvrent. Aucune relecture ne la corrige ;
-- c'est un index qui la corrige.

-- **Une seule qualification ouverte par IA.** L'ordonnanceur n'ouvre une partie
-- de qualification que s'il n'en voit aucune en cours pour l'IA candidate. Deux
-- réveils simultanés n'en voient chacun aucune et en ouvrent chacun une ; le
-- verdict est ensuite pris sur la dernière partie terminée, donc sur celle des
-- deux qui finit la dernière — autant dire au hasard. La candidate tient
-- toujours les bleus (`_shared/wavePlan.ts` l'oppose à l'IA de la maison, qui
-- prend les blancs), et une qualification n'appartient à aucune vague.
create unique index if not exists parties_qualification_ouverte_idx
  on public.parties (bot_bleu)
  where vague_id is null and statut <> 'terminee';

comment on index public.parties_qualification_ouverte_idx is
  'Une qualification ouverte à la fois par IA candidate. La deuxième insertion échoue en 23505.';

-- **Une paire, une ouverture, une couleur : une seule partie par vague.** Le
-- calendrier d'une vague ne donne jamais deux fois la même ouverture imposée à
-- une paire dans les mêmes couleurs (`_shared/schedule.ts`, et le test qui le
-- vérifie). Cet index en fait une propriété de la base, et rend du même coup la
-- création des parties d'une vague **rejouable** : un ouvreur mort en chemin est
-- repris par le réveil suivant sans dédoubler ce qu'il avait déjà inséré.
--
-- L'index n'est pas partiel : `vague_id` nul rend la clé distincte d'elle-même,
-- si bien que les qualifications, qui n'appartiennent à aucune vague, n'y sont
-- jamais en conflit. C'est aussi ce qui permet à PostgREST de l'inférer pour un
-- `on_conflict`, ce qu'un index partiel ne permet pas.
create unique index if not exists parties_vague_appariement_idx
  on public.parties (vague_id, bot_bleu, bot_blanc, ouverture);

comment on index public.parties_vague_appariement_idx is
  'Une partie par (vague, bleu, blanc, ouverture) : la création d''une vague se rejoue sans doublon.';
