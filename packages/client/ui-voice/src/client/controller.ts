/** React-free per-session voice profile, recording, arm, and playback owner. */

import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  SpeechProfile, VoiceAudioSource, VoiceClient, VoicePlatform, VoicePlayback, VoiceRecording,
  VoiceSessionObservable, VoiceSessionView,
} from './contract.ts'

const INITIAL_VIEW: VoiceSessionView = {
  profileState: 'idle',
  recordingState: 'idle',
  voiceDraft: null,
  autoPlaybackArmed: false,
  playback: null,
}

/** True for cancellation from a Session switch, a new recording, or disposal. */
function isAbort(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/** Stable diagnostic text for UI-owned failure rows. */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Session controller shared by every voice entry mounted for that Session. */
export class VoiceSessionController implements VoiceSessionObservable {
  private readonly listeners = new Set<() => void>()
  private view: VoiceSessionView = INITIAL_VIEW
  private disposed = false

  private profileEpoch = 0
  private profileAbort: AbortController | undefined
  private profilePending: Promise<SpeechProfile | undefined> | undefined

  private recordingEpoch = 0
  private recordingAbort: AbortController | undefined
  private recording: VoiceRecording | undefined

  private playbackEpoch = 0
  private playbackAbort: AbortController | undefined
  private playback: VoicePlayback | undefined
  private playbackSource: VoiceAudioSource | undefined

  /** Highest assistant-message seq already committed when voice-send armed. */
  private autoPlaybackBaselineSeq: number | undefined

  /**
   * @param sessionId - owning Session.
   * @param client - Host-backed speech transport.
   * @param platform - injectable browser recording/playback adapter.
   */
  constructor(
    readonly sessionId: SessionId,
    private readonly client: VoiceClient,
    private readonly platform: VoicePlatform,
  ) {}

  /**
   * Observe state changes until the returned disposer runs.
   * @param listener - state-change callback.
   * @returns disposer for this subscription.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot(): VoiceSessionView {
    return this.view
  }

  /**
   * Exclude manual media operations while a call owns them.
   * @param active - whether a call is open.
   */
  setCallActive(active: boolean): void {
    if (this.view.callActive === active) return
    this.publish({ ...this.view, callActive: active })
  }

  /**
   * Load and cache the exact operations authorized for this live Agent scope.
   * @returns authorized operations, or undefined when speech is unavailable.
   */
  ensureProfile(): Promise<SpeechProfile | undefined> {
    if (this.disposed) return Promise.resolve(undefined)
    if (this.view.profileState === 'ready') return Promise.resolve(this.view.profile)
    if (this.view.profileState === 'unavailable') return Promise.resolve(undefined)
    if (this.profilePending !== undefined) return this.profilePending

    const epoch = ++this.profileEpoch
    const abort = new AbortController()
    this.profileAbort = abort
    this.publish({ ...this.withoutProfileFields(), profileState: 'loading' })
    const pending = this.client.profile(this.sessionId, abort.signal).then((profile) => {
      if (!this.profileCurrent(epoch, abort)) return undefined
      if (profile.transcription === undefined && profile.synthesis === undefined) {
        this.publish({ ...this.withoutProfileFields(), profileState: 'unavailable' })
        return undefined
      }
      this.publish({ ...this.withoutProfileFields(), profileState: 'ready', profile })
      return profile
    }).catch((error: unknown) => {
      if (!this.profileCurrent(epoch, abort) || isAbort(error)) return undefined
      this.clearAutoPlayback()
      this.publish({
        ...this.withoutProfileFields(),
        profileState: 'error',
        profileError: errorText(error),
      })
      return undefined
    }).finally(() => {
      if (epoch === this.profileEpoch) {
        this.profilePending = undefined
        this.profileAbort = undefined
      }
    })
    this.profilePending = pending
    return pending
  }

  /** Drop cached authority and reload after the Web connection re-establishes. */
  refreshProfile(): void {
    if (this.disposed) return
    this.abortProfileRequest()
    this.publish({ ...this.withoutProfileFields(), profileState: 'idle' })
    void this.ensureProfile()
  }

  /** Request microphone access and begin one complete recording. */
  async startRecording(): Promise<void> {
    if (this.isDisposed() || this.view.recordingState === 'requesting'
      || this.view.recordingState === 'recording' || this.view.recordingState === 'transcribing') return
    this.clearAutoPlayback()
    this.clearVoiceDraft()
    this.stopPlayback()
    const epoch = ++this.recordingEpoch
    const abort = new AbortController()
    this.recordingAbort = abort
    this.publish({ ...this.withoutRecordingError(), recordingState: 'requesting' })
    const profile = await this.ensureProfile()
    if (!this.recordingCurrent(epoch, abort)) return
    const transcription = profile?.transcription
    if (transcription === undefined) {
      this.recordingAbort = undefined
      this.publish({ ...this.withoutRecordingError(), recordingState: 'idle' })
      return
    }
    try {
      const recording = await this.platform.record(transcription.mediaTypes, transcription.maxBytes, abort.signal)
      if (!this.recordingCurrent(epoch, abort)) {
        void recording.completion.catch(() => undefined)
        recording.cancel()
        return
      }
      this.recording = recording
      this.observeRecording(recording, epoch, abort)
      this.publish({ ...this.withoutRecordingError(), recordingState: 'recording' })
    } catch (error: unknown) {
      if (!this.recordingCurrent(epoch, abort) || isAbort(error)) return
      this.recordingAbort = undefined
      this.publish({
        ...this.withoutRecordingError(),
        recordingState: 'error',
        recordingError: errorText(error),
      })
    }
  }

  /**
   * Finish recording and transcribe its complete Blob.
   * @returns trimmed recognized text, or null after cancellation, failure, or an empty result.
   */
  async stopRecording(): Promise<string | null> {
    const recording = this.recording
    const abort = this.recordingAbort
    const transcription = this.view.profile?.transcription
    if (recording === undefined || abort === undefined || transcription === undefined) return null
    const epoch = this.recordingEpoch
    this.recording = undefined
    this.publish({ ...this.withoutRecordingError(), recordingState: 'transcribing' })
    try {
      const audio = await recording.stop()
      if (!this.recordingCurrent(epoch, abort)) return null
      if (audio.size > transcription.maxBytes) {
        throw new Error(`Recording exceeds the ${String(transcription.maxBytes)} byte limit.`)
      }
      const result = await this.client.transcribe({
        sessionId: this.sessionId,
        profile: transcription.profile,
        audio,
      }, abort.signal)
      if (!this.recordingCurrent(epoch, abort)) return null
      this.recordingAbort = undefined
      this.publish({ ...this.withoutRecordingError(), recordingState: 'idle' })
      const text = result.text.trim()
      return text === '' ? null : text
    } catch (error: unknown) {
      if (!this.recordingCurrent(epoch, abort) || isAbort(error)) return null
      this.recordingAbort = undefined
      this.clearAutoPlayback()
      this.publish({
        ...this.withoutRecordingError(),
        recordingState: 'error',
        recordingError: errorText(error),
      })
      return null
    }
  }

  /** Cancel microphone/transcription work and clear any pending automatic reply. */
  cancelRecording(): void {
    ++this.recordingEpoch
    this.recordingAbort?.abort()
    this.recordingAbort = undefined
    this.recording?.cancel()
    this.recording = undefined
    this.clearAutoPlayback()
    this.publish({ ...this.withoutRecordingError(), recordingState: 'idle' })
  }

  /**
   * Mark the exact draft written from the latest recognized utterance.
   * @param draft - complete composer text after transcription was appended.
   */
  markVoiceDraft(draft: string): void {
    if (this.disposed) return
    this.publish({ ...this.view, voiceDraft: draft })
  }

  /** Return the input button to microphone mode without changing its draft. */
  clearVoiceDraft(): void {
    if (this.view.voiceDraft === null) return
    this.publish({ ...this.view, voiceDraft: null })
  }

  /**
   * Arm the first assistant message absent from the synchronous pre-submit baseline.
   * The platform unlock attempt runs inside the user's voice-send gesture.
   * @param committedThroughSeq - highest assistant-message seq committed before input submission.
   */
  armAutoPlayback(committedThroughSeq: number): void {
    if (this.disposed) return
    this.platform.unlock()
    this.autoPlaybackBaselineSeq = committedThroughSeq
    this.publish({ ...this.view, voiceDraft: null, autoPlaybackArmed: true })
  }

  /** Clear an unclaimed automatic reply after send failure, cancellation, or switch. */
  clearAutoPlayback(): void {
    this.autoPlaybackBaselineSeq = undefined
    if (!this.view.autoPlaybackArmed) return
    this.publish({ ...this.view, autoPlaybackArmed: false })
  }

  /**
   * Atomically claim an armed new committed assistant message.
   * @param messageSeq - durable seq of the mounted finalized assistant message.
   * @returns true only for the first commit after the arm-time boundary.
   */
  claimAutoPlayback(messageSeq: number): boolean {
    const baseline = this.autoPlaybackBaselineSeq
    if (!this.view.autoPlaybackArmed || baseline === undefined || messageSeq <= baseline) return false
    this.autoPlaybackBaselineSeq = undefined
    this.publish({ ...this.view, autoPlaybackArmed: false })
    return true
  }

  /**
   * Synthesize and progressively play one committed assistant message.
   * @param messageId - committed assistant message selected for playback.
   */
  async play(messageId: MessageId): Promise<void> {
    if (this.isDisposed()) return
    this.cancelPlayback(false)
    const epoch = ++this.playbackEpoch
    const abort = new AbortController()
    this.playbackAbort = abort
    const profile = await this.ensureProfile()
    if (!this.playbackCurrent(epoch, abort)) return
    const synthesis = profile?.synthesis
    if (synthesis === undefined) {
      this.playbackAbort = undefined
      return
    }
    this.publish({ ...this.view, playback: { messageId, status: 'loading' } })
    try {
      const source = await this.client.synthesize({
        sessionId: this.sessionId,
        messageId,
        profile: synthesis.profile,
      }, abort.signal)
      if (!this.playbackCurrent(epoch, abort)) {
        source.dispose?.()
        return
      }
      this.playbackSource = source
      this.playback = this.platform.play(source, {
        onPlaying: () => {
          if (this.playbackCurrent(epoch, abort)) {
            this.publish({ ...this.view, playback: { messageId, status: 'playing' } })
          }
        },
        onEnded: () => {
          if (!this.playbackCurrent(epoch, abort)) return
          this.releasePlaybackResources()
          this.publish({ ...this.view, playback: null })
        },
        onError: (error) => {
          if (!this.playbackCurrent(epoch, abort)) return
          this.failPlayback(messageId, error)
        },
      }, abort.signal)
    } catch (error: unknown) {
      if (!this.playbackCurrent(epoch, abort) || isAbort(error)) return
      this.failPlayback(messageId, error)
    }
  }

  /**
   * Stop loading or playback; an optional id prevents another row stopping it.
   * @param messageId - message that owns the stop action, when row-scoped.
   */
  stopPlayback(messageId?: MessageId): void {
    if (messageId !== undefined && this.view.playback?.messageId !== messageId) return
    this.cancelPlayback(true)
  }

  /** Stop every transient operation when this Session leaves the stage. */
  deactivate(): void {
    if (this.disposed) return
    this.abortProfileRequest()
    this.cancelRecording()
    this.cancelPlayback(true)
    this.clearVoiceDraft()
  }

  /** Permanently release this Session's browser resources and observers. */
  dispose(): void {
    if (this.disposed) return
    this.deactivate()
    this.disposed = true
    this.listeners.clear()
  }

  private publish(view: VoiceSessionView): void {
    if (this.disposed || view === this.view) return
    this.view = view
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-voice] session listener threw:', error)
      }
    }
  }

  /** Re-read disposal across awaits; lifecycle methods may settle while an operation waits. */
  private isDisposed(): boolean {
    return this.disposed
  }

  private withoutProfileFields(): Omit<VoiceSessionView, 'profileState' | 'profile' | 'profileError'> {
    const { profileState: _state, profile: _profile, profileError: _error, ...rest } = this.view
    return rest
  }

  private withoutRecordingError(): Omit<VoiceSessionView, 'recordingState' | 'recordingError'> {
    const { recordingState: _state, recordingError: _error, ...rest } = this.view
    return rest
  }

  private profileCurrent(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.profileEpoch && !abort.signal.aborted
  }

  private recordingCurrent(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.recordingEpoch && !abort.signal.aborted
  }

  /** Consume recorder settlement immediately so failure never becomes an unhandled rejection or a stuck Recording UI. */
  private observeRecording(recording: VoiceRecording, epoch: number, abort: AbortController): void {
    void recording.completion.then(() => {
      if (!this.recordingCurrent(epoch, abort) || this.view.recordingState !== 'recording') return
      this.recording = undefined
      this.recordingAbort = undefined
      this.publish({
        ...this.withoutRecordingError(),
        recordingState: 'error',
        recordingError: 'Recording stopped before transcription was requested.',
      })
    }, (error: unknown) => {
      if (!this.recordingCurrent(epoch, abort) || isAbort(error) || this.view.recordingState !== 'recording') return
      this.recording = undefined
      this.recordingAbort = undefined
      this.clearAutoPlayback()
      this.publish({
        ...this.withoutRecordingError(),
        recordingState: 'error',
        recordingError: errorText(error),
      })
    })
  }

  private playbackCurrent(epoch: number, abort: AbortController): boolean {
    return !this.disposed && epoch === this.playbackEpoch && !abort.signal.aborted
  }

  private abortProfileRequest(): void {
    ++this.profileEpoch
    this.profileAbort?.abort()
    this.profileAbort = undefined
    this.profilePending = undefined
    if (this.view.profileState === 'loading') {
      this.publish({ ...this.withoutProfileFields(), profileState: 'idle' })
    }
  }

  private failPlayback(messageId: MessageId, error: unknown): void {
    this.clearAutoPlayback()
    this.releasePlaybackResources()
    this.publish({
      ...this.view,
      playback: { messageId, status: 'error', error: errorText(error) },
    })
  }

  private cancelPlayback(publish: boolean): void {
    ++this.playbackEpoch
    this.playbackAbort?.abort()
    this.releasePlaybackResources()
    if (publish && this.view.playback !== null) this.publish({ ...this.view, playback: null })
  }

  private releasePlaybackResources(): void {
    this.playbackAbort = undefined
    this.playback?.stop()
    this.playback = undefined
    this.playbackSource?.dispose?.()
    this.playbackSource = undefined
  }
}
