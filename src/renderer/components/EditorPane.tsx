import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { useStore } from '../state/store'
import { DiffView } from './DiffView'

/** Monaco's language ids for the extensions this editor is likely to meet. */
const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  md: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  rb: 'ruby',
  sh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  sql: 'sql'
}

function languageFor(path: string): string {
  return LANGUAGES[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'
}

export function EditorPane({
  onCursorChange
}: {
  onCursorChange: (position: { line: number; column: number } | null) => void
}): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  /** One Monaco model per open file, so each tab keeps its own undo history. */
  const models = useRef(new Map<string, monaco.editor.ITextModel>())
  /** Last tab we actually focused, so saves and background edits do not steal focus. */
  const focusedPath = useRef<string | null>(null)

  const { openFiles, activePath, dirty, diffPath, workspace, saveFile, openFolder, setQuickOpen } =
    useStore()

  useEffect(() => {
    if (!container.current) return

    const instance = monaco.editor.create(container.current, {
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2
    })
    editor.current = instance

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useStore.getState().activePath
      const model = path ? models.current.get(path) : null
      if (path && model) void saveFile(path, model.getValue())
    })

    const cursor = instance.onDidChangeCursorPosition((e) =>
      onCursorChange({ line: e.position.lineNumber, column: e.position.column })
    )

    return () => {
      cursor.dispose()
      instance.dispose()
      for (const model of models.current.values()) model.dispose()
      models.current.clear()
    }
  }, [saveFile, onCursorChange])

  /**
   * Swap the visible model when the active tab changes.
   *
   * Keyed on activePath alone. It used to depend on the whole `openFiles` array, so
   * every save and every edit Claude made re-ran it — calling focus() and yanking the
   * caret out of the terminal or whatever else you were using.
   */
  useEffect(() => {
    const instance = editor.current
    if (!instance || !activePath || diffPath) return

    const file = useStore.getState().openFiles.find((f) => f.path === activePath)
    if (!file) return

    let model = models.current.get(activePath)
    if (!model) {
      model = monaco.editor.createModel(file.saved, languageFor(activePath))
      models.current.set(activePath, model)

      const created = model
      created.onDidChangeContent(() => {
        const saved = useStore.getState().openFiles.find((f) => f.path === activePath)?.saved
        useStore.getState().markDirty(activePath, created.getValue() !== saved)
      })
    }

    if (instance.getModel() !== model) instance.setModel(model)

    // Focus only when the user actually switched tabs.
    if (focusedPath.current !== activePath) {
      focusedPath.current = activePath
      instance.focus()
    }
    onCursorChange(
      instance.getPosition()
        ? { line: instance.getPosition()!.lineNumber, column: instance.getPosition()!.column }
        : null
    )
  }, [activePath, diffPath, onCursorChange])

  // Dispose models for tabs that were closed, so they do not leak.
  useEffect(() => {
    const open = new Set(openFiles.map((f) => f.path))
    for (const [path, model] of models.current) {
      if (!open.has(path)) {
        model.dispose()
        models.current.delete(path)
      }
    }
    if (openFiles.length === 0) onCursorChange(null)
  }, [openFiles, onCursorChange])

  // Apply an edit made on disk — usually Claude — without losing the cursor.
  const externalEdit = useStore((s) => s.externalEdit)
  useEffect(() => {
    if (!externalEdit) return
    const model = models.current.get(externalEdit.path)
    if (!model || model.getValue() === externalEdit.contents) return

    const position = editor.current?.getPosition()
    // pushEditOperations rather than setValue, so the change joins the undo stack
    // instead of erasing it.
    model.pushEditOperations(
      [],
      [{ range: model.getFullModelRange(), text: externalEdit.contents }],
      () => null
    )
    if (position && model === editor.current?.getModel()) editor.current?.setPosition(position)
  }, [externalEdit])

  // Jump to a line, e.g. from a search result.
  const revealLine = useStore((s) => s.revealLine)
  useEffect(() => {
    const instance = editor.current
    if (!revealLine || !instance || revealLine.path !== activePath) return
    instance.revealLineInCenter(revealLine.line)
    instance.setPosition({ lineNumber: revealLine.line, column: 1 })
    instance.focus()
  }, [revealLine, activePath])

  const showEditor = activePath !== null && !diffPath

  return (
    <div className="editor-area">
      {/* Hidden entirely when there is nothing open — an empty 34px strip read as a
          broken toolbar rather than an empty tab bar. */}
      {(openFiles.length > 0 || diffPath) && (
        <div className="tabs" role="tablist" aria-label="Open editors">
          {openFiles.map((file) => (
            <Tab key={file.path} path={file.path} isDirty={dirty.has(file.path)} />
          ))}
          {diffPath && <DiffTab path={diffPath} />}
        </div>
      )}

      {/* Kept mounted and merely hidden: re-creating Monaco loses undo history. */}
      <div className="editor-host" style={{ display: showEditor ? 'block' : 'none' }}>
        <div ref={container} className="monaco-container" />
      </div>

      {diffPath && <DiffView path={diffPath} />}

      {!showEditor && !diffPath && (
        <div className="panel-empty editor-empty">
          {workspace ? (
            <>
              <p className="empty-title">No file open</p>
              <p className="hint">Pick a file from the Explorer, or search for one by name.</p>
              <button className="primary" onClick={() => setQuickOpen(true)}>
                Go to File…
              </button>
            </>
          ) : (
            <>
              <p className="empty-title">Welcome to Open Claude</p>
              <p className="hint">
                Open a folder to browse its files, watch git changes, and run Claude against it.
              </p>
              <button className="primary" onClick={() => void openFolder()}>
                Open Folder
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Tab({ path, isDirty }: { path: string; isDirty: boolean }): JSX.Element {
  const { activePath, diffPath, openFile, closeFile } = useStore()
  const isActive = activePath === path && !diffPath

  return (
    <div
      className={`tab${isActive ? ' active' : ''}`}
      role="tab"
      aria-selected={isActive}
      onClick={() => void openFile(path)}
      // Middle-click closes, as it does in every browser and editor.
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          closeFile(path)
        }
      }}
      title={path}
    >
      <span className="tab-name">{path.split('/').pop()}</span>
      <button
        className="tab-close"
        aria-label={`Close ${path.split('/').pop()}${isDirty ? ' (unsaved changes)' : ''}`}
        title={isDirty ? 'Unsaved changes — close anyway' : 'Close'}
        onClick={(e) => {
          e.stopPropagation()
          closeFile(path)
        }}
      >
        {isDirty ? '●' : '×'}
      </button>
    </div>
  )
}

/**
 * The diff gets its own tab rather than replacing the editor wholesale. Previously
 * clicking a file in Source Control hid every open tab, with no visible way back.
 */
function DiffTab({ path }: { path: string }): JSX.Element {
  const showDiff = useStore((s) => s.showDiff)

  return (
    <div className="tab active diff-tab" role="tab" aria-selected="true" title={`Diff: ${path}`}>
      <span className="tab-kind">Diff</span>
      <span className="tab-name">{path.split('/').pop()}</span>
      <button className="tab-close" aria-label="Close diff" title="Close" onClick={() => showDiff(null)}>
        ×
      </button>
    </div>
  )
}
