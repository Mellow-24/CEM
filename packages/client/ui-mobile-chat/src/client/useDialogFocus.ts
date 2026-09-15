/** Keyboard focus ownership for mobile overlays, independent of media lifetime. */
import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Trap focus while an overlay is visible and restore its trigger on dismissal.
 * @param active - Whether this overlay owns keyboard interaction.
 * @param close - Escape action; minimizing a call does not hang up.
 * @returns Ref for the dialog container.
 */
export function useDialogFocus(active: boolean, close: () => void): RefObject<HTMLElement> {
  const ref = useRef<HTMLElement>(null)
  const action = useRef(close)
  action.current = close
  useEffect(() => {
    const element = ref.current
    if (!active || !element) return
    const previous = document.activeElement
    const candidates = (): HTMLElement[] => [...element.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]',
    )]
    candidates()[0]?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); action.current(); return }
      if (event.key !== 'Tab') return
      const targets = candidates()
      const first = targets[0], last = targets.at(-1)
      if (event.shiftKey && (document.activeElement === first || !element.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !element.contains(document.activeElement))) {
        event.preventDefault(); first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus()
    }
  }, [active])
  return ref
}
