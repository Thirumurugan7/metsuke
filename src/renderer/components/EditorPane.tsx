import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import { useStore } from '../state/store'

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

export function EditorPane(): JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  /** One Monaco model per open file, so each tab keeps its own undo history. */
  const models = useRef(new Map<string, monaco.editor.ITextModel>())

  const { openFiles, activePath, dirty, diffPath, markDirty, saveFile } = useStore()

  // Create the editor once. Re-creating it on every state change would throw away
  // cursor position, folding, and undo history.
  useEffect(() => {
    if (!container.current) return

    editor.current = monaco.editor.create(container.current, {
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      minimap: { enabled: true },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      tabSize: 2
    })

    editor.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const path = useStore.getState().activePath
      const model = path ? models.current.get(path) : null
      if (path && model) void saveFile(path, model.getValue())
    })

    return () => {
      editor.current?.dispose()
      for (const model of models.current.values()) model.dispose()
      models.current.clear()
    }
  }, [saveFile])

  // Swap the visible model when the active tab changes.
  useEffect(() => {
    if (!editor.current || !activePath || diffPath) return

    const file = openFiles.find((f) => f.path === activePath)
    if (!file) return

    let model = models.current.get(activePath)
    if (!model) {
      model = monaco.editor.createModel(file.saved, languageFor(activePath))
      models.current.set(activePath, model)
      model.onDidChangeContent(() => {
        markDirty(activePath, model!.getValue() !== useStore.getState().openFiles.find((f) => f.path === activePath)?.saved)
      })
    }

    editor.current.setModel(model)
    editor.current.focus()
  }, [activePath, diffPath, openFiles, markDirty])

  // Dispose models for tabs that were closed, so they do not leak.
  useEffect(() => {
    const open = new Set(openFiles.map((f) => f.path))
    for (const [path, model] of models.current) {
      if (!open.has(path)) {
        model.dispose()
        models.current.delete(path)
      }
    }
  }, [openFiles])

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
    if (position) editor.current?.setPosition(position)
  }, [externalEdit])

  const showEditor = activePath !== null && !diffPath

  return (
    <div className="editor-area">
      <div className="tabs">
        {openFiles.map((file) => (
          <Tab key={file.path} path={file.path} isDirty={dirty.has(file.path)} />
        ))}
      </div>

      <div className="editor-host" style={{ display: showEditor ? 'block' : 'none' }}>
        <div ref={container} className="monaco-container" />
      </div>

      {!showEditor && !diffPath && (
        <div className="panel-empty">
          <p>Select a file to start editing</p>
        </div>
      )}
    </div>
  )
}

function Tab({ path, isDirty }: { path: string; isDirty: boolean }): JSX.Element {
  const { activePath, openFile, closeFile } = useStore()
  const name = path.split('/').pop()

  return (
    <div
      className={`tab${activePath === path ? ' active' : ''}`}
      onClick={() => void openFile(path)}
      title={path}
    >
      <span className="tab-name">{name}</span>
      <span
        className="tab-close"
        onClick={(e) => {
          e.stopPropagation()
          closeFile(path)
        }}
      >
        {isDirty ? '●' : '×'}
      </span>
    </div>
  )
}
