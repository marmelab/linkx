/**
 * Session de l'auteur, partagée par les écrans sans passer par un contexte.
 *
 * Un seul abonnement au service d'authentification pour toute la plateforme :
 * il s'ouvre au premier écran qui s'y abonne, jamais au chargement du jeu.
 */
import { useSyncExternalStore } from 'react'
import type { Session } from '@supabase/supabase-js'
import { tournamentClient } from './api'

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

function start() {
  if (started) return
  started = true
  const client = tournamentClient()
  void client.auth.getSession().then(({ data }) => {
    publish({ session: data.session, ready: true })
  })
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
