import type { NotifyEvent } from '@shared/ipc'

/**
 * Work out which kind of alert a Claude Code hook delivery represents.
 *
 * The `Stop` hook is unambiguous. The `Notification` hook covers both "I need your
 * approval" and "I have been sitting here waiting", and its message text is the only
 * thing separating them — so this is a heuristic over Claude's own wording, kept in one
 * tested place rather than inline in the hook handler.
 */
export function classifyHook(kind: string, message: string): NotifyEvent {
  if (kind === 'stop') return 'finished'
  return /permission|approve|allow|confirm|authorize|authorise/i.test(message)
    ? 'permission'
    : 'idle'
}

/** MarkdownV2 requires every one of these escaped, or Telegram rejects the message. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (c) => `\\${c}`)
}
