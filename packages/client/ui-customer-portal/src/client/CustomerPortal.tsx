/** Customer-facing CEM conversation surface. */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type {
  ConversationNode, ConversationSnapshot, SessionFace, SessionId, SessionListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserVoiceRuntime, SpeechProfile, VoiceCallView } from '@deepseek-ai/dsh-client-ui-voice/client'
import css from './CustomerPortal.module.css'

const CEM_LOGO = 'https://www.cem-macau.com/_nuxt/img/logo.5ab12fa.svg'
const PRODUCT_TITLE = '智能客服｜澳門電力股份有限公司'

/** Root injection over the existing Session and speech HTTP services. */
export interface CustomerPortalInjected {
  activate: () => Promise<SessionId>
  openSession: (id: SessionId) => Promise<SessionId>
  archiveSession: (id: SessionId) => Promise<void>
  resolveSession: (id: SessionId) => SessionFace | undefined
  send: (id: SessionId, text: string) => Promise<void>
  cancel: (id: SessionId) => Promise<void>
  createVoice: (session: SessionFace) => BrowserVoiceRuntime
}

/** Full root-slot props for the customer portal. */
export type CustomerPortalProps = PropsRuntime<'root'> & InjectFace<CustomerPortalInjected>

interface DisplayMessage {
  readonly key: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly time?: number
  readonly partial?: boolean
}

/** Customer-facing progress shown before the current answer has visible prose. */
export type CustomerReplyWaitPhase = 'submitting' | 'thinking' | 'searching'

interface RecommendationGroup {
  readonly title: string
  readonly tone: 'orange' | 'yellow'
  readonly icon: ReactNode
  readonly questions: readonly string[]
}

const RECOMMENDATIONS: readonly RecommendationGroup[] = [
  {
    title: '賬單及繳費', tone: 'orange', icon: <ReceiptIcon />,
    questions: ['我可以查閱過往的電子賬單嗎？', '查詢如何預繳電費'],
  },
  {
    title: '供電及合約', tone: 'yellow', icon: <HomeIcon />,
    questions: ['我想申請供電，我需要做甚麼？', '我想轉名，我需要做甚麼？'],
  },
  {
    title: '停電及安全', tone: 'yellow', icon: <BoltIcon />,
    questions: ['我屋企個總掣跳咗打唔翻上去', '維生設備客戶支援是什麼？'],
  },
  {
    title: '電動車及應用', tone: 'orange', icon: <CarIcon />,
    questions: ['充電完成後，無法拔除充電線應如何處理？', '我可以通過甚麼渠道充值澳電銀包？'],
  },
]

const HISTORY_PAGE_SIZE = 8

interface CustomerHistoryItem {
  readonly id: SessionId
  readonly title: string
  readonly updatedAt: number
  readonly running: boolean
}

/** Select visible customer-service root Sessions for the portal history rail, newest first. */
export function customerHistory(
  list: SessionListState,
  archivedIds: readonly SessionId[] = [],
): readonly CustomerHistoryItem[] {
  const archived = new Set(archivedIds)
  return list.ids
    .flatMap(id => {
      const item = list.byId[id]
      return item !== undefined && item.agentPreset === 'macau-customer-service' && !item.blank
        && item.origin !== 'subagent' && !archived.has(item.id)
        ? [{ id, title: item.displayTitle, updatedAt: item.updatedAt, running: item.running }]
        : []
    })
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
}

/** Bound one history render to a stable page instead of mounting every retained Session. */
export function customerHistoryPage(
  history: readonly CustomerHistoryItem[],
  requestedPage: number,
): { readonly items: readonly CustomerHistoryItem[]; readonly page: number; readonly pageCount: number } {
  const pageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE))
  const page = Math.min(Math.max(0, Math.trunc(requestedPage)), pageCount - 1)
  const start = page * HISTORY_PAGE_SIZE
  return { items: history.slice(start, start + HISTORY_PAGE_SIZE), page, pageCount }
}

type UserContent = Extract<ConversationNode, { kind: 'user' }>['content']
type AssistantBlocks = Extract<ConversationNode, { kind: 'assistant' }>['blocks']

function textContent(content: UserContent): string {
  return content.flatMap((block) => {
    const candidate = block as { type?: unknown; text?: unknown }
    return candidate.type === 'text' && typeof candidate.text === 'string' ? [candidate.text] : []
  }).join('')
}

function assistantText(blocks: AssistantBlocks): string {
  return blocks.flatMap((block) => {
    const candidate = block as { kind?: unknown; text?: unknown }
    return candidate.kind === 'text' && typeof candidate.text === 'string' ? [candidate.text] : []
  }).join('')
}

function callsTool(blocks: AssistantBlocks): boolean {
  return blocks.some((block) => block.kind === 'tool-call')
}

/** Project only customer-visible user prompts and completed answer prose from the full tool trace. */
export function visibleMessages(snapshot: ConversationSnapshot): readonly DisplayMessage[] {
  const messages: DisplayMessage[] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = textContent(node.content)
      if (text.trim() !== '') messages.push({ key: `${node.kind}-${String(node.seq)}`, role: 'user', text, time: node.time })
      continue
    }
    if (node.kind === 'assistant') {
      if (callsTool(node.blocks)) continue
      const text = assistantText(node.blocks)
      if (text.trim() !== '') messages.push({ key: `assistant-${String(node.seq)}`, role: 'assistant', text, time: node.time })
    }
  }
  const pending = snapshot.partial
  const partial = pending === null || pending.step === 1 || callsTool(pending.blocks)
    ? ''
    : assistantText(pending.blocks)
  if (partial.trim() !== '') {
    messages.push({
      key: `partial-${String(pending?.turn)}-${String(pending?.step)}`,
      role: 'assistant',
      text: partial,
      partial: true,
    })
  }
  return messages
}

/**
 * Select a stable progress state while transport, generation, or hidden lookup steps precede answer text.
 * @param snapshot - current Session conversation state.
 * @param submitted - a locally submitted prompt that has not produced a visible answer yet.
 * @returns a customer-facing progress phase, or null once answer prose is visible.
 */
export function customerReplyWaitPhase(
  snapshot: ConversationSnapshot,
  submitted: boolean,
): CustomerReplyWaitPhase | null {
  const partial = snapshot.partial
  const answerVisible = partial !== null
    && partial.step !== 1
    && !callsTool(partial.blocks)
    && assistantText(partial.blocks).trim() !== ''
  if (answerVisible || (!submitted && !snapshot.running)) return null
  if (!snapshot.running) return 'submitting'
  if (snapshot.runningCalls.length > 0 || (partial !== null && callsTool(partial.blocks))) {
    return 'searching'
  }
  return 'thinking'
}

function timeLabel(time: number | undefined): string {
  if (time === undefined) return ''
  return new Intl.DateTimeFormat('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(time))
}

function historyTimeLabel(time: number): string {
  return new Intl.DateTimeFormat('zh-HK', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(time))
}

function callAvailable(profile: SpeechProfile | undefined): profile is SpeechProfile {
  return profile?.call !== undefined && profile.transcription?.realtime === true && profile.synthesis !== undefined
}

function callStatus(phase: VoiceCallView['phase']): string {
  switch (phase) {
    case 'idle': return '通話已結束'
    case 'connecting': return '正在接通澳電智能客服…'
    case 'listening': return '正在聆聽，請說出你的問題'
    case 'transcribing': return '正在識別你的語音…'
    case 'thinking': return '正在查詢相關資料…'
    case 'generating': return '正在準備語音回答…'
    case 'playing': return '客服正在回答…'
    case 'ending': return '正在結束通話…'
    case 'error': return '通話遇到問題'
  }
}

function ActiveConversation({ session, send, cancel, createVoice }: {
  session: SessionFace
  send: CustomerPortalInjected['send']
  cancel: CustomerPortalInjected['cancel']
  createVoice: CustomerPortalInjected['createVoice']
}) {
  const snapshot = useSyncExternalStore(
    listener => session.subscribe(listener),
    () => session.getSnapshot(),
  )
  const messages = useMemo(() => visibleMessages(snapshot), [snapshot])
  const [voice] = useState(() => createVoice(session))
  const voiceView = useSyncExternalStore(
    listener => voice.controller.subscribe(listener),
    () => voice.controller.getSnapshot(),
  )
  const callView = useSyncExternalStore(
    listener => voice.call.subscribe(listener),
    () => voice.call.getSnapshot(),
  )
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pendingReply, setPendingReply] = useState<{
    readonly assistantCount: number
    readonly runningObserved: boolean
  } | null>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const assistantCount = messages.filter(message => message.role === 'assistant').length
  const replyWaitPhase = customerReplyWaitPhase(snapshot, pendingReply !== null)

  useEffect(() => {
    const element = scroll.current
    if (element === null) return
    if (messages.length === 0 && replyWaitPhase === null) {
      element.scrollTop = 0
      return
    }
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [messages, replyWaitPhase])

  useEffect(() => {
    if (pendingReply === null) return
    if (assistantCount > pendingReply.assistantCount
      || snapshot.promptError !== null
      || snapshot.lastAgentError !== null
      || (pendingReply.runningObserved && !snapshot.running)) {
      setPendingReply(null)
      return
    }
    if (snapshot.running && !pendingReply.runningObserved) {
      setPendingReply(current => current === null ? null : { ...current, runningObserved: true })
    }
  }, [assistantCount, pendingReply, snapshot.lastAgentError, snapshot.promptError, snapshot.running])

  useEffect(() => {
    void voice.controller.ensureProfile()
    return () => { void voice.dispose() }
  }, [voice])

  useEffect(() => {
    const profile = voiceView.profile
    if (callView.phase === 'idle' && callAvailable(profile)) voice.call.prepareGreeting(profile, 'yue')
  }, [callView.phase, voice, voiceView.profile])

  const submit = async (text: string): Promise<void> => {
    const value = text.trim()
    if (value === '' || snapshot.running) return
    setDraft('')
    setError(null)
    setPendingReply({ assistantCount, runningObserved: snapshot.running })
    try {
      await send(session.sessionId, value)
    } catch (reason) {
      setPendingReply(null)
      setDraft(value)
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  const toggleRecording = async (): Promise<void> => {
    const recordingState = voice.controller.getSnapshot().recordingState
    if (recordingState === 'recording') {
      const transcript = await voice.controller.stopRecording()
      if (transcript !== null) setDraft(current => current === '' ? transcript : `${current}\n${transcript}`)
      return
    }
    if (recordingState === 'requesting' || recordingState === 'transcribing') return
    setError(null)
    if (voiceView.profileState === 'error' || voiceView.profileState === 'unavailable') {
      voice.controller.refreshProfile()
    }
    const profile = await voice.controller.ensureProfile()
    if (profile?.transcription === undefined) {
      setError('語音輸入服務暫時未能連接，請稍後再試。')
      return
    }
    await voice.controller.startRecording()
  }

  const startCall = (): void => {
    setError(null)
    const profile = voice.controller.getSnapshot().profile
    if (!callAvailable(profile)) {
      if (voiceView.profileState === 'error' || voiceView.profileState === 'unavailable') {
        voice.controller.refreshProfile()
      }
      void voice.controller.ensureProfile()
      setError('語音通話正在準備，請稍後再按一次通話按鈕。')
      return
    }
    voice.call.prepareGreeting(profile, 'yue')
    voice.call.start(profile, 'yue')
  }

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault()
    void submit(draft)
  }

  const empty = snapshot.openState === 'open' && messages.length === 0
  const voiceLabel = voiceView.recordingState === 'recording' ? '完成錄音'
    : voiceView.recordingState === 'transcribing' ? '識別中'
      : voiceView.recordingState === 'requesting' ? '準備中' : '語音輸入'
  const visibleError = error ?? voiceView.profileError ?? voiceView.recordingError

  return (
    <>
      <div className={css.windowHeader}>
        <div className={css.assistantId}>
          <AssistantAvatar />
          <div>
            <div className={css.assistantTitle}>澳電智能客服</div>
            <div className={css.assistantState}>隨時為你解答電力服務問題</div>
          </div>
        </div>
        <button
          className={css.callButton}
          type="button"
          aria-label="開始語音通話"
          disabled={snapshot.running || snapshot.removed || callView.phase !== 'idle'}
          onClick={startCall}
        >
          <PhoneIcon />
          <span>語音通話</span>
        </button>
      </div>
      <div ref={scroll} className={css.conversation} aria-live="polite" data-customer-conversation="">
        {snapshot.openState !== 'open'
          ? <div className={css.loading}><span /><p>正在載入對話記錄……</p></div>
          : empty
          ? <Welcome onQuestion={(text) => { void submit(text) }} disabled={snapshot.running} />
          : (
            <div className={css.messageList}>
              {messages.map(message => <MessageBubble key={message.key} message={message} />)}
              {replyWaitPhase !== null && <ReplyWait phase={replyWaitPhase} />}
            </div>
          )}
      </div>
      <div className={css.composerArea}>
        {visibleError !== undefined && (
          <div className={css.error} role="alert">{visibleError}</div>
        )}
        <form
          className={`${css.composer} ${voiceView.recordingState === 'recording' ? css.listening : ''}`}
          onSubmit={onSubmit}
        >
          <textarea
            value={draft}
            onChange={(event) => { setDraft(event.currentTarget.value) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit(draft)
              }
            }}
            aria-label="輸入你的問題"
            placeholder={voiceView.recordingState === 'recording' ? '請說出你的問題……' : '請輸入你的問題……'}
            rows={1}
            disabled={snapshot.removed || callView.phase !== 'idle'}
          />
          <button className={`${css.voiceInput} ${voiceView.recordingState === 'recording' ? css.voiceActive : ''}`} type="button"
            aria-label={voiceLabel} aria-pressed={voiceView.recordingState === 'recording'}
            disabled={snapshot.running || snapshot.removed || callView.phase !== 'idle'
              || voiceView.recordingState === 'transcribing' || voiceView.recordingState === 'requesting'}
            onClick={() => { void toggleRecording() }}><MicrophoneIcon /><span>{voiceLabel}</span></button>
          {snapshot.running
            ? <button className={css.stopButton} type="button" aria-label="停止回覆" onClick={() => { void cancel(session.sessionId) }}>停止</button>
            : <button className={css.sendButton} type="submit" aria-label="發送訊息" disabled={draft.trim() === '' || snapshot.removed}><SendIcon /></button>}
        </form>
        <div className={css.composerNote}>請勿提供銀行密碼或一次性驗證碼。使用服務即表示你同意澳電的<a href="https://www.cem-macau.com/zh/terms-of-service/" target="_blank" rel="noreferrer">服務條款</a>及<a href="https://www.cem-macau.com/zh/privacy-statement/" target="_blank" rel="noreferrer">私隱聲明</a>。</div>
      </div>
      {callView.phase !== 'idle' && <CallDialog view={callView} onEnd={() => { void voice.call.stop() }} />}
    </>
  )
}

function ReplyWait({ phase }: { phase: CustomerReplyWaitPhase }) {
  const label = phase === 'submitting' ? '已收到你的問題，正在處理'
    : phase === 'searching' ? '正在查詢相關資料'
      : '正在理解你的問題'
  return (
    <div className={`${css.message} ${css.replyWait}`}>
      <AssistantAvatar small />
      <div>
        <div className={`${css.bubble} ${css.waitBubble}`} role="status">
          <span className={css.waitLabel}>{label}</span>
          <span className={css.typing} aria-hidden><i /><i /><i /></span>
        </div>
        <div className={css.meta}>澳電智能客服</div>
      </div>
    </div>
  )
}

function CallDialog({ view, onEnd }: { view: VoiceCallView; onEnd: () => void }) {
  const [seconds, setSeconds] = useState(0)
  const captions = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const started = Date.now()
    const timer = setInterval(() => { setSeconds(Math.floor((Date.now() - started) / 1000)) }, 1000)
    return () => { clearInterval(timer) }
  }, [])

  useEffect(() => {
    const element = captions.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [view.answer, view.error, view.transcript])

  return (
    <div className={css.callBackdrop} role="presentation">
      <section className={css.callPanel} role="dialog" aria-modal="true" aria-label="澳電智能客服語音通話">
        <header className={css.callHeader}>
          <span className={css.callLive}><i />語音通話中</span>
          <span className={css.callTimer}>
            {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
          </span>
        </header>
        <div className={css.callBody}>
          <div className={css.callAvatar} data-speaking={view.phase === 'playing' || undefined}>
            <ChatIcon />
            <div className={css.callWave} aria-hidden="true">
              {[0, 1, 2, 3, 4].map(index => <span key={index} />)}
            </div>
          </div>
          <h2>澳電智能客服</h2>
          <p className={css.callStatus} role="status">{callStatus(view.phase)}</p>
          <div ref={captions} className={css.callCaptions} aria-live="polite">
            {view.transcript !== '' && (
              <div className={css.customerCaption}><span>你</span><p>{view.transcript}</p></div>
            )}
            {view.answer !== '' && (
              <div className={css.assistantCaption}><span>客服</span><p>{view.answer}</p></div>
            )}
            {view.error !== undefined && <p className={css.callError} role="alert">{view.error}</p>}
          </div>
          <p className={css.callHint}>開場白播放完成後即可提問，客服回答時也可以直接說話打斷。</p>
        </div>
        <footer className={css.callFooter}>
          <button type="button" aria-label="掛斷語音通話" onClick={onEnd}><PhoneDownIcon /></button>
          <span>掛斷</span>
          <small>通話內容會保留在本次會話中</small>
        </footer>
      </section>
    </div>
  )
}

function Welcome({ onQuestion, disabled }: { onQuestion: (question: string) => void; disabled: boolean }) {
  return (
    <section className={css.welcome}>
      <div className={css.welcomeHead}>
        <div className={css.welcomeSymbol}><BoltIcon /></div>
        <h1>你好，有甚麼可以幫到你？</h1>
        <p>可以直接輸入問題，或從以下常見問題開始。</p>
      </div>
      <div className={css.welcomeGreeting}>
        <AssistantAvatar small />
        <p>你好，我係澳電智能客服。你可以先選擇服務類別和常見問題，亦可以直接輸入或用語音提問。</p>
      </div>
      <div className={css.recommendationGrid}>
        {RECOMMENDATIONS.map(group => (
          <section key={group.title} className={css.recommendationGroup}>
            <div className={css.groupTitle}><span className={group.tone === 'yellow' ? css.groupIconYellow : css.groupIcon}>{group.icon}</span>{group.title}</div>
            {group.questions.map(question => <button key={question} className={css.question} type="button" disabled={disabled} onClick={() => { onQuestion(question) }}>{question}<ChevronIcon /></button>)}
          </section>
        ))}
      </div>
    </section>
  )
}

function MessageBubble({ message }: { message: DisplayMessage }) {
  return (
    <div className={`${css.message} ${message.role === 'user' ? css.user : ''}`}>
      {message.role === 'assistant' && <AssistantAvatar small />}
      <div><div className={css.bubble}><p>{message.text}</p>{message.partial && <span className={css.caret} aria-hidden />}</div><div className={css.meta}>{message.role === 'assistant' ? '澳電智能客服' : timeLabel(message.time)}</div></div>
    </div>
  )
}

function AssistantAvatar({ small = false }: { small?: boolean }) {
  return <div className={small ? css.miniAvatar : css.assistantAvatar}><ChatIcon /></div>
}

/** CEM shell, mounted only after the route has a usable Session binding. */
export function CustomerPortal({
  useSessions, useWorkspaces, activate, openSession, archiveSession, resolveSession, send, cancel, createVoice,
}: CustomerPortalProps) {
  const sessionList = useSessions(state => state)
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const phase = sessionList.phase
  const history = useMemo(
    () => customerHistory(sessionList, archivedSessionIds),
    [archivedSessionIds, sessionList],
  )
  const [historyPage, setHistoryPage] = useState(0)
  const pagedHistory = useMemo(() => customerHistoryPage(history, historyPage), [history, historyPage])
  const [activeSessionId, setActiveSessionId] = useState<SessionId | undefined>(undefined)
  const [activationError, setActivationError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomerHistoryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const activated = useRef(false)
  const session = activeSessionId === undefined ? undefined : resolveSession(activeSessionId)

  useEffect(() => {
    const previousLanguage = document.documentElement.lang
    const previousTitle = document.title
    document.documentElement.lang = 'zh-Hant'
    document.title = PRODUCT_TITLE
    return () => {
      document.documentElement.lang = previousLanguage
      document.title = previousTitle
    }
  }, [])

  const connect = (): void => {
    activated.current = true
    setHistoryPage(0)
    setActivationError(null)
    void activate().then(setActiveSessionId, (reason: unknown) => {
      activated.current = false
      setActivationError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const selectHistory = (id: SessionId): void => {
    setActivationError(null)
    void openSession(id).then(setActiveSessionId, (reason: unknown) => {
      setActivationError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const closeDelete = (): void => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  const confirmDelete = (): void => {
    if (deleteTarget === null || deleting) return
    const target = deleteTarget
    setDeleting(true)
    setDeleteError(null)
    void archiveSession(target.id).then(() => {
      setDeleting(false)
      setDeleteTarget(null)
      if (target.id === activeSessionId) connect()
    }, (reason: unknown) => {
      setDeleting(false)
      setDeleteError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  useEffect(() => {
    if (phase !== 'ready' || activated.current) return
    connect()
  }, [activate, phase])

  return (
    <div className={css.pageShell}>
      <div><div className={css.brandStripe} /><header className={css.siteHeader}><div className={css.identity}><img className={css.cemLogo} src={CEM_LOGO} alt="澳電 CEM" /><span className={css.identityLine} /><span className={css.productName}>智能客服</span></div><div className={css.onlineStatus}><span />24小時在線服務</div></header></div>
      <main className={css.main}>
        <div className={css.portalLayout}>
          <aside className={css.historySidebar} aria-label="過往對話" data-customer-history="">
            <div className={css.historyHeader}>
              <div><span>{history.length} 條記錄</span><strong>過往對話</strong></div>
              <button type="button" onClick={connect}><PlusIcon />新對話</button>
            </div>
            <nav className={css.historyList} aria-label="客服對話記錄">
              <div className={css.historyScroller}>
                {history.length === 0
                  ? <p className={css.historyEmpty}>完成首次查詢後，對話記錄會顯示在這裡。</p>
                  : pagedHistory.items.map(item => (
                    <div key={item.id} className={css.historyItem}
                      data-current={item.id === activeSessionId || undefined}>
                      <button type="button" className={css.historyOpen}
                        aria-label={`開啟對話：${item.title}`} onClick={() => { selectHistory(item.id) }}>
                        <span><HistoryIcon />{item.title}</span>
                        <small>{item.running ? '回覆中' : historyTimeLabel(item.updatedAt)}</small>
                      </button>
                      <button type="button" className={css.historyDelete}
                        aria-label={`刪除對話：${item.title}`} title={item.running ? '回覆完成後可刪除' : '刪除對話'}
                        disabled={item.running} onClick={() => { setDeleteError(null); setDeleteTarget(item) }}>
                        <TrashIcon />
                      </button>
                    </div>
                  ))}
              </div>
              {pagedHistory.pageCount > 1 && (
                <div className={css.historyPagination} aria-label="對話記錄分頁">
                  <button type="button" aria-label="上一頁" disabled={pagedHistory.page === 0}
                    onClick={() => { setHistoryPage(page => Math.max(0, page - 1)) }}><ChevronLeftIcon /></button>
                  <span>{pagedHistory.page + 1} / {pagedHistory.pageCount}</span>
                  <button type="button" aria-label="下一頁" disabled={pagedHistory.page === pagedHistory.pageCount - 1}
                    onClick={() => { setHistoryPage(page => Math.min(pagedHistory.pageCount - 1, page + 1)) }}><ChevronIcon /></button>
                </div>
              )}
            </nav>
          </aside>
          <section className={css.serviceWindow}>
            {activationError !== null
              ? <><StaticWindowHeader /><div className={css.activationFailure} role="alert"><h1>暫時未能連接客服</h1><p>{activationError}</p><button type="button" onClick={connect}>重新連接</button></div></>
              : session === undefined
                ? <><StaticWindowHeader /><div className={css.loading}><span /><p>正在連接澳電智能客服……</p></div></>
                : <ActiveConversation key={session.sessionId} session={session} send={send} cancel={cancel} createVoice={createVoice} />}
          </section>
        </div>
      </main>
      {deleteTarget !== null && (
        <div className={css.deleteBackdrop} role="presentation">
          <section className={css.deleteDialog} role="dialog" aria-modal="true" aria-label="刪除對話">
            <div className={css.deleteIcon}><TrashIcon /></div>
            <h2>刪除這個對話？</h2>
            <p>「{deleteTarget.title}」將從客服對話列表移除，後台質檢記錄仍會保留。</p>
            {deleteError !== null && <p className={css.deleteError} role="alert">{deleteError}</p>}
            <div className={css.deleteActions}>
              <button type="button" disabled={deleting} onClick={closeDelete}>取消</button>
              <button type="button" className={css.deleteConfirm} aria-label="確認刪除對話"
                disabled={deleting} onClick={confirmDelete}>{deleting ? '正在刪除…' : '刪除'}</button>
            </div>
          </section>
        </div>
      )}
      <footer className={css.siteFooter}>© 2026 澳門電力股份有限公司　保留一切權利</footer>
    </div>
  )
}

function StaticWindowHeader() {
  return (
    <div className={css.windowHeader}>
      <div className={css.assistantId}>
        <AssistantAvatar />
        <div>
          <div className={css.assistantTitle}>澳電智能客服</div>
          <div className={css.assistantState}>隨時為你解答電力服務問題</div>
        </div>
      </div>
    </div>
  )
}

function ChatIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 9h8M8 13h5" /><path d="M7 18.2c-2.4-1.3-4-3.8-4-6.7C3 6.8 7 3 12 3s9 3.8 9 8.5-4 8.5-9 8.5c-.9 0-1.8-.1-2.6-.4L5 21l2-2.8Z" /></svg> }
function BoltIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M13 2 5 14h7l-1 8 8-12h-7z" /></svg> }
function ReceiptIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg> }
function HomeIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 11 12 4l9 7v9H3z" /><path d="M9 20v-6h6v6" /></svg> }
function CarIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17h10M6 12h12l2 5v3h-2v-2H6v2H4v-3z" /><path d="m8 12 1.5-5h5L16 12" /></svg> }
function ChevronIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m9 18 6-6-6-6" /></svg> }
function MicrophoneIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" /></svg> }
function PhoneIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /></svg> }
function PhoneDownIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4.5 15.5c4.7-3.4 10.3-3.4 15 0" /><path d="m7 14-2.5 4M17 14l2.5 4" /></svg> }
function SendIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg> }
function PlusIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg> }
function HistoryIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6" /><path d="M4 4v4.6h4.6M12 8v4l3 2" /></svg> }
function TrashIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" /></svg> }
function ChevronLeftIcon() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6" /></svg> }
