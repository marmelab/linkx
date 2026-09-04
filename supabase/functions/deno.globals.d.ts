/**
 * Le fragment de l'API Deno que `_shared/` touche, déclaré **pour `tsc` seul**.
 *
 * Deno n'en a pas besoin — il apporte ses propres types, et ne charge pas ce
 * fichier, qu'aucun module n'importe. Il n'existe que pour que
 * `tsconfig.supabase.json` puisse type-vérifier les tests de `supabase/functions`
 * sous Vitest : sans lui, `denoDns.ts` échouerait sur un `Deno` inconnu, et ces
 * deux mille lignes de tests resteraient le seul coin du dépôt que rien ne
 * vérifie — `deno check` les exclut, aucun autre projet TypeScript ne les inclut.
 *
 * Le garder **minimal** : ce qui est déclaré ici est ce que le code partagé a le
 * droit d'employer. Une fonction edge qui aurait besoin de plus n'est pas testée
 * sous Vitest, et relève de `deno check`.
 *
 * Ces déclarations ne peuvent pas dériver de l'API réelle : le `find` du job
 * `backend` ramasse ce fichier comme les autres, et `deno check` fusionne ce
 * `namespace` avec le sien — une signature qui mentirait ne compilerait plus.
 */
declare namespace Deno {
  namespace errors {
    class NotFound extends Error {}
  }

  function resolveDns(
    query: string,
    recordType: 'A' | 'AAAA',
  ): Promise<string[]>
}
