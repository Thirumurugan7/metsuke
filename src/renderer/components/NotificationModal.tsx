import { useEffect, useRef } from 'react'
import { useStore } from '../state/store'
import type { NotifyEvent } from '@shared/ipc'

const ICONS: Record<NotifyEvent, string> = {
  permission: '🔐',
  idle: '⏳',
  finished: '✅'
}

/**
 * The in-app alert. It sits over everything, so it reaches you wherever you are in the
 * editor — the file tree, a diff, the preview.
 *
 * Dismissing it focuses the terminal that raised it, because the thing you almost
 * always want next is to answer Claude.
 */
export function NotificationModal(): JSX.Element | null {
  const { activeNotification, dismissNotification, terminals, setActiveTerminal, togglePanel, terminalVisible } =
    useStore()
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (activeNotification) button.current?.focus()
  }, [activeNotification])

  useEffect(() => {
    if (!activeNotification) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dismissNotification()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeNotification, dismissNotification])

  if (!activeNotification) return null
  const { event, title, message, sessionId } = activeNotification

  const goToTerminal = (): void => {
    // The hook reports Claude's own session id, not our tab id, so fall back to the
    // first Claude tab when we cannot match it exactly.
    const tab = terminals.find((t) => t.sessionId === sessionId) ?? terminals.find((t) => t.kind === 'claude')
    if (tab) setActiveTerminal(tab.id)
    if (!terminalVisible) togglePanel('terminal')
    dismissNotification()
  }

  return (
    <div className="overlay notify-overlay" onMouseDown={dismissNotification}>
      <div
        className={`notify-modal notify-${event}`}
        role="alertdialog"
        aria-labelledby="notify-title"
        aria-describedby="notify-message"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="notify-icon" aria-hidden="true">
          {ICONS[event]}
        </div>
        <div className="notify-text">
          <h2 id="notify-title">{title}</h2>
          <p id="notify-message">{message}</p>
        </div>
        <div className="notify-actions">
          <button ref={button} className="primary" onClick={goToTerminal}>
            Go to Claude
          </button>
          <button className="labelled" onClick={dismissNotification}>
            Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
