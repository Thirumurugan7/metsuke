import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './alert.css'
import { bootstrapTheme } from './theme/apply'
import { Icon } from './components/Icon'
import type { NotificationPayload, NotifyEvent } from '@shared/ipc'

// Same origin as the main window, so the stored choice is already there to read.
bootstrapTheme()

const EVENT_ICON: Record<NotifyEvent, 'lock' | 'waiting' | 'done'> = {
  permission: 'lock',
  idle: 'waiting',
  finished: 'done'
}

/**
 * The contents of the floating alert window.
 *
 * Deliberately tiny and self-contained: it shares no state with the editor, and talks
 * to the main process over the same typed IPC contract as everything else.
 */
function Alert(): JSX.Element | null {
  const [payload, setPayload] = useState<NotificationPayload | null>(null)

  useEffect(() => {
    const off = window.api.on('alert:payload', (next) => setPayload(next))
    // Tell main we can receive payloads; anything that arrived first is replayed.
    void window.api.invoke('alert:ready')

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') void window.api.invoke('alert:dismiss')
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off()
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  if (!payload) return null

  return (
    <div className={`alert-card alert-${payload.event}`}>
      <div className="alert-icon" aria-hidden="true">
        <Icon name={EVENT_ICON[payload.event]} size={16} />
      </div>

      <div className="alert-body">
        <h1 className="alert-title">{payload.title}</h1>
        <p className="alert-message">{payload.message}</p>
        <div className="alert-actions">
          <button
            className="primary"
            autoFocus
            onClick={() => void window.api.invoke('alert:goto', payload.sessionId)}
          >
            Go to Claude
          </button>
          <button className="ghost" onClick={() => void window.api.invoke('alert:dismiss')}>
            Dismiss
          </button>
        </div>
      </div>

      <button className="alert-close" aria-label="Dismiss" onClick={() => void window.api.invoke('alert:dismiss')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Alert />
  </StrictMode>
)
