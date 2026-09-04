/**
 * Authentification des fonctions réservées à la plateforme : `scheduler`,
 * `referee-tick` et `wave-mail`.
 *
 * `verify_jwt` ne vérifie qu'une signature, et le jeton d'un simple visiteur en
 * porte une : c'est bien la **clé de service** qu'il faut exiger, pas un jeton
 * valide. Et une clé se compare à durée constante — une comparaison qui
 * s'arrête au premier caractère différent laisse la deviner octet par octet.
 * Une seule copie de ce test, ici, plutôt qu'une par fonction.
 */

/**
 * Comparaison sans fuite de temps : on parcourt toujours la totalité des
 * caractères. Une longueur différente suffit à refuser — la longueur d'une clé
 * n'est pas un secret —, et une clé attendue vide refuse toujours, pour qu'une
 * variable d'environnement absente n'ouvre rien.
 */
export function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length || expected.length === 0) return false
  let difference = 0
  for (let index = 0; index < given.length; index += 1) {
    difference |= given.charCodeAt(index) ^ expected.charCodeAt(index)
  }
  return difference === 0
}

/** L'appel présente-t-il la clé de service en jeton porteur ? */
export function fromPlatform(request: Request, serviceKey: string): boolean {
  const bearer = (request.headers.get('authorization') ?? '')
    .replace(/^Bearer\s+/i, '')
  return sameSecret(bearer, serviceKey)
}
