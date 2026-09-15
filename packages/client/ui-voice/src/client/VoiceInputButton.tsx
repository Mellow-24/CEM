/** Microphone, transcript-ready, and voice-send composer control. */

import { useEffect, useRef } from 'react'
import { IconSendOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VoiceInputProps } from './slots.ts'
import { MicrophoneIcon, StopIcon } from './icons.tsx'
import css from './VoiceControls.module.css'

/** Append a recognized utterance without changing or silently sending existing text. */
export function appendTranscript(draft: string, transcript: string): string {
  const text = transcript.trim()
  if (draft === '') return text
  if (text === '') return draft
  return `${draft}${draft.endsWith('\n') ? '' : '\n'}${text}`
}

/** Highest assistant seq already committed at the exact voice-send gesture. */
function committedAssistantSeq(session: VoiceInputProps['session']): number {
  let maximum = -1
  for (const node of session.nodes) {
    if (node.kind === 'assistant' && node.messageId !== undefined) maximum = Math.max(maximum, node.seq)
  }
  return maximum
}

/** Session-scoped microphone control; Host profile absence renders nothing. */
export function VoiceInputButton({
  session, input, inputActions, useVoice, ensureProfile, startRecording, stopRecording, cancelRecording,
  markVoiceDraft, clearVoiceDraft, armAutoPlayback, clearAutoPlayback, t,
}: VoiceInputProps) {
  const voice = useVoice(view => view)
  const sawArmedRun = useRef(false)
  const draftRef = useRef(input.draft)
  draftRef.current = input.draft

  useEffect(() => { void ensureProfile() }, [ensureProfile])

  // Editing or ordinary send breaks the exact ASR-draft identity and returns
  // this control to microphone mode without arming automatic playback.
  useEffect(() => {
    if (voice.voiceDraft !== null && voice.voiceDraft !== input.draft) clearVoiceDraft()
  }, [clearVoiceDraft, input.draft, voice.voiceDraft])

  // Send failure or a running→idle transition with no committed claimant
  // clears the arm. The claimant clears it first on a successful fast reply.
  useEffect(() => {
    if (!voice.autoPlaybackArmed) {
      sawArmedRun.current = false
      return
    }
    if (session.promptError?.op === 'send') {
      clearAutoPlayback()
      return
    }
    if (session.running) {
      sawArmedRun.current = true
    } else if (sawArmedRun.current) {
      clearAutoPlayback()
    }
  }, [clearAutoPlayback, session.promptError, session.running, voice.autoPlaybackArmed])

  if (voice.profileState !== 'ready' || voice.profile?.transcription === undefined) return null

  const recording = voice.recordingState === 'recording'
  const pending = voice.recordingState === 'requesting' || voice.recordingState === 'transcribing'
  const voiceDraftReady = voice.voiceDraft !== null && voice.voiceDraft === input.draft && input.draft.trim() !== ''
  const synthesisAvailable = voice.profile.synthesis !== undefined
  const automaticPlaybackAvailable = synthesisAvailable && !input.draft.trimStart().startsWith('/')
  const locked = session.removed || session.running || voice.callActive || input.phase !== 'plain'
  const label = pending
    ? t('input.cancel')
    : recording ? t('input.stop')
      : voiceDraftReady ? t(automaticPlaybackAvailable ? 'input.voiceSend' : 'input.transcriptSend')
        : session.running ? t('input.running') : t('input.start')

  const activate = (): void => {
    if (pending) {
      cancelRecording()
      return
    }
    if (recording) {
      void stopRecording().then((transcript) => {
        if (transcript === null) return
        const next = appendTranscript(draftRef.current, transcript)
        markVoiceDraft(next)
        inputActions.setDraft(next)
      })
      return
    }
    if (voiceDraftReady) {
      if (automaticPlaybackAvailable) armAutoPlayback(committedAssistantSeq(session))
      else clearVoiceDraft()
      inputActions.submit()
      return
    }
    void startRecording()
  }

  return (
    <Tooltip label={label} side="top" delayMs={500}>
      <button
        type="button"
        className={css.control}
        aria-label={label}
        aria-pressed={recording || undefined}
        data-active={recording || voiceDraftReady || undefined}
        disabled={!recording && !pending && locked}
        onMouseDown={(event) => { event.preventDefault() }}
        onClick={activate}
      >
        {pending
          ? <span className={css.spinner} aria-hidden />
          : recording ? <StopIcon /> : voiceDraftReady ? <IconSendOutline16 /> : <MicrophoneIcon />}
      </button>
    </Tooltip>
  )
}
