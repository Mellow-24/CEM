/** Manual and armed automatic playback for one committed assistant message. */

import { useEffect } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VoicePlaybackProps } from './slots.ts'
import { SpeakerIcon, StopIcon } from './icons.tsx'
import css from './VoiceControls.module.css'

/** Final assistant-message speech action; unavailable Host profiles render nothing. */
export function VoicePlaybackAction({
  messageId, messageSeq, useVoice, ensureProfile, claimAutoPlayback, play, stop, t,
}: VoicePlaybackProps) {
  const voice = useVoice(view => view)
  useEffect(() => { void ensureProfile() }, [ensureProfile])
  useEffect(() => {
    if (voice.autoPlaybackArmed && claimAutoPlayback(messageSeq)) void play(messageId)
  }, [claimAutoPlayback, messageId, messageSeq, play, voice.autoPlaybackArmed])

  if (voice.profileState !== 'ready' || voice.profile?.synthesis === undefined) return null

  const playback = voice.playback
  let active = false
  let failure: string | undefined
  if (playback !== null && playback.messageId === messageId) {
    active = playback.status === 'loading' || playback.status === 'playing'
    if (playback.status === 'error') failure = playback.error ?? 'unknown error'
  }
  const failed = failure !== undefined
  const label = active ? t('playback.stop') : failed ? t('playback.retry') : t('playback.play')

  return (
    <>
      <Tooltip label={label} side="bottom">
        <button
          type="button"
          disabled={voice.callActive}
          className={css.messageAction}
          aria-label={label}
          aria-pressed={active || undefined}
          data-active={active || undefined}
          onClick={() => { if (active) stop(messageId); else void play(messageId) }}
        >
          {active ? <StopIcon /> : <SpeakerIcon />}
        </button>
      </Tooltip>
      {failed && (
        <span className={css.visuallyHidden} role="status">
          {t('status.playbackError', { message: failure })}
        </span>
      )}
    </>
  )
}
