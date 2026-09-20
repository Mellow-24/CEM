/** CEM mobile welcome, conversation, and recording views; live sources arrive through slot hooks. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import clsx from 'clsx'
import type { ClientResponse } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { BrowserVoiceRuntime, SpeechProfile } from '@deepseek-ai/dsh-client-ui-voice/client'
import type { InjectFace, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { createMobileStore } from './store.ts'
import { messagesOf } from './presenter.ts'
import { Icon, Logo, Wave } from './Icons.tsx'
import type { IconName } from './Icons.tsx'
import { CallScreen } from './CallScreen.tsx'
import { PendingRequest } from './PendingRequest.tsx'
import { useDialogFocus } from './useDialogFocus.ts'
import css from './MobileChat.module.css'

type RootProps = PropsRuntime<'root'> & PropsRenderSlots<'mobile-chat.conversation'> & { initialize: () => Promise<void> }

/** Wait for authoritative workspace/session baselines before selecting a customer Session. */
export function MobileChatRoot({ useWorkspaces, initialize, renderSlot }: RootProps) {
  const ready = useWorkspaces(state => state.baselinesReady)
  const [prepared, setPrepared] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const frame = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ready) return
    let active = true
    setError('')
    void initialize().then(() => { if (active) setPrepared(true) }, (reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [ready, initialize, retry])
  useLayoutEffect(() => {
    const previous = document.title
    const language = document.documentElement.lang
    document.title = '澳電智能客服'
    document.documentElement.lang = 'zh-Hant'
    const viewport = window.visualViewport
    const resize = (): void => {
      frame.current?.style.setProperty('--mobile-height', `${viewport?.height ?? window.innerHeight}px`)
      frame.current?.style.setProperty('--mobile-top', `${viewport?.offsetTop ?? 0}px`)
    }
    resize()
    const source = viewport ?? window
    source.addEventListener('resize', resize)
    source.addEventListener('scroll', resize)
    return () => { source.removeEventListener('resize', resize); source.removeEventListener('scroll', resize); document.title = previous; document.documentElement.lang = language }
  }, [])
  return <main ref={frame} className={css.frame} data-cem-mobile="chat">
    {prepared ? renderSlot('mobile-chat.conversation', {}) : <div className={css.loading}><Logo /><h1>澳電智能客服</h1><p role={error ? 'alert' : 'status'}>{error || '正在連接客服服務…'}</p>{error && <button onClick={() => { setRetry(n => n + 1) }}>重新連接</button>}</div>}
  </main>
}

interface MobileInjected {
  hooks: { voice: BrowserVoiceRuntime['controller']; call: BrowserVoiceRuntime['call'] }
  servicePresets: string[]
  language: string
  send(text: string): Promise<void>
  cancel(): Promise<void>
  open(id: SessionId): Promise<void>
  newSession(preset?: string): Promise<void>
  loadOlder(): Promise<void>
  ensureVoice(): Promise<SpeechProfile | undefined>
  refreshVoice(): Promise<void>
  record(): Promise<void>
  finishRecording(): Promise<string | null>
  cancelRecording(): void
  prepareCall(): void
  startCall(): void
  endCall(): Promise<void>
  muteCall(muted: boolean): void
  interruptCall(): void
  respond(key: string, result: ClientResponse['result']): Promise<void>
}

type ConversationProps = PropsRuntime<'mobile-chat.conversation'> & PropsStore<ReturnType<typeof createMobileStore>> & InjectFace<MobileInjected>

const QUESTIONS: { text: string; icon: IconName }[] = [
  { text: '如何查詢本月電費？', icon: 'bill' }, { text: '有哪些繳費方式？', icon: 'card' },
  { text: '停電了應該怎麼辦？', icon: 'bolt' }, { text: '如何申請用電服務？', icon: 'home' },
]

/** Render the Session's real conversation and invoke only injected operations. */
export function MobileConversation(props: ConversationProps) {
  const { useSession, useSessions, useWorkspaces, useStore, actions, useVoice, useCall } = props
  const session = useSession(state => state)
  const sessions = useSessions(state => state)
  const archived = useWorkspaces(state => state.archivedSessionIds)
  const ui = useStore(state => state)
  const voice = useVoice(state => state)
  const call = useCall(state => state)
  const drawer = useDialogFocus(ui.drawer, () => { actions.drawer(false) })
  const messages = useMemo(() => messagesOf(session), [session.nodes, session.partial])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cancelGesture, setCancelGesture] = useState(false)
  const [atBottom, setAtBottom] = useState(true)
  const scroll = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const gesture = useRef<{ y: number; cancelled: boolean } | null>(null)
  const submitting = useRef(false)
  const empty = messages.length === 0
  const calling = call.phase !== 'idle'
  const recording = voice.recordingState === 'recording' || voice.recordingState === 'requesting'
  const voiceBusy = recording || voice.recordingState === 'transcribing'
  const locked = busy || session.running || session.removed || session.pending.length > 0 || calling
  const callAvailable = !!(voice.profile?.call && voice.profile.transcription?.realtime && voice.profile.synthesis)
  const currentPreset = sessions.byId[props.sessionId]?.agentPreset
  const history = sessions.ids.map(id => sessions.byId[id]).filter(item => item !== undefined).filter(item => !item.blank && !archived.includes(item.id) && props.servicePresets.includes(item.agentPreset ?? ''))

  useEffect(() => { void props.ensureVoice() }, [props.ensureVoice])
  useEffect(() => { if (!calling) props.prepareCall() }, [calling, voice.profile, props.prepareCall])
  useLayoutEffect(() => {
    if (atBottom && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight
  }, [messages, atBottom, session.running])
  useEffect(() => () => { props.cancelRecording() }, [props.cancelRecording])
  useLayoutEffect(() => {
    if (!input.current) return
    input.current.style.height = 'auto'
    input.current.style.height = `${Math.min(input.current.scrollHeight, 132)}px`
  }, [ui.draft, ui.voiceMode])

  const attempt = async (operation: () => Promise<void>): Promise<void> => {
    setError(''); setBusy(true)
    try { await operation() } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  const send = async (text: string): Promise<void> => {
    const value = text.trim()
    if (!value || locked || submitting.current) return
    submitting.current = true
    const originalDraft = ui.draft
    await attempt(async () => {
      await props.send(value)
      if (value === originalDraft.trim()) actions.clearDraft(originalDraft)
      setAtBottom(true)
    })
    submitting.current = false
  }
  const finish = async (): Promise<void> => {
    if (voice.recordingState === 'requesting') { props.cancelRecording(); return }
    await attempt(async () => {
      const text = await props.finishRecording()
      if (text !== null) { actions.appendTranscript(text); actions.voiceMode(false); input.current?.focus() }
    })
  }
  const begin = (): void => { if (!locked && !voiceBusy) { setError(''); void props.record() } }
  const startCall = (): void => {
    if (locked || voiceBusy) return
    setError('')
    try { props.startCall(); actions.callExpanded(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
  }
  const onDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (locked || voiceBusy || event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { y: event.clientY, cancelled: false }
    setCancelGesture(false)
    begin()
  }
  const onMove = (event: PointerEvent<HTMLButtonElement>): void => {
    if (!gesture.current) return
    gesture.current.cancelled = gesture.current.y - event.clientY > 64
    setCancelGesture(gesture.current.cancelled)
  }
  const release = (cancelled: boolean): void => {
    if (!gesture.current) return
    const shouldCancel = cancelled || gesture.current.cancelled
    gesture.current = null
    setCancelGesture(false)
    if (shouldCancel) props.cancelRecording()
    else void finish()
  }
  const submit = (event: FormEvent): void => { event.preventDefault(); void send(ui.draft) }
  const sessionError = error || session.lastAgentError || session.promptError?.error.message
  const voiceError = voice.recordingError || voice.profileError

  return <div className={css.conversation} data-cem-conversation>
    {empty && <div className={css.brandSweep} aria-hidden="true"><i /><i /></div>}
    <header className={clsx(css.header, empty && css.headerWelcome)}>
      <div className={css.identity}><Logo compact={!empty} markOnly={!empty} /><span>澳電智能客服</span></div>
      <div className={css.headerActions}>
        {!empty && <button className={css.headerCall} onClick={startCall} disabled={locked || !callAvailable} aria-label="開始通話"><span><Icon name="phone" /></span>通話</button>}
        <button className={css.historyButton} onClick={() => { actions.drawer(true) }} aria-label="對話記錄"><Icon name="chat" />{empty && '對話'}</button>
      </div>
    </header>
    <div className={css.scroll} ref={scroll} onScroll={() => {
      const el = scroll.current
      if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 64)
    }}>
      {empty ? <section className={css.welcome}>
        <h1>您好，有甚麼可以幫您？</h1><p className={css.intro}>電費、繳費、用電服務，都可以問我</p>
        <button className={css.callCard} onClick={startCall} disabled={locked || !callAvailable}><span className={css.phoneBadge}><Icon name="phone" /></span><span><small>想直接說？</small><strong>與澳電助手通話</strong></span><Icon name="chevron" /></button>
        <h2>您可能想問</h2>
        <div className={css.questions}>{QUESTIONS.map(question => <button key={question.text} onClick={() => { void send(question.text) }} disabled={locked}><Icon name={question.icon} /><span>{question.text}</span><Icon name="chevron" /></button>)}</div>
      </section> : <section className={css.messages} aria-label="聊天文字">
        <div className={css.date}>與澳電助手的對話</div>
        {session.hasMore && <button className={css.older} disabled={session.loadingOlder}
          onClick={() => { void attempt(props.loadOlder) }}>載入更早對話</button>}
        {messages.map(message => <article key={message.key} className={`${css.message} ${message.role === 'user' ? css.userMessage : ''}`}>
          {message.role === 'assistant' && <Logo compact markOnly />}
          <div className={css.messageContent}><p className={css.bubble}>{message.text}{message.partial && <span className={css.cursor} aria-label="正在回答" />}</p>
            <small className={css.messageMeta}>{message.interrupted ? '回答已停止' : message.time === undefined ? '' : new Date(message.time).toLocaleTimeString('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false })}</small></div>
        </article>)}
        {session.running && !session.partial && <div className={css.thinking} role="status"><Logo compact markOnly /><span>正在為您查詢<span className={css.dots}>…</span></span></div>}
      </section>}
    </div>
    {!atBottom && !empty && <button className={css.latest} onClick={() => { setAtBottom(true) }}>回到最新消息 ↓</button>}
    <div className={css.composerArea}>
      {sessionError && <div className={css.error} role="alert">{sessionError}<button onClick={() => { void attempt(props.refreshVoice) }}>重新連接客服</button></div>}
      {!sessionError && voiceError && <div className={css.error} role="alert">{voiceError}<button onClick={() => { void attempt(props.refreshVoice) }}>重試語音服務</button></div>}
      {!sessionError && !voiceError && voice.profileState === 'unavailable' && <div className={css.error}>語音服務尚未就緒，您仍可使用文字聊天。<button onClick={() => { void attempt(props.refreshVoice) }}>重新連接語音</button></div>}
      {session.pending.map(wait => <PendingRequest key={wait.key} wait={wait} respond={result => props.respond(wait.key, result)} />)}
      {session.running && !calling && <button className={css.stopAnswer} onClick={() => { void attempt(props.cancel) }}><Icon name="stop" />停止回答</button>}
      {voiceBusy && <div className={css.recording} data-cancel={cancelGesture || undefined} role="status"><strong>{cancelGesture ? '鬆開取消' : voice.recordingState === 'transcribing' ? '正在轉為文字…' : voice.recordingState === 'requesting' ? '正在開啟麥克風…' : '正在聆聽…'}</strong><Wave active={recording} /><span>{cancelGesture ? '取消後不會發送' : '鬆開轉文字，上滑取消'}</span><button onClick={props.cancelRecording}>取消</button></div>}
      {empty && !voiceBusy && <p className={css.voiceHint}><Icon name="mic" />也可以按住說話</p>}
      <form className={css.composer} onSubmit={submit}>
        <button className={css.modeButton} type="button" aria-label={ui.voiceMode ? '切換文字輸入' : '切換語音輸入'} disabled={calling || voiceBusy} onClick={() => { actions.voiceMode(!ui.voiceMode) }}><Icon name={ui.voiceMode ? 'keyboard' : 'mic'} /></button>
        {ui.voiceMode ? <button className={css.holdButton} type="button" disabled={locked || voice.recordingState === 'transcribing' || voice.profile?.transcription === undefined} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => { release(false) }} onPointerCancel={() => { release(true) }} onKeyDown={(event) => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); if (recording) void finish(); else begin() } }} aria-label="按住說話，鍵盤按 Enter 開始或結束錄音"><Icon name="mic" />{recording ? '鬆開轉文字' : '按住說話'}</button>
          : <textarea ref={input} aria-label="輸入您的問題" placeholder="輸入您的問題…" value={ui.draft} rows={1} disabled={calling || session.removed} onChange={(event) => { actions.draft(event.target.value) }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(ui.draft) } }} />}
        <button className={css.send} type={ui.voiceMode ? 'button' : 'submit'} aria-label={ui.voiceMode ? '開始通話' : '發送訊息'} disabled={ui.voiceMode ? locked || !callAvailable || voiceBusy : locked || !ui.draft.trim()} onClick={ui.voiceMode ? startCall : undefined}><Icon name={ui.voiceMode ? 'phone' : 'send'} /></button>
      </form>
      {ui.voiceMode && voice.recordingState !== 'transcribing' && <button className={css.tapRecord} onClick={recording ? () => { void finish() } : begin} disabled={locked || voice.profile?.transcription === undefined}>{recording ? '完成錄音並轉文字' : '也可點擊開始錄音'}</button>}
      <p className={css.disclaimer}>AI 回覆僅供參考</p>
    </div>
    {ui.drawer && <div className={css.drawerBackdrop} onClick={() => { actions.drawer(false) }}><section ref={drawer} className={css.drawer} role="dialog" aria-modal="true" aria-label="對話記錄" onClick={(event) => { event.stopPropagation() }}>
      <header><h2>對話記錄</h2><button aria-label="關閉對話記錄" onClick={() => { actions.drawer(false) }}><Icon name="close" /></button></header>
      <button className={css.newSession} disabled={calling || busy} onClick={() => { void attempt(async () => { await props.newSession(); actions.drawer(false) }) }}><Icon name="plus" />開始新對話</button>
      <label className={css.serviceSelect}>服務助手<select value={currentPreset} disabled={calling || busy} onChange={(event) => { const preset = event.target.value; if (window.confirm('更換服務將開啟新對話，原對話會保留。')) void attempt(() => props.newSession(preset)) }}>{props.servicePresets.map(preset => <option key={preset} value={preset}>{preset === 'macau-customer-service' ? '澳電智能客服' : preset === 'macau-customer-service-wiki' ? '澳電知識助手' : preset}</option>)}</select></label>
      {calling && <p>請先結束通話，再切換對話。</p>}
      <div className={css.historyList}>{history.length === 0 ? <p>開始聊天後，對話會顯示在這裡。</p> : history.map(item => <button key={item.id} aria-current={item.id === props.sessionId ? 'true' : undefined} disabled={calling || busy} onClick={() => { void attempt(async () => { await props.open(item.id); actions.drawer(false) }) }}><Icon name="chat" /><span>{item.title || '客服對話'}</span><Icon name="chevron" /></button>)}</div>
    </section></div>}
    <CallScreen call={call} expanded={ui.callExpanded} expand={actions.callExpanded}
      end={() => { void attempt(props.endCall) }} mute={props.muteCall} interrupt={props.interruptCall} />
  </div>
}
