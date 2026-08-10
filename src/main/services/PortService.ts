import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PortInfo } from '@shared/ipc'

const exec = promisify(execFile)

/** Ports below this are system services, never a dev server worth surfacing. */
const MIN_PORT = 1024

/**
 * Processes that listen on a port but never serve a web page. Clicking one in the
 * preview gives a blank pane, so they are marked system and hidden by default rather
 * than sitting in the list looking like candidates.
 */
const NON_WEB_PROCESSES = [
  'controlcenter',
  'rapportd',
  'sharingd',
  'identityservicesd',
  'remoted',
  'mongod',
  'postgres',
  'mysqld',
  'redis-server',
  'memcached',
  'language_server',
  'sshd',
  'cupsd'
]

function isNonWeb(name: string | null): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  return NON_WEB_PROCESSES.some((n) => lower.includes(n))
}

/**
 * Discovers TCP ports that are listening on this machine, so the UI can offer each one
 * as a one-click preview target.
 *
 * Ports opened by a process descended from one of our terminals are flagged `ours` and
 * sorted first — that is almost always the dev server Claude just started.
 */
export class PortService {
  readonly #intervalMs: number
  #timer: NodeJS.Timeout | null = null
  #last = ''
  #onChange: ((ports: PortInfo[]) => void) | null = null
  #ourPids: () => number[] = () => []

  constructor(opts: { intervalMs?: number } = {}) {
    this.#intervalMs = opts.intervalMs ?? 3000
  }

  /**
   * Begin polling. `ourPids` is read fresh each tick rather than captured, because
   * terminals come and go while the poll loop runs.
   */
  start(ourPids: () => number[], onChange: (ports: PortInfo[]) => void): void {
    this.#ourPids = ourPids
    this.#onChange = onChange
    void this.#tick()
    this.#timer = setInterval(() => void this.#tick(), this.#intervalMs)
  }

  async #tick(): Promise<void> {
    let ports: PortInfo[]
    try {
      ports = await this.list()
    } catch {
      return // lsof missing or transiently failed; try again next tick
    }
    // Only notify on an actual change, so the renderer is not repainted every 3s.
    const fingerprint = JSON.stringify(ports)
    if (fingerprint === this.#last) return
    this.#last = fingerprint
    this.#onChange?.(ports)
  }

  /** Current snapshot of listening ports, ours first, then ascending. */
  async list(): Promise<PortInfo[]> {
    const listeners =
      process.platform === 'win32' ? await PortService.#listWindows() : await PortService.#listUnix()

    const ourPids = new Set(this.#ourPids())
    // Always needed now: the editor's own ports must be identified even when no
    // terminal is running.
    const parents = await PortService.#parentMap()

    // The editor itself listens on several ports — Electron's helpers, and in dev the
    // Vite server and the debug port. Listing them invites the user to preview the
    // editor rather than their project.
    const selfChain = new Set<number>()
    for (let pid = process.pid, hops = 0; pid > 1 && hops < 64; hops++) {
      selfChain.add(pid)
      pid = parents.get(pid) ?? 0
    }
    const isSelf = (pid: number): boolean =>
      selfChain.has(pid) || PortService.#isDescendant(pid, new Set([process.pid]), parents)

    const seen = new Map<number, PortInfo>()
    for (const { port, pid, process: name } of listeners) {
      if (port < MIN_PORT) continue
      // Servers commonly bind both IPv4 and IPv6; collapse to one entry per port.
      if (seen.has(port)) continue

      const ours = pid !== null && PortService.#isDescendant(pid, ourPids, parents)
      seen.set(port, {
        port,
        pid,
        process: name,
        ours,
        // A port we started from a terminal is always a candidate, whatever it is.
        system: !ours && ((pid !== null && isSelf(pid)) || isNonWeb(name))
      })
    }

    return [...seen.values()].sort((a, b) => {
      if (a.ours !== b.ours) return a.ours ? -1 : 1
      if (a.system !== b.system) return a.system ? 1 : -1
      return a.port - b.port
    })
  }

  /** Walk the process tree upward looking for one of our pty processes. */
  static #isDescendant(pid: number, ancestors: Set<number>, parents: Map<number, number>): boolean {
    let current: number | undefined = pid
    // Bounded so a cycle in a malformed ps table cannot hang the poll loop.
    for (let hops = 0; current !== undefined && current > 1 && hops < 64; hops++) {
      if (ancestors.has(current)) return true
      current = parents.get(current)
    }
    return false
  }

  static async #parentMap(): Promise<Map<number, number>> {
    const map = new Map<number, number>()
    try {
      const { stdout } = await exec('ps', ['-eo', 'pid=,ppid='])
      for (const line of stdout.split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number)
        if (Number.isFinite(pid) && Number.isFinite(ppid)) map.set(pid, ppid)
      }
    } catch {
      // No ps: every port simply reports ours=false.
    }
    return map
  }

  /**
   * macOS and Linux via lsof's machine-readable output, which emits one `p<pid>` and
   * `c<command>` per process followed by an `n<address>` line per socket.
   */
  static async #listUnix(): Promise<Array<{ port: number; pid: number | null; process: string | null }>> {
    const { stdout } = await exec('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], {
      maxBuffer: 8 * 1024 * 1024
    })

    const out: Array<{ port: number; pid: number | null; process: string | null }> = []
    let pid: number | null = null
    let name: string | null = null

    for (const line of stdout.split('\n')) {
      const tag = line[0]
      const value = line.slice(1)
      if (tag === 'p') {
        pid = Number(value) || null
        name = null
      } else if (tag === 'c') {
        name = value
      } else if (tag === 'n') {
        // *:5173, 127.0.0.1:3001, [::1]:8080
        const port = Number(value.slice(value.lastIndexOf(':') + 1))
        if (Number.isFinite(port) && port > 0) out.push({ port, pid, process: name })
      }
    }
    return out
  }

  static async #listWindows(): Promise<Array<{ port: number; pid: number | null; process: string | null }>> {
    const { stdout } = await exec('netstat', ['-ano', '-p', 'TCP'], { maxBuffer: 8 * 1024 * 1024 })

    const out: Array<{ port: number; pid: number | null; process: string | null }> = []
    for (const line of stdout.split('\n')) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5 || parts[3] !== 'LISTENING') continue
      const port = Number(parts[1].slice(parts[1].lastIndexOf(':') + 1))
      const pid = Number(parts[4]) || null
      if (Number.isFinite(port) && port > 0) out.push({ port, pid, process: null })
    }
    return out
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    this.#onChange = null
    this.#last = ''
  }
}
