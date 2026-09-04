-- Le cron réveille les deux fonctions tous les jours, et non le seul jeudi.
--
-- Ce que corrige cette migration : `20260904100300` ne planifiait les réveils
-- que pendant la fenêtre parisienne du jeudi. Or l'histoire 14 veut qu'une IA
-- nouvellement déclarée joue sa **partie de qualification** tout de suite,
-- « au moment exact où son auteur regarde l'écran ». Une IA déclarée le lundi
-- attendait donc trois jours avant d'entrer au classement — et l'écran de
-- déclaration promettait le contraire.
--
-- Pourquoi élargir le cron plutôt que déclencher la qualification depuis
-- `register-bot` : la qualification n'est pas seulement à *ouvrir*, elle est à
-- *jouer*, coup par coup, par `referee-tick`. Un déclenchement unique à la
-- déclaration ne suffirait donc pas ; il faudrait de toute façon un réveil
-- périodique pour mener la partie à son terme, la reprendre si une invocation
-- meurt, et la relancer après correction de l'adresse. Une seule entrée par
-- fonction, tous les jours, remplace les deux besoins.
--
-- Ce n'est pas un affaiblissement de la fenêtre de vague, qui borne
-- l'**ouverture** d'une vague et rien d'autre : hors fenêtre, `scheduler`
-- qualifie les IA en attente et remet en file les parties immobiles, mais
-- n'ouvre aucune vague. `referee-tick`, lui, ne lit pas le calendrier : une
-- vague ouverte est faite pour être jouée, quel que soit le jour, et c'est
-- l'ordonnanceur seul qui décide d'en ouvrir une. Voir le README, section
-- « Plateforme de tournoi », qui fait foi sur ce partage.
--
-- Effet de bord heureux : les quatre entrées d'origine devenaient deux par
-- fonction pour rattraper les deux heures de la vague qui tombent le mercredi
-- UTC, l'heure d'été décalant la fenêtre parisienne. Un réveil quotidien rend
-- ce raisonnement sans objet, et avec lui une classe entière d'erreurs de
-- fuseau. `_shared/waveWindow.ts` reste seul juge de ce qui est dans la vague.

do $$
declare
  planifie text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron absent : aucune vague ne sera déclenchée toute seule.';
    return;
  end if;

  foreach planifie in array array[
    'vagues-ordonnanceur', 'vagues-ordonnanceur-veille',
    'vagues-arbitre', 'vagues-arbitre-veille'
  ] loop
    if exists (select 1 from cron.job where jobname = planifie) then
      perform cron.unschedule(planifie);
    end if;
  end loop;

  perform cron.schedule(
    'vagues-ordonnanceur', '* * * * *',
    $j$select public.appeler_fonction_edge('scheduler')$j$
  );
  perform cron.schedule(
    'vagues-arbitre', '* * * * *',
    $j$select public.appeler_fonction_edge('referee-tick')$j$
  );
end;
$$;
