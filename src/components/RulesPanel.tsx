import { useEffect, useRef } from 'react'

type RulesPanelProps = { onClose: () => void }

export function RulesPanel({ onClose }: RulesPanelProps) {
  const dialogRef = useRef<HTMLElement>(null)

  // `onClose` est une closure recréée à chaque rendu du parent. En dépendre
  // ferait rejouer l'effet à chaque rendu (tour de l'ordinateur, fin du halo) :
  // le focus serait ramené de force sur « Compris » et le déclencheur mémorisé
  // deviendrait un bouton de la boîte elle-même, donc démonté à la fermeture.
  // On garde l'effet monté une seule fois et on lit la version courante ici.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Boîte de dialogue modale : Échap ferme, le focus reste piégé à l'intérieur,
  // et il revient à l'élément déclencheur à la fermeture. On mémorise le
  // déclencheur avant de déplacer le focus dans la boîte.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const focusable = () =>
      dialogRef.current
        ? Array.from(
            dialogRef.current.querySelectorAll<HTMLElement>(
              'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
            ),
          )
        : []

    const initial = focusable()
    initial[initial.length - 1]?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      opener?.focus?.()
    }
  }, [])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="rules-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        ref={dialogRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="close-button" onClick={onClose} aria-label="Fermer les règles">×</button>
        <p className="overline">Aide de jeu</p>
        <h2 id="rules-title">Comment jouer</h2>
        <ol>
          <li><strong>Choisissez une forme.</strong> Chaque joueur possède deux exemplaires des sept formes.</li>
          <li><strong>Orientez-la.</strong> Cliquez de nouveau sur la forme ou utilisez <kbd>R</kbd> pour tourner. <kbd>F</kbd> retourne les S/Z et L/J.</li>
          <li><strong>Choisissez une entrée.</strong> La colonne visée porte le centre de la forme, qui reste toujours entièrement sur le plateau. L’aperçu montre son point de chute.</li>
          <li><strong>Posez sans laisser de vide.</strong> Toute la face inférieure doit reposer sur le fond, une autre partie de la pièce ou des cases déjà posées.</li>
          <li><strong>Reliez deux bords opposés.</strong> Gauche–droite ou haut–bas, par les côtés ou les angles.</li>
        </ol>
        <p className="rules-note">Si personne ne peut jouer, la plus grande zone connectée gagne. Une égalité donne un match nul.</p>
        <button type="button" className="secondary-button" onClick={onClose}>Compris</button>
      </section>
    </div>
  )
}

