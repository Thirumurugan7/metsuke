import * as monaco from 'monaco-editor'
import type { ITheme as XtermTheme } from '@xterm/xterm'
import { DEFAULT_THEME, THEMES, themeById, type Theme } from './themes'

/**
 * Pushes the chosen theme into all four colour systems in the app.
 *
 * The CSS custom properties are the backbone, but Monaco, xterm and the floating alert
 * window each carry their own palette. If any one of them is missed the app looks
 * half-repainted, so they are all driven from here rather than from wherever they
 * happen to be constructed.
 */

const STORAGE_KEY = 'metsuke.theme'

export function readStoredTheme(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function storeTheme(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // Private mode or a locked-down profile. The theme still applies for this session.
  }
}

/**
 * Write the tokens onto the root element.
 *
 * Called once at module load before React mounts, which is what stops the default
 * palette flashing on startup: the variables are in place before the first paint.
 */
export function applyCssTokens(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${name}`, value)
  }
  root.dataset.theme = theme.id
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
}

// ── Monaco ───────────────────────────────────────────────────────────────────

const defined = new Set<string>()

/** Monaco insists on hex without alpha, and throws on anything else. */
const solid = (hex: string): string => hex.slice(0, 7)

export function monacoThemeName(theme: Theme): string {
  const name = `oc-${theme.id}`
  if (defined.has(name)) return name

  monaco.editor.defineTheme(name, {
    base: theme.dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: solid(theme.syntax.comment), fontStyle: 'italic' },
      { token: 'keyword', foreground: solid(theme.syntax.keyword) },
      { token: 'string', foreground: solid(theme.syntax.string) },
      { token: 'number', foreground: solid(theme.syntax.number) },
      { token: 'type', foreground: solid(theme.syntax.type) },
      { token: 'type.identifier', foreground: solid(theme.syntax.type) },
      { token: 'entity.name.function', foreground: solid(theme.syntax.func) },
      { token: 'function', foreground: solid(theme.syntax.func) },
      { token: 'variable', foreground: solid(theme.syntax.variable) },
      { token: 'identifier', foreground: solid(theme.syntax.variable) },
      { token: 'operator', foreground: solid(theme.syntax.operator) },
      { token: 'delimiter', foreground: solid(theme.syntax.operator) },
      { token: 'tag', foreground: solid(theme.syntax.type) },
      { token: 'attribute.name', foreground: solid(theme.syntax.func) },
      { token: 'attribute.value', foreground: solid(theme.syntax.string) }
    ],
    colors: {
      'editor.background': solid(theme.bg),
      'editor.foreground': solid(theme.fg),
      'editorLineNumber.foreground': solid(theme.fgDim),
      'editorLineNumber.activeForeground': solid(theme.fg),
      'editorCursor.foreground': solid(theme.accent),
      'editor.selectionBackground': solid(theme.accent) + '44',
      'editor.inactiveSelectionBackground': solid(theme.accent) + '22',
      'editor.lineHighlightBackground': solid(theme.bgAlt),
      'editorIndentGuide.background1': solid(theme.border),
      'editorWhitespace.foreground': solid(theme.border),
      'editorWidget.background': solid(theme.bgAlt),
      'editorWidget.border': solid(theme.border),
      'editorSuggestWidget.background': solid(theme.bgAlt),
      'editorSuggestWidget.border': solid(theme.border),
      'editorSuggestWidget.selectedBackground': solid(theme.bgBar),
      'editorGutter.addedBackground': solid(theme.added),
      'editorGutter.deletedBackground': solid(theme.removed),
      'editorGutter.modifiedBackground': solid(theme.modified),
      'scrollbarSlider.background': solid(theme.border) + '99',
      'scrollbarSlider.hoverBackground': solid(theme.border) + 'cc',
      'minimap.background': solid(theme.bg)
    }
  })

  defined.add(name)
  return name
}

export function applyMonacoTheme(theme: Theme): void {
  monaco.editor.setTheme(monacoThemeName(theme))
}

// ── xterm ────────────────────────────────────────────────────────────────────

export function xtermTheme(theme: Theme): XtermTheme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = theme.ansi16
  const [bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = theme.ansi16.slice(8)

  return {
    background: theme.bgDeep,
    foreground: theme.fg,
    cursor: theme.accent,
    cursorAccent: theme.bgDeep,
    // A hint of the accent, not a block that hides the text under it.
    selectionBackground: `${theme.accent}55`,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: bBlack,
    brightRed: bRed,
    brightGreen: bGreen,
    brightYellow: bYellow,
    brightBlue: bBlue,
    brightMagenta: bMagenta,
    brightCyan: bCyan,
    brightWhite: bWhite
  }
}

// ── the whole lot ────────────────────────────────────────────────────────────

type Listener = (theme: Theme) => void
const listeners = new Set<Listener>()

let current: Theme = themeById(readStoredTheme())

export function getTheme(): Theme {
  return current
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function onThemeChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setTheme(id: string, opts: { persist?: boolean } = {}): void {
  current = themeById(id)
  applyCssTokens(current)
  // Monaco is only touched once it exists; the alert window never loads it.
  if (typeof monaco?.editor?.setTheme === 'function') applyMonacoTheme(current)
  if (opts.persist !== false) storeTheme(current.id)
  for (const listener of listeners) listener(current)
}

/**
 * Apply the stored theme to the CSS variables synchronously, before React renders.
 * Deliberately does not touch Monaco, which does not exist yet at this point.
 */
export function bootstrapTheme(): Theme {
  current = themeById(readStoredTheme())
  applyCssTokens(current)
  return current
}

export { THEMES, themeById }
export type { Theme }
