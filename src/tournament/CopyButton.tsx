import { useRef, useState } from 'react'

type CopyButtonProps = {
  value: string
  label: string
  /** Ce que la fenêtre de repli demande quand le presse-papiers est refusé. */
  prompt: string
}

/**
 * Même geste que `SharePositionButton` : presse-papiers, et repli sur
 * `window.prompt` quand il est refusé — un contexte non sécurisé n'a pas
 * d'accès au presse-papiers, et le secret d'une IA ne s'affiche qu'une fois.
 */
export function CopyButton({ value, label, prompt }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (resetTimer.current) window.clearTimeout(resetTimer.current)
      resetTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt(prompt, value)
    }
  }

  return (
    <button
      type="button"
      className="secondary-button secondary-button--small"
      onClick={copy}
    >
      {copied ? 'Copié ✓' : label}
    </button>
  )
}
