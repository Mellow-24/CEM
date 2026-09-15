/** Dedicated and minimized mobile call presentation over real call state. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { VoiceCallView } from '@deepseek-ai/dsh-client-ui-voice/client'
import { callLabel, duration } from './presenter.ts'
import { Icon, Logo } from './Icons.tsx'
import { useDialogFocus } from './useDialogFocus.ts'
import css from './MobileChat.module.css'

export interface CallScreenProps {
  call: VoiceCallView
  expanded: boolean
  expand(this: void, value: boolean): void
  end(this: void): void
  mute(this: void, value: boolean): void
  interrupt(this: void): void
}

/** Keep one call mounted while the customer moves between captions and chat. */
export function CallScreen({ call, expanded, expand, end, mute, interrupt }: CallScreenProps) {
  const [seconds, setSeconds] = useState(0)
  const started = useRef<number | null>(null)
  const history = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const userScroll = useRef(false)
  const scrollPosition = useRef(0)
  const [readingHistory, setReadingHistory] = useState(false)
  const latest = (): void => {
    following.current = true
    userScroll.current = false
    setReadingHistory(false)
    const element = history.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }
  const dialog = useDialogFocus(expanded && call.phase !== 'idle', () => { expand(false) })
  useLayoutEffect(() => {
    if (call.phase === 'idle') {
      following.current = true
      userScroll.current = false
      scrollPosition.current = 0
      setReadingHistory(false)
      return
    }
    const element = history.current
    if (element === null) return
    element.scrollTop = following.current ? element.scrollHeight : scrollPosition.current
  }, [call.messages, call.phase, expanded])
  useEffect(() => {
    const element = history.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight
    })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [expanded, call.phase === 'idle'])
  useEffect(() => {
    if (call.phase === 'idle') { started.current = null; setSeconds(0); return }
    if (call.phase === 'connecting' || call.phase === 'error') return
    started.current ??= Date.now()
    const tick = (): void => { setSeconds(Math.floor((Date.now() - (started.current ?? Date.now())) / 1000)) }
    tick()
    const timer = setInterval(tick, 1000)
    return () => { clearInterval(timer) }
  }, [call.phase])
  if (call.phase === 'idle') return null
  if (!expanded) return <div className={css.callBanner}>
    <button onClick={() => { expand(true) }}><Icon name="phone" /><span>{callLabel(call)} · {duration(seconds)}</span></button>
    <button aria-label="結束通話" onClick={end}><Icon name="close" /></button>
  </div>
  return <section ref={dialog} className={css.callScreen} role="dialog" aria-modal="true" aria-label="澳電語音通話">
    <header className={css.callHeader}>
      <button onClick={() => { expand(false) }}><Icon name="back" />返回聊天</button>
      <Logo compact />
    </header>
    <div className={css.callBody}>
      <div className={css.callSummary}>
        <div className={css.callIdentity}>
          <h1>澳電語音助手</h1>
          <p className={css.callTime}>{call.phase === 'connecting' ? '正在接通' : call.phase === 'error' ? '連線中斷' : '通話中'} <span>{duration(seconds)}</span></p>
        </div>
        <div className={css.orbStage} aria-hidden="true">
          <div className={css.orb} data-active={!call.muted && (call.phase === 'playing' || call.phase === 'listening')} data-muted={call.muted || undefined}><span><Icon name="mic" /></span></div>
        </div>
        <p className={css.callStatus} role="status">{callLabel(call)}</p>
      </div>
      <div className={css.captions}>
        <div ref={history} className={css.captionViewport} role="log" aria-label="通話對話" aria-live="polite" aria-relevant="additions text"
          tabIndex={0}
          onWheel={() => { userScroll.current = true }}
          onTouchStart={() => { userScroll.current = true }}
          onPointerDown={() => { userScroll.current = true }}
          onKeyDown={(event) => {
            if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(event.key)) userScroll.current = true
          }}
          onScroll={(event) => {
            const element = event.currentTarget
            scrollPosition.current = element.scrollTop
            if (!userScroll.current && following.current) return
            following.current = element.scrollHeight - element.clientHeight - element.scrollTop < 24
            setReadingHistory(!following.current)
          }}>
          <div className={css.captionFlow}>
            {call.messages.map(message => <div key={message.id} className={css.captionRow} data-speaker={message.speaker}>
              {message.speaker === 'assistant' && <Logo compact markOnly />}
              <div><small>{message.speaker === 'user' ? '您' : '澳電助手'}
                {message.status === 'interrupted' && <span> · 已打斷</span>}
                {message.status === 'unsubmitted' && <span> · 未提交</span>}
                {message.status === 'partial' && message.speaker === 'user' && <span> · 正在聆聽</span>}
              </small><p>{message.text}</p></div>
            </div>)}
            {call.messages.length === 0 &&
              <p className={css.captionEmpty}>接通後，對話文字會顯示在這裡。</p>}
          </div>
        </div>
        {readingHistory && <button className={css.latestCaption} onClick={latest}>回到最新對話 ↓</button>}
        {call.error && <p className={css.error} role="alert">{call.error}</p>}
      </div>
    </div>
    <footer className={css.callFooter}>
      <div className={css.callControls}>
        <button onClick={() => { mute(!call.muted) }} aria-pressed={call.muted ?? false} disabled={call.phase === 'error' || call.phase === 'ending'}><span className={css.mute} data-muted={call.muted || undefined}><Icon name="mic" /></span>{call.muted ? '取消靜音' : '靜音'}</button>
        <button onClick={end} disabled={call.phase === 'ending'}><span className={css.hangup}><Icon name="phone" /></span>結束通話</button>
        <button onClick={interrupt} disabled={call.phase === 'error' || call.phase === 'ending'}><span className={css.interrupt}><Icon name="chat" /></span>我要說話</button>
      </div>
      <p>完整對話會保留在聊天中</p>
    </footer>
  </section>
}
