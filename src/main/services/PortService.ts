import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { PortInfo, PortProbe } from '@shared/ipc'

const exec = promisify(execFile)

/** Ports below this are system services, never a dev server worth surfacing. */
const MIN_PORT = 1024

/** How long a probe waits for a response before calling the port unresponsive. */
const PROBE_TIMEOUT_MS = 1200

/**
 * How long a probe result is trusted before a port is probed again. Bounds probing to
 * roughly once per this window per port, however often `list()` itself is polled — a
 * dev server mid-compile that was unresponsive a second ago is worth checking again
 * sooner than one that answered cleanly.
 */
const PROBE_TTL_MS = 5000

/**
 * Classifies what, if anything, answers on a port. This is what "system" now means for
 * a port nobody started from a terminal here: not `ours`, and did not answer with HTML.
 * Replaces the old hardcoded process-name list, which had to be told about every new
 * daemon by name and still passed through things like a stray `java` or `figma_agent`
 * process as if they were candidates (H2).
 */
async function probe(port: number): Promise<PortProbe> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual'
    })
    const contentType = res.headers.get('content-type') ?? ''
    return contentType.toLowerCase().includes('text/html') ? 'html' : 'not-web'
  } catch {
    return 'unresponsive'
  } finally {
    clearTimeout(timer)
  }
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
  #probeCache = new Map<number, { result: PortProbe; at: number }>()

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

    type Candidate = { port: number; pid: number | null; process: string | null; ours: boolean; self: boolean }
    const seen = new Map<number, Candidate>()
    for (const { port, pid, process: name } of listeners) {
      if (port < MIN_PORT) continue
      // Servers commonly bind both IPv4 and IPv6; collapse to one entry per port.
      if (seen.has(port)) continue

      seen.set(port, {
        port,
        pid,
        process: name,
        ours: pid !== null && PortService.#isDescendant(pid, ourPids, parents),
        self: pid !== null && isSelf(pid)
      })
    }

    // Self ports are never offered regardless of what answers on them, so probing one
    // would only spend time on a result nobody will see.
    const toProbe = [...seen.values()].filter((c) => !c.self)
    const probed = await Promise.all(toProbe.map((c) => this.#probeCached(c.port)))
    const probeByPort = new Map(toProbe.map((c, i) => [c.port, probed[i]]))

    const ports: PortInfo[] = [...seen.values()].map((c) => {
      const probeResult = c.self ? null : (probeByPort.get(c.port) ?? null)
      return {
        port: c.port,
        pid: c.pid,
        process: c.process,
        ours: c.ours,
        // A port we started from a terminal is always a candidate, whatever it serves.
        system: !c.ours && (c.self || probeResult !== 'html'),
        probe: probeResult
      }
    })

    return ports.sort((a, b) => {
      if (a.ours !== b.ours) return a.ours ? -1 : 1
      if (a.system !== b.system) return a.system ? 1 : -1
      return a.port - b.port
    })
  }

  /** Reuses a recent probe result rather than hitting the port again every poll tick. */
  async #probeCached(port: number): Promise<PortProbe> {
    const cached = this.#probeCache.get(port)
    if (cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.result
    const result = await probe(port)
    this.#probeCache.set(port, { result, at: Date.now() })
    return result
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

  /**
   * pid -> parent pid for every process, used to tell our dev servers and our own
   * processes from everyone else's. `ps` does not exist on Windows, so that branch
   * asks PowerShell instead; a failure on either just means every port reports
   * ours=false rather than breaking the panel.
   */
  static async #parentMap(): Promise<Map<number, number>> {
    const map = new Map<number, number>()
    try {
      const { stdout } =
        process.platform === 'win32'
          ? await exec('powershell.exe', [
              '-NoProfile',
              '-Command',
              'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'
            ])
          : await exec('ps', ['-eo', 'pid=,ppid='])

      for (const line of stdout.split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number)
        if (Number.isFinite(pid) && Number.isFinite(ppid)) map.set(pid, ppid)
      }
    } catch {
      // No process table available: every port simply reports ours=false.
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
    this.#probeCache.clear()
  }
}
