/**
 * Session de l'auteur, partagée par les écrans sans passer par un contexte.
 *
 * Un seul abonnement au service d'authentification pour toute la plateforme :
 * il s'ouvre au premier écran qui s'y abonne, jamais au chargement du jeu.
 */
import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import { tournamentClient } from './api'
import { urlWithoutAuthCode } from './routes'

export type SessionState = {
  session: Session | null
  /** Faux tant que la première lecture n'a pas répondu : ne rien conclure avant. */
  ready: boolean
}

let snapshot: SessionState = { session: null, ready: false }
let started = false
const listeners = new Set<() => void>()

function publish(next: SessionState) {
  snapshot = next
  for (const listener of listeners) listener()
}

/**
 * Le `?code=` du lien magique s'efface dès la première réponse, **échec
 * compris** : la bibliothèque ne le retire qu'après un échange réussi, et un
 * lien expiré enfermerait sinon le visiteur sur la plateforme (`routes.ts`).
 * `getSession` attend l'échange, il n'y a donc rien à effacer trop tôt.
 */
function forgetAuthCode() {
  const cleaned = urlWithoutAuthCode(window.location.href)
  if (cleaned !== window.location.href) {
    window.history.replaceState(null, '', cleaned)
  }
}

function start() {
  if (started) return
  started = true
  const client = tournamentClient()
  void client.auth
    .getSession()
    .then(({ data }) => {
      publish({ session: data.session, ready: true })
    })
    .catch(() => {
      publish({ session: null, ready: true })
    })
    .finally(forgetAuthCode)
  client.auth.onAuthStateChange((_event, session) => {
    publish({ session, ready: true })
  })
}

function subscribe(listener: () => void): () => void {
  start()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): SessionState {
  return snapshot
}

export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
