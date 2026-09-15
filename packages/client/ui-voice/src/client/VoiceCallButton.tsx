/** Composer call button and live call dialog. */

import type {} from '@deepseek-ai/dsh-response-language/client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { VoiceCallProps } from './slots.ts'
import { PhoneIcon } from './icons.tsx'
import css from './VoiceControls.module.css'

/** Call controls over the current Session; all media work belongs to the controller. */
export function VoiceCallButton({
  session, input, useVoice, useCall, useProjection, ensureProfile, prepareGreeting, startCall, endCall, t,
}: VoiceCallProps) {
  const voice = useVoice(view => view)
  const call = useCall(view => view)
  const language = useProjection('responseLanguage')?.currentValue
  const captions = useRef<HTMLDivElement>(null)
  const hangup = useRef<HTMLButtonElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [seconds, setSeconds] = useState(0)
  const open = call.phase !== 'idle'
  useEffect(() => { void ensureProfile() }, [ensureProfile])
  useEffect(() => { if (!open) prepareGreeting(language) }, [open, voice.profile, language, prepareGreeting])
  useLayoutEffect(() => {
    const element = captions.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [open, call.answer, call.transcript, call.error])
  useLayoutEffect(() => {
    const element = captions.current
    if (element === null) return
    const observer = new ResizeObserver(() => { element.scrollTop = element.scrollHeight })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [open])
  useEffect(() => {
    if (!open) return
    const started = Date.now()
    setSeconds(0)
    const timer = setInterval(() => { setSeconds(Math.floor((Date.now() - started) / 1000)) }, 1000)
    return () => { clearInterval(timer) }
  }, [open])
  useEffect(() => {
    if (!open) return
    hangup.current?.focus()
    return () => { trigger.current?.focus() }
  }, [open])
  if (voice.profile?.call === undefined || !voice.profile.transcription?.realtime || voice.profile.synthesis === undefined) return null
  const close = (): void => { void endCall() }
  const locked = session.running || session.removed || session.queue.length > 0 || input.phase !== 'plain'
  return <>
    <Tooltip label={t('call.start')} side="top">
      <button ref={trigger} type="button" className={css.control} aria-label={t('call.start')} disabled={locked || open}
        onMouseDown={(event) => { event.preventDefault() }} onClick={() => { startCall(language) }}><PhoneIcon /></button>
    </Tooltip>
    <Modal open={open} onClose={close} title={t('call.title')} closeLabel={t('call.end')} className={css.callScreen ?? ''} headless>
      <div className={css.call} onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }}>
        <header className={css.callHeader}>
          <span className={css.callBadge}>{t('call.live')}</span>
          <span className={css.callTimer}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</span>
        </header>
        <main className={css.callMain}>
          <h2>{t('call.title')}</h2>
          <p className={css.callState} role="status">{t(`call.${call.phase}`)}</p>
          <div className={css.callOrb} data-speaking={call.phase === 'playing' || undefined} aria-hidden="true">
            <div className={css.callWave}>{[0, 1, 2, 3, 4].map(index => <span key={index} />)}</div>
          </div>
          <div ref={captions} className={css.callCaptions} aria-live="polite">
            {call.transcript !== '' && (
              <section className={`${css.captionTurn} ${css.customerTurn}`}>
                <span className={css.captionSpeaker}>{t('call.you')}</span>
                <p className={css.callTranscript}>{call.transcript}</p>
              </section>
            )}
            {call.answer !== '' && (
              <section className={`${css.captionTurn} ${css.assistantTurn}`}>
                <span className={css.captionSpeaker}>{t('call.assistant')}</span>
                <p className={css.callAnswer}>{call.answer}</p>
              </section>
            )}
            {call.error !== undefined && <p role="alert">{call.error}</p>}
          </div>
        </main>
        <footer className={css.callFooter}>
          <p className={css.callHint}>{t('call.hint')}</p>
          <button ref={hangup} type="button" className={css.callHangup} aria-label={t('call.end')} onClick={close}><PhoneIcon /></button>
          <span>{t('call.end')}</span>
          <small>{t('call.saved')}</small>
        </footer>
      </div>
    </Modal>
  </>
}
