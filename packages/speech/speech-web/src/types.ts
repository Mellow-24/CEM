/** Browser-safe HTTP payload types for the speech Web Consumer. */

/** Transcription capability visible to one live Session agent. */
export interface SpeechWebTranscriptionProfile {
  readonly realtime?: boolean
  readonly profile: string
  readonly mediaTypes: string[]
  readonly maxBytes: number
}

/** Synthesis capability visible to one live Session agent. */
export interface SpeechWebSynthesisProfile {
  readonly profile: string
  readonly mediaType: string
  readonly maxInputChars: number
  readonly maxOutputBytes: number
}

/** Agent-scoped speech capabilities; absent fields are unavailable. */
export interface SpeechWebProfile {
  /** Automatic utterance detection and reply deadline; absent disables calls. */
  readonly call?: SpeechCallOptions
  readonly transcription?: SpeechWebTranscriptionProfile
  readonly synthesis?: SpeechWebSynthesisProfile
}

/** Deployment-configured browser call limits, advertised only with both speech capabilities. */
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
  /** Maximum pending sentences before the call stops. */
  readonly sentenceQueueLimit: number
  /** Alternate synthesis profile selected after the preferred provider fails before audio begins. */
  readonly fallbackSynthesisProfile?: string

}

/** Successful transcription response. */
export interface SpeechWebTranscript {
  readonly text: string
  readonly language?: string
}

/** JSON error returned before a streaming response begins. */
export interface SpeechWebErrorBody {
  readonly error: {
    readonly code: string
    readonly message: string
  }
}
