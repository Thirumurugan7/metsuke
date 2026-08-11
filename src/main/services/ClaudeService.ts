import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ClaudeConfig, ClaudeSkill, ModelUsage, UsageReport } from '@shared/ipc'

const CLAUDE_HOME = path.join(os.homedir(), '.claude')

/** Only look this far back. Older transcripts cost time to parse and answer nothing. */
const WINDOW_DAYS = 7
/** A single runaway transcript should not stall the panel. */
const MAX_FILE_BYTES = 40 * 1024 * 1024

/**
 * Reads what Claude Code leaves on disk: token usage, available skills, and which
 * model is configured.
 *
 * Everything here is read-only with one exception, and that exception is deliberate:
 * the editor never writes ~/.claude/settings.json. Changing the model there would
 * change it for every Claude session on the machine, including ones started outside
 * this app, which is not a decision an editor gets to make on the user's behalf. The
 * model chosen here is passed to sessions the editor spawns, and the global default is
 * shown beside it as context.
 */
export class ClaudeService {
  /**
   * Claude Code stores transcripts under a directory named after the project path with
   * separators replaced by dashes.
   */
  static #projectDir(root: string): string {
    return path.join(CLAUDE_HOME, 'projects', root.replace(/[/\\]/g, '-'))
  }

  /** Sum the per-message usage records in one transcript, grouped by model. */
  static async #readTranscript(file: string): Promise<Map<string, ModelUsage>> {
    const totals = new Map<string, ModelUsage>()

    const stat = await fs.stat(file).catch(() => null)
    if (!stat || stat.size > MAX_FILE_BYTES) return totals

    const text = await fs.readFile(file, 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      if (!line || line.indexOf('"usage"') === -1) continue

      let record: any
      try {
        record = JSON.parse(line)
      } catch {
        // Transcripts are appended to live, so the last line can be a partial write.
        continue
      }

      const usage = record?.message?.usage
      if (!usage) continue

      const model = record?.message?.model ?? 'unknown'
      const entry = totals.get(model) ?? {
        model,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0
      }
      entry.input += usage.input_tokens ?? 0
      entry.output += usage.output_tokens ?? 0
      entry.cacheRead += usage.cache_read_input_tokens ?? 0
      entry.cacheWrite += usage.cache_creation_input_tokens ?? 0
      totals.set(model, entry)
    }

    return totals
  }

  static #merge(into: Map<string, ModelUsage>, from: Map<string, ModelUsage>): void {
    for (const [model, add] of from) {
      const entry = into.get(model) ?? { model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      entry.input += add.input
      entry.output += add.output
      entry.cacheRead += add.cacheRead
      entry.cacheWrite += add.cacheWrite
      into.set(model, entry)
    }
  }

  /**
   * Token usage over the last week, today, and for the open folder.
   *
   * Bucketed by file modification time rather than by per-message timestamps: a
   * transcript is one working session, so its mtime is a good enough proxy for when the
   * tokens were spent, and it avoids parsing timestamps on every one of thousands of
   * lines.
   */
  async usage(workspaceRoot: string | null): Promise<UsageReport> {
    const projects = path.join(CLAUDE_HOME, 'projects')
    const dirs = await fs.readdir(projects, { withFileTypes: true }).catch(() => [])

    const now = Date.now()
    const startOfToday = new Date().setHours(0, 0, 0, 0)
    const weekAgo = now - WINDOW_DAYS * 86_400_000

    const today = new Map<string, ModelUsage>()
    const week = new Map<string, ModelUsage>()
    const workspace = new Map<string, ModelUsage>()
    const wanted = workspaceRoot ? ClaudeService.#projectDir(workspaceRoot) : null

    let sessions = 0

    for (const dir of dirs) {
      if (!dir.isDirectory()) continue
      const full = path.join(projects, dir.name)
      const files = await fs.readdir(full).catch(() => [])

      for (const name of files) {
        if (!name.endsWith('.jsonl')) continue
        const file = path.join(full, name)
        const stat = await fs.stat(file).catch(() => null)
        if (!stat || stat.mtimeMs < weekAgo) continue

        const totals = await ClaudeService.#readTranscript(file)
        if (totals.size === 0) continue

        sessions++
        ClaudeService.#merge(week, totals)
        if (stat.mtimeMs >= startOfToday) ClaudeService.#merge(today, totals)
        if (wanted && full === wanted) ClaudeService.#merge(workspace, totals)
      }
    }

    const sort = (map: Map<string, ModelUsage>): ModelUsage[] =>
      [...map.values()].sort((a, b) => b.input + b.output - (a.input + a.output))

    return {
      today: sort(today),
      week: sort(week),
      workspace: wanted ? sort(workspace) : null,
      sessions,
      windowDays: WINDOW_DAYS,
      generatedAt: now
    }
  }

  /**
   * Skills available to Claude here: the user's own, this project's, and any that
   * arrive with an installed plugin.
   */
  async skills(workspaceRoot: string | null): Promise<ClaudeSkill[]> {
    const roots: Array<{ dir: string; source: ClaudeSkill['source'] }> = [
      { dir: path.join(CLAUDE_HOME, 'skills'), source: 'user' },
      { dir: path.join(CLAUDE_HOME, 'plugins', 'cache'), source: 'plugin' }
    ]
    if (workspaceRoot) {
      roots.unshift({ dir: path.join(workspaceRoot, '.claude', 'skills'), source: 'project' })
    }

    const found: ClaudeSkill[] = []
    const seen = new Set<string>()

    for (const { dir, source } of roots) {
      for (const file of await ClaudeService.#findSkillFiles(dir)) {
        if (seen.has(file)) continue
        seen.add(file)

        const skill = await ClaudeService.#readSkill(file, source)
        if (skill) found.push(skill)
      }
    }

    return found.sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Walk for SKILL.md, bounded so a deep plugin tree cannot spiral. */
  static async #findSkillFiles(dir: string, depth = 0): Promise<string[]> {
    if (depth > 5) return []
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    const out: string[] = []

    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isFile() && entry.name === 'SKILL.md') out.push(full)
      else if (entry.isDirectory() && entry.name !== 'node_modules') {
        out.push(...(await ClaudeService.#findSkillFiles(full, depth + 1)))
      }
    }
    return out
  }

  /** Pull name and description out of the YAML frontmatter at the top of a SKILL.md. */
  static async #readSkill(file: string, source: ClaudeSkill['source']): Promise<ClaudeSkill | null> {
    const text = await fs.readFile(file, 'utf8').catch(() => null)
    if (!text) return null

    const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
    const block = front?.[1] ?? ''
    const field = (key: string): string => {
      const m = new RegExp(`^${key}:\\s*(.+)$`, 'm').exec(block)
      return (m?.[1] ?? '').trim().replace(/^['"]|['"]$/g, '')
    }

    const name = field('name') || path.basename(path.dirname(file))
    if (!name) return null

    // Plugin skills live under cache/<marketplace>/<plugin>/..., which is the only
    // place the owning plugin's name appears.
    const parts = file.split(path.sep)
    const cacheAt = parts.indexOf('cache')
    const plugin = source === 'plugin' && cacheAt >= 0 ? parts[cacheAt + 2] : undefined

    return {
      name,
      description: field('description').slice(0, 300),
      source,
      plugin,
      path: file
    }
  }

  /** The configured model and enabled plugins, both read-only. */
  async config(sessionModel: string | null): Promise<ClaudeConfig> {
    let globalModel: string | null = null
    let plugins: string[] = []

    try {
      const raw = JSON.parse(await fs.readFile(path.join(CLAUDE_HOME, 'settings.json'), 'utf8'))
      globalModel = typeof raw.model === 'string' ? raw.model : null
      plugins = Object.keys(raw.enabledPlugins ?? {}).map((key) => key.split('@')[0])
    } catch {
      // No settings file yet, which is a perfectly normal state.
    }

    return { globalModel, sessionModel, plugins }
  }
}
