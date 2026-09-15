// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  browserVoicePlatform, RECORDING_TIMESLICE_MS, selectRecordingMediaType, VoicePlatformError,
} from '../src/client/platform.ts'

function dataEvent(blob: Blob): Event {
  const event = new Event('dataavailable')
  Object.defineProperty(event, 'data', { value: blob })
  return event
}

class FakeMediaRecorder extends EventTarget {
  static readonly isTypeSupported = vi.fn((type: string) => type === 'audio/webm;codecs=opus')
  static last: FakeMediaRecorder | undefined
  static startFailure: Error | undefined
  readonly mimeType: string
  state: RecordingState = 'inactive'
  readonly start = vi.fn((timeslice?: number) => {
    if (FakeMediaRecorder.startFailure !== undefined) throw FakeMediaRecorder.startFailure
    this.state = 'recording'
    void timeslice
  })
  readonly stop = vi.fn(() => {
    this.state = 'inactive'
    this.dispatchEvent(new Event('stop'))
  })

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super()
    this.mimeType = options?.mimeType ?? ''
    FakeMediaRecorder.last = this
  }

  emit(blob: Blob): void {
    this.dispatchEvent(dataEvent(blob))
  }
}

function installRecorder() {
  const track = { stop: vi.fn() }
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const getUserMedia = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  return { getUserMedia, stream, track }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  FakeMediaRecorder.last = undefined
  FakeMediaRecorder.startFailure = undefined
  FakeMediaRecorder.isTypeSupported.mockClear()
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
})

describe('recording media negotiation', () => {
  it('uses browser preference within the Host allowlist, then Host-only fallbacks', () => {
    const supported = vi.fn((type: string) => type === 'audio/mp4' || type === 'audio/custom')
    expect(selectRecordingMediaType(['audio/custom', 'audio/mp4', 'audio/webm;codecs=opus'], supported))
      .toBe('audio/mp4')
    expect(selectRecordingMediaType(['audio/custom'], supported)).toBe('audio/custom')
    expect(selectRecordingMediaType(['audio/none'], supported)).toBeUndefined()
  })

  it('fails loud when microphone APIs or a shared media type are unavailable', async () => {
    await expect(browserVoicePlatform.record(['audio/webm'], 8, new AbortController().signal))
      .rejects.toMatchObject({ code: 'microphone-unavailable' })

    installRecorder()
    await expect(browserVoicePlatform.record(['audio/mp4'], 8, new AbortController().signal))
      .rejects.toMatchObject({ code: 'recording-unsupported' })
  })
})

describe('browserVoicePlatform recording', () => {
  it('records with a timeslice, accumulates complete chunks, and stops every track', async () => {
    const { getUserMedia, track } = installRecorder()
    const recording = await browserVoicePlatform.record(
      ['audio/webm;codecs=opus'],
      16,
      new AbortController().signal,
    )
    const recorder = FakeMediaRecorder.last!
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    })
    expect(recorder.start).toHaveBeenCalledWith(RECORDING_TIMESLICE_MS)
    recorder.emit(new Blob(['ab']))
    recorder.emit(new Blob(['cd']))
    const blob = await recording.stop()
    expect(blob.size).toBe(4)
    expect(blob.type).toBe('audio/webm;codecs=opus')
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('stops during capture as soon as accumulated chunks cross maxBytes', async () => {
    const { track } = installRecorder()
    const recording = await browserVoicePlatform.record(
      ['audio/webm;codecs=opus'],
      4,
      new AbortController().signal,
    )
    const recorder = FakeMediaRecorder.last!
    recorder.emit(new Blob(['123']))
    recorder.emit(new Blob(['45']))
    await expect(recording.stop()).rejects.toMatchObject({
      name: 'VoicePlatformError',
      code: 'recording-too-large',
    })
    expect(recorder.stop).toHaveBeenCalledOnce()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('rejects start failure before publishing a recording handle', async () => {
    const { track } = installRecorder()
    const failure = new Error('encoder refused start')
    FakeMediaRecorder.startFailure = failure
    await expect(browserVoicePlatform.record(
      ['audio/webm;codecs=opus'],
      8,
      new AbortController().signal,
    )).rejects.toBe(failure)
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('cancels capture on AbortSignal and rejects stop as AbortError', async () => {
    const { track } = installRecorder()
    const abort = new AbortController()
    const recording = await browserVoicePlatform.record(['audio/webm;codecs=opus'], 8, abort.signal)
    abort.abort()
    await expect(recording.stop()).rejects.toMatchObject({ name: 'AbortError' })
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('does not request microphone permission when already cancelled', async () => {
    const { getUserMedia } = installRecorder()
    const abort = new AbortController()
    abort.abort()
    await expect(browserVoicePlatform.record(['audio/webm;codecs=opus'], 8, abort.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('stops a microphone track when permission resolves after cancellation', async () => {
    const { getUserMedia, stream, track } = installRecorder()
    let resolvePermission!: (value: MediaStream) => void
    const permission = new Promise<MediaStream>((resolve) => { resolvePermission = resolve })
    getUserMedia.mockReturnValueOnce(permission)
    const abort = new AbortController()
    const recording = browserVoicePlatform.record(['audio/webm;codecs=opus'], 8, abort.signal)
    abort.abort()
    resolvePermission(stream)
    await expect(recording).rejects.toMatchObject({ name: 'AbortError' })
    expect(track.stop).toHaveBeenCalledOnce()
  })
})

describe('browserVoicePlatform playback', () => {
  function fakeAudio(play: () => Promise<void>) {
    const pause = vi.fn()
    const load = vi.fn()
    const removeAttribute = vi.fn()
    const audio = new EventTarget() as HTMLAudioElement
    Object.assign(audio, {
      preload: '',
      src: '',
      play: vi.fn(play),
      pause,
      load,
      removeAttribute,
    })
    vi.spyOn(document, 'createElement').mockReturnValue(audio)
    return { audio, load, pause, removeAttribute }
  }

  function events() {
    const onPlaying = vi.fn()
    const onEnded = vi.fn()
    const onError = vi.fn()
    return { callbacks: { onPlaying, onEnded, onError }, onPlaying, onEnded, onError }
  }

  it('publishes playing/ended and unloads the progressive URL', async () => {
    const media = fakeAudio(() => Promise.resolve())
    const lifecycle = events()
    browserVoicePlatform.play({ url: '/speech.mp3', playbackRate: 1.15 }, lifecycle.callbacks, new AbortController().signal)
    expect(media.audio.playbackRate).toBe(1.15)
    expect(media.audio.preservesPitch).toBe(true)
    expect(media.audio.src).toBe('/speech.mp3')
    media.audio.dispatchEvent(new Event('playing'))
    media.audio.dispatchEvent(new Event('ended'))
    expect(lifecycle.onPlaying).toHaveBeenCalledOnce()
    expect(lifecycle.onEnded).toHaveBeenCalledOnce()
    expect(media.pause).toHaveBeenCalledOnce()
    expect(media.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('reports play rejection and leaves caller-owned explicit retry state', async () => {
    const media = fakeAudio(() => Promise.reject(new Error('autoplay denied')))
    const lifecycle = events()
    browserVoicePlatform.play({ url: '/speech.mp3' }, lifecycle.callbacks, new AbortController().signal)
    await Promise.resolve()
    await Promise.resolve()
    expect(lifecycle.onError).toHaveBeenCalledOnce()
    expect(media.removeAttribute).toHaveBeenCalledWith('src')
  })

  it('unloads playback on abort without reporting an error', () => {
    const media = fakeAudio(() => Promise.resolve())
    const lifecycle = events()
    const abort = new AbortController()
    browserVoicePlatform.play({ url: '/speech.mp3' }, lifecycle.callbacks, abort.signal)
    abort.abort()
    expect(media.pause).toHaveBeenCalledOnce()
    expect(lifecycle.onError).not.toHaveBeenCalled()
  })

  it('contains a synchronous play failure', () => {
    const failure = new Error('sync play failure')
    const media = fakeAudio(() => { throw failure })
    const lifecycle = events()
    browserVoicePlatform.play({ url: '/speech.mp3' }, lifecycle.callbacks, new AbortController().signal)
    expect(lifecycle.onError).toHaveBeenCalledWith(failure)
    expect(media.pause).toHaveBeenCalledOnce()
  })

  it('best-effort unlock contains playback rejection', async () => {
    const media = fakeAudio(() => Promise.reject(new VoicePlatformError('recording-failed', 'blocked')))
    browserVoicePlatform.unlock()
    await Promise.resolve()
    await Promise.resolve()
    expect(media.pause).toHaveBeenCalledOnce()
  })
})
