import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Root } from './Root.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

// Service worker : uniquement sur le build de production, jamais en
// développement où il masquerait le rechargement à chaud. Le chemin relatif se
// résout depuis le document et fixe donc la portée au sous-chemin de
// publication (/linkx/).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error: unknown) => {
      // Le jeu doit rester jouable même si l'installation hors ligne échoue.
      console.warn('Service worker non enregistré', error)
    })
  })
}
