import { useRef, useState } from "react";
import { serializeGameRecord } from "../game/moveNotation";
import type { GameState } from "../game/types";

type SharePositionButtonProps = {
  state: GameState;
};

/**
 * Copie un lien qui rejoue la partie en cours. L'URL porte `?moves=<notation>`,
 * le format que `queryState` sait charger : plateau, réserves et joueur au trait
 * sont reconstruits à l'identique par rejeu — ce que `?board=` ne fait pas, lui
 * qui repart réserves pleines. Sert à partager une position exacte, par exemple
 * pour signaler un coup douteux de l'ordinateur.
 */
export function SharePositionButton({ state }: SharePositionButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | null>(null);

  const share = async () => {
    let url: string;
    try {
      const moves = serializeGameRecord(state);
      const base = `${window.location.origin}${window.location.pathname}`;
      url = `${base}?moves=${encodeURIComponent(moves)}`;
    } catch {
      // Historique non sérialisable (rare) : rien de fiable à partager.
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (resetTimer.current) window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Presse-papiers refusé (contexte non sécurisé) : le joueur copie à la main.
      window.prompt("Copiez ce lien pour partager la position :", url);
    }
  };

  return (
    <button
      type="button"
      className="secondary-button secondary-button--small"
      onClick={share}
    >
      {copied ? "Lien copié ✓" : "Partager"}
    </button>
  );
}
