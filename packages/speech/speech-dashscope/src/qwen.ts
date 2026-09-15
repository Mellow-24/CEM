/** Qwen-TTS language names and streaming PCM framing for browser playback. */

import { SpeechSynthesisError } from '@deepseek-ai/dsh-speech-synthesis'

const LANGUAGES: Readonly<Record<string, string>> = {
  zh: 'Chinese', yue: 'Chinese', en: 'English', pt: 'Portuguese',
  fr: 'French', de: 'German', it: 'Italian', es: 'Spanish',
  ja: 'Japanese', ko: 'Korean', ru: 'Russian',
}

/**
 * Resolve a BCP 47 language to Qwen's language selector; Cantonese pronunciation comes from its voice.
 * @param language - Consumer-resolved or configured language.
 * @returns supported Qwen language name.
 */
export function qwenLanguage(language: string): string {
  const primary = language.toLowerCase().split('-')[0] ?? ''
  const result = LANGUAGES[primary]
  if (result === undefined) throw new SpeechSynthesisError('Qwen-TTS does not support this response language', 'UNSUPPORTED_LANGUAGE')
  return result
}

/**
 * Frame mono 24 kHz PCM16 as a WAV stream whose data size is not known until HTTP EOF.
 * @returns RIFF and PCM headers with streaming size sentinels.
 */
export function streamingWaveHeader(): Uint8Array {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(0xffffffff, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(24000, 24)
  header.writeUInt32LE(48000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(0xffffffff, 40)
  return header
}
