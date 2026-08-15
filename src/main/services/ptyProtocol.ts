import type { TerminalSession, TerminalSpawnOptions } from '@shared/ipc'

/**
 * The wire between the editor and the process that owns its ptys.
 *
 * Newline-delimited JSON, deliberately. The volume is a terminal's output, the two ends
 * ship together so there is no version skew to negotiate, and being able to read a
 * session of it with `nc` is worth more here than a compact encoding.
 */

/** Editor to host. */
export type Command =
  | { op: 'hello'; token: string }
  /** The id is chosen by the caller so spawning can stay synchronous on the editor side. */
  | { op: 'spawn'; id: string; opts: TerminalSpawnOptions; env: Record<string, string> }
  | { op: 'write'; id: string; data: string }
  | { op: 'resize'; id: string; cols: number; rows: number }
  | { op: 'kill'; id: string }
  /** Everything the host knows, so a reconnecting editor can rebuild its view. */
  | { op: 'sync' }
  /** Kill every session and exit. Sent on a real quit, never on a restart. */
  | { op: 'shutdown' }

/** Host to editor. */
export type Event =
  | { ev: 'ready'; sessions: SessionState[] }
  /**
   * A spawn that actually happened, carrying the values only the host knows: the pid,
   * and the shell and cwd it resolved when the caller did not name them.
   */
  | { ev: 'started'; id: string; pid: number; meta: TerminalSession }
  | { ev: 'data'; id: string; data: string }
  | { ev: 'exit'; id: string; exitCode: number }
  | { ev: 'denied' }

export interface SessionState {
  meta: TerminalSession
  scrollback: string
  pid: number
}

export function encode(message: Command | Event): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * Split a stream into messages, returning whatever is left over.
 *
 * A socket hands over arbitrary chunks: one write can arrive as three reads, and three
 * writes as one. Callers keep the remainder and pass it back with the next chunk.
 */
export function decode<T extends Command | Event>(
  buffer: string
): { messages: T[]; rest: string } {
  const parts = buffer.split('\n')
  // The last piece is either empty (the buffer ended on a newline) or a partial message.
  const rest = parts.pop() ?? ''

  const messages: T[] = []
  for (const part of parts) {
    if (!part.trim()) continue
    try {
      messages.push(JSON.parse(part) as T)
    } catch {
      // A corrupt line is dropped rather than killing the connection. Terminals are the
      // one thing in this app that must not go down over a bad byte.
    }
  }

  return { messages, rest }
}
