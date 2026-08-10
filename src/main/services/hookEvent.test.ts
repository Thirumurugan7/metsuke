import { describe, it, expect } from 'vitest'
import { classifyHook, escapeMarkdown } from './hookEvent'

describe('classifyHook', () => {
  it('treats the Stop hook as a finished turn regardless of message', () => {
    expect(classifyHook('stop', 'anything at all')).toBe('finished')
    expect(classifyHook('stop', '')).toBe('finished')
  })

  it('recognises the wordings Claude uses when asking to run something', () => {
    const asks = [
      'Claude needs your permission to use Bash',
      'Allow Claude to edit src/app.ts?',
      'Approve this tool use',
      'Please confirm before continuing',
      'Authorize the write to disk'
    ]
    for (const message of asks) {
      expect(classifyHook('notification', message), message).toBe('permission')
    }
  })

  it('is case-insensitive', () => {
    expect(classifyHook('notification', 'PERMISSION REQUIRED')).toBe('permission')
  })

  it('falls back to idle for a waiting message', () => {
    expect(classifyHook('notification', 'Claude is waiting for your input')).toBe('idle')
  })

  it('falls back to idle when the hook carried no message', () => {
    expect(classifyHook('notification', '')).toBe('idle')
  })
})

describe('escapeMarkdown', () => {
  it('escapes every character Telegram MarkdownV2 reserves', () => {
    // Telegram rejects the whole message if any of these are unescaped.
    for (const char of '_*[]()~`>#+-=|{}.!\\') {
      expect(escapeMarkdown(char), `for ${char}`).toBe(`\\${char}`)
    }
  })

  it('leaves ordinary prose alone', () => {
    expect(escapeMarkdown('Claude needs permission')).toBe('Claude needs permission')
  })

  it('escapes a realistic tool-permission message', () => {
    expect(escapeMarkdown('Run `npm test` in /tmp/x-1.0?')).toBe(
      'Run \\`npm test\\` in /tmp/x\\-1\\.0?'
    )
  })

  it('does not double-escape a backslash into a broken pair', () => {
    expect(escapeMarkdown('a\\b')).toBe('a\\\\b')
  })
})
