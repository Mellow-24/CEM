import { describe, expect, it, vi } from 'vitest'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { createWebVoiceClient, parseSpeechProfile } from '../src/client/client.ts'

const SID = 'session/粤语' as SessionId
const MID = 'message?1' as MessageId

describe('speech profile wire validation', () => {
  it('accepts fractional playback speed and rejects unusable rates', () => {
    const call = { defaultGreeting: 'yue', greetings: { yue: { text: '你好。', url: '/api/speech/greeting?language=yue' } }, playbackRate: 1.15, microphone: { echoCancellation: true, noiseSuppression: true, autoGainControl: false }, maxPendingAudioMs: 8000, utteranceMergeMs: 10, interruption: { confirmationMs: 420, minimumMeaningfulCharacters: 3, echoMinimumCharacters: 6, echoSimilarityThreshold: 0.82, backchannelMaximumCharacters: 6 }, sentenceMaxChars: 160, sentencePauseMinChars: 12, sentenceQueueLimit: 32, responseTimeoutMs: 1000 }
    expect(parseSpeechProfile({ call }).call?.playbackRate).toBe(1.15)
    expect(parseSpeechProfile({ call: { ...call, fallbackSynthesisProfile: 'tts-fallback' } }).call)
      .toMatchObject({ fallbackSynthesisProfile: 'tts-fallback' })
    expect(() => parseSpeechProfile({ call: { ...call, fallbackSynthesisProfile: '' } }))
      .toThrow(/fallbackSynthesisProfile/)
    expect(() => parseSpeechProfile({ call: { ...call, defaultGreeting: 'missing' } })).toThrow('Default greeting')
    expect(() => parseSpeechProfile({ call: { ...call, greetings: { yue: { text: '你好', url: 'https://outside.test/audio' } } } })).toThrow('Invalid greeting audio URL')
    for (const rate of [0, 2.1, NaN, '1.15', undefined]) {
      expect(() => parseSpeechProfile({ call: { ...call, playbackRate: rate } })).toThrow(/playbackRate/)
    }
    expect(() => parseSpeechProfile({ call: { ...call, utteranceMergeMs: -1 } })).toThrow(/utteranceMergeMs/)
    expect(() => parseSpeechProfile({ call: { ...call, interruption: {
      ...call.interruption, echoSimilarityThreshold: 0.49,
    } } })).toThrow(/echoSimilarityThreshold/)
    expect(() => parseSpeechProfile({ call: { ...call, interruption: undefined } })).toThrow(/interruption/)
    expect(() => parseSpeechProfile({ call: { ...call, sentencePauseMinChars: 161 } }))
      .toThrow(/sentencePauseMinChars/)
    for (const milliseconds of [1900, 2050, 60100, undefined]) {
      expect(() => parseSpeechProfile({ call: { ...call, maxPendingAudioMs: milliseconds } })).toThrow(/maxPendingAudioMs/)
    }
    expect(() => parseSpeechProfile({ call: { ...call,
      microphone: { ...call.microphone, autoGainControl: 'false' } } })).toThrow(/autoGainControl/)
  })

  it('accepts absent operations and a complete two-operation profile', () => {
    expect(parseSpeechProfile({})).toEqual({})
    expect(parseSpeechProfile({
      transcription: { profile: 'asr', mediaTypes: ['audio/webm', 'audio/mp4'], maxBytes: 1024 },
      synthesis: { profile: 'tts', mediaType: 'audio/mpeg', maxInputChars: 4000 },
    })).toEqual({
      transcription: { profile: 'asr', mediaTypes: ['audio/webm', 'audio/mp4'], maxBytes: 1024 },
      synthesis: { profile: 'tts', mediaType: 'audio/mpeg', maxInputChars: 4000 },
    })
  })

  it.each([
    [null, 'speech profile must be an object'],
    [{ extra: true }, 'unknown field'],
    [{ transcription: { profile: '', mediaTypes: ['audio/webm'], maxBytes: 1 } }, 'transcription.profile'],
    [{ transcription: { profile: 'asr', mediaTypes: [], maxBytes: 1 } }, 'mediaTypes'],
    [{ transcription: { profile: 'asr', mediaTypes: [''], maxBytes: 1 } }, 'mediaTypes'],
    [{ transcription: { profile: 'asr', mediaTypes: ['audio/webm'], maxBytes: 0 } }, 'maxBytes'],
    [{ synthesis: { profile: 'tts', mediaType: '', maxInputChars: 1 } }, 'synthesis.mediaType'],
    [{ synthesis: { profile: 'tts', mediaType: 'audio/mpeg', maxInputChars: 1.5 } }, 'maxInputChars'],
  ])('rejects invalid Host profile data: %j', (value, message) => {
    expect(() => parseSpeechProfile(value)).toThrow(message)
  })
})

describe('createWebVoiceClient', () => {
  it('folds a missing Host route to unavailable and validates a successful profile', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('missing', { status: 404 }))
      .mockResolvedValueOnce(Response.json({
        transcription: { profile: 'asr', mediaTypes: ['audio/webm'], maxBytes: 8 },
      }))
    const client = createWebVoiceClient(fetcher)
    const signal = new AbortController().signal
    await expect(client.profile(SID, signal)).resolves.toEqual({})
    await expect(client.profile(SID, signal)).resolves.toMatchObject({
      transcription: { profile: 'asr', maxBytes: 8 },
    })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/speech/profile?sessionId=session%2F%E7%B2%A4%E8%AF%AD')
    expect(fetcher.mock.calls[0]?.[1]).toEqual({ method: 'GET', signal })
  })

  it('keeps explicit unavailability and a cold Session quiet until summary invalidation', async () => {
    const client = createWebVoiceClient(vi.fn()
      .mockResolvedValueOnce(Response.json({ code: 'PROFILE_UNAVAILABLE' }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ error: { code: 'SESSION_NOT_LIVE' } }, { status: 404 })))
    const signal = new AbortController().signal
    await expect(client.profile(SID, signal)).resolves.toEqual({})
    await expect(client.profile(SID, signal)).resolves.toEqual({})
  })

  it('sends the complete Blob with its actual media type and validates transcript JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ text: '你好', language: 'yue-Hant-HK' }))
    const client = createWebVoiceClient(fetcher)
    const signal = new AbortController().signal
    const audio = new Blob(['voice'], { type: 'audio/webm;codecs=opus' })
    await expect(client.transcribe({ sessionId: SID, profile: 'asr/1', audio }, signal))
      .resolves.toEqual({ text: '你好', language: 'yue-Hant-HK' })
    expect(fetcher).toHaveBeenCalledWith(
      '/api/speech/transcribe?sessionId=session%2F%E7%B2%A4%E8%AF%AD&profile=asr%2F1',
      {
        method: 'POST',
        headers: { 'content-type': 'audio/webm;codecs=opus' },
        body: audio,
        signal,
      },
    )
  })

  it('builds an encoded progressive synthesis URL without buffering audio', async () => {
    const fetcher = vi.fn()
    const client = createWebVoiceClient(fetcher)
    await expect(client.synthesize({ sessionId: SID, messageId: MID, profile: 'tts/1' }, new AbortController().signal))
      .resolves.toEqual({
        url: '/api/speech/synthesize?sessionId=session%2F%E7%B2%A4%E8%AF%AD&messageId=message%3F1&profile=tts%2F1',
      })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each([
    ['profile', () => new Response('down', { status: 503 }), 'speech profile request failed: HTTP 503'],
    ['transcribe', () => new Response('down', { status: 413 }), 'speech transcription request failed: HTTP 413'],
  ])('reports non-success %s status', async (operation, response, message) => {
    const client = createWebVoiceClient(vi.fn().mockResolvedValue(response()))
    const signal = new AbortController().signal
    const promise = operation === 'profile'
      ? client.profile(SID, signal)
      : client.transcribe({ sessionId: SID, profile: 'asr', audio: new Blob(['x']) }, signal)
    await expect(promise).rejects.toThrow(message)
  })

  it.each([
    [{}, 'text and optional language fields only'],
    [{ text: 1 }, 'text must be a string'],
    [{ text: 'ok', language: '' }, 'language must be a non-empty string'],
    [{ text: 'ok', extra: true }, 'text and optional language fields only'],
  ])('rejects malformed transcription responses: %j', async (body, message) => {
    const client = createWebVoiceClient(vi.fn().mockResolvedValue(Response.json(body)))
    await expect(client.transcribe({
      sessionId: SID,
      profile: 'asr',
      audio: new Blob(['x']),
    }, new AbortController().signal)).rejects.toThrow(message)
  })

  it('accepts an empty no-speech transcript', async () => {
    const client = createWebVoiceClient(vi.fn().mockResolvedValue(Response.json({ text: '' })))
    await expect(client.transcribe({
      sessionId: SID,
      profile: 'asr',
      audio: new Blob(['silence']),
    }, new AbortController().signal)).resolves.toEqual({ text: '' })
  })
})
