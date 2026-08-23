import { getThemePreference, setTheme, SYSTEM_PREFERENCE, THEMES } from './apply'
import { useTheme } from './useTheme'

/**
 * The theme chooser.
 *
 * Each option carries a real swatch built from that theme's own tokens, so you can see
 * the ground, the panel, the accent and the syntax colours before committing to it. A
 * dropdown of names would make you switch seven times to find out what they look like.
 *
 * "Standard" groups the four choices most people want first (follow system, dark,
 * light, high contrast); "More themes" holds the five fandom palettes below it.
 */
export function ThemePicker(): JSX.Element {
  const current = useTheme()
  const preference = getThemePreference()

  const standard = THEMES.filter((t) => t.group === 'core')
  const fandom = THEMES.filter((t) => t.group === 'fandom')

  const option = (id: string): JSX.Element => {
    const theme = THEMES.find((t) => t.id === id)!
    const active = preference === theme.id

    return (
      <button
        key={theme.id}
        type="button"
        className={`theme-option${active ? ' active' : ''}`}
        aria-pressed={active}
        title={theme.blurb}
        onClick={() => setTheme(theme.id)}
      >
        {/* A miniature of the editor: bar, sidebar, ground, and a line of syntax. */}
        <span className="theme-swatch" style={{ background: theme.bg, borderColor: theme.border }}>
          <span className="theme-swatch-bar" style={{ background: theme.bgBar }} />
          <span className="theme-swatch-side" style={{ background: theme.bgAlt }} />
          <span className="theme-swatch-code">
            <i style={{ background: theme.syntax.keyword }} />
            <i style={{ background: theme.syntax.string }} />
            <i style={{ background: theme.syntax.func }} />
          </span>
          <span className="theme-swatch-accent" style={{ background: theme.accent }} />
        </span>

        <span className="theme-meta">
          <span className="theme-name">{theme.name}</span>
          <span className="theme-blurb">{theme.blurb}</span>
        </span>
      </button>
    )
  }

  const dark = THEMES.find((t) => t.id === 'dark')!
  const light = THEMES.find((t) => t.id === 'light')!
  const followSystem = (
    <button
      key="system"
      type="button"
      className={`theme-option${preference === SYSTEM_PREFERENCE ? ' active' : ''}`}
      aria-pressed={preference === SYSTEM_PREFERENCE}
      title={`Uses ${current.name} right now, and switches automatically when your OS does.`}
      onClick={() => setTheme(SYSTEM_PREFERENCE)}
    >
      <span className="theme-swatch theme-swatch-system">
        <span className="theme-swatch-half" style={{ background: dark.bg }} />
        <span className="theme-swatch-half" style={{ background: light.bg, borderColor: light.border }} />
      </span>
      <span className="theme-meta">
        <span className="theme-name">Follow system</span>
        <span className="theme-blurb">Matches your OS appearance setting.</span>
      </span>
    </button>
  )

  return (
    <div className="theme-picker">
      <div className="theme-group-label">Standard</div>
      <div className="theme-grid">
        {followSystem}
        {standard.map((t) => option(t.id))}
      </div>

      <div className="theme-group-label">More themes</div>
      <div className="theme-grid">{fandom.map((t) => option(t.id))}</div>
    </div>
  )
}
