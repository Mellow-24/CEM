import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { MiniStreamSpeechSynthesisProvider } from '../src/index.ts'

const token = process.env.MACAU_MINISTREAM_TTS_TOKEN

describe.skipIf(token === undefined)('MiniStream speech real API', () => {
  it('streams company Cantonese preset sentences as sequential MP3', async () => {
    if (token === undefined) throw new Error('e2e ran without MACAU_MINISTREAM_TTS_TOKEN')
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: token, source: 'test' }) } as never)
    const provider = new MiniStreamSpeechSynthesisProvider(ctx, {
      profile: 'customer-service-live',
      endpoint: 'wss://120.209.217.11:30700/ministream-ws/tts/{client_id}',
      apiKeyEnv: 'MACAU_MINISTREAM_TTS_TOKEN',
      defaultLanguage: 'yue',
      voicePresetKey: 'mailinlin',
      generationMode: 'preset_voice',
      maxGenerateLength: 500,
      normalize: true,
      timeoutMs: 60_000,
      firstAudioTimeoutMs: 10_000,
      maxInputChars: 600,
      maxOutputBytes: 2 * 1024 * 1024,
      maxEventBytes: 512 * 1024,
      tlsRejectUnauthorized: false,
    })
    const texts = ['你好，呢度係澳電智能客服。', '請問有咩可以幫到你？', '多謝你嘅查詢。']
    const outputs = []
    for (const text of texts) {
      const output = await provider.synthesize(
        { text, language: 'yue-Hant-MO' },
        new AbortController().signal,
      )
      const chunks: Uint8Array[] = []
      for await (const chunk of output.chunks) chunks.push(chunk)
      outputs.push({ output, chunks, audio: Buffer.concat(chunks) })
    }
    for (const { output, chunks, audio } of outputs) {
      expect(output.metadata).toEqual({ mediaType: 'audio/mpeg', sampleRateHz: 48000, channels: 1 })
      expect(audio.byteLength).toBeGreaterThan(1_000)
      expect(chunks.length).toBeGreaterThan(1)
      expect(audio[0]).toBe(0xff)
      expect((audio[1] ?? 0) & 0xe0).toBe(0xe0)
    }
  }, 90_000)
})
