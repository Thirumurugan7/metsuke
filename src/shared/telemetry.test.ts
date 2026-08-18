import { describe, it, expect } from 'vitest'
import { scrub, isValidEvent, sanitiseEvent, type TelemetryEvent } from './telemetry'

const HOME = '/Users/jane.doe'

describe('scrub', () => {
  /*
   * The case this exists for. A stack trace from a user's machine names them and names
   * whatever they are building, and neither fact is needed to fix a null check.
   */
  it('removes the home directory, which is a person', () => {
    const out = scrub(`Error at ${HOME}/clients/acme-secret/src/index.ts:40`, HOME)
    expect(out).not.toContain('jane.doe')
    expect(out).not.toContain('acme-secret')
  })

  it('keeps enough of the path to find the file in our own source', () => {
    const out = scrub(`at ${HOME}/dev/metsuke/src/main/services/GitService.ts:112`, HOME)
    expect(out).toContain("services/GitService.ts")
    expect(out).toContain('112')
  })

  it('reduces an absolute path even when the home directory is unknown', () => {
    const out = scrub('/Users/someone-else/private/thing/file.ts:9')
    expect(out).not.toContain('someone-else')
    expect(out).not.toContain('private')
    expect(out).toContain('file.ts')
  })

  it('reduces Windows paths too', () => {
    const out = scrub('at C:\\Users\\Jane\\Documents\\secret-app\\src\\main.ts:3')
    expect(out).not.toContain('Jane')
    expect(out).not.toContain('secret-app')
  })

  it('reduces file urls, which survive a naive path match', () => {
    const out = scrub(`at file://${HOME}/work/nda-project/out/main/index.js:1926`, HOME)
    expect(out).not.toContain('nda-project')
  })

  /*
   * The rule the allowlist encodes: a directory we could have named is kept, a directory
   * the user named is not, however short the path is.
   */
  it('keeps a directory that could only be ours', () => {
    expect(scrub(`at ${HOME}/x/src/main/services/GitService.ts:112`, HOME)).toContain('services/GitService.ts')
    expect(scrub('/app/out/main/index.js:1926')).toContain('main/index.js')
  })

  it('drops a directory the user named, even directly under home', () => {
    const out = scrub(`ENOENT ${HOME}/unreleased-startup/plan.md`, HOME)
    expect(out).not.toContain('unreleased-startup')
    expect(out).toContain('plan.md')
  })

  it('removes email addresses', () => {
    expect(scrub('git config user.email jane@acme.co failed')).toContain('(email)')
    expect(scrub('git config user.email jane@acme.co failed')).not.toContain('acme.co')
  })

  /* Bridge tokens, session ids and api keys all look like this. */
  it('removes long hex strings, which are tokens more often than not', () => {
    const token = 'a'.repeat(64)
    expect(scrub(`authorization Bearer ${token}`)).not.toContain(token)
  })

  it('leaves an ordinary message alone', () => {
    const message = 'Cannot read properties of undefined (reading channel)'
    expect(scrub(message, HOME)).toBe(message)
  })

  it('does not fall over on an empty home directory', () => {
    expect(() => scrub('anything', '')).not.toThrow()
    expect(scrub('anything', '/')).toBe('anything')
  })
})

describe('isValidEvent', () => {
  it('accepts each declared event', () => {
    const events: TelemetryEvent[] = [
      { name: 'app_launched', firstRun: true, claudeInstalled: true, gitInstalled: true },
      { name: 'app_closed', sessionSeconds: 42 },
      { name: 'folder_opened', isGitRepo: true },
      { name: 'feature_used', feature: 'panel_git' },
      { name: 'terminal_spawned', kind: 'claude' },
      { name: 'thread_created', mode: 'instance', worktree: true },
      { name: 'thread_landed', conflicted: false },
      { name: 'preview_tool_used', tool: 'navigate' },
      { name: 'update_state', status: 'ready' },
      { name: 'error', kind: 'ipc', errorName: 'TypeError', message: 'boom' }
    ]
    for (const event of events) expect(isValidEvent(event)).toBe(true)
  })

  /*
   * The point of validating on the server as well as the client: a tampered or buggy
   * client must not be able to store a shape nobody has agreed to.
   */
  it('rejects an event name it has never heard of', () => {
    expect(isValidEvent({ name: 'file_contents', body: 'secret' })).toBe(false)
  })

  it('rejects the right name with the wrong types', () => {
    expect(isValidEvent({ name: 'folder_opened', isGitRepo: 'yes' })).toBe(false)
    expect(isValidEvent({ name: 'app_closed', sessionSeconds: 'ages' })).toBe(false)
    expect(isValidEvent({ name: 'app_closed', sessionSeconds: Number.NaN })).toBe(false)
  })

  it('rejects an oversized string rather than storing a document', () => {
    expect(isValidEvent({ name: 'error', kind: 'ipc', errorName: 'E', message: 'x'.repeat(5000) })).toBe(false)
  })

  it('rejects nonsense', () => {
    expect(isValidEvent(null)).toBe(false)
    expect(isValidEvent('event')).toBe(false)
    expect(isValidEvent([])).toBe(false)
  })
})

describe('sanitiseEvent', () => {
  it('scrubs the strings on an error event', () => {
    const out = sanitiseEvent(
      { name: 'error', kind: 'uncaught-exception', errorName: 'Error', message: `ENOENT ${HOME}/secret/plan.md`, stack: `at ${HOME}/secret/plan.md:1` },
      HOME
    ) as Extract<TelemetryEvent, { name: 'error' }>

    expect(out.message).not.toContain('secret')
    expect(out.stack).not.toContain('secret')
  })

  it('truncates a stack instead of shipping a novel', () => {
    const out = sanitiseEvent(
      { name: 'error', kind: 'ipc', errorName: 'E', message: 'm', stack: 'x'.repeat(9000) },
      HOME
    ) as Extract<TelemetryEvent, { name: 'error' }>
    expect(out.stack!.length).toBeLessThanOrEqual(2000)
    expect(isValidEvent(out)).toBe(true)
  })

  it('leaves events without strings untouched', () => {
    const event: TelemetryEvent = { name: 'terminal_spawned', kind: 'shell' }
    expect(sanitiseEvent(event, HOME)).toEqual(event)
  })
})
