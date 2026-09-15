/** Injected callback faces and composed props for the three voice entries. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageId } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { VoiceSessionObservable } from './contract.ts'
import type { VoiceCallController } from './call.ts'
import type {} from './locales.ts'

/** Input-row mutation face over one session controller. */
export interface VoiceInputInjected {
  hooks: { voice: VoiceSessionObservable }
  ensureProfile: () => Promise<unknown>
  startRecording: () => Promise<void>
  stopRecording: () => Promise<string | null>
  cancelRecording: () => void
  markVoiceDraft: (draft: string) => void
  clearVoiceDraft: () => void
  armAutoPlayback: (committedThroughSeq: number) => void
  clearAutoPlayback: () => void
}

/** Status-row read face over the same controller. */
export interface VoiceStatusInjected {
  hooks: { voice: VoiceSessionObservable }
  ensureProfile: () => Promise<unknown>
}

/** Final assistant-message playback face over the same controller. */
export interface VoicePlaybackInjected {
  hooks: { voice: VoiceSessionObservable }
  ensureProfile: () => Promise<unknown>
  claimAutoPlayback: (messageSeq: number) => boolean
  play: (messageId: MessageId) => Promise<void>
  stop: (messageId: MessageId) => void
}

/** Props for the composer microphone and voice-send action. */
export type VoiceInputProps = PropsRuntime<'conversation.input.right'>
  & InjectFace<VoiceInputInjected>
  & PropsLocale<'voice'>

/** Call-only callbacks and transient state. */
export interface VoiceCallInjected {
  hooks: { voice: VoiceSessionObservable; call: VoiceCallController }
  ensureProfile: () => Promise<unknown>
  prepareGreeting: (language?: string) => void
  startCall: (language?: string) => void
  endCall: () => Promise<void>
}

/** Composer call button props. */
export type VoiceCallProps = PropsRuntime<'conversation.input.right'> & InjectFace<VoiceCallInjected> & PropsLocale<'voice'>

/** Props for transient recording, transcription, and playback diagnostics. */
export type VoiceStatusProps = PropsRuntime<'conversation.composer.dock'>
  & InjectFace<VoiceStatusInjected>
  & PropsLocale<'voice'>

/** Props for committed-assistant play and stop actions. */
export type VoicePlaybackProps = PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<VoicePlaybackInjected>
  & PropsLocale<'voice'>
