/*
 * Service worker de Linkx.
 *
 * Objectif : relancer le jeu hors ligne après une première visite, sans jamais
 * enfermer un joueur sur une version périmée après un déploiement.
 *
 * Trois stratégies, choisies selon ce que la requête demande :
 *
 * - documents (navigations) : réseau d'abord, cache en secours. Le HTML porte
 *   les noms hachés des assets du build courant ; le servir depuis le cache en
 *   priorité gèlerait le joueur sur l'ancien build. Hors ligne, on rend la
 *   dernière copie connue.
 * - assets hachés (`assets/…`) : cache d'abord. Leur nom change à chaque build,
 *   une entrée en cache est donc immuable et ne peut pas devenir périmée.
 * - reste de l'origine (icônes, manifeste, SVG) : cache d'abord mais
 *   revalidation en arrière-plan, car ces noms sont stables entre deux
 *   déploiements et ne doivent pas rester figés.
 *
 * À l'installation, le worker relit le document pour y trouver les assets du
 * build courant et les met en cache : le jeu est donc jouable hors ligne dès la
 * fin de la première visite, sans liste de fichiers hachés codée en dur.
 *
 * Les URL relatives se résolvent ici par rapport à l'emplacement du script,
 * donc la portée du site publié sous un sous-chemin (`/linkx/`) reste correcte.
 */

const VERSION = 'v1'
const SHELL_CACHE = `linkx-shell-${VERSION}`
const ASSET_CACHE = `linkx-assets-${VERSION}`
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE]

/** Entrée du site : seule ressource dont l'absence rendrait le hors-ligne inutile. */
const DOCUMENT_URL = './'

/** Ressources aux noms stables, préchargées au mieux : un échec ne bloque pas l'installation. */
const OPTIONAL_URLS = [
  './manifest.webmanifest',
  './favicon.svg',
  './icons.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
]

/**
 * Repère les assets hachés cités par le document. Leur nom change à chaque
 * build : plutôt que de figer une liste dans ce fichier, on la relit dans le
 * HTML au moment de l'installation. Sans cela, le premier chargement se ferait
 * avant la prise de contrôle du worker et le JS ne serait pas encore en cache.
 */
const ASSET_REFERENCE = /(?:src|href)="([^"]*assets\/[^"]+)"/g

function findAssetUrls(html) {
  return [...html.matchAll(ASSET_REFERENCE)].map((match) => match[1])
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      const page = await fetch(DOCUMENT_URL, { cache: 'no-cache' })
      if (!page.ok) throw new Error(`Document indisponible : ${page.status}`)
      await shell.put(DOCUMENT_URL, page.clone())

      const assets = await caches.open(ASSET_CACHE)
      const urls = [...OPTIONAL_URLS, ...findAssetUrls(await page.text())]
      await Promise.all(urls.map((url) => assets.add(url).catch(() => undefined)))

      // Le HTML étant servi réseau d'abord et les assets étant hachés, prendre
      // la main tout de suite ne peut pas mélanger deux versions du build.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name.startsWith('linkx-') && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstDocument(request))
    return
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(cacheFirst(request))
    return
  }

  event.respondWith(staleWhileRevalidate(event))
})

/** Réseau d'abord : la page réelle si le réseau répond, la dernière copie sinon. */
async function networkFirstDocument(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await fetch(request)
    if (response.ok) {
      // Une seule entrée canonique : le document le plus frais, quelle que soit
      // l'URL demandée (`/linkx/` ou `/linkx/index.html`).
      await cache.put(DOCUMENT_URL, response.clone())
    }
    return response
  } catch (error) {
    const cached = (await cache.match(request)) ?? (await cache.match(DOCUMENT_URL))
    if (cached) return cached
    throw error
  }
}

/** Cache d'abord, sans revalidation : réservé aux URL dont le nom contient un hachage. */
async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone())
  }
  return response
}

/** Cache d'abord pour la vitesse, mise à jour en arrière-plan pour la fraîcheur. */
async function staleWhileRevalidate(event) {
  const { request } = event
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)

  const network = fetch(request)
    .then(async (response) => {
      if (response.ok && response.type === 'basic') {
        await cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => undefined)

  // Maintient le worker en vie le temps de la revalidation même si la réponse
  // servie vient du cache.
  event.waitUntil(network)

  if (cached) return cached

  const response = await network
  if (response) return response
  return Response.error()
}
