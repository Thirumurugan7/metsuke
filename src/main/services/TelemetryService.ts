import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  TELEMETRY_SCHEMA_VERSION,
  isValidEvent,
  sanitiseEvent,
  type TelemetryEnvelope,
  type TelemetryEvent
} from '@shared/telemetry'

/** Consent is a three-state answer, because "not asked yet" is not "no". */
export type ConsentState = 'unasked' | 'granted' | 'denied'

export interface TelemetryConfig {
  /** Where events go. Empty disables sending entirely, whatever consent says. */
  endpoint: string
  appVersion: string
  platform: string
  arch: string
  osVersion: string
  /** The user's home directory, so it can be scrubbed out of anything on its way out. */
  homeDir: string
}

/** How the events actually leave. Injected so tests never touch the network. */
export type Transport = (endpoint: string, body: string) => Promise<{ ok: boolean }>

const FLUSH_INTERVAL_MS = 60_000
/** Batches are small on purpose: a failed send should lose as little as possible. */
const MAX_BATCH = 50
/** Past this the oldest are dropped. An editor is not a queue with a disk quota. */
const MAX_QUEUED = 500

const defaultTransport: Transport = async (endpoint, body) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  })
  return { ok: response.ok }
}

/**
 * Usage reporting, off until somebody says yes.
 *
 * Three rules hold this together, and they are worth stating because every one of them
 * is a thing telemetry usually gets wrong.
 *
 * Nothing is sent before consent. Not a "first launch" ping, not an install count. The
 * queue starts collecting only once the answer is yes, so a user who says no has sent
 * exactly nothing, and a user who has not been asked yet has sent nothing either.
 *
 * Nothing that leaves is unbounded. Every event is validated against the shared schema
 * and every string is scrubbed of paths, emails and tokens, in that order, on the way
 * into the queue rather than on the way out, so a queued event is already safe to read.
 *
 * Nothing here can break the editor. A failed send is retried later and then dropped;
 * network errors are swallowed; and the whole thing is a no-op when the endpoint is
 * unset, which is how a build with no server configured behaves.
 */
export class TelemetryService {
  readonly #config: TelemetryConfig
  readonly #dir: string
  readonly #transport: Transport
  readonly #sessionId = randomUUID()

  #consent: ConsentState = 'unasked'
  #installId: string | null = null
  #firstRun = false
  #queue: Array<TelemetryEvent & { at: number }> = []
  #timer: NodeJS.Timeout | null = null
  #flushing = false

  constructor(userDataDir: string, config: TelemetryConfig, transport: Transport = defaultTransport) {
    this.#dir = userDataDir
    this.#config = config
    this.#transport = transport
  }

  get consent(): ConsentState {
    return this.#consent
  }

  /** True when there is somewhere to send and someone has agreed to it. */
  get active(): boolean {
    return this.#consent === 'granted' && this.#config.endpoint.length > 0
  }

  get installId(): string | null {
    return this.#consent === 'granted' ? this.#installId : null
  }

  /** True when this is the first launch on this machine, for the onboarding prompt. */
  get firstRun(): boolean {
    return this.#firstRun
  }

  async load(): Promise<void> {
    this.#consent = await this.#readConsent()
    this.#firstRun = !(await this.#exists(this.#file('install-id')))

    if (this.#consent === 'granted') {
      this.#installId = await this.#readOrCreateInstallId()
      this.#queue = await this.#readQueue()
      this.#start()
    }
  }

  /**
   * Record the user's answer.
   *
   * Saying no deletes the queue and the install id: there should be nothing left on the
   * machine describing a person who declined, and nothing to resume from if they change
   * their mind and change it back.
   */
  async setConsent(granted: boolean): Promise<void> {
    this.#consent = granted ? 'granted' : 'denied'
    await this.#write('consent', this.#consent)

    if (!granted) {
      this.#queue = []
      this.#stop()
      await this.#remove('queue.json')
      await this.#remove('install-id')
      this.#installId = null
      return
    }

    this.#installId = await this.#readOrCreateInstallId()
    this.#start()
  }

  /** Queue an event. Silently ignored unless telemetry is active. */
  record(event: TelemetryEvent): void {
    if (!this.active) return

    const safe = sanitiseEvent(event, this.#config.homeDir)
    if (!isValidEvent(safe)) return

    this.#queue.push({ ...safe, at: Date.now() })
    if (this.#queue.length > MAX_QUEUED) this.#queue = this.#queue.slice(-MAX_QUEUED)
  }

  /** Send what is queued. Survives failure by putting the batch back. */
  async flush(): Promise<void> {
    if (!this.active || this.#flushing || this.#queue.length === 0) return
    this.#flushing = true

    const batch = this.#queue.slice(0, MAX_BATCH)
    this.#queue = this.#queue.slice(batch.length)

    const envelope: TelemetryEnvelope = {
      schema: TELEMETRY_SCHEMA_VERSION,
      installId: this.#installId ?? 'unknown',
      sessionId: this.#sessionId,
      appVersion: this.#config.appVersion,
      platform: this.#config.platform,
      arch: this.#config.arch,
      osVersion: this.#config.osVersion,
      sentAt: Date.now(),
      events: batch
    }

    try {
      const { ok } = await this.#transport(this.#config.endpoint, JSON.stringify(envelope))
      // A rejected batch goes back to the front, so a server that is down for an hour
      // costs nothing but a delay.
      if (!ok) this.#queue = [...batch, ...this.#queue].slice(-MAX_QUEUED)
    } catch {
      this.#queue = [...batch, ...this.#queue].slice(-MAX_QUEUED)
    } finally {
      this.#flushing = false
    }
  }

  /** Flush and write anything left to disk, so a quit does not lose the session. */
  async shutdown(): Promise<void> {
    this.#stop()
    if (!this.active) return
    await this.flush()
    await this.#writeQueue()
  }

  #start(): void {
    if (this.#timer) return
    this.#timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS)
    // Never hold the app open on account of a telemetry timer.
    this.#timer.unref?.()
  }

  #stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
  }

  // -- disk -----------------------------------------------------------------

  #file(name: string): string {
    return path.join(this.#dir, 'telemetry', name)
  }

  async #exists(file: string): Promise<boolean> {
    try {
      await fs.stat(file)
      return true
    } catch {
      return false
    }
  }

  async #write(name: string, contents: string): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.#file(name)), { recursive: true })
      await fs.writeFile(this.#file(name), contents, 'utf8')
    } catch {
      // Telemetry that cannot write is telemetry that does not run. Not an error.
    }
  }

  async #remove(name: string): Promise<void> {
    try {
      await fs.rm(this.#file(name), { force: true })
    } catch {
      // Nothing to do about it, and nothing depends on it.
    }
  }

  async #readConsent(): Promise<ConsentState> {
    try {
      const value = (await fs.readFile(this.#file('consent'), 'utf8')).trim()
      return value === 'granted' || value === 'denied' ? value : 'unasked'
    } catch {
      return 'unasked'
    }
  }

  async #readOrCreateInstallId(): Promise<string> {
    try {
      const existing = (await fs.readFile(this.#file('install-id'), 'utf8')).trim()
      if (existing.length >= 8) return existing
    } catch {
      // First time, or deleted by a user who said no and changed their mind.
    }
    const id = randomUUID()
    await this.#write('install-id', id)
    return id
  }

  async #readQueue(): Promise<Array<TelemetryEvent & { at: number }>> {
    try {
      const raw = JSON.parse(await fs.readFile(this.#file('queue.json'), 'utf8')) as unknown
      if (!Array.isArray(raw)) return []
      // Re-validated on the way back in: the file is editable, and a queue read from
      // disk is no more trusted than one arriving over a socket.
      return raw.filter((e) => isValidEvent(e)) as Array<TelemetryEvent & { at: number }>
    } catch {
      return []
    }
  }

  async #writeQueue(): Promise<void> {
    if (this.#queue.length === 0) return void (await this.#remove('queue.json'))
    await this.#write('queue.json', JSON.stringify(this.#queue))
  }
}
