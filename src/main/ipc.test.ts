import { describe, it, expect, vi, beforeEach } from 'vitest'
import { INVOKE_CHANNELS } from '@shared/ipc'

/** Captures what registerIpc registers, without needing a real Electron runtime. */
const registered = new Map<string, (...args: any[]) => any>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      registered.set(channel, handler)
    }
  },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: class {},
  webContents: { fromId: vi.fn() }
}))

const { registerIpc } = await import('./ipc')

function makeServices() {
  return {
    terminals: { listen: vi.fn(), spawn: vi.fn(), write: vi.fn(), resize: vi.fn(), kill: vi.fn(), list: vi.fn(), pids: () => [] },
    ports: { start: vi.fn(), list: vi.fn() },
    automation: { listen: vi.fn(), attach: vi.fn(), navigate: vi.fn(), reload: vi.fn(), consoleMessages: vi.fn(), networkRequests: vi.fn(), clearBuffers: vi.fn() },
    workspace: null
  } as any
}

describe('the IPC contract', () => {
  beforeEach(() => {
    registered.clear()
    registerIpc(makeServices(), () => null)
  })

  it('registers a handler for every declared invoke channel', () => {
    const missing = INVOKE_CHANNELS.filter((c) => !registered.has(c))
    expect(missing).toEqual([])
  })

  it('registers nothing that is not declared', () => {
    const declared = new Set<string>(INVOKE_CHANNELS)
    const undeclared = [...registered.keys()].filter((c) => !declared.has(c))
    expect(undeclared).toEqual([])
  })

  it('turns a thrown error into an error Result instead of rejecting', async () => {
    // No folder is open, so any file operation throws inside the handler.
    const result = await registered.get('files:read')!({}, 'anything.txt')
    expect(result).toEqual({ ok: false, error: 'No folder is open' })
  })

  it('wraps a successful call in an ok Result', async () => {
    const result = await registered.get('workspace:current')!({})
    expect(result).toEqual({ ok: true, value: null })
  })
})
