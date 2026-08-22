import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  FolderTree,
  Search,
  GitBranch,
  Sparkles,
  Plug,
  Monitor,
  TerminalSquare,
  FolderOpen,
  Bell,
  Crosshair,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Maximize,
  Minimize,
  X,
  Plus,
  ChevronDown,
  Check,
  ExternalLink,
  PanelLeft,
  PanelBottom,
  PanelRight,
  Hash
} from 'lucide-react'

/**
 * One glyph, one meaning, one place this is declared. Every icon used anywhere in the
 * app is named here — if two features need "the same kind of thing," they import the
 * same name, so a collision like the old ▤ meaning four things becomes structurally
 * impossible.
 */
export const ICONS = {
  files: FolderTree,
  search: Search,
  git: GitBranch,
  agents: Sparkles,
  ports: Plug,
  preview: Monitor,
  sessions: TerminalSquare,
  openFolder: FolderOpen,
  notifications: Bell,
  pointAtElement: Crosshair,
  settings: SlidersHorizontal,
  back: ChevronLeft,
  forward: ChevronRight,
  reload: RotateCw,
  fullscreen: Maximize,
  exitFullscreen: Minimize,
  close: X,
  add: Plus,
  chevronDown: ChevronDown,
  check: Check,
  branch: GitBranch, // same glyph as `git`, deliberately — same meaning
  external: ExternalLink,
  sidebar: PanelLeft,
  terminalPanel: PanelBottom,
  previewPanel: PanelRight,
  gotoLine: Hash
  // add more only when a real batch needs one — do not pre-populate speculative icons
} as const satisfies Record<string, LucideIcon>

export function Icon({
  name,
  size = 16,
  className
}: {
  name: keyof typeof ICONS
  size?: 16 | 20
  className?: string
}): JSX.Element {
  const Glyph = ICONS[name]
  return <Glyph size={size} strokeWidth={1.5} aria-hidden="true" className={className} />
}
