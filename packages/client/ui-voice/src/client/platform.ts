/** MediaRecorder capture and progressive HTMLAudioElement playback. */

import { prepareAudio } from './playback.ts'
import { capturePcm } from './pcm.ts'
import type {
  VoicePlatform, VoicePlayback, VoiceRecording,
} from './contract.ts'

/** Cross-engine preference order; the Host profile still decides the allowed set. */
export const RECORDING_MEDIA_TYPE_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
] as const

/** One-sample silent WAV used only to exercise the user-gesture playback path. */
export const SILENT_WAV = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA=='
/** Chunk cadence that lets the byte limit stop capture before an unbounded final Blob. */
export const RECORDING_TIMESLICE_MS = 250

/** Error whose message can be surfaced by the localized status row. */
export class VoicePlatformError extends Error {
  /** Stable browser-operation failure category. */
  readonly code: 'microphone-unavailable' | 'recording-unsupported' | 'recording-failed' | 'recording-too-large'

  /** @param code - stable category. @param message - diagnostic detail. */
  constructor(
    code: VoicePlatformError['code'],
    message: string,
  ) {
    super(message)
    this.name = 'VoicePlatformError'
    this.code = code
  }
}

/** Abort error independent of the browser's optional DOMException constructor. */
function abortError(): Error {
  const error = new Error('voice operation aborted')
  error.name = 'AbortError'
  return error
}

/** Stop all microphone tracks exactly once. */
function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop()
}

/** Cancel the caller's wait even when the browser leaves a permission prompt open. */
async function requestMicrophone(devices: MediaDevices, signal: AbortSignal): Promise<MediaStream> {
  signal.throwIfAborted()
  let removeAbort = (): void => {}
  try {
    return await new Promise<MediaStream>((resolve, reject) => {
      const cancel = (): void => { reject(abortError()) }
      signal.addEventListener('abort', cancel, { once: true })
      removeAbort = () => { signal.removeEventListener('abort', cancel) }
      void devices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(
        (stream) => {
          if (signal.aborted) stopTracks(stream)
          else resolve(stream)
        }, reject,
      )
    })
  } finally { removeAbort() }
}

/**
 * Resolve the first Host-accepted recording type this browser can encode.
 * @param accepted - media types admitted by the selected transcription profile.
 * @param isSupported - browser encoder support predicate.
 * @returns selected media type, or undefined when none is supported.
 */
export function selectRecordingMediaType(
  accepted: readonly string[],
  isSupported: (mediaType: string) => boolean,
): string | undefined {
  const acceptedSet = new Set(accepted)
  const ordered = [
    ...RECORDING_MEDIA_TYPE_PREFERENCE.filter(mediaType => acceptedSet.has(mediaType)
      || accepted.some(type => mediaType.startsWith(`${type};`))),
    ...accepted.filter(mediaType => !RECORDING_MEDIA_TYPE_PREFERENCE.includes(
      mediaType as (typeof RECORDING_MEDIA_TYPE_PREFERENCE)[number],
    )),
  ]
  return ordered.find(isSupported)
}

/** Browser-owned complete recording handle. */
class MediaRecorderHandle implements VoiceRecording {
  readonly mediaType: string
  private readonly chunks: Blob[] = []
  readonly completion: Promise<Blob>
  private resolve!: (blob: Blob) => void
  private reject!: (error: unknown) => void
  private settled = false
  private cancelled = false
  private recordedBytes = 0
  private terminalError: unknown

  constructor(
    private readonly recorder: MediaRecorder,
    private readonly stream: MediaStream,
    private readonly signal: AbortSignal,
    fallbackMediaType: string,
    private readonly maxBytes: number,
  ) {
    this.mediaType = recorder.mimeType || fallbackMediaType
    this.completion = new Promise<Blob>((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })
    recorder.addEventListener('dataavailable', this.onData)
    recorder.addEventListener('error', this.onError)
    recorder.addEventListener('stop', this.onStop)
    signal.addEventListener('abort', this.onAbort, { once: true })
  }

  /** Start capture synchronously so the factory can reject instead of returning a dead handle. */
  begin(): void {
    if (this.signal.aborted) {
      this.abandon()
      throw abortError()
    }
    try {
      this.recorder.start(RECORDING_TIMESLICE_MS)
    } catch (error) {
      this.abandon()
      throw error
    }
  }

  async stop(): Promise<Blob> {
    if (!this.settled && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
      } catch (error) {
        this.finishError(error)
      }
    }
    return await this.completion
  }

  cancel(): void {
    if (this.settled) return
    this.cancelled = true
    if (this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop()
        return
      } catch {
        // The shared settlement below owns track release and the abort result.
      }
    }
    this.finishError(abortError())
  }

  private readonly onData = (event: BlobEvent): void => {
    if (event.data.size === 0) return
    if (this.recordedBytes + event.data.size > this.maxBytes) {
      const error = new VoicePlatformError(
        'recording-too-large',
        `Recording exceeds the ${String(this.maxBytes)} byte limit.`,
      )
      this.terminalError = error
      if (this.recorder.state !== 'inactive') {
        try {
          this.recorder.stop()
        } catch {
          // The explicit error settlement below owns resource release.
        }
      }
      this.finishError(error)
      return
    }
    this.chunks.push(event.data)
    this.recordedBytes += event.data.size
  }

  private readonly onError = (): void => {
    this.finishError(new VoicePlatformError('recording-failed', 'MediaRecorder reported an encoding failure.'))
  }

  private readonly onStop = (): void => {
    if (this.terminalError !== undefined) {
      this.finishError(this.terminalError)
      return
    }
    if (this.cancelled || this.signal.aborted) {
      this.finishError(abortError())
      return
    }
    this.finishSuccess(new Blob(this.chunks, { type: this.mediaType }))
  }

  private readonly onAbort = (): void => { this.cancel() }

  private finishSuccess(blob: Blob): void {
    if (this.settled) return
    this.settled = true
    this.cleanup()
    this.resolve(blob)
  }

  private finishError(error: unknown): void {
    if (this.settled) return
    this.settled = true
    this.cleanup()
    this.reject(error)
  }

  private cleanup(): void {
    this.signal.removeEventListener('abort', this.onAbort)
    this.recorder.removeEventListener('dataavailable', this.onData)
    this.recorder.removeEventListener('error', this.onError)
    this.recorder.removeEventListener('stop', this.onStop)
    stopTracks(this.stream)
  }

  /** Release a handle the factory never publishes, without rejecting an unobserved Promise. */
  private abandon(): void {
    if (this.settled) return
    this.settled = true
    this.cleanup()
  }
}

/** Browser implementation injected into every session controller. */
export const browserVoicePlatform: VoicePlatform = {
  unlock() {
    // Best effort only: browsers may still reject the later audible play after
    // the asynchronous synthesis request. That rejection reaches onError and
    // leaves the committed message's explicit retry button available.
    const audio = document.createElement('audio')
    audio.src = SILENT_WAV
    const release = (): void => {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    try {
      void audio.play().then(release, release)
    } catch {
      release()
    }
  },

  capture: capturePcm,

  async record(mediaTypes, maxBytes, signal) {
    const mediaDevices = (navigator as unknown as { mediaDevices?: MediaDevices }).mediaDevices
    const Recorder = (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder
    if (mediaDevices === undefined || Recorder === undefined) {
      throw new VoicePlatformError('microphone-unavailable', 'This browser does not expose microphone recording.')
    }
    const selected = selectRecordingMediaType(mediaTypes, mediaType => Recorder.isTypeSupported(mediaType))
    if (selected === undefined) {
      throw new VoicePlatformError('recording-unsupported', 'No Host-accepted recording media type is supported by this browser.')
    }
    const stream = await requestMicrophone(mediaDevices, signal)
    if (signal.aborted) {
      stopTracks(stream)
      throw abortError()
    }
    let recorder: MediaRecorder
    try {
      recorder = new Recorder(stream, { mimeType: selected })
    } catch (error) {
      stopTracks(stream)
      throw error
    }
    const recording = new MediaRecorderHandle(recorder, stream, signal, selected, maxBytes)
    recording.begin()
    return recording
  },

  prepare: prepareAudio,
  play(source, events, signal): VoicePlayback {
    return prepareAudio(source, signal).play(events)
  },
}
