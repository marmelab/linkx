-- Amorçage local uniquement (`supabase db reset`). Aucune donnée d'essai :
-- seule l'extension pgTAP, qu'exige `supabase test db` et qui n'a rien à faire
-- dans une migration appliquée en production.
create extension if not exists pgtap with schema extensions;
