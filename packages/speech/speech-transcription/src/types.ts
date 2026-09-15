/** Provider-neutral transcription requests, results, and profile metadata. */

/** Complete recorded audio submitted for one final transcript. */
export interface SpeechTranscriptionInput {
  /** Encoded audio bytes. */
  readonly data: Uint8Array
  /** Lowercase base media type verified against the selected profile. */
  readonly mediaType: string
}

/** Final provider transcript. */
export interface SpeechTranscript {
  /** Transcript text; empty means the recording contained no recognized speech. */
  readonly text: string
  /** Provider-reported BCP 47 language tag, when available. */
  readonly language?: string
}

/** Browser-safe facts advertised for one transcription profile. */
export interface SpeechTranscriptionProfile {
  /** Scope-local profile name used for exact selection. */
  readonly profile: string
  /** Whether streaming PCM recognition is available. */
  readonly realtime?: boolean
  /** Accepted lowercase base audio media types. */
  readonly mediaTypes: readonly string[]
  /** Maximum complete recording size. */
  readonly maxBytes: number
  /** Maximum transcript characters accepted from the provider. */
  readonly maxTranscriptChars: number
}

/** One transcription implementation registered under an agent-visible profile. */
export interface SpeechTranscriptionProvider extends SpeechTranscriptionProfile {
  /**
   * Open streaming recognition.
   * @param event - normalized recognition observer.
   * @param signal - call lifetime.
   * @returns ready PCM input.
   */
  openRealtime?(event: (event: SpeechRealtimeEvent) => void, signal: AbortSignal): Promise<SpeechRealtimeInput>
  /**
   * Produce one final transcript from a complete admitted recording.
   * @param input - validated complete audio input.
   * @param signal - cancellation for this provider operation.
   * @returns the final transcript.
   */
  transcribe(input: SpeechTranscriptionInput, signal: AbortSignal): Promise<SpeechTranscript>
}

/** Registration-bound transcription operation returned by profile resolution. */
export interface ResolvedSpeechTranscription {
  /**
   * Open streaming recognition.
   * @param event - normalized recognition observer.
   * @param signal - call lifetime.
   * @returns ready PCM input.
   */
  openRealtime?(event: (event: SpeechRealtimeEvent) => void, signal: AbortSignal): Promise<SpeechRealtimeInput>
  /** Detached public profile metadata. */
  readonly profile: SpeechTranscriptionProfile
  /**
   * Validate and transcribe one complete recording.
   * @param input - caller-supplied bytes and media type.
   * @param signal - required cancellation signal.
   * @returns the provider's validated final transcript.
   */
  transcribe(input: SpeechTranscriptionInput, signal: AbortSignal): Promise<SpeechTranscript>
}

/** Streaming recognition notifications; partial text is transient. */
export type SpeechRealtimeEvent = { readonly type: 'speech-start' }
  | { readonly type: 'partial' | 'final'; readonly text: string }
  | { readonly type: 'error'; readonly message: string }

/** Ready streaming recognizer. Input is mono PCM16 little-endian at 16 kHz. */
export interface SpeechRealtimeInput {
  /** Send ordered PCM bytes. @param pcm - bounded PCM frame. @returns provider write completion. */
  send(pcm: Uint8Array): Promise<void>
  /** End recognition and release transport resources. @returns transport quiescence. */
  close(): Promise<void>
}
