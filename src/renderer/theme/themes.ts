/**
 * Theme definitions.
 *
 * Each theme is written as a compact spec: the dozen colours that actually carry its
 * identity. `build` derives the full token set from that, so every theme gets the same
 * structure and a new one cannot be shipped half-defined. It also means the overlay
 * colours flip direction automatically: a white wash over a dark ground is invisible on
 * a light one, and that single mistake is what makes most "light modes" unusable.
 */

export interface SyntaxColors {
  comment: string
  keyword: string
  string: string
  number: string
  type: string
  func: string
  variable: string
  operator: string
}

interface Spec {
  id: string
  name: string
  group: 'core' | 'fandom'
  /** One line shown under the name in the picker. */
  blurb: string
  dark: boolean

  bg: string
  bgAlt: string
  bgDeep: string
  bgBar: string
  border: string
  fg: string
  fgDim: string
  accent: string
  accentHover: string
  /** Text drawn on top of the accent colour. */
  onAccent: string

  added: string
  removed: string
  modified: string
  untracked: string
  conflict: string

  syntax: SyntaxColors
  /** Eight normal ANSI colours. Bright variants are derived. */
  ansi: [string, string, string, string, string, string, string, string]
}

export interface Theme extends Spec {
  /** CSS custom properties, keyed without the leading double dash. */
  tokens: Record<string, string>
  /** Sixteen ANSI colours for xterm. */
  ansi16: string[]
}

// ── colour helpers ───────────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

const toHex = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0')

/** Move a colour toward white or black. `amount` is 0 to 1. */
export function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex)
  const target = amount > 0 ? 255 : 0
  const t = Math.abs(amount)
  return `#${toHex(r + (target - r) * t)}${toHex(g + (target - g) * t)}${toHex(b + (target - b) * t)}`
}

function relativeLuminance(hex: string): number {
  const channel = (v: number): number => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = parseHex(hex)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1 to 21. Body text wants 4.5 or better. */
export function contrast(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

// ── the builder ──────────────────────────────────────────────────────────────

function build(spec: Spec): Theme {
  // A wash of white lifts a dark surface and a wash of black deepens a light one.
  // Using the wrong direction is what turns hover states invisible.
  const wash = (alpha: number): string =>
    spec.dark ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`

  // Tinted diff grounds, derived from the theme's own added/removed hues so the diff
  // view belongs to the theme instead of always being VS Code green and red.
  const diffGround = (colour: string): string =>
    spec.dark ? mix(colour, spec.bg, 0.82) : mix(colour, spec.bg, 0.86)

  return {
    ...spec,
    ansi16: [
      ...spec.ansi,
      ...spec.ansi.map((c, i) => (i === 0 ? lighten(c, spec.dark ? 0.35 : 0.25) : lighten(c, spec.dark ? 0.22 : -0.12)))
    ],
    tokens: {
      bg: spec.bg,
      'bg-alt': spec.bgAlt,
      'bg-deep': spec.bgDeep,
      'bg-bar': spec.bgBar,
      border: spec.border,
      fg: spec.fg,
      'fg-dim': spec.fgDim,
      accent: spec.accent,
      'accent-hover': spec.accentHover,
      'on-accent': spec.onAccent,
      // Its own token so accent can mean one thing: "the thing you are on." Same value
      // as accent for now, but free to diverge later without touching every ring.
      focus: spec.accent,
      // Neutral chip ground for pure-count badges, so accent is not diluted into
      // meaning "there is a number here" as well as "this is selected."
      badge: spec.dark ? mix(spec.fg, spec.bg, 0.7) : mix(spec.fg, spec.bg, 0.85),

      added: spec.added,
      removed: spec.removed,
      modified: spec.modified,
      untracked: spec.untracked,
      conflict: spec.conflict,

      // Interaction washes, replacing sixteen hardcoded #ffffffXX values.
      hover: wash(0.05),
      'hover-strong': wash(0.1),
      sunken: wash(0.06),

      // Form controls.
      'input-bg': spec.dark ? lighten(spec.bg, 0.09) : '#ffffff',
      'input-border': spec.dark ? wash(0.09) : mix(spec.border, spec.bg, 0.25),

      // Shadows read as heavier on light grounds, so they are pulled back there.
      shadow: spec.dark ? 'rgba(0,0,0,0.55)' : 'rgba(15,20,30,0.16)',
      'shadow-strong': spec.dark ? 'rgba(0,0,0,0.72)' : 'rgba(15,20,30,0.24)',
      scrim: spec.dark ? 'rgba(0,0,0,0.42)' : 'rgba(20,24,32,0.28)',

      // Diff view.
      'diff-add-bg': diffGround(spec.added),
      'diff-add-fg': spec.dark ? lighten(spec.added, 0.45) : lighten(spec.added, -0.35),
      'diff-del-bg': diffGround(spec.removed),
      'diff-del-fg': spec.dark ? lighten(spec.removed, 0.45) : lighten(spec.removed, -0.35),

      // Error surfaces: toasts and the alert card.
      'danger-bg': spec.dark ? mix(spec.removed, spec.bg, 0.75) : mix(spec.removed, spec.bg, 0.88),
      'danger-border': spec.dark ? mix(spec.removed, spec.bg, 0.55) : mix(spec.removed, spec.bg, 0.7),
      'danger-fg': spec.dark ? lighten(spec.removed, 0.55) : lighten(spec.removed, -0.4),

      // The ground behind the preview webview before a page paints over it. White in
      // every theme on purpose: the page about to load almost certainly expects it, and
      // a dark flash before a light site is worse than a consistent one.
      'preview-ground': '#ffffff',

      row: '22px'
    }
  }
}

/** Blend `a` over `b`. `weight` is how much of `b` survives. */
function mix(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = parseHex(a)
  const [br, bg, bb] = parseHex(b)
  const w = Math.min(1, Math.max(0, weight))
  return `#${toHex(ar * (1 - w) + br * w)}${toHex(ag * (1 - w) + bg * w)}${toHex(ab * (1 - w) + bb * w)}`
}

// ── the seven ────────────────────────────────────────────────────────────────

const SPECS: Spec[] = [
  {
    id: 'dark',
    name: 'Dark',
    group: 'core',
    blurb: 'The default. Neutral greys, nothing competing for attention.',
    dark: true,
    bg: '#1e1e1e',
    bgAlt: '#252526',
    bgDeep: '#1a1a1a',
    bgBar: '#323233',
    border: '#3c3c3c',
    fg: '#d4d4d4',
    fgDim: '#9d9d9d',
    accent: '#0b6fd4',
    accentHover: '#2f8ff0',
    onAccent: '#ffffff',
    added: '#4ec9b0',
    removed: '#f14c4c',
    modified: '#e2c08d',
    untracked: '#73c991',
    conflict: '#e5c07b',
    syntax: {
      comment: '#6a9955',
      keyword: '#c586c0',
      string: '#ce9178',
      number: '#b5cea8',
      type: '#4ec9b0',
      func: '#dcdcaa',
      variable: '#9cdcfe',
      operator: '#d4d4d4'
    },
    ansi: ['#1e1e1e', '#f14c4c', '#73c991', '#e2c08d', '#569cd6', '#c586c0', '#4ec9b0', '#d4d4d4']
  },

  {
    id: 'light',
    name: 'Light',
    group: 'core',
    blurb: 'A real light theme, built from white up rather than the dark one inverted.',
    dark: false,
    bg: '#ffffff',
    bgAlt: '#f4f5f7',
    bgDeep: '#fafbfc',
    bgBar: '#eceef1',
    border: '#d6d9de',
    fg: '#1c1e21',
    fgDim: '#5a5f66',
    accent: '#0a5fd0',
    accentHover: '#0b4fae',
    onAccent: '#ffffff',
    added: '#0a7a5c',
    removed: '#c0392b',
    modified: '#9a6b12',
    untracked: '#12784f',
    conflict: '#8a5a00',
    syntax: {
      comment: '#4a7a34',
      keyword: '#9b1fa8',
      string: '#9c3a13',
      number: '#0f6b3f',
      type: '#0a6a72',
      func: '#7a5a00',
      variable: '#0a4f9c',
      operator: '#1c1e21'
    },
    ansi: ['#2b2f36', '#c0392b', '#12784f', '#9a6b12', '#0a5fd0', '#8a2fa0', '#0a6a72', '#f4f5f7']
  },

  {
    id: 'jjk',
    name: 'Jujutsu Kaisen',
    group: 'fandom',
    blurb: 'Cursed energy. Near black, with the cold blue of an Infinity barrier.',
    dark: true,
    bg: '#0b0b11',
    bgAlt: '#12131c',
    bgDeep: '#07070c',
    bgBar: '#171826',
    border: '#262a3d',
    fg: '#dde2f2',
    fgDim: '#9296b3',
    accent: '#5b8cff',
    accentHover: '#7da3ff',
    onAccent: '#06070d',
    added: '#4fd6c0',
    removed: '#ff5f78',
    modified: '#c4a2ff',
    untracked: '#6ee7c0',
    conflict: '#e0b0ff',
    syntax: {
      comment: '#6b7398',
      keyword: '#b57bff',
      string: '#7fd8c4',
      number: '#8fb8ff',
      type: '#5b8cff',
      func: '#c9d4f5',
      variable: '#9fc3ff',
      operator: '#dde2f2'
    },
    ansi: ['#0b0b11', '#ff5f78', '#4fd6c0', '#c4a2ff', '#5b8cff', '#b57bff', '#7fd8c4', '#dde2f2']
  },

  {
    id: 'naruto',
    name: 'Naruto',
    group: 'fandom',
    blurb: 'Kurama orange burning over forest charcoal.',
    dark: true,
    bg: '#171310',
    bgAlt: '#201a15',
    bgDeep: '#110e0b',
    bgBar: '#271f18',
    border: '#3a2f24',
    fg: '#f2e7d8',
    fgDim: '#b09a7e',
    accent: '#ff7a1a',
    accentHover: '#ff9540',
    onAccent: '#1a0e04',
    added: '#8ecf74',
    removed: '#f4553c',
    modified: '#ffc44d',
    untracked: '#a8de92',
    conflict: '#ffb638',
    syntax: {
      comment: '#7d6a52',
      keyword: '#ff9c4a',
      string: '#c9d97a',
      number: '#ffc44d',
      type: '#69c6d0',
      func: '#ffd98a',
      variable: '#f2e7d8',
      operator: '#e0cdb4'
    },
    ansi: ['#171310', '#f4553c', '#8ecf74', '#ffc44d', '#69c6d0', '#ff9c4a', '#c9d97a', '#f2e7d8']
  },

  {
    id: 'demon-slayer',
    name: 'Demon Slayer',
    group: 'fandom',
    blurb: 'Nichirin indigo at night, cut with the ember of a breathing form.',
    dark: true,
    bg: '#101021',
    bgAlt: '#17182e',
    bgDeep: '#0b0b18',
    bgBar: '#1d1e38',
    border: '#2c2e4d',
    fg: '#e9e7f7',
    fgDim: '#9b98bd',
    accent: '#ff6b3d',
    accentHover: '#ff8961',
    onAccent: '#1a0803',
    added: '#57c9a5',
    removed: '#ff4d6d',
    modified: '#ffc857',
    untracked: '#7fe0c0',
    conflict: '#ffb0c4',
    syntax: {
      comment: '#7574a8',
      keyword: '#ff8fb0',
      string: '#8fe0c8',
      number: '#ffc857',
      type: '#7aa8ff',
      func: '#ffb08a',
      variable: '#cfd0f5',
      operator: '#e9e7f7'
    },
    ansi: ['#101021', '#ff4d6d', '#57c9a5', '#ffc857', '#7aa8ff', '#ff8fb0', '#8fe0c8', '#e9e7f7']
  },

  {
    id: 'evangelion',
    name: 'Evangelion',
    group: 'fandom',
    blurb: 'NERV terminal green over black, with Unit-01 violet.',
    dark: true,
    bg: '#0a0d0a',
    bgAlt: '#111611',
    bgDeep: '#060806',
    bgBar: '#161d16',
    border: '#26332a',
    fg: '#dcecd8',
    fgDim: '#8aa389',
    accent: '#9d6cff',
    accentHover: '#b48cff',
    onAccent: '#0a0512',
    added: '#6ee787',
    removed: '#ff5c5c',
    modified: '#ffa657',
    untracked: '#8ff0a0',
    conflict: '#ffcc66',
    syntax: {
      comment: '#5c7a5e',
      keyword: '#b48cff',
      string: '#6ee787',
      number: '#ffa657',
      type: '#57d6b0',
      func: '#d2f5c8',
      variable: '#a8e6a0',
      operator: '#dcecd8'
    },
    ansi: ['#0a0d0a', '#ff5c5c', '#6ee787', '#ffa657', '#9d6cff', '#b48cff', '#57d6b0', '#dcecd8']
  },

  {
    id: 'one-piece',
    name: 'One Piece',
    group: 'fandom',
    blurb: 'Deep water navy under Going Merry gold.',
    dark: true,
    bg: '#0a1420',
    bgAlt: '#101d2e',
    bgDeep: '#071019',
    bgBar: '#152539',
    border: '#20374f',
    fg: '#e9f0f8',
    fgDim: '#93a9c2',
    accent: '#f0a028',
    accentHover: '#ffb84d',
    onAccent: '#1a1000',
    added: '#4ec9b0',
    removed: '#ef5350',
    modified: '#ffcf5c',
    untracked: '#6fd9a8',
    conflict: '#ffc078',
    syntax: {
      comment: '#5b7590',
      keyword: '#f0a028',
      string: '#7fd6b8',
      number: '#ffcf5c',
      type: '#5cb8e6',
      func: '#ffd98a',
      variable: '#bcd6ef',
      operator: '#e9f0f8'
    },
    ansi: ['#0a1420', '#ef5350', '#4ec9b0', '#ffcf5c', '#5cb8e6', '#f0a028', '#7fd6b8', '#e9f0f8']
  }
]

export const THEMES: Theme[] = SPECS.map(build)
export const DEFAULT_THEME = 'dark'

export function themeById(id: string | null): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
