import { writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import {
  DashScopeSpeechSynthesisProvider,
} from '@deepseek-ai/dsh-speech-dashscope'
import { describe, expect, it } from 'vitest'

const apiKey = process.env.DASHSCOPE_API_KEY

async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  for await (const chunk of source) chunks.push(chunk)
  return Buffer.concat(chunks)
}

describe.skipIf(apiKey === undefined)('speech-dashscope real API', () => {
  it.each([
    ['yue', '你好，我係澳電智能客服，請問有咩可以幫到你？'],
    ['zh', '您好，请问有什么可以帮您？'],
    ['en', 'Hello, how can I help you?'],
    ['pt', 'Olá, em que posso ajudar?'],
  ])('streams %s customer-service speech with the selected system voice', async (language, text) => {
    if (apiKey === undefined) throw new Error('e2e ran without DASHSCOPE_API_KEY')
    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => ({ value: apiKey, source: 'test' }) } as never)
    const provider = new DashScopeSpeechSynthesisProvider(ctx, {
      profile: 'customer-service-live', protocol: 'qwen-tts', model: 'qwen3-tts-flash',
      endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
      voice: 'Kiki', defaultLanguage: 'yue', voiceByLanguage: { zh: 'Cherry', en: 'Jennifer', pt: 'Maia' },
      format: 'wav', sampleRate: 24000, timeoutMs: 60000, maxInputChars: 600,
      maxOutputBytes: 2 * 1024 * 1024, maxResponseBytes: 4 * 1024 * 1024, maxEventBytes: 1024 * 1024,
    })
    const result = await provider.synthesize({ text, language }, new AbortController().signal)
    expect(result.metadata).toEqual({ mediaType: 'audio/wav', sampleRateHz: 24000 })
    const audio = await collect(result.chunks)
    expect(audio.subarray(0, 4).toString()).toBe('RIFF')
    expect(audio.byteLength).toBeGreaterThan(1000)
    expect(audio.subarray(44).some(byte => byte !== 0)).toBe(true)
    audio.writeUInt32LE(audio.length - 8, 4)
    audio.writeUInt32LE(audio.length - 44, 40)
    await writeFile(`/tmp/dsh-customer-service-${language}.wav`, audio)
  }, 90000)

  it('streams MP3 bytes from the configured Qwen model and authorized voice', async () => {
    if (apiKey === undefined) throw new Error('e2e ran without DASHSCOPE_API_KEY')
    const ctx = new Context()
    ctx.provide('credentials', {
      resolve: async () => ({ value: apiKey, source: 'test' }),
    } as never)
    const provider = new DashScopeSpeechSynthesisProvider(ctx, {
      profile: 'hk-feng-shui-live',
      model: 'qwen-audio-3.0-tts-flash',
      voice: 'qwen-audio-3.0-tts-flash-yishuiyue-e46ca9514e714a479eeb17e5fbfbfab7',
      format: 'mp3',
      sampleRate: 22050,
      instruction: '請以自然、親切的香港粵語朗讀。',
      enableAigcTag: true,
      timeoutMs: 60_000,
      maxInputChars: 100,
      maxOutputBytes: 2 * 1024 * 1024,
      maxResponseBytes: 4 * 1024 * 1024,
      maxEventBytes: 1024 * 1024,
    })

    const output = await provider.synthesize(
      { text: '你好，歡迎使用香港風水顧問。' },
      new AbortController().signal,
    )
    expect(output.metadata).toEqual({ mediaType: 'audio/mpeg', sampleRateHz: 22050 })
    const audio = await collect(output.chunks)
    expect(audio.byteLength).toBeGreaterThan(1_000)
    expect(audio.subarray(0, 3).toString('ascii')).toBe('ID3')
  }, 90_000)
})
