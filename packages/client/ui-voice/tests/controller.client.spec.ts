import { describe, expect, it, vi } from 'vitest'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { VoiceSessionController } from '../src/client/controller.ts'
import type {
  SpeechProfile, VoiceAudioSource, VoiceClient, VoicePlatform, VoicePlayback, VoicePlaybackEvents, VoiceRecording,
} from '../src/client/contract.ts'

const SID = 'voice-session' as SessionId
const MID = (value: string) => value as MessageId
const PROFILE: SpeechProfile = {
  transcription: { profile: 'asr-cantonese', mediaTypes: ['audio/webm;codecs=opus'], maxBytes: 8 },
  synthesis: { profile: 'tts-cantonese', mediaType: 'audio/mpeg', maxInputChars: 4_000 },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function recordingOf(blob: Blob): VoiceRecording {
  const done = deferred<Blob>()
  return {
    mediaType: blob.type,
    completion: done.promise,
    stop: vi.fn(() => {
      done.resolve(blob)
      return done.promise
    }),
    cancel: vi.fn(() => { done.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) }),
  }
}

function bench(overrides: {
  profile?: VoiceClient['profile']
  transcribe?: VoiceClient['transcribe']
  synthesize?: VoiceClient['synthesize']
  recording?: VoiceRecording
} = {}) {
  const recording = overrides.recording
    ?? recordingOf(new Blob(['voice'], { type: 'audio/webm;codecs=opus' }))
  let playbackEvents: VoicePlaybackEvents | undefined
  const playbackStop = vi.fn<VoicePlayback['stop']>()
  const unlock = vi.fn<VoicePlatform['unlock']>()
  const record = vi.fn<VoicePlatform['record']>(async () => recording)
  const platformPlay = vi.fn<VoicePlatform['play']>((_source, events) => {
    playbackEvents = events
    return { stop: playbackStop }
  })
  const platform: VoicePlatform = {
    unlock,
    record,
    play: platformPlay,
  }
  const sourceDispose = vi.fn<NonNullable<VoiceAudioSource['dispose']>>()
  const source: VoiceAudioSource = { url: '/speech.mp3', dispose: sourceDispose }
  const profile = overrides.profile ?? vi.fn<VoiceClient['profile']>(async () => PROFILE)
  const transcribe = overrides.transcribe ?? vi.fn<VoiceClient['transcribe']>(async () => ({ text: '  你好  ' }))
  const synthesize = overrides.synthesize ?? vi.fn<VoiceClient['synthesize']>(async () => source)
  const client: VoiceClient = {
    profile,
    transcribe,
    synthesize,
  }
  const controller = new VoiceSessionController(SID, client, platform)
  return {
    client, controller, platform, recording, source, playbackStop, unlock, record, platformPlay,
    profile, transcribe, synthesize, sourceDispose,
    playbackEvents: () => playbackEvents,
  }
}

describe('VoiceSessionController profiles and recording', () => {
  it('single-flights and caches an available Host profile', async () => {
    const pending = deferred<SpeechProfile>()
    const profile = vi.fn(() => pending.promise)
    const b = bench({ profile })
    const first = b.controller.ensureProfile()
    const second = b.controller.ensureProfile()
    expect(profile).toHaveBeenCalledOnce()
    expect(b.controller.getSnapshot().profileState).toBe('loading')

    pending.resolve(PROFILE)
    await expect(first).resolves.toBe(PROFILE)
    await expect(second).resolves.toBe(PROFILE)
    expect(b.controller.getSnapshot()).toMatchObject({ profileState: 'ready', profile: PROFILE })
    await b.controller.ensureProfile()
    expect(profile).toHaveBeenCalledOnce()
  })

  it('hides an empty profile, surfaces a failed lookup, and retries after refresh', async () => {
    const profile = vi.fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('profile offline'))
      .mockResolvedValueOnce(PROFILE)
    const b = bench({ profile })
    await expect(b.controller.ensureProfile()).resolves.toBeUndefined()
    expect(b.controller.getSnapshot().profileState).toBe('unavailable')

    b.controller.refreshProfile()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.controller.getSnapshot()).toMatchObject({ profileState: 'error', profileError: 'profile offline' })

    b.controller.refreshProfile()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.controller.getSnapshot().profileState).toBe('ready')
  })

  it('records one complete Blob, applies the Host byte cap, and returns trimmed text', async () => {
    const b = bench()
    await b.controller.ensureProfile()
    await b.controller.startRecording()
    expect(b.record).toHaveBeenCalledWith(['audio/webm;codecs=opus'], 8, expect.any(AbortSignal))
    expect(b.controller.getSnapshot().recordingState).toBe('recording')

    await expect(b.controller.stopRecording()).resolves.toBe('你好')
    expect(b.transcribe).toHaveBeenCalledWith({
      sessionId: SID,
      profile: 'asr-cantonese',
      // Vitest's asymmetric matcher intentionally stands in for opaque Blob bytes.
      // oxlint-disable-next-line typescript/no-unsafe-assignment
      audio: expect.any(Blob),
    }, expect.any(AbortSignal))
    expect(b.controller.getSnapshot().recordingState).toBe('idle')
  })

  it('keeps a final-size backstop and never uploads an oversized recording', async () => {
    const recording = recordingOf(new Blob(['123456789'], { type: 'audio/webm;codecs=opus' }))
    const b = bench({ recording })
    await b.controller.ensureProfile()
    await b.controller.startRecording()
    await expect(b.controller.stopRecording()).resolves.toBeNull()
    expect(b.transcribe).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot()).toMatchObject({
      recordingState: 'error',
      recordingError: 'Recording exceeds the 8 byte limit.',
    })
  })

  it('returns null for a successful no-speech transcript', async () => {
    const b = bench({ transcribe: vi.fn().mockResolvedValue({ text: '   ' }) })
    await b.controller.ensureProfile()
    await b.controller.startRecording()
    await expect(b.controller.stopRecording()).resolves.toBeNull()
    expect(b.controller.getSnapshot().recordingState).toBe('idle')
  })

  it('cancels live capture, clears the automatic arm, and ignores late setup', async () => {
    const pending = deferred<VoiceRecording>()
    const platformDone = deferred<Blob>()
    const cancelLateRecording = vi.fn(() => {
      platformDone.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    })
    const platformRecording: VoiceRecording = {
      mediaType: 'audio/webm',
      completion: platformDone.promise,
      stop: vi.fn(() => platformDone.promise),
      cancel: cancelLateRecording,
    }
    const b = bench()
    b.record.mockReturnValueOnce(pending.promise)
    await b.controller.ensureProfile()
    b.controller.armAutoPlayback(-1)
    const start = b.controller.startRecording()
    await Promise.resolve()
    b.controller.cancelRecording()
    pending.resolve(platformRecording)
    await start
    expect(cancelLateRecording).toHaveBeenCalledOnce()
    expect(b.controller.getSnapshot()).toMatchObject({ recordingState: 'idle', autoPlaybackArmed: false })
  })

  it('does not start capture when the Session deactivates during profile lookup', async () => {
    const pending = deferred<SpeechProfile>()
    const b = bench({ profile: vi.fn(() => pending.promise) })
    const start = b.controller.startRecording()
    b.controller.deactivate()
    pending.resolve(PROFILE)
    await start
    expect(b.record).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot().recordingState).toBe('idle')
  })

  it('observes spontaneous encoder failure and contains listener exceptions', async () => {
    const done = deferred<Blob>()
    const recording: VoiceRecording = {
      mediaType: 'audio/webm',
      completion: done.promise,
      stop: vi.fn(() => done.promise),
      cancel: vi.fn(),
    }
    const b = bench({ recording })
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    const later = vi.fn()
    b.controller.subscribe(() => { throw new Error('listener failed') })
    b.controller.subscribe(later)
    await b.controller.ensureProfile()
    await b.controller.startRecording()
    done.reject(new Error('encoder failed'))
    await Promise.resolve()
    await Promise.resolve()
    expect(b.controller.getSnapshot()).toMatchObject({
      recordingState: 'error',
      recordingError: 'encoder failed',
    })
    expect(logger).toHaveBeenCalled()
    expect(later).toHaveBeenCalled()
  })
})

describe('VoiceSessionController arm and playback', () => {
  it('claims exactly the first post-arm committed assistant id', async () => {
    const b = bench()
    await b.controller.ensureProfile()
    b.controller.markVoiceDraft('已转写')
    b.controller.armAutoPlayback(20)
    expect(b.unlock).toHaveBeenCalledOnce()
    expect(b.controller.getSnapshot()).toMatchObject({ voiceDraft: null, autoPlaybackArmed: true })
    expect(b.controller.claimAutoPlayback(20)).toBe(false)
    expect(b.controller.claimAutoPlayback(21)).toBe(true)
    expect(b.controller.claimAutoPlayback(22)).toBe(false)
    expect(b.controller.getSnapshot().autoPlaybackArmed).toBe(false)
  })

  it('loads, progressively plays, and stops one addressed message', async () => {
    const pending = deferred<VoiceAudioSource>()
    const synthesize = vi.fn(() => pending.promise)
    const b = bench({ synthesize })
    await b.controller.ensureProfile()
    const play = b.controller.play(MID('reply'))
    await Promise.resolve()
    expect(b.controller.getSnapshot().playback).toEqual({ messageId: MID('reply'), status: 'loading' })
    pending.resolve(b.source)
    await play
    expect(b.synthesize).toHaveBeenCalledWith({
      sessionId: SID, messageId: MID('reply'), profile: 'tts-cantonese',
    }, expect.any(AbortSignal))
    b.playbackEvents()?.onPlaying()
    expect(b.controller.getSnapshot().playback).toEqual({ messageId: MID('reply'), status: 'playing' })

    b.controller.stopPlayback(MID('other'))
    expect(b.playbackStop).not.toHaveBeenCalled()
    b.controller.stopPlayback(MID('reply'))
    expect(b.playbackStop).toHaveBeenCalledOnce()
    expect(b.sourceDispose).toHaveBeenCalledOnce()
    expect(b.controller.getSnapshot().playback).toBeNull()
  })

  it('returns ended playback to idle and preserves explicit retry after autoplay rejection', async () => {
    const b = bench()
    await b.controller.ensureProfile()
    await b.controller.play(MID('ended'))
    b.playbackEvents()?.onEnded()
    expect(b.controller.getSnapshot().playback).toBeNull()

    await b.controller.play(MID('rejected'))
    b.playbackEvents()?.onError(new Error('autoplay denied'))
    expect(b.controller.getSnapshot().playback).toEqual({
      messageId: MID('rejected'), status: 'error', error: 'autoplay denied',
    })
  })

  it('aborts profile, recording, playback, and the arm when the Session deactivates', async () => {
    const profilePending = deferred<SpeechProfile>()
    const b = bench({ profile: vi.fn(() => profilePending.promise) })
    const profile = b.controller.ensureProfile()
    b.controller.markVoiceDraft('draft')
    b.controller.armAutoPlayback(-1)
    b.controller.deactivate()
    profilePending.resolve(PROFILE)
    await profile
    expect(b.controller.getSnapshot()).toMatchObject({
      profileState: 'idle', voiceDraft: null, autoPlaybackArmed: false, playback: null,
    })
    b.controller.dispose()
    await expect(b.controller.ensureProfile()).resolves.toBeUndefined()
  })

  it('does not synthesize when playback intent is cancelled during profile lookup', async () => {
    const pending = deferred<SpeechProfile>()
    const b = bench({ profile: vi.fn(() => pending.promise) })
    const play = b.controller.play(MID('late'))
    b.controller.deactivate()
    pending.resolve(PROFILE)
    await play
    expect(b.synthesize).not.toHaveBeenCalled()
    expect(b.controller.getSnapshot().playback).toBeNull()
  })
})
