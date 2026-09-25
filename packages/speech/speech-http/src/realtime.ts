/** Qwen streaming PCM transcription with server VAD and bounded transport queues. */

import WebSocket from 'ws'
import OpenCC from 'opencc-js/cn2t'
import type { SpeechRealtimeEvent, SpeechRealtimeInput } from '@deepseek-ai/dsh-speech-transcription'

const toHongKongTraditional = OpenCC.Converter({ from: 'cn', to: 'hk' })

/** Deployment-specific Qwen streaming recognition settings. */
export interface QwenRealtimeConfig {
  /** Absolute WebSocket endpoint; credentials are supplied separately. */
  readonly url: string
  /** Qwen realtime ASR model. */
  readonly model: string
  /** Server VAD silence interval ending a sentence. */
  readonly silenceMs: number
  /** Server VAD speech detection threshold. */
  readonly threshold: number
  /** Convert Han characters in partial and final transcripts to Hong Kong Traditional Chinese. */
  readonly traditionalChineseOutput?: boolean
  /** Maximum connected call duration. */
  readonly maxDurationMs: number
  /** Maximum pending encoded provider input bytes. */
  readonly maxBufferedBytes: number
}

/**
 * Open an authenticated Qwen recognition stream; resolves after session.updated.
 * @param config - endpoint and VAD settings.
 * @param headers - server-resolved credentials.
 * @param timeoutMs - connection/setup deadline.
 * @param maxEventBytes - maximum provider event bytes.
 * @param maxTextChars - maximum partial/final transcript length.
 * @param emit - normalized event observer.
 * @param signal - call lifetime cancellation.
 * @returns ready PCM input, with asynchronous close.
 */
export async function openQwenRealtime(
  config: QwenRealtimeConfig, headers: Record<string, string>, timeoutMs: number,
  maxEventBytes: number, maxTextChars: number,
  emit: (event: SpeechRealtimeEvent) => void, signal: AbortSignal,
): Promise<SpeechRealtimeInput> {
  signal.throwIfAborted()
  const url = new URL(config.url)
  url.searchParams.set('model', config.model)
  const socket = new WebSocket(url, { headers, handshakeTimeout: timeoutMs, maxPayload: maxEventBytes, followRedirects: false })
  let ready = false
  let closing = false
  let sequence = 0
  const transcript = (text: string): string => {
    if (text.length > maxTextChars) throw new Error('Transcript exceeds limit')
    const normalized = config.traditionalChineseOutput ? toHongKongTraditional(text) : text
    if (normalized.length > maxTextChars) throw new Error('Transcript exceeds limit')
    return normalized
  }
  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const setup = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
  let resolveClosed!: () => void
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve })
  const notify = (event: SpeechRealtimeEvent): void => {
    try { emit(event) } catch { fail('Speech recognition observer failed') }
  }
  const fail = (message: string): void => {
    if (closing) return
    closing = true
    rejectReady(new Error(message))
    if (ready) {
      try { emit({ type: 'error', message }) } catch { /* Observer failure cannot prevent socket teardown. */ }
    }
    socket.terminate()
  }
  const abort = (): void => { fail('Speech recognition was cancelled') }
  const deadline = setTimeout(() => { fail('Speech recognition setup timed out') }, timeoutMs)
  const duration = setTimeout(() => { fail('The maximum voice call duration was reached') }, config.maxDurationMs)
  signal.addEventListener('abort', abort, { once: true })
  const send = async (body: object): Promise<void> => {
    if (closing || socket.readyState !== WebSocket.OPEN) throw new Error('Speech recognition connection closed')
    const encoded = JSON.stringify({ event_id: `event_${String(++sequence)}`, ...body })
    if (socket.bufferedAmount + Buffer.byteLength(encoded) > config.maxBufferedBytes) {
      fail('Speech recognition upload is too slow')
      throw new Error('Speech recognition upload is too slow')
    }
    await new Promise<void>((resolve, reject) => { socket.send(encoded, (error) =>{  if (error) reject(error); else resolve() }) })
  }
  socket.on('open', () => {
    void send({ type: 'session.update', session: {
      modalities: ['text'], input_audio_format: 'pcm', sample_rate: 16000,
      input_audio_transcription: {},
      turn_detection: { type: 'server_vad', threshold: config.threshold, silence_duration_ms: config.silenceMs },
    } }).catch(() => { fail('Speech recognition setup failed') })
  })
  socket.on('message', (data, binary) => {
    if (closing) return
    try {
      if (binary) throw new Error('Unexpected binary recognition event')
      const value: unknown = JSON.parse((Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)).toString('utf8'))
      if (typeof value !== 'object' || value === null || !('type' in value)) throw new Error('Invalid recognition event')
      const event = value as Record<string, unknown>
      switch (event['type']) {
        case 'session.updated':
          ready = true
          clearTimeout(deadline)
          resolveReady()
          break
        case 'input_audio_buffer.speech_started': notify({ type: 'speech-start' }); break
        case 'conversation.item.input_audio_transcription.text': {
          if (typeof event['text'] !== 'string' || typeof event['stash'] !== 'string') throw new Error('Invalid partial transcript')
          const text = event['text'] + event['stash']
          notify({ type: 'partial', text: transcript(text) })
          break
        }
        case 'conversation.item.input_audio_transcription.completed': {
          const text = event['transcript']
          if (typeof text !== 'string') throw new Error('Invalid final transcript')
          notify({ type: 'final', text: transcript(text) })
          break
        }
        case 'error':
        case 'conversation.item.input_audio_transcription.failed':
        case 'session.finished': fail('Qwen realtime recognition ended or failed'); break
        default: break // Provider lifecycle and accounting events do not contain transcript input.
      }
    } catch { fail('Invalid Qwen realtime recognition response') }
  })
  socket.on('error', () => { fail('Qwen realtime connection failed; check the endpoint and credential') })
  socket.on('close', () => {
    clearTimeout(deadline)
    clearTimeout(duration)
    signal.removeEventListener('abort', abort)
    if (!closing) {
      closing = true
      rejectReady(new Error('Speech recognition connection closed'))
      if (ready) notify({ type: 'error', message: 'Speech recognition connection closed' })
    }
    resolveClosed()
  })
  if (signal.aborted) abort()
  try { await setup } catch (error) { await closed; throw error }
  return {
    async send(pcm) {
      if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) throw new Error('Expected PCM16 audio')
      await send({ type: 'input_audio_buffer.append', audio: Buffer.from(pcm).toString('base64') })
    },
    async close() {
      if (!closing) { closing = true; socket.terminate() }
      await closed
    },
  }
}
