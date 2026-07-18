type RulesPanelProps = { onClose: () => void }

export function RulesPanel({ onClose }: RulesPanelProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="rules-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="close-button" onClick={onClose} aria-label="Fermer les règles">×</button>
        <p className="overline">Aide de jeu</p>
        <h2 id="rules-title">Comment jouer</h2>
        <ol>
          <li><strong>Choisissez une forme.</strong> Chaque joueur possède deux exemplaires des sept formes.</li>
          <li><strong>Orientez-la.</strong> Cliquez de nouveau sur la forme ou utilisez <kbd>R</kbd> pour tourner. <kbd>F</kbd> retourne les S/Z et L/J.</li>
          <li><strong>Choisissez une entrée.</strong> La colonne indique la case la plus à gauche de la forme. L’aperçu montre son point de chute.</li>
          <li><strong>Posez sans laisser de vide.</strong> Toute la face inférieure doit reposer sur le fond, une autre partie de la pièce ou des cases déjà posées.</li>
          <li><strong>Reliez deux bords opposés.</strong> Gauche–droite ou haut–bas, par les côtés ou les angles.</li>
        </ol>
        <p className="rules-note">Si personne ne peut jouer, la plus grande zone connectée gagne. Une égalité donne un match nul.</p>
        <button type="button" className="secondary-button" onClick={onClose} autoFocus>Compris</button>
      </section>
    </div>
  )
}

