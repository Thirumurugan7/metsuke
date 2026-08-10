import { useEffect } from 'react'
import { useStore } from '../state/store'

/** How long a message stays before it dismisses itself. */
const DISMISS_MS = 8000

/**
 * Error messages, stacked. Previously a single banner held one message and each new
 * failure silently overwrote the previous one, so a burst of errors showed only the
 * last. These queue, auto-dismiss, and stay selectable so a git error can be copied.
 */
export function Toasts(): JSX.Element | null {
  const { toasts, dismissToast } = useStore()

  useEffect(() => {
    if (toasts.length === 0) return
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), DISMISS_MS))
    return () => timers.forEach(clearTimeout)
  }, [toasts, dismissToast])

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="alert" aria-live="assertive">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span className="toast-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            className="icon-only"
            aria-label="Dismiss error"
            title="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
