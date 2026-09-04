-- La table des administrateurs se lit d'elle-même : elle ne rend une ligne
-- qu'à un administrateur. C'est ce qui permet à « Mes IA » de décider seul s'il
-- affiche le bloc de déclenchement du cron, sans fonction dédiée ni droit
-- supplémentaire — et c'est aussi ce qui fait qu'un utilisateur ordinaire
-- n'apprend rien de son existence.
begin;
select plan(5);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'admin@example.test'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'simple@example.test');

insert into public.administrateurs (utilisateur_id)
values ('aaaaaaaa-0000-0000-0000-000000000001');

-- L'administrateur.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
select is(
  (select count(*) from public.administrateurs),
  1::bigint,
  'un administrateur se voit dans la table'
);
select is(
  public.est_administrateur(),
  true,
  'et est_administrateur() le confirme'
);

-- Un utilisateur ordinaire : ni ligne, ni erreur. Un refus lui apprendrait que
-- la table existe et qu'elle le concerne.
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
select is(
  (select count(*) from public.administrateurs),
  0::bigint,
  'un utilisateur ordinaire n''y voit aucune ligne, pas même la sienne'
);
select is(
  public.est_administrateur(),
  false,
  'et n''est pas administrateur'
);

-- Personne n'entre dans la table par le client : c'est une écriture de service.
select throws_ok(
  $$insert into public.administrateurs (utilisateur_id)
    values ('aaaaaaaa-0000-0000-0000-000000000002')$$,
  '42501',
  null,
  'nul ne se déclare administrateur depuis le client'
);

select * from finish();
rollback;
