import { contextBridge, ipcRenderer } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type EventChannels,
  type InvokeChannel,
  type InvokeChannels,
  type Result
} from '@shared/ipc'

/**
 * The only surface the renderer has on the main process.
 *
 * Channel names are checked against the contract rather than passed through, so a
 * compromised or buggy renderer cannot invoke arbitrary IPC — it can only reach the
 * channels declared in `src/shared/ipc.ts`.
 */

const invokable = new Set<string>(INVOKE_CHANNELS)
const subscribable = new Set<string>(EVENT_CHANNELS)

const api = {
  invoke<C extends InvokeChannel>(
    channel: C,
    ...args: InvokeChannels[C]['args']
  ): Promise<Result<InvokeChannels[C]['result']>> {
    if (!invokable.has(channel)) {
      return Promise.resolve({ ok: false, error: `Channel not in the IPC contract: ${channel}` })
    }
    return ipcRenderer.invoke(channel, ...args)
  },

  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on<C extends EventChannel>(channel: C, listener: (...args: EventChannels[C]) => void): () => void {
    if (!subscribable.has(channel)) throw new Error(`Channel not in the IPC contract: ${channel}`)

    const wrapped = (_event: unknown, ...args: unknown[]): void =>
      listener(...(args as EventChannels[C]))
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
