import {
  DashScopeSseError,
  parseDashScopeSse,
} from '../src/sse.ts'
import { describe, expect, it } from 'vitest'

const encoder = new TextEncoder()

async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield value
}

async function collect(
  source: AsyncIterable<Uint8Array>,
  maxResponseBytes: number,
  maxEventBytes: number,
): Promise<string[]> {
  const events: string[] = []
  for await (const event of parseDashScopeSse(
    source,
    { maxResponseBytes, maxEventBytes },
    new AbortController().signal,
  )) events.push(event)
  return events
}

function splitEveryByte(value: Uint8Array): Uint8Array[] {
  return [...value].map(byte => new Uint8Array([byte]))
}

describe('DashScope SSE parser', () => {
  it('preserves data across every byte boundary and accepts LF plus CRLF events', async () => {
    const wire = encoder.encode([
      'data: {"one":1}\n\n',
      ': heartbeat\r\n',
      'event: message\r\n',
      'data: {"two":\r\n',
      'data: 2}\r\n\r\n',
    ].join(''))
    await expect(collect(chunks(...splitEveryByte(wire)), wire.length, wire.length))
      .resolves.toEqual(['{"one":1}', '{"two":\n2}'])
  })

  it('accepts an event exactly at maxEventBytes and rejects one byte less', async () => {
    const event = encoder.encode('data: {"ok":true}\n\n')
    const encodedEventBytes = encoder.encode('data: {"ok":true}\n').length
    await expect(collect(chunks(event), event.length, encodedEventBytes))
      .resolves.toEqual(['{"ok":true}'])
    await expect(collect(chunks(event), event.length, encodedEventBytes - 1))
      .rejects.toMatchObject({ code: 'SSE_EVENT_TOO_LARGE' } satisfies Partial<DashScopeSseError>)
  })

  it('enforces maxEventBytes across accumulated source chunks', async () => {
    const first = encoder.encode('data: 1234')
    const second = encoder.encode('56\n\n')
    await expect(collect(chunks(first, second), first.length + second.length, 10))
      .rejects.toMatchObject({ code: 'SSE_EVENT_TOO_LARGE' })
  })

  it('accepts an exact complete-response bound and rejects single or accumulated overflow', async () => {
    const event = encoder.encode('data: {}\n\n')
    await expect(collect(chunks(event), event.length, event.length))
      .resolves.toEqual(['{}'])
    await expect(collect(chunks(event), event.length - 1, event.length - 1))
      .rejects.toMatchObject({ code: 'SSE_RESPONSE_TOO_LARGE' })
    const middle = Math.floor(event.length / 2)
    await expect(collect(
      chunks(event.slice(0, middle), event.slice(middle)),
      event.length - 1,
      event.length - 1,
    )).rejects.toMatchObject({ code: 'SSE_RESPONSE_TOO_LARGE' })
  })

  it('rejects invalid UTF-8 without including event bytes in the error', async () => {
    const wire = new Uint8Array([
      ...encoder.encode('data: '),
      0xff,
      ...encoder.encode('\n\n'),
    ])
    await expect(collect(chunks(wire), wire.length, wire.length))
      .rejects.toMatchObject({ code: 'SSE_INVALID_UTF8', message: 'DashScope SSE line is not valid UTF-8' })
  })

  it('rejects invalid UTF-8 in comments and a UTF-8 BOM instead of skipping them', async () => {
    const comment = new Uint8Array([
      0x3a, 0x20, 0xff, 0x0a,
      ...encoder.encode('data: {}\n\n'),
    ])
    await expect(collect(chunks(comment), comment.length, comment.length))
      .rejects.toMatchObject({ code: 'SSE_INVALID_UTF8' })

    const bom = new Uint8Array([
      0xef, 0xbb, 0xbf,
      ...encoder.encode('data: {"first":1}\n\ndata: {"second":2}\n\n'),
    ])
    await expect(collect(chunks(bom), bom.length, bom.length))
      .rejects.toMatchObject({ code: 'SSE_INVALID_UTF8' })
  })

  it('rejects a final data event without a blank separator', async () => {
    const wire = encoder.encode('data: {"tail":true}')
    await expect(collect(chunks(wire), wire.length, wire.length))
      .rejects.toMatchObject({ code: 'SSE_TRUNCATED' })
  })

  it('handles bare CR, grows a long line, and ignores events without data', async () => {
    const longComment = `: ${'x'.repeat(1100)}\n\n`
    const wire = encoder.encode([
      'retry\rvalue\n\n',
      'event: message\n\n',
      '\n',
      longComment,
      'data\n\n',
      'data:without-space\n\n',
    ].join(''))
    await expect(collect(chunks(wire), 4096, 2048))
      .resolves.toEqual(['', 'without-space'])
  })

  it('rejects a trailing lone CR as a truncated event', async () => {
    const wire = encoder.encode('data: {}\r')
    await expect(collect(chunks(wire), wire.length, wire.length))
      .rejects.toMatchObject({ code: 'SSE_TRUNCATED' })
  })

  it.each([
    [{ maxResponseBytes: 1.5, maxEventBytes: 1 }, 'fractional response'],
    [{ maxResponseBytes: 0, maxEventBytes: 1 }, 'zero response'],
    [{ maxResponseBytes: 2, maxEventBytes: 1.5 }, 'fractional event'],
    [{ maxResponseBytes: 2, maxEventBytes: 0 }, 'zero event'],
    [{ maxResponseBytes: 1, maxEventBytes: 2 }, 'event above response'],
  ])('rejects invalid limits: %s', async (limits) => {
    const source = chunks(encoder.encode('\n'))
    const run = async (): Promise<void> => {
      for await (const _event of parseDashScopeSse(source, limits, new AbortController().signal)) {
        throw new Error('invalid limits must yield no event')
      }
    }
    await expect(run()).rejects.toThrow(/limits require positive safe integers/)
  })

  it('honors a signal aborted before the first source chunk', async () => {
    const abort = new AbortController()
    const reason = new Error('stop parsing')
    abort.abort(reason)
    const run = async (): Promise<void> => {
      for await (const _event of parseDashScopeSse(
        chunks(encoder.encode('data: {}\n\n')),
        { maxResponseBytes: 32, maxEventBytes: 32 },
        abort.signal,
      )) {
        throw new Error('aborted parser must yield no event')
      }
    }
    await expect(run()).rejects.toBe(reason)
  })
})
