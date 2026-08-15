import { describe, it, expect } from 'vitest'
import { encode, decode, type Command, type Event } from './ptyProtocol'

describe('pty protocol framing', () => {
  it('round-trips a command', () => {
    const command: Command = { op: 'write', id: 'a', data: 'ls\r' }
    const { messages, rest } = decode<Command>(encode(command))
    expect(messages).toEqual([command])
    expect(rest).toBe('')
  })

  it('reads several messages out of one chunk', () => {
    const buffer = encode({ ev: 'data', id: 'a', data: '1' }) + encode({ ev: 'data', id: 'a', data: '2' })
    const { messages } = decode<Event>(buffer)
    expect(messages).toHaveLength(2)
  })

  /*
   * The case that actually happens: a socket splits a write wherever it likes, so a
   * message routinely arrives in pieces. Losing the remainder loses terminal output.
   */
  it('holds a partial message until the rest of it arrives', () => {
    const whole = encode({ ev: 'data', id: 'a', data: 'hello' })
    const cut = Math.floor(whole.length / 2)

    const first = decode<Event>(whole.slice(0, cut))
    expect(first.messages).toHaveLength(0)
    expect(first.rest).toBe(whole.slice(0, cut))

    const second = decode<Event>(first.rest + whole.slice(cut))
    expect(second.messages).toEqual([{ ev: 'data', id: 'a', data: 'hello' }])
    expect(second.rest).toBe('')
  })

  it('survives a newline inside the payload, because terminal output is full of them', () => {
    const event: Event = { ev: 'data', id: 'a', data: 'line one\nline two\n' }
    const { messages } = decode<Event>(encode(event))
    expect(messages).toEqual([event])
  })

  it('drops a corrupt line instead of taking the connection down with it', () => {
    const buffer = 'not json at all\n' + encode({ ev: 'exit', id: 'a', exitCode: 0 })
    const { messages } = decode<Event>(buffer)
    expect(messages).toEqual([{ ev: 'exit', id: 'a', exitCode: 0 }])
  })

  it('ignores blank lines', () => {
    const { messages } = decode<Event>('\n\n' + encode({ ev: 'denied' }))
    expect(messages).toEqual([{ ev: 'denied' }])
  })

  it('carries binary-ish output without mangling it', () => {
    // Terminal output is full of escape sequences; JSON has to survive them intact.
    const data = '[31mred[0m  é 🚀'
    const { messages } = decode<Event>(encode({ ev: 'data', id: 'a', data }))
    expect((messages[0] as { data: string }).data).toBe(data)
  })
})
