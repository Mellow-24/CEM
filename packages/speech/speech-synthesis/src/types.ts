/** Provider-neutral streaming speech-synthesis requests and media metadata. */

/** Text accepted by one synthesis provider operation. */
export interface SpeechSynthesisInput {
  /** Consumer-admitted text to synthesize. */
  readonly text: string
  /** Consumer-resolved BCP 47 reply language; omission uses provider policy. */
  readonly language?: string
}

/** Metadata accompanying one encoded audio stream. */
export interface SpeechAudioMetadata {
  /** Encoded output media type. */
  readonly mediaType: string
  /** Exact byte length when known before streaming. */
  readonly contentLength?: number
  /** PCM sample rate when meaningful for the media type. */
  readonly sampleRateHz?: number
  /** Channel count when meaningful for the media type. */
  readonly channels?: number
}

/** One synthesis output whose chunks are consumed once in provider order. */
export interface SpeechSynthesisOutput {
  /** Validated encoded-media metadata. */
  readonly metadata: SpeechAudioMetadata
  /** Encoded audio chunks. */
  readonly chunks: AsyncIterable<Uint8Array>
}

/** Browser-safe facts advertised for one synthesis profile. */
export interface SpeechSynthesisProfile {
  /** Scope-local profile name used for exact selection. */
  readonly profile: string
  /** Output media type promised by this profile. */
  readonly mediaType: string
  /** Maximum accepted input characters. */
  readonly maxInputChars: number
  /** Maximum encoded bytes emitted by one operation. */
  readonly maxOutputBytes: number
}

/** One streaming synthesis implementation registered under an agent-visible profile. */
export interface SpeechSynthesisProvider extends SpeechSynthesisProfile {
  /**
   * Start one encoded audio stream.
   * @param input - admitted final text.
   * @param signal - cancellation for provider setup and stream consumption.
   * @returns output metadata and ordered encoded chunks.
   */
  synthesize(input: SpeechSynthesisInput, signal: AbortSignal): Promise<SpeechSynthesisOutput>
}

/** Registration-bound synthesis operation returned by profile resolution. */
export interface ResolvedSpeechSynthesis {
  /** Detached public profile metadata. */
  readonly profile: SpeechSynthesisProfile
  /**
   * Validate text and start its encoded audio stream.
   * @param input - admitted text and optional resolved reply language.
   * @param signal - required cancellation signal.
   * @returns validated metadata and bounded encoded chunks.
   */
  synthesize(input: SpeechSynthesisInput, signal: AbortSignal): Promise<SpeechSynthesisOutput>
}
