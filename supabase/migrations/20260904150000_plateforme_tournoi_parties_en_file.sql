-- Ce que la file contient déjà (histoire 15).
--
-- La remise en file de l'ordonnanceur ne regardait que `parties.modifie_le`.
-- Or une partie qui **attend son tour** ne touche pas sa ligne : `referee-tick`
-- replanifie son message sans rien écrire quand l'IA tient déjà ses deux appels
-- (verdict « IA occupée »). À l'ouverture d'une vague de 192 parties pour huit
-- IA, presque toutes sont dans ce cas ; elles recevaient donc un second message
-- au bout du délai, puis un troisième à la minute suivante, chacun coûtant un
-- appel d'IA et une écriture de journal.
--
-- L'ordonnanceur a besoin de la seule chose que `modifie_le` ne dit pas : la
-- partie a-t-elle déjà un message. La table de file les porte tous, visibles ou
-- non — un message en cours de traitement y reste, invisible jusqu'à son `vt`.
create or replace function public.file_coups_parties_en_file()
returns uuid[]
language sql
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(distinct (m.message ->> 'partie_id')::uuid),
    '{}'::uuid[]
  )
  from pgmq.q_coups_a_jouer as m
  where m.message ->> 'partie_id' is not null;
$$;

revoke all on function public.file_coups_parties_en_file() from public;
grant execute on function public.file_coups_parties_en_file() to service_role;

comment on function public.file_coups_parties_en_file() is
  'Parties dont un message attend dans la file, visible ou non. Sert à ne pas réempiler deux fois.';
