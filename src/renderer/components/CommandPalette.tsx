import { useEffect, useMemo, useRef, useState } from 'react'
import { call, useStore } from '../state/store'
import { rank, fuzzyMatch, score } from '../state/fuzzy'
import { commandsFor, type Command } from '../state/commands'
import { useFocusTrap } from '../a11y/useFocusTrap'
import { Icon } from './Icon'

type Row =
  | { kind: 'file'; path: string }
  | { kind: 'command'; command: Command & { blocked: string | null } }
  | { kind: 'session'; id: string; title: string; detail: string }
  | { kind: 'line'; line: number }
  | { kind: 'ask'; text: string }

const SECTIONS: Command['section'][] = ['Agent', 'Go to', 'Preview', 'Source control', 'View', 'Settings']

function rankCommands(
  commands: Array<Command & { blocked: string | null }>,
  query: string
): Array<Command & { blocked: string | null }> {
  if (!query) return commands
  return commands
    .map((c) => ({ c, positions: fuzzyMatch(`${c.title} ${c.keywords.join(' ')}`, query) }))
    .filter((r): r is { c: Command & { blocked: string | null }; positions: number[] } => r.positions !== null)
    .sort((a, b) => score(a.c.title, a.positions) - score(b.c.title, b.positions))
    .map((r) => r.c)
}

/**
 * The single overlay for "get somewhere fast": files with no prefix, `>` for commands,
 * `@` for sessions, `:` for a line number, and a pinned "Ask Claude" row when the text
 * looks like a question rather than a filename. Modelled closely on the old
 * `QuickOpen.tsx` — same overlay, focus trap, and keyboard-nav pattern.
 */
export function CommandPalette(): JSX.Element | null {
  const state = useStore()
  const { quickOpen, paletteOpen, workspace, setQuickOpen, setPaletteOpen, openFile, activePath } = state
  const lockedToFiles = quickOpen
  const open = quickOpen || paletteOpen

  const [files, setFiles] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  useFocusTrap(dialog, open, input)

  useEffect(() => {
    if (!open || !workspace) return
    setQuery('')
    setSelected(0)
    void call('files:all').then((all) => all && setFiles(all))
    input.current?.focus()
  }, [open, workspace])

  const close = (): void => {
    setQuickOpen(false)
    setPaletteOpen(false)
  }

  const mode: 'files' | 'commands' | 'sessions' | 'line' = lockedToFiles
    ? 'files'
    : query.startsWith('>')
      ? 'commands'
      : query.startsWith('@')
        ? 'sessions'
        : query.startsWith(':')
          ? 'line'
          : 'files'

  const rest = mode === 'files' ? query : query.slice(1)

  const fileResults = useMemo(() => (mode === 'files' ? rank(files, rest) : []), [mode, files, rest])

  const looksLikeFilename = /[./]/.test(rest)
  const askRow: Row | null =
    mode === 'files' && !lockedToFiles && rest.trim() !== '' && fileResults.length === 0 && !looksLikeFilename
      ? { kind: 'ask', text: rest.trim() }
      : null

  const commandRows = useMemo(
    () => (mode === 'commands' ? rankCommands(commandsFor(state), rest) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, rest, state.workspace, state.previewUrl, state.inspecting, state.activePath]
  )

  const sessionRows = useMemo(() => {
    if (mode !== 'sessions') return []
    const q = rest.toLowerCase()
    return state.terminals
      .filter((t) => !q || t.title.toLowerCase().includes(q))
      .map((t) => ({
        kind: 'session' as const,
        id: t.id,
        title: t.title,
        detail: t.sessionId ? (t.kind === 'claude' ? 'Claude session' : 'shell') : 'not running'
      }))
  }, [mode, rest, state.terminals])

  const lineNumber = mode === 'line' && /^\d+$/.test(rest.trim()) ? parseInt(rest.trim(), 10) : null

  // Flattened, in display order, for keyboard nav and the section-grouped render below.
  const rows: Row[] = useMemo(() => {
    if (mode === 'files') {
      const r: Row[] = []
      if (askRow) r.push(askRow)
      r.push(...fileResults.map((path): Row => ({ kind: 'file', path })))
      return r
    }
    if (mode === 'commands') return commandRows.map((command): Row => ({ kind: 'command', command }))
    if (mode === 'sessions') return sessionRows
    if (mode === 'line') return lineNumber !== null ? [{ kind: 'line', line: lineNumber }] : []
    return []
  }, [mode, askRow, fileResults, commandRows, sessionRows, lineNumber])

  useEffect(() => setSelected(0), [mode, rest])

  if (!open) return null

  const choose = (row: Row): void => {
    switch (row.kind) {
      case 'file':
        void openFile(row.path)
        close()
        return
      case 'ask':
        void useStore.getState().askClaude(row.text)
        close()
        return
      case 'session':
        useStore.setState({ activeTerminal: row.id, terminalVisible: true })
        close()
        return
      case 'line':
        if (activePath) {
          useStore.setState({ revealLine: { path: activePath, line: row.line, at: Date.now() } })
        }
        close()
        return
      case 'command':
        if (row.command.blocked) return
        // goto.line has no useful `run` of its own — selecting it switches the palette
        // into `:` mode instead of closing, same as typing `:` would.
        if (row.command.id === 'goto.line') {
          setQuery(':')
          input.current?.focus()
          return
        }
        void row.command.run(useStore.getState())
        close()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') return close()
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((i) => Math.min(i + 1, rows.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((i) => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter' && rows[selected]) choose(rows[selected])
  }

  const placeholder = lockedToFiles
    ? 'Go to file…'
    : 'Go to file, > for commands, @ for sessions, : for a line…'

  return (
    <div className="overlay" onMouseDown={close}>
      <div
        ref={dialog}
        className="quick-open"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder={placeholder}
          aria-label="Command palette input"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />

        <div className="quick-open-results">
          {rows.length === 0 && (
            <div className="quick-open-empty">
              {mode === 'files' && files.length === 0 && 'Indexing…'}
              {mode === 'files' && files.length > 0 && 'No matching files'}
              {mode === 'commands' && 'No matching commands'}
              {mode === 'sessions' && 'No sessions'}
              {mode === 'line' && (activePath ? 'Type a line number' : 'Open a file first')}
            </div>
          )}

          {mode === 'commands'
            ? SECTIONS.map((section) => {
                const inSection = rows.filter(
                  (r): r is Row & { kind: 'command' } => r.kind === 'command' && r.command.section === section
                )
                if (inSection.length === 0) return null
                return (
                  <div key={section}>
                    <div className="palette-section">{section}</div>
                    {inSection.map((row) => (
                      <PaletteRow
                        key={row.command.id}
                        row={row}
                        selected={rows.indexOf(row) === selected}
                        onPick={() => choose(row)}
                        onHover={() => setSelected(rows.indexOf(row))}
                      />
                    ))}
                  </div>
                )
              })
            : rows.map((row, i) => (
                <PaletteRow
                  key={rowKey(row)}
                  row={row}
                  selected={i === selected}
                  onPick={() => choose(row)}
                  onHover={() => setSelected(i)}
                />
              ))}
        </div>
      </div>
    </div>
  )
}

function rowKey(row: Row): string {
  switch (row.kind) {
    case 'file':
      return `file:${row.path}`
    case 'command':
      return `command:${row.command.id}`
    case 'session':
      return `session:${row.id}`
    case 'line':
      return 'line'
    case 'ask':
      return 'ask'
  }
}

function PaletteRow({
  row,
  selected,
  onPick,
  onHover
}: {
  row: Row
  selected: boolean
  onPick: () => void
  onHover: () => void
}): JSX.Element {
  const blocked = row.kind === 'command' ? row.command.blocked : null

  return (
    <div
      className={`quick-open-row${selected ? ' selected' : ''}${blocked ? ' blocked' : ''}`}
      onMouseEnter={onHover}
      onClick={blocked ? undefined : onPick}
    >
      {row.kind === 'file' && (
        <>
          <span className="quick-open-name">{row.path.split('/').pop()}</span>
          <span className="quick-open-dir">{row.path.split('/').slice(0, -1).join('/')}</span>
        </>
      )}
      {row.kind === 'command' && (
        <>
          <Icon name={row.command.icon} />
          <span className="quick-open-name">{row.command.title}</span>
          {blocked ? (
            <span className="palette-blocked">{blocked}</span>
          ) : row.command.shortcut ? (
            <span className="palette-shortcut">{row.command.shortcut}</span>
          ) : null}
        </>
      )}
      {row.kind === 'session' && (
        <>
          <Icon name="sessions" />
          <span className="quick-open-name">{row.title}</span>
          <span className="quick-open-dir">{row.detail}</span>
        </>
      )}
      {row.kind === 'line' && <span className="quick-open-name">Go to line {row.line}</span>}
      {row.kind === 'ask' && (
        <>
          <Icon name="agents" />
          <span className="quick-open-name">Ask Claude &quot;{row.text}&quot;</span>
        </>
      )}
    </div>
  )
}
