import { useEffect, useState } from 'react'
import { call, useStore } from '../state/store'
import type { NotifyEvent } from '@shared/ipc'

const EVENTS: Array<{ id: NotifyEvent; label: string; help: string }> = [
  {
    id: 'permission',
    label: 'Claude asks permission',
    help: 'It wants to run a tool and is waiting for you to approve it.'
  },
  { id: 'idle', label: 'Claude is waiting', help: 'It has been idle waiting for your input.' },
  { id: 'finished', label: 'Claude finishes a turn', help: 'Noisier — off by default.' }
]

export function NotificationSettings(): JSX.Element | null {
  const { settingsOpen, notifySettings, setSettingsOpen, updateNotifySettings, setError } = useStore()
  const [token, setToken] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  useEffect(() => {
    if (settingsOpen) void useStore.getState().loadNotifySettings()
  }, [settingsOpen])

  useEffect(() => {
    if (!settingsOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settingsOpen, setSettingsOpen])

  if (!settingsOpen) return null
  if (!notifySettings) {
    return (
      <div className="overlay" onMouseDown={() => setSettingsOpen(false)}>
        <div className="settings-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="panel-empty">Loading settings…</div>
        </div>
      </div>
    )
  }

  const s = notifySettings

  const test = async (channel: 'modal' | 'system' | 'sound' | 'telegram'): Promise<void> => {
    setTesting(channel)
    setResult(null)
    const message = await call('notify:test', channel)
    if (message) setResult(message)
    setTesting(null)
  }

  return (
    <div className="overlay" onMouseDown={() => setSettingsOpen(false)}>
      <div
        className="settings-modal"
        role="dialog"
        aria-label="Notification settings"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="settings-header">
          <h2>Notifications</h2>
          <button className="icon-only" aria-label="Close settings" onClick={() => setSettingsOpen(false)}>
            ×
          </button>
        </header>

        <div className="settings-body">
          <section>
            <h3>Notify me when…</h3>
            {EVENTS.map((event) => (
              <label key={event.id} className="settings-row">
                <input
                  type="checkbox"
                  checked={s.events[event.id]}
                  onChange={(e) =>
                    void updateNotifySettings({ events: { [event.id]: e.target.checked } as never })
                  }
                />
                <span>
                  {event.label}
                  <small>{event.help}</small>
                </span>
              </label>
            ))}
          </section>

          <section>
            <h3>How to notify me</h3>

            <label className="settings-row">
              <input
                type="checkbox"
                checked={s.modal}
                onChange={(e) => void updateNotifySettings({ modal: e.target.checked })}
              />
              <span>
                Pop-up on screen
                <small>
                  Floats above every application, on whichever display your cursor is on —
                  you see it in your browser or terminal, not only in the editor.
                </small>
              </span>
              <button className="labelled" disabled={testing !== null} onClick={() => void test('modal')}>
                Test
              </button>
            </label>

            <label className="settings-row indent">
              <input
                type="checkbox"
                checked={s.focusWindow}
                disabled={!s.modal}
                onChange={(e) => void updateNotifySettings({ focusWindow: e.target.checked })}
              />
              <span>
                Take focus when it appears
                <small>
                  Off by default the pop-up appears without interrupting your typing. On, it
                  grabs the keyboard — effective, and rude.
                </small>
              </span>
            </label>

            <label className="settings-row">
              <input
                type="checkbox"
                checked={s.adaptation}
                onChange={(e) => void updateNotifySettings({ adaptation: e.target.checked })}
              />
              <span>
                Mark adaptations
                <small>
                  A faint wheel and a low tone the first time Claude reaches for a capability,
                  or when you hand it a definitive instruction. Never more than once every few
                  seconds, and skipped entirely if your system asks for reduced motion.
                </small>
              </span>
              {/*
                type="button" because this sits inside a <label>: without it the button
                submits, and a stray activation would toggle the checkbox it is next to.
              */}
              <button
                type="button"
                className="labelled"
                title="Play the wheel now, ignoring the setting and the cooldown"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  useStore.getState().testAdaptation()
                }}
              >
                Test
              </button>
            </label>

            <label className="settings-row">
              <input
                type="checkbox"
                checked={s.system}
                onChange={(e) => void updateNotifySettings({ system: e.target.checked })}
              />
              <span>
                System notification
                <small>
                  Your OS notification centre. On macOS you may need to allow this once under
                  System Settings → Notifications.
                </small>
              </span>
              <button className="labelled" disabled={testing !== null} onClick={() => void test('system')}>
                Test
              </button>
            </label>

            <label className="settings-row">
              <input
                type="checkbox"
                checked={s.sound.enabled}
                onChange={(e) => void updateNotifySettings({ sound: { ...s.sound, enabled: e.target.checked } })}
              />
              <span>
                Play a sound
                <small>
                  {s.sound.path ? s.sound.path.split('/').pop() : 'Built-in chime'} — pick any audio
                  file you like.
                </small>
              </span>
              <button className="labelled" disabled={testing !== null} onClick={() => void test('sound')}>
                Test
              </button>
            </label>

            <div className="settings-row indent">
              <span className="settings-spacer" />
              <span className="settings-inline">
                <button
                  className="labelled"
                  onClick={async () => {
                    const picked = await call('notify:pickSound')
                    if (picked) await useStore.getState().loadNotifySettings()
                  }}
                >
                  Choose sound file…
                </button>
                {s.sound.path && (
                  <button
                    className="labelled"
                    onClick={() => void updateNotifySettings({ sound: { ...s.sound, path: null } })}
                  >
                    Use built-in
                  </button>
                )}
                <label className="settings-volume">
                  Volume
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={s.sound.volume}
                    onChange={(e) =>
                      void updateNotifySettings({ sound: { ...s.sound, volume: Number(e.target.value) } })
                    }
                  />
                </label>
              </span>
            </div>

            <label className="settings-row">
              <input
                type="checkbox"
                checked={s.telegram.enabled}
                onChange={(e) =>
                  void updateNotifySettings({ telegram: { ...s.telegram, enabled: e.target.checked } })
                }
              />
              <span>
                Telegram message
                <small>
                  Sends to your phone. Create a bot with @BotFather, then message it once and get your
                  chat ID from @userinfobot.
                </small>
              </span>
              <button
                className="labelled"
                disabled={testing !== null || !s.telegramConfigured}
                onClick={() => void test('telegram')}
              >
                Test
              </button>
            </label>

            {s.telegram.enabled && (
              <div className="settings-row indent settings-telegram">
                <input
                  type="password"
                  placeholder={s.telegramConfigured ? 'Bot token (saved)' : 'Bot token'}
                  aria-label="Telegram bot token"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
                <input
                  placeholder="Chat ID"
                  aria-label="Telegram chat ID"
                  value={s.telegram.chatId}
                  onChange={(e) =>
                    void updateNotifySettings({ telegram: { ...s.telegram, chatId: e.target.value } })
                  }
                />
                <button
                  className="labelled"
                  disabled={!token.trim()}
                  onClick={async () => {
                    await updateNotifySettings({ telegram: { ...s.telegram, botToken: token.trim() } })
                    // Never keep the token in renderer state once it is stored.
                    setToken('')
                    setError(null)
                  }}
                >
                  Save token
                </button>
              </div>
            )}
          </section>

          {result && <p className="settings-result">{result}</p>}
        </div>
      </div>
    </div>
  )
}
