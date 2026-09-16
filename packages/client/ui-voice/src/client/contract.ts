/** Browser voice transport and media-platform contracts. */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId, SessionId } from '@deepseek-ai/dsh-client-connection/client'

/** Host-authorized transcription configuration for one live Agent scope. */
export interface SpeechTranscriptionProfile {
  /** Host profile id that the caller must echo on transcription. */
  readonly realtime?: boolean
  readonly profile: string
  /** Browser recording media types accepted by this profile. */
  readonly mediaTypes: readonly string[]
  /** Maximum complete recording body accepted by the Host. */
  readonly maxBytes: number
}

/** Host-authorized synthesis configuration for one live Agent scope. */
export interface SpeechSynthesisProfile {
  /** Host profile id that the caller must echo on synthesis. */
  readonly profile: string
  /** Audio media type returned by the streaming endpoint. */
  readonly mediaType: string
  /** Maximum admitted assistant text length accepted by this profile. */
  readonly maxInputChars: number
}

/** Voice operations currently available to one Session's live Agent. */
export interface SpeechProfile {
  readonly call?: SpeechCallOptions
  readonly transcription?: SpeechTranscriptionProfile
  readonly synthesis?: SpeechSynthesisProfile
}

/** Host-advertised automatic utterance detection and reply limits. */
export interface SpeechCallOptions {
  /** Prepared greetings indexed by response-language preference. */
  readonly greetings: Readonly<Record<string, {
    /** Caption matching the prepared recording. */
    readonly text: string
    /** Authorized same-origin audio URL. */
    readonly url: string
  }>>
  /** Greeting used for automatic language selection. */
  readonly defaultGreeting: string
  /** Pitch-preserving playback multiplier for call audio. */
  readonly playbackRate: number
  /** Browser microphone processing applied before PCM reaches recognition. */
  readonly microphone: {
    /** Suppress acoustic feedback from speaker playback. */
    readonly echoCancellation: boolean
    /** Apply the browser's background-noise suppression. */
    readonly noiseSuppression: boolean
    /** Let the browser amplify low-level input before server VAD. */
    readonly autoGainControl: boolean
  }
  /** Maximum wait for one completed answer, in milliseconds. */
  readonly responseTimeoutMs: number
  /** Maximum queued and in-flight microphone audio before a stalled uplink ends the call. */
  readonly maxPendingAudioMs: number
  /** Grace after a final ASR segment during which resumed speech stays in the same user message. */
  readonly utteranceMergeMs: number
  /** Multi-signal intent screening applied while an assistant answer is active. */
  readonly interruption: {
    /** Sustained partial-transcript time required before it can stop playback. */
    readonly confirmationMs: number
    /** Minimum normalized letters or numbers for a non-final utterance to claim the turn. */
    readonly minimumMeaningfulCharacters: number
    /** Minimum normalized characters before playback similarity can identify echo. */
    readonly echoMinimumCharacters: number
    /** Bigram similarity at or above which recognized text is treated as playback echo. */
    readonly echoSimilarityThreshold: number
    /** Maximum normalized length eligible for short acknowledgement classification. */
    readonly backchannelMaximumCharacters: number
  }
  /** Maximum characters in one TTS sentence. */
  readonly sentenceMaxChars: number
  /** Minimum characters before a comma-like pause can start TTS. */
  readonly sentencePauseMinChars: number
  /** Maximum pending sentences before the call stops. */
  readonly sentenceQueueLimit: number
  /** Alternate synthesis profile selected after the preferred provider fails before audio begins. */
  readonly fallbackSynthesisProfile?: string

}

/** Progressive same-origin audio source prepared by the Host client. */
export interface VoiceAudioSource {
  /** Optional pitch-preserving speed; ordinary message playback uses 1. */
  readonly playbackRate?: number
  /** URL whose response body streams the synthesized audio. */
  readonly url: string
  /** Release any client-owned URL or request token after playback settles. */
  readonly dispose?: () => void
}

/** One recorded assistant sentence; the prefix is hashed before crossing the wire. */
export interface VoiceSentence {
  readonly sessionId: SessionId
  readonly profile: string
  readonly turn: number
  readonly step: number
  readonly block: number
  readonly start: number
  readonly prefix: string
}

/** Same-origin browser transport owned by this UI package. */
export interface VoiceClient {
  /**
   * Prepare a streaming sentence source.
   * @param request - logged text prefix and coordinates.
   * @param signal - response lifetime.
   * @returns audio source.
   */
  synthesizeSentence?(request: VoiceSentence, signal: AbortSignal): Promise<VoiceAudioSource>

  /**
   * Open continuous recognition.
   * @param sessionId - live conversation.
   * @param profile - authorized recognizer.
   * @param event - streaming notifications.
   * @param signal - call lifetime.
   * @returns ready ordered PCM sender accepting 1–20 complete 100 ms frames per upload.
   */
  listen?(
    sessionId: SessionId, profile: string, event: (event: VoiceRecognitionEvent) => void, signal: AbortSignal,
  ): Promise<{ send(pcm: Uint8Array): Promise<void>; done: Promise<void> }>

  /**
   * Resolve the profiles authorized by the Session's current live Agent scope.
   * An object with neither operation means this Session has no voice UI.
   * @param sessionId - target Session.
   * @param signal - cancellation for a switch, reconnect, or plugin disposal.
   * @returns the exact Host-authorized operation profiles.
   */
  profile(sessionId: SessionId, signal: AbortSignal): Promise<SpeechProfile>
  /**
   * Transcribe one complete browser recording.
   * @param request - Session, authorized profile, and complete recorded Blob.
   * @param signal - cancellation for a switch, new recording, or disposal.
   * @returns recognized text; the UI appends it to the draft without submitting.
   */
  transcribe(request: {
    readonly sessionId: SessionId
    readonly profile: string
    readonly audio: Blob
  }, signal: AbortSignal): Promise<{ readonly text: string; readonly language?: string }>
  /**
   * Prepare a progressive synthesis source for one committed assistant message.
   * @param request - Session, durable message identity, and authorized profile.
   * @param signal - cancellation before the media element owns the request.
   * @returns a same-origin progressive audio source.
   */
  synthesize(request: {
    readonly sessionId: SessionId
    readonly messageId: MessageId
    readonly profile: string
  }, signal: AbortSignal): Promise<VoiceAudioSource>
}

/** One live browser recording whose bytes remain local until `stop`. */
export interface VoiceRecording {
  /** Actual MediaRecorder media type written into the complete Blob. */
  readonly mediaType: string
  /** Settlement observed immediately by the controller, including spontaneous recorder failures. */
  readonly completion: Promise<Blob>
  /** Finish capture, stop every track, and resolve the complete recording. */
  stop(): Promise<Blob>
  /** Cancel capture, stop every track, and reject any pending stop. */
  cancel(): void
}

/** Stop handle for one progressive media-element playback. */
export interface VoicePlayback {
  /** Pause, unload the URL, and release event handlers. */
  stop(): void
}

/** Playback lifecycle callbacks owned by the session controller. */
export interface VoicePlaybackEvents {
  readonly onPlaying: () => void
  readonly onEnded: () => void
  readonly onError: (error: unknown) => void
}

/** Narrow browser API adapter injected into the React-free controller. */
export interface VoicePlatform {
  /**
   * Preload a sentence without playing it.
   * @param source - streaming source.
   * @param signal - response lifetime.
   * @returns ordered playback and cleanup.
   */
  prepare?(source: VoiceAudioSource, signal: AbortSignal): {
    play(events: VoicePlaybackEvents): VoicePlayback
    stop(): void
  }

  /**
   * Capture continuous mono 16 kHz PCM16.
   * @param onFrame - 100 ms frame sink.
   * @param microphone - browser input processing selected by the Host.
   * @param signal - capture lifetime.
   * @returns capture cleanup.
   */
  capture?(
    onFrame: (pcm: Uint8Array) => void,
    microphone: SpeechCallOptions['microphone'],
    signal: AbortSignal,
  ): Promise<{ close(): Promise<void> }>

  /** Best-effort audio-policy unlock performed synchronously from voice-send. */
  unlock(): void
  /**
   * Request microphone access and start recording with one Host-accepted type.
   * @param mediaTypes - Host-accepted candidates.
   * @param maxBytes - complete recording byte cap, enforced while chunks arrive.
   * @param signal - lifetime cancellation.
   * @returns the live complete-recording handle.
   */
  record(mediaTypes: readonly string[], maxBytes: number, signal: AbortSignal): Promise<VoiceRecording>
  /**
   * Start progressive playback.
   * @param source - Host-prepared same-origin source.
   * @param events - playback lifecycle callbacks.
   * @param signal - lifetime cancellation.
   * @returns the stop handle.
   */
  play(source: VoiceAudioSource, events: VoicePlaybackEvents, signal: AbortSignal): VoicePlayback
}

/** Profile fetch lifecycle. */
export type VoiceProfileState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
/** Microphone/transcription lifecycle. */
export type VoiceRecordingState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error'
/** One addressed synthesis lifecycle. */
export interface VoicePlaybackState {
  readonly messageId: MessageId
  readonly status: 'loading' | 'playing' | 'error'
  readonly error?: string
}

/** Stable per-session view published to both voice slot entries. */
export interface VoiceSessionView {
  /** Automatic calls exclusively own the microphone and playback controls. */
  readonly callActive?: boolean
  readonly profileState: VoiceProfileState
  readonly profile?: SpeechProfile
  readonly profileError?: string
  readonly recordingState: VoiceRecordingState
  readonly recordingError?: string
  /** Exact draft produced by the latest transcription; null after edit/send. */
  readonly voiceDraft: string | null
  /** True from voice-send until one new committed assistant message claims it. */
  readonly autoPlaybackArmed: boolean
  readonly playback: VoicePlaybackState | null
}

/** Observable voice state shared by the input, status, and message entries. */
export type VoiceSessionObservable = HostObservable<VoiceSessionView>

/** Streaming recognition input for the call controller. */
export type VoiceRecognitionEvent = { readonly type: 'speech-start' }
  | { readonly type: 'partial' | 'final'; readonly text: string }
  | { readonly type: 'error'; readonly message: string }
