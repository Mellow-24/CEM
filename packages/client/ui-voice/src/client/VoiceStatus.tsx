/** Composer-dock status for recording, transcription, automatic reply, and playback. */

import { useEffect } from 'react'
import type { VoiceStatusProps } from './slots.ts'
import css from './VoiceControls.module.css'

/** Visible status for the current Session's transient voice operation. */
export function VoiceStatus({ useVoice, ensureProfile, t }: VoiceStatusProps) {
  const voice = useVoice(view => view)
  useEffect(() => { void ensureProfile() }, [ensureProfile])

  let text: string | null = null
  let error = false
  if (voice.profileState === 'error') {
    text = t('status.profileError', { message: voice.profileError ?? 'unknown error' })
    error = true
  } else if (voice.recordingState === 'error') {
    text = t('status.inputError', { message: voice.recordingError ?? 'unknown error' })
    error = true
  } else if (voice.recordingState === 'recording') {
    text = t('status.recording')
  } else if (voice.recordingState === 'transcribing' || voice.recordingState === 'requesting') {
    text = t('status.transcribing')
  } else if (voice.playback?.status === 'error') {
    text = t('status.playbackError', { message: voice.playback.error ?? 'unknown error' })
    error = true
  } else if (voice.playback?.status === 'loading') {
    text = t('status.generating')
  } else if (voice.playback?.status === 'playing') {
    text = t('status.playing')
  } else if (voice.autoPlaybackArmed) {
    text = t('status.awaitingReply')
  } else if (voice.voiceDraft !== null) {
    text = t(voice.profile?.synthesis === undefined ? 'status.transcriptDraft' : 'status.voiceDraft')
  }

  if (text === null) return null
  return (
    <span className={css.status} role={error ? 'alert' : 'status'} data-error={error || undefined}>
      {text}
    </span>
  )
}
