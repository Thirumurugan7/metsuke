import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { useFocusTrap } from '../a11y/useFocusTrap'

/**
 * The one overlay system (J3). Two sizes: 'command' is the palette's anchored-near-top
 * geometry, correct for a fast-typing search UI; 'dialog' is centered, used by
 * everything else — Settings, New session, Merge, and confirmations. Owns the scrim,
 * the focus trap, and Escape-to-close, so no consumer hand-rolls any of the three, the
 * way `NotificationSettings`/`NewThread`/`LandThread` each used to.
 *
 * Only ever rendered while open — the consumer's own `if (!open) return null` gates
 * mounting, same as before. That is what lets the focus trap simply always be "on"
 * once this exists.
 */
export function Modal({
  variant,
  label,
  onClose,
  initialFocus,
  className,
  children
}: {
  variant: 'command' | 'dialog'
  label: string
  onClose: () => void
  initialFocus?: RefObject<HTMLElement | null>
  className?: string
  children: ReactNode
}): JSX.Element {
  const dialog = useRef<HTMLDivElement>(null)
  useFocusTrap(dialog, true, initialFocus)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reuses the two proven CSS idioms rather than a fresh visual language: 'command'
  // keeps the palette's `.quick-open` geometry, 'dialog' keeps `.sheet`'s. The
  // consolidation this closes (J3) is behavioral — one component owning the scrim,
  // the focus trap and Escape — not a new shared class name.
  const base = variant === 'command' ? 'quick-open' : 'sheet'

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div
        ref={dialog}
        className={`${base}${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
