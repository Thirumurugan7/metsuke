import { app, Notification, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { NotificationPayload, NotificationSettings, NotifyEvent } from '@shared/ipc'
import { escapeMarkdown } from './hookEvent'

const DEFAULTS: NotificationSettings = {
  modal: true,
  adaptation: true,
  focusWindow: false,
  system: true,
  sound: { enabled: true, path: null, volume: 0.7 },
  telegram: { enabled: false, chatId: '', botToken: '' },
  events: { permission: true, idle: true, finished: false }
}

/** Titles are short because the OS notification centre truncates aggressively. */
const TITLES: Record<NotifyEvent, string> = {
  permission: 'Claude needs permission',
  idle: 'Claude is waiting for you',
  finished: 'Claude finished'
}

const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac'
}

/**
 * Decides what happens when Claude asks for attention, and delivers it everywhere the
 * user has asked for: an in-app modal, the OS notification centre, a sound, and a
 * Telegram message to their phone.
 *
 * The modal and the sound belong to the renderer (it owns the DOM and the audio
 * context), so those are emitted as an event; the OS and Telegram channels are handled
 * here because they need main-process APIs and outbound network.
 */
export class NotificationService {
  #settings: NotificationSettings = structuredClone(DEFAULTS)
  #onFire: ((payload: NotificationPayload) => void) | null = null
  /** Coalesces duplicate hook deliveries, which Claude Code can emit in bursts. */
  #lastKey = ''
  #lastAt = 0

  get settingsPath(): string {
    return path.join(app.getPath('userData'), 'notifications.json')
  }

  listen(onFire: (payload: NotificationPayload) => void): void {
    this.#onFire = onFire
  }

  /** Whether the floating pop-up should be shown at all. */
  get popup(): boolean {
    return this.#settings.modal
  }

  /** Whether the adaptation flourish should play at all. */
  get adaptation(): boolean {
    return this.#settings.adaptation
  }

  /** Whether an alert should take focus rather than appearing quietly beside your work. */
  get focusWindow(): boolean {
    return this.#settings.modal && this.#settings.focusWindow
  }

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'))
      const { telegramToken, ...rest } = raw
      this.#settings = {
        ...structuredClone(DEFAULTS),
        ...rest,
        sound: { ...DEFAULTS.sound, ...rest.sound },
        telegram: { ...DEFAULTS.telegram, ...rest.telegram, botToken: decryptToken(telegramToken) },
        events: { ...DEFAULTS.events, ...rest.events }
      }
    } catch {
      // No settings yet, or corrupt: defaults are a perfectly good starting point.
      this.#settings = structuredClone(DEFAULTS)
    }
  }

  async save(): Promise<void> {
    const { telegram, ...rest } = this.#settings
    const body = {
      ...rest,
      // The token is stored separately and encrypted at rest where the OS supports it.
      telegram: { enabled: telegram.enabled, chatId: telegram.chatId },
      telegramToken: encryptToken(telegram.botToken)
    }
    await fs.mkdir(path.dirname(this.settingsPath), { recursive: true })
    await fs.writeFile(this.settingsPath, JSON.stringify(body, null, 2), 'utf8')
  }

  /** Settings for the UI, with the bot token redacted — it is write-only. */
  read(): NotificationSettings & { telegramConfigured: boolean } {
    return {
      ...structuredClone(this.#settings),
      telegram: { ...this.#settings.telegram, botToken: '' },
      telegramConfigured: this.#settings.telegram.botToken.length > 0
    }
  }

  async update(patch: Partial<NotificationSettings>): Promise<void> {
    const telegram = patch.telegram
      ? {
          ...this.#settings.telegram,
          ...patch.telegram,
          // An empty token in a patch means "leave it alone", not "erase it" — the UI
          // never receives the real one, so it cannot send it back.
          botToken: patch.telegram.botToken || this.#settings.telegram.botToken
        }
      : this.#settings.telegram

    this.#settings = {
      ...this.#settings,
      ...patch,
      sound: { ...this.#settings.sound, ...patch.sound },
      telegram,
      events: { ...this.#settings.events, ...patch.events }
    }
    await this.save()
  }

  /** The configured sound as base64, so the renderer can play it under a strict CSP. */
  async soundData(): Promise<{ mimeType: string; base64: string } | null> {
    const file = this.#settings.sound.path
    if (!file) return null
    try {
      const bytes = await fs.readFile(file)
      const mimeType = AUDIO_MIME[path.extname(file).toLowerCase()] ?? 'audio/mpeg'
      return { mimeType, base64: bytes.toString('base64') }
    } catch {
      return null
    }
  }

  /**
   * Deliver a notification. `message` comes from Claude Code's hook payload, so it is
   * whatever Claude actually said it needed.
   */
  async fire(event: NotifyEvent, message: string, sessionId: string | null): Promise<void> {
    if (!this.#settings.events[event]) return

    // Claude Code can deliver the same hook more than once; ignore an identical repeat
    // within a couple of seconds so the user is not alerted twice for one prompt.
    const key = `${event}:${message}`
    const now = Date.now()
    if (key === this.#lastKey && now - this.#lastAt < 2000) return
    this.#lastKey = key
    this.#lastAt = now

    const payload: NotificationPayload = {
      event,
      title: TITLES[event],
      message: message.trim() || TITLES[event],
      sessionId,
      timestamp: now
    }

    // The renderer decides whether to show the modal and play the sound; it is told
    // regardless so it can keep a history.
    this.#onFire?.(payload)

    if (this.#settings.system) this.#showSystem(payload)
    if (this.#settings.telegram.enabled) await this.#sendTelegram(payload).catch(() => {})
  }

  #showSystem(payload: NotificationPayload): void {
    if (!Notification.isSupported()) return
    new Notification({
      title: payload.title,
      body: payload.message,
      urgency: payload.event === 'permission' ? 'critical' : 'normal'
    }).show()
  }

  /** Returns Telegram's own error text on failure, which is specific and worth showing. */
  async #sendTelegram(payload: NotificationPayload): Promise<void> {
    const { botToken, chatId } = this.#settings.telegram
    if (!botToken || !chatId) throw new Error('Telegram bot token and chat ID are both required')

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: `*${escapeMarkdown(payload.title)}*\n${escapeMarkdown(payload.message)}`,
        parse_mode: 'MarkdownV2'
      })
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { description?: string } | null
      throw new Error(body?.description ?? `Telegram returned ${response.status}`)
    }
  }

  /** Fire a sample through one channel so the user can confirm it is wired up. */
  async test(channel: 'modal' | 'system' | 'sound' | 'telegram'): Promise<string> {
    const payload: NotificationPayload = {
      event: 'permission',
      title: 'Metsuke test',
      message: 'If you can see or hear this, the channel works.',
      sessionId: null,
      timestamp: Date.now()
    }

    switch (channel) {
      case 'modal':
      case 'sound':
        this.#onFire?.({ ...payload, event: channel === 'sound' ? 'idle' : 'permission' })
        return channel === 'sound' ? 'Played the alert sound' : 'Showed the modal'
      case 'system':
        if (!Notification.isSupported()) throw new Error('This system does not support notifications')
        this.#showSystem(payload)
        return 'Sent a system notification'
      case 'telegram':
        await this.#sendTelegram(payload)
        return 'Telegram message sent'
    }
  }
}

function encryptToken(token: string): string {
  if (!token) return ''
  if (!safeStorage.isEncryptionAvailable()) return `plain:${token}`
  return `enc:${safeStorage.encryptString(token).toString('base64')}`
}

function decryptToken(stored: unknown): string {
  if (typeof stored !== 'string' || !stored) return ''
  if (stored.startsWith('plain:')) return stored.slice(6)
  if (!stored.startsWith('enc:')) return ''
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
  } catch {
    return ''
  }
}
