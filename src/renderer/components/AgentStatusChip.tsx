import { useEffect, useMemo, useState } from 'react'
import { useStore, computeAgentStatus, type AgentChipState } from '../state/store'
import { age } from './ThreadsPanel'

/** Same glyph vocabulary as ThreadsPanel's own DOT map — a new home, not a new meaning. */
const GLYPH: Record<AgentChipState, string> = {
  working: '●',
  needsYou: '◐',
  stopped: '●',
  idle: '○'
}

const CLASS: Record<AgentChipState, string> = {
  working: 'working',
  needsYou: 'needs-you',
  stopped: 'stopped',
  idle: 'idle'
}

function label(state: AgentChipState, count: number): string {
  switch (state) {
    case 'working':
      return count === 1 ? 'Working' : `${count} working`
    case 'needsYou':
      return count === 1 ? 'Needs you' : `${count} need you`
    case 'stopped':
      return count === 1 ? 'Stopped' : `${count} stopped`
    case 'idle':
      return 'Idle'
  }
}

/**
 * What the agent is doing right now, read off `terminals`/`threads`/`notificationLog`
 * rather than tracked separately. Rendered twice — once in the title bar, once in the
 * status bar — always as this same component so the two can never disagree.
 */
export function AgentStatusChip(): JSX.Element {
  const terminals = useStore((s) => s.terminals)
  const threads = useStore((s) => s.threads)
  const notificationLog = useStore((s) => s.notificationLog)
  const selectThread = useStore((s) => s.selectThread)
  const setSidebar = useStore((s) => s.setSidebar)

  // Nothing else re-renders this once a second on its own — without a tick, "working"
  // would freeze at whatever elapsed time happened to be true the moment the last hook
  // event landed, which defeats the entire point of showing it.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [])

  const status = useMemo(
    () => computeAgentStatus(terminals, threads, notificationLog),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [terminals, threads, notificationLog, tick]
  )

  const onClick = (): void => {
    if (status.focusTarget?.kind === 'thread') {
      selectThread(status.focusTarget.id)
      return
    }
    if (status.focusTarget?.kind === 'terminal') {
      useStore.setState({ activeTerminal: status.focusTarget.id, terminalVisible: true })
      return
    }
    // Several sessions share this state, or there is nothing to focus — don't guess.
    setSidebar('agents')
  }

  const text = label(status.state, status.count)
  const elapsed =
    status.state === 'working' && status.elapsedMs !== undefined
      ? age(Date.now() - status.elapsedMs, null)
      : null

  return (
    <button className={`agent-chip agent-chip-${CLASS[status.state]}`} onClick={onClick} title={`Agent: ${text}`}>
      <span className="agent-chip-dot" aria-hidden="true">
        {GLYPH[status.state]}
      </span>
      <span className="agent-chip-label">{text}</span>
      {elapsed && <span className="agent-chip-elapsed">{elapsed}</span>}
    </button>
  )
}
