/** Bounded incremental decoding for DashScope Server-Sent Events. */

/** Stable parser failure categories. */
export type DashScopeSseErrorCode =
  | 'SSE_EVENT_TOO_LARGE'
  | 'SSE_RESPONSE_TOO_LARGE'
  | 'SSE_INVALID_UTF8'
  | 'SSE_TRUNCATED'

/** Parser failure that never includes event data. */
export class DashScopeSseError extends Error {
  /**
   * @param message - response-independent failure description.
   * @param code - stable parser failure category.
   * @param options - optional chained cause.
   */
  constructor(message: string, readonly code: DashScopeSseErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DashScopeSseError'
  }
}

/** Encoded SSE admission limits. */
export interface DashScopeSseLimits {
  /** Maximum bytes across the complete encoded response. */
  readonly maxResponseBytes: number
  /** Maximum bytes in one event before its blank-line separator. */
  readonly maxEventBytes: number
}

/** Incremental line and event state with memory bounded by `maxEventBytes`. */
class Parser {
  private line: Uint8Array
  private lineLength = 0
  private pendingCr = false
  private eventBytes = 0
  private readonly dataLines: Uint8Array[] = []

  constructor(private readonly maxEventBytes: number) {
    this.line = new Uint8Array(Math.min(maxEventBytes, 1024))
  }

  push(chunk: Uint8Array): string[] {
    const events: string[] = []
    for (const byte of chunk) {
      if (byte === 0x0a) {
        const terminatorBytes = this.pendingCr ? 2 : 1
        this.pendingCr = false
        this.finishLine(terminatorBytes, events)
        continue
      }
      if (this.pendingCr) {
        this.append(0x0d)
        this.pendingCr = false
      }
      if (byte === 0x0d) {
        this.pendingCr = true
      } else {
        this.append(byte)
      }
    }
    return events
  }

  finish(): void {
    if (this.pendingCr) {
      this.append(0x0d)
      this.pendingCr = false
    }
    if (this.lineLength > 0 || this.eventBytes > 0 || this.dataLines.length > 0) {
      throw new DashScopeSseError(
        'DashScope SSE ended before an event separator',
        'SSE_TRUNCATED',
      )
    }
  }

  private append(byte: number): void {
    if (this.eventBytes + this.lineLength + 1 > this.maxEventBytes) this.tooLarge()
    if (this.lineLength === this.line.length) {
      const capacity = Math.min(this.maxEventBytes, Math.max(1, this.line.length * 2))
      const grown = new Uint8Array(capacity)
      grown.set(this.line)
      this.line = grown
    }
    this.line[this.lineLength] = byte
    this.lineLength += 1
  }

  private finishLine(terminatorBytes: number, events: string[]): void {
    if (this.lineLength === 0) {
      const event = this.dispatch()
      if (event !== undefined) events.push(event)
      return
    }
    if (this.eventBytes + this.lineLength + terminatorBytes > this.maxEventBytes) this.tooLarge()
    this.eventBytes += this.lineLength + terminatorBytes
    const line = this.line.slice(0, this.lineLength)
    this.lineLength = 0
    validateLineUtf8(line)
    this.acceptLine(line)
  }

  private acceptLine(line: Uint8Array): void {
    if (line[0] === 0x3a) return
    let colon = -1
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] === 0x3a) {
        colon = index
        break
      }
    }
    const fieldEnd = colon < 0 ? line.length : colon
    if (!isDataField(line, fieldEnd)) return
    let valueStart = colon < 0 ? line.length : colon + 1
    if (line[valueStart] === 0x20) valueStart += 1
    this.dataLines.push(line.slice(valueStart))
  }

  private dispatch(): string | undefined {
    this.eventBytes = 0
    this.lineLength = 0
    if (this.dataLines.length === 0) return undefined
    const size = this.dataLines.reduce((total, line) => total + line.length, 0)
      + this.dataLines.length - 1
    const data = new Uint8Array(size)
    let offset = 0
    for (const [index, line] of this.dataLines.entries()) {
      if (index > 0) {
        data[offset] = 0x0a
        offset += 1
      }
      data.set(line, offset)
      offset += line.length
    }
    this.dataLines.length = 0
    // Each data line was already decoded fatally. Joining valid lines with
    // ASCII LF preserves valid UTF-8, so this decode cannot introduce a new failure.
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  }

  private tooLarge(): never {
    throw new DashScopeSseError(
      'DashScope SSE event exceeds maxEventBytes',
      'SSE_EVENT_TOO_LARGE',
    )
  }
}

function isDataField(line: Uint8Array, end: number): boolean {
  return end === 4
    && line[0] === 0x64
    && line[1] === 0x61
    && line[2] === 0x74
    && line[3] === 0x61
}

function validateLineUtf8(line: Uint8Array): void {
  if (line.length >= 3 && line[0] === 0xef && line[1] === 0xbb && line[2] === 0xbf) {
    throw new DashScopeSseError(
      'DashScope SSE must not contain a UTF-8 BOM',
      'SSE_INVALID_UTF8',
    )
  }
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line)
  } catch (error) {
    throw new DashScopeSseError(
      'DashScope SSE line is not valid UTF-8',
      'SSE_INVALID_UTF8',
      { cause: error },
    )
  }
}

/**
 * Decode SSE `data` values without retaining more than one bounded event.
 * @param source - encoded response chunks in arrival order.
 * @param limits - complete-response and per-event encoded byte limits.
 * @param signal - cancellation checked before and after every chunk.
 * @returns decoded data values, joining repeated `data:` fields with LF.
 */
export async function* parseDashScopeSse(
  source: AsyncIterable<Uint8Array>,
  limits: DashScopeSseLimits,
  signal: AbortSignal,
): AsyncIterable<string> {
  if (!Number.isSafeInteger(limits.maxResponseBytes) || limits.maxResponseBytes < 1
    || !Number.isSafeInteger(limits.maxEventBytes) || limits.maxEventBytes < 1
    || limits.maxEventBytes > limits.maxResponseBytes) {
    throw new TypeError('DashScope SSE limits require positive safe integers and maxEventBytes <= maxResponseBytes')
  }
  const parser = new Parser(limits.maxEventBytes)
  let responseBytes = 0
  for await (const chunk of source) {
    signal.throwIfAborted()
    if (chunk.byteLength > limits.maxResponseBytes - responseBytes) {
      throw new DashScopeSseError(
        'DashScope SSE response exceeds maxResponseBytes',
        'SSE_RESPONSE_TOO_LARGE',
      )
    }
    responseBytes += chunk.byteLength
    for (const event of parser.push(chunk)) yield event
  }
  signal.throwIfAborted()
  parser.finish()
}
