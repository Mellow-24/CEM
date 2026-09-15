/** Live Qwen TTS-to-ASR roundtrip using the Macau preset's provider configuration. */
import { Context } from '@deepseek-ai/cordis'
import { DashScopeSpeechSynthesisProvider } from '@deepseek-ai/dsh-speech-dashscope'
import { HttpSpeechTranscriptionProvider } from '@deepseek-ai/dsh-speech-http'
import { describe, expect, it, vi } from 'vitest'

const key = process.env.DASHSCOPE_API_KEY

describe.skipIf(!key)('Qwen customer-service speech roundtrip', () => {
  it('synthesizes a greeting and recognizes the generated speech', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: key, source: 'test' }) } as never)
    const tts = new DashScopeSpeechSynthesisProvider(ctx, {
      profile: 'macau', model: 'qwen-audio-3.0-tts-flash',
      voice: process.env.DSH_MACAU_TTS_VOICE ?? 'longanhuan_v3.6',
      endpoint: process.env.DSH_MACAU_TTS_URL ?? 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
      format: 'mp3', sampleRate: 22050, timeoutMs: 60000,
      maxInputChars: 100, maxOutputBytes: 2097152, maxResponseBytes: 4194304, maxEventBytes: 1048576,
    })
    const result = await tts.synthesize({ text: '你好，请问如何查询电费账单？' }, new AbortController().signal)
    const chunks: Uint8Array[] = []
    for await (const chunk of result.chunks) chunks.push(chunk)
    const data = Buffer.concat(chunks)
    expect(data.byteLength).toBeGreaterThan(1000)
    const asr = new HttpSpeechTranscriptionProvider(ctx, {
      profile: 'macau', protocol: 'qwen-asr', model: 'qwen3-asr-flash',
      url: process.env.DSH_MACAU_ASR_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKeyEnv: 'DASHSCOPE_API_KEY', mediaTypes: ['audio/mpeg'],
      timeoutMs: 60000, maxBytes: 6291456, maxResponseBytes: 65536, maxTranscriptChars: 4000,
    })
    const transcript = await asr.transcribe({ data, mediaType: 'audio/mpeg' }, new AbortController().signal)
    expect(transcript.text).toMatch(/电费|電費/)
    expect(transcript.text).toMatch(/账单|賬單|帐单/)
  }, 130000)
})


describe.skipIf(!key)('Qwen realtime ASR', () => {
  it('receives speech onset, live text, and automatic final text from paced PCM', async () => {
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: key, source: 'test' }) } as never)
    const tts = new DashScopeSpeechSynthesisProvider(ctx, {
      profile: 'macau', model: 'qwen-audio-3.0-tts-flash',
      voice: process.env.DSH_MACAU_TTS_VOICE ?? 'longanhuan_v3.6',
      endpoint: process.env.DSH_MACAU_TTS_URL ?? 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
      format: 'wav', sampleRate: 16000, timeoutMs: 60000,
      maxInputChars: 100, maxOutputBytes: 2097152, maxResponseBytes: 4194304, maxEventBytes: 1048576,
    })
    const speech = await tts.synthesize({ text: '你好，我想查询这个月的电费账单。' }, new AbortController().signal)
    const chunks: Uint8Array[] = []
    for await (const chunk of speech.chunks) chunks.push(chunk)
    const wav = Buffer.concat(chunks)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    let offset = 12
    while (wav.toString('ascii', offset, offset + 4) !== 'data') {
      offset += 8 + wav.readUInt32LE(offset + 4)
      if (offset > wav.length - 8) throw new Error('WAV has no PCM data')
    }
    const pcm = Buffer.concat([wav.subarray(offset + 8), Buffer.alloc(64000)])
    const asr = new HttpSpeechTranscriptionProvider(ctx, {
      profile: 'macau', protocol: 'qwen-asr', model: 'qwen3-asr-flash',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKeyEnv: 'DASHSCOPE_API_KEY', mediaTypes: ['audio/wav'], timeoutMs: 15000,
      maxBytes: 6291456, maxResponseBytes: 65536, maxTranscriptChars: 4000,
      realtime: {
        url: process.env.DSH_MACAU_ASR_REALTIME_URL ?? 'wss://dashscope.aliyuncs.com/api-ws/v1/realtime',
        model: 'qwen3-asr-flash-realtime', silenceMs: 400, threshold: 0.2,
        maxDurationMs: 60000, maxBufferedBytes: 64000,
      },
    })
    const events: { type: string; text?: string }[] = []
    const stream = await asr.openRealtime!((event) => { events.push(event) }, new AbortController().signal)
    try {
      for (let i = 0; i < pcm.length; i += 3200) {
        await stream.send(pcm.subarray(i, Math.min(i + 3200, pcm.length)))
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      await vi.waitFor(() => { expect(events.some(event => event.type === 'final')).toBe(true) }, { timeout: 15000 })
      expect(events.some(event => event.type === 'speech-start')).toBe(true)
      expect(events.some(event => event.type === 'partial')).toBe(true)
      expect(events.filter(event => event.type === 'final').map(event => event.text).join('')).toMatch(/电费|電費/)
    } finally { await stream.close() }
  }, 90000)
})
