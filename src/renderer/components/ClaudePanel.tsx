import { useEffect, useState } from 'react'
import { call, useStore } from '../state/store'
import type { ClaudeConfig, ClaudeSkill, ModelUsage, UsageReport } from '@shared/ipc'
import './claude.css'

/**
 * Models the CLI accepts as an alias. Aliases rather than pinned names, so a session
 * always gets the current model in that family without this list going stale.
 */
const MODELS = [
  { id: null, label: 'Follow my default', blurb: 'Whatever ~/.claude/settings.json says' },
  { id: 'opus', label: 'Opus', blurb: 'Most capable, slowest, most expensive' },
  { id: 'sonnet', label: 'Sonnet', blurb: 'The usual balance of speed and depth' },
  { id: 'haiku', label: 'Haiku', blurb: 'Fastest and cheapest, for simple work' },
  { id: 'fable', label: 'Fable', blurb: 'Latest in the Fable family' }
] as const

/** Tokens are big and boring at full precision. */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

/** Strip the vendor prefix so "claude-opus-5" reads as "opus 5". */
function shortModel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-/g, ' ')
}

function totalOf(rows: ModelUsage[]): number {
  return rows.reduce((sum, r) => sum + r.input + r.output + r.cacheRead + r.cacheWrite, 0)
}

function UsageRows({ rows }: { rows: ModelUsage[] }): JSX.Element {
  if (rows.length === 0) return <p className="claude-none">Nothing yet.</p>

  const max = Math.max(...rows.map((r) => r.input + r.output + r.cacheRead + r.cacheWrite), 1)

  return (
    <div className="usage-rows">
      {rows.map((row) => {
        const total = row.input + row.output + row.cacheRead + row.cacheWrite
        return (
          <div key={row.model} className="usage-row">
            <div className="usage-head">
              <span className="usage-model">{shortModel(row.model)}</span>
              <span className="usage-total">{compact(total)}</span>
            </div>
            {/*
              Cache reads dwarf everything else, so a stacked bar would be a solid block
              of one colour. Each segment is drawn against the row total instead.
            */}
            <div className="usage-bar" title={`${total.toLocaleString()} tokens`}>
              <span className="seg in" style={{ width: `${(row.input / max) * 100}%` }} />
              <span className="seg out" style={{ width: `${(row.output / max) * 100}%` }} />
              <span className="seg cache" style={{ width: `${(row.cacheRead / max) * 100}%` }} />
            </div>
            <div className="usage-legend">
              <span><i className="in" /> {compact(row.input)} in</span>
              <span><i className="out" /> {compact(row.output)} out</span>
              <span><i className="cache" /> {compact(row.cacheRead)} cached</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ClaudePanel(): JSX.Element {
  const { workspace, terminals, activeTerminal, setActiveTerminal } = useStore()
  const [usage, setUsage] = useState<UsageReport | null>(null)
  const [skills, setSkills] = useState<ClaudeSkill[] | null>(null)
  const [config, setConfig] = useState<ClaudeConfig | null>(null)
  const [scope, setScope] = useState<'today' | 'week' | 'workspace'>('today')
  const [busy, setBusy] = useState(false)

  const load = async (): Promise<void> => {
    setBusy(true)
    const [u, s, c] = await Promise.all([
      call('claude:usage'),
      call('claude:skills'),
      call('claude:config')
    ])
    if (u) setUsage(u)
    if (s) setSkills(s)
    if (c) setConfig(c)
    setBusy(false)
  }

  useEffect(() => {
    void load()
    // Reading every recent transcript is not free, so this does not poll.
  }, [workspace?.root])

  const chooseModel = async (model: string | null): Promise<void> => {
    if ((await call('claude:setModel', model)) === null) return
    setConfig((prev) => (prev ? { ...prev, sessionModel: model } : prev))
  }

  /** Ask a running session to switch, the same way you would by typing it. */
  const applyToSession = (model: string | null): void => {
    const target =
      terminals.find((t) => t.id === activeTerminal && t.kind === 'claude' && t.sessionId) ??
      terminals.find((t) => t.kind === 'claude' && t.sessionId)
    if (!target?.sessionId) return

    void call('terminal:write', target.sessionId, `/model ${model ?? 'default'}\r`)
    setActiveTerminal(target.id)
  }

  const rows =
    scope === 'today' ? usage?.today : scope === 'week' ? usage?.week : (usage?.workspace ?? [])

  return (
    <div className="claude-panel">
      <section className="claude-section">
        <div className="claude-head">
          <h3>Usage</h3>
          <button className="icon-only" title="Recount" aria-label="Recount usage" onClick={() => void load()}>
            ↻
          </button>
        </div>

        <div className="claude-tabs" role="group" aria-label="Usage period">
          <button className={scope === 'today' ? 'on' : ''} onClick={() => setScope('today')}>
            Today
          </button>
          <button className={scope === 'week' ? 'on' : ''} onClick={() => setScope('week')}>
            {usage?.windowDays ?? 7} days
          </button>
          <button
            className={scope === 'workspace' ? 'on' : ''}
            disabled={!workspace}
            onClick={() => setScope('workspace')}
          >
            This project
          </button>
        </div>

        {busy && !usage ? (
          <p className="claude-none">Reading transcripts…</p>
        ) : (
          <>
            <div className="usage-total-line">
              <b>{compact(totalOf(rows ?? []))}</b> tokens
              {scope === 'week' && usage ? ` across ${usage.sessions} sessions` : ''}
            </div>
            <UsageRows rows={rows ?? []} />
          </>
        )}

        <p className="claude-foot">
          Counted from the transcripts Claude Code writes under <code>~/.claude</code>. These are
          real token counts, not a quota: your plan's limits are not published to the CLI.
        </p>
      </section>

      <section className="claude-section">
        <div className="claude-head">
          <h3>Model</h3>
        </div>

        <div className="model-list">
          {MODELS.map((model) => {
            const selected = (config?.sessionModel ?? null) === model.id
            return (
              <button
                key={model.id ?? 'default'}
                className={`model-row${selected ? ' on' : ''}`}
                onClick={() => void chooseModel(model.id)}
              >
                <span className="model-tick" aria-hidden="true">
                  {selected ? '●' : '○'}
                </span>
                <span className="model-body">
                  <span className="model-name">
                    {model.label}
                    {model.id === null && config?.globalModel ? (
                      <em> ({config.globalModel})</em>
                    ) : null}
                  </span>
                  <small>{model.blurb}</small>
                </span>
              </button>
            )
          })}
        </div>

        <div className="model-actions">
          <button
            className="labelled"
            disabled={!terminals.some((t) => t.kind === 'claude' && t.sessionId)}
            title="Type /model into the running Claude session"
            onClick={() => applyToSession(config?.sessionModel ?? null)}
          >
            Apply to the running session
          </button>
        </div>

        <p className="claude-foot">
          This applies to sessions the editor starts. Your global default in
          <code>~/.claude/settings.json</code> is left alone, because changing it would change
          every Claude session on this machine, not just the ones in here.
        </p>
      </section>

      <section className="claude-section">
        <div className="claude-head">
          <h3>Skills</h3>
          <span className="claude-count">{skills?.length ?? 0}</span>
        </div>

        {skills === null ? (
          <p className="claude-none">Looking…</p>
        ) : skills.length === 0 ? (
          <p className="claude-none">
            None found. Skills live in <code>.claude/skills</code> in a project, in
            <code>~/.claude/skills</code>, or arrive with a plugin.
          </p>
        ) : (
          <div className="skill-list">
            {skills.map((skill) => (
              <div key={skill.path} className="skill-row" title={skill.path}>
                <div className="skill-top">
                  <span className="skill-name">{skill.name}</span>
                  <span className={`skill-src src-${skill.source}`}>
                    {skill.source === 'plugin' ? (skill.plugin ?? 'plugin') : skill.source}
                  </span>
                </div>
                {skill.description && <p className="skill-desc">{skill.description}</p>}
              </div>
            ))}
          </div>
        )}
      </section>

      {config && config.plugins.length > 0 && (
        <section className="claude-section">
          <div className="claude-head">
            <h3>Plugins</h3>
            <span className="claude-count">{config.plugins.length}</span>
          </div>
          <div className="plugin-list">
            {config.plugins.map((plugin) => (
              <span key={plugin} className="plugin-chip">
                {plugin}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
