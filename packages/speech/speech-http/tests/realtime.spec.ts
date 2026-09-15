/** Qwen event mapping and connection cleanup against a local WebSocket peer. */
import { WebSocketServer } from 'ws'
import { describe, expect, it, vi } from 'vitest'
import { openQwenRealtime } from '../src/realtime.ts'
import type { SpeechRealtimeEvent } from '@deepseek-ai/dsh-speech-transcription'

async function peer(ready = true) {
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => server.once('listening', resolve))
  const address = server.address()
  if (typeof address === 'string' || address === null) throw new Error('missing address')
  const frames: Record<string, unknown>[] = []
  const headers: string[] = []
  server.on('connection', (socket, request) => {
    headers.push(request.headers.authorization ?? '')
    socket.on('message', (data) => {
      const row = JSON.parse((Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)).toString('utf8')) as Record<string, unknown>
      frames.push(row)
      if (ready && row.type === 'session.update') socket.send(JSON.stringify({ type: 'session.updated' }))
    })
  })
  return {
    config: { url: `ws://127.0.0.1:${address.port}`, model: 'qwen-test', silenceMs: 400, threshold: 0.2, maxDurationMs: 10000, maxBufferedBytes: 64000 },
    server, frames, headers,
    async close() {
      for (const socket of server.clients) socket.terminate()
      await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
    },
  }
}

describe('Qwen realtime provider', () => {
  it('authenticates, waits for server configuration, maps onset and text, and sends PCM', async () => {
    const p = await peer()
    const events: SpeechRealtimeEvent[] = []
    const input = await openQwenRealtime(p.config, { authorization: 'Bearer test-key' }, 1000, 65536, 100, event => events.push(event), new AbortController().signal)
    try {
      expect(p.headers).toEqual(['Bearer test-key'])
      expect(p.frames[0]).toMatchObject({ type: 'session.update', session: { input_audio_format: 'pcm', sample_rate: 16000, turn_detection: { threshold: 0.2, silence_duration_ms: 400 } } })
      await input.send(new Uint8Array([1, 0, 2, 0]))
      await vi.waitFor(() => { expect(p.frames).toHaveLength(2) })
      expect(p.frames[1]).toMatchObject({ type: 'input_audio_buffer.append', audio: 'AQACAA==' })
      const socket = [...p.server.clients][0]!
      socket.send(JSON.stringify({ type: 'input_audio_buffer.speech_started' }))
      socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.text', text: '电费', stash: '账单' }))
      socket.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: '电费账单' }))
      await vi.waitFor(() => { expect(events).toEqual([{ type: 'speech-start' }, { type: 'partial', text: '电费账单' }, { type: 'final', text: '电费账单' }]) })
    } finally { await input.close(); await p.close() }
  })

  it('rejects oversized transcript events and releases the connection', async () => {
    const p = await peer()
    const events: SpeechRealtimeEvent[] = []
    const input = await openQwenRealtime(p.config, {}, 1000, 65536, 2, event => events.push(event), new AbortController().signal)
    try {
      ;[...p.server.clients][0]!.send(JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: 'too long' }))
      await vi.waitFor(() => { expect(events).toEqual([{ type: 'error', message: 'Invalid Qwen realtime recognition response' }]) })
      await vi.waitFor(() => { expect(p.server.clients.size).toBe(0) })
    } finally { await input.close(); await p.close() }
  })

  it('cancels setup before session.updated without leaving a socket', async () => {
    const p = await peer(false)
    const abort = new AbortController()
    const result = openQwenRealtime(p.config, {}, 1000, 65536, 100, () => {}, abort.signal)
    const rejected = expect(result).rejects.toThrow('cancelled')
    await vi.waitFor(() => { expect(p.frames).toHaveLength(1) })
    abort.abort()
    await rejected
    await vi.waitFor(() => { expect(p.server.clients.size).toBe(0) })
    await p.close()
  })
})
