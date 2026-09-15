/** Existing Host session catalog presented for customer-service operations. */

import { useMemo, useState, type ReactNode } from 'react'
import type { SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { CustomerServiceAdminInjected } from './contracts.ts'
import { AdminPageHeader } from './AdminPage.tsx'
import css from './AdminSection.module.css'

type SessionsInjected = Pick<CustomerServiceAdminInjected, 'openSession'>
type SessionFilter = 'all' | 'running' | 'idle'

/** Props assembled for the customer conversation Settings entry. */
export type SessionsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customerServiceAdmin'>
  & InjectFace<SessionsInjected>

function formatTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(timestamp)
}

function matchesSession(session: SessionSummary, query: string): boolean {
  if (query.length === 0) return true
  return [session.id, session.displayTitle, session.agentPreset, session.cwd]
    .some(value => value?.toLocaleLowerCase().includes(query) === true)
}

function isHistoricalConversation(session: SessionSummary): boolean {
  return !session.blank && session.origin !== 'subagent'
}

/** Render searchable sessions and route a selected row back to conversation replay. */
export function SessionsSection({ useSessions, openSession, close, t }: SessionsSectionProps): ReactNode {
  const snapshot = useSessions(state => state)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [preset, setPreset] = useState('')
  const [openFailed, setOpenFailed] = useState(false)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const sessions = useMemo(
    () => snapshot.ids
      .map(id => snapshot.byId[id] as SessionSummary)
      .filter(isHistoricalConversation)
      .sort((left, right) => right.updatedAt - left.updatedAt),
    [snapshot],
  )
  const filtered = useMemo(
    () => sessions.filter(session => matchesSession(session, normalizedQuery)
      && (filter === 'all' || (filter === 'running' ? session.running : !session.running))
      && (preset === '' || session.agentPreset === preset)),
    [filter, normalizedQuery, preset, sessions],
  )
  const runningCount = sessions.filter(session => session.running).length
  const presets = [...new Set(sessions.flatMap(session => session.agentPreset ? [session.agentPreset] : []))].sort()
  const presetCount = presets.length

  const select = (session: SessionSummary): void => {
    try {
      openSession(session.id)
      close()
    } catch {
      setOpenFailed(true)
    }
  }

  return (
    <section className={css.page} aria-busy={snapshot.phase === 'pending'}>
      <AdminPageHeader eyebrow={t('sessionsNav')} title={t('sessionsTitle')} description={t('sessionsDescription')} />

      {snapshot.phase === 'pending' ? <p className={css.statusPanel}>{t('sessionsLoading')}</p> : null}
      {snapshot.phase === 'ready' ? (
        <>
          <div className={css.metricGrid}>
            <Metric label={t('activeConversations')} value={sessions.length} hint={t('replayableConversations')} />
            <Metric label={t('runningConversations')} value={runningCount} hint={t('liveConversationHint')} tone={runningCount > 0 ? 'warn' : undefined} />
            <Metric label={t('presetCount')} value={presetCount} hint={t('servicePresetHint')} />
            <Metric label={t('sessionSearchResults')} value={filtered.length} hint={t('currentFilter')} />
          </div>
          <div className={css.panel}>
            <p className={css.scopeNote}>{t('reviewScope')}</p>
            <div className={css.toolbar}>
              <input
                className={css.input}
                type="search"
                value={query}
                aria-label={t('searchSessions')}
                placeholder={t('searchSessions')}
                onChange={(event) => {
                  setQuery(event.currentTarget.value)
                  setOpenFailed(false)
                }}
              />
              <select className={css.select} aria-label={t('filterPreset')} value={preset} onChange={(event) => { setPreset(event.currentTarget.value) }}>
                <option value="">{t('all')}</option>
                {presets.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
              <div className={css.filterGroup} role="group" aria-label={t('sessionStatus')}>
                {(['all', 'running', 'idle'] as const).map(value => (
                  <button
                    className={css.filterButton}
                    type="button"
                    key={value}
                    data-active={filter === value ? 'true' : undefined}
                    aria-pressed={filter === value}
                    onClick={() => { setFilter(value) }}
                  >
                    {t(value)}
                  </button>
                ))}
              </div>
            </div>
            {openFailed ? <p className={css.notice} data-kind="error" role="alert">{t('openConversationError')}</p> : null}
            {sessions.length === 0 ? <p className={css.empty}>{t('sessionsEmpty')}</p> : null}
            {sessions.length > 0 && filtered.length === 0 ? <p className={css.empty}>{t('sessionsNoMatch')}</p> : null}
            {filtered.length > 0 ? (
              <ul className={css.sessionList}>
                {filtered.map((session) => {
                  const status = session.running ? 'running' : 'idle'
                  const tone = session.running ? 'warn' : 'success'
                  return (
                    <li className={css.sessionCard} key={session.id}>
                      <div className={css.sessionHeader}>
                        <h3 className={css.sessionTitle}>{session.displayTitle}</h3>
                        <span className={css.statusPill} data-tone={tone}>{t(status)}</span>
                      </div>
                      <div className={css.sessionMeta}>
                        <span>{session.id}</span>
                        <span>{t('preset')}: {session.agentPreset ?? t('unknown')}</span>
                        <span>{t('updated')}: {formatTime(session.updatedAt)}</span>
                      </div>
                      <div className={css.sessionFooter}>
                        <span className={css.sessionPath} title={session.cwd}>{session.cwd ?? t('unknown')}</span>
                        <button
                          className={css.sessionAction}
                          type="button"
                          aria-label={`${t('openConversation')}: ${session.displayTitle}`}
                          onClick={() => { select(session) }}
                        >
                          {t('openConversation')}
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  )
}

function Metric({ label, value, hint, tone }: {
  label: string
  value: number
  hint: string
  tone?: 'warn' | undefined
}): ReactNode {
  return (
    <div className={css.metricCard} data-tone={tone}>
      <span className={css.metricLabel}>{label}</span>
      <strong className={css.metricValue}>{value}</strong>
      <span className={css.metricHint}>{hint}</span>
    </div>
  )
}
