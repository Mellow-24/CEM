/** Recorded regression cases for the customer-service evaluation loop. */

import { useMemo, useState, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AdminBadCaseList, CustomerServiceAdminInjected } from './contracts.ts'
import { useResource } from './useResource.ts'
import { AdminPageHeader, formatTimestamp, ResourceFeedback } from './AdminPage.tsx'
import css from './AdminSection.module.css'

type EvaluationInjected = Pick<CustomerServiceAdminInjected, 'listBadCases'>
type CaseFilter = 'all' | AdminBadCaseList['items'][number]['status']

/** Props assembled for the customer-service evaluation Settings entry. */
export type EvaluationSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customerServiceAdmin'>
  & InjectFace<EvaluationInjected>

/** Render bad-case counts, filters, and acceptance details. */
export function EvaluationSection({ listBadCases, t }: EvaluationSectionProps): ReactNode {
  const resource = useResource(listBadCases)
  const [filter, setFilter] = useState<CaseFilter>('all')
  const filtered = useMemo(
    () => resource.state.status === 'ready'
      ? resource.state.value.items.filter(item => filter === 'all' || item.status === filter)
      : [],
    [filter, resource.state],
  )

  return (
    <section className={css.page} aria-busy={resource.state.status === 'loading'}>
      <AdminPageHeader
        eyebrow={t('evaluationNav')} title={t('evaluationTitle')} description={t('evaluationDescription')}
      />
      <ResourceFeedback status={resource.state.status} onRetry={resource.retry} t={t} />
      {resource.state.status === 'ready' ? (
        <EvaluationBody items={resource.state.value.items} filtered={filtered} filter={filter} setFilter={setFilter} t={t} />
      ) : null}
    </section>
  )
}

function EvaluationBody({ items, filtered, filter, setFilter, t }: {
  items: AdminBadCaseList['items']
  filtered: AdminBadCaseList['items']
  filter: CaseFilter
  setFilter: (filter: CaseFilter) => void
  t: EvaluationSectionProps['t']
}): ReactNode {
  const open = items.filter(item => item.status === 'open').length
  const closed = items.length - open
  const passed = items.filter(item => item.verdict === 'pass').length
  const passRate = items.length === 0 ? 0 : Math.round((passed / items.length) * 100)
  const failureCounts = new Map<string, number>()
  for (const item of items) {
    for (const failureType of item.failureTypes) {
      failureCounts.set(failureType, (failureCounts.get(failureType) ?? 0) + 1)
    }
  }
  const primaryFailures = [...failureCounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3)
  return (
    <>
      <div className={css.metricGrid}>
        <div className={css.metricCard}><span className={css.metricLabel}>{t('badCases')}</span><strong className={css.metricValue}>{items.length}</strong></div>
        <div className={css.metricCard} data-tone={open > 0 ? 'warn' : 'success'}><span className={css.metricLabel}>{t('openCases')}</span><strong className={css.metricValue}>{open}</strong></div>
        <div className={css.metricCard}><span className={css.metricLabel}>{t('closedCases')}</span><strong className={css.metricValue}>{closed}</strong></div>
        <div className={css.metricCard} data-tone={items.length === 0 ? undefined : passRate === 100 ? 'success' : 'warn'}><span className={css.metricLabel}>{t('qualityPassRate')}</span><strong className={css.metricValue}>{items.length === 0 ? '—' : `${passRate}%`}</strong><span className={css.metricHint}>{t('qualityPassRateHint')}</span></div>
      </div>
      <article className={css.qualitySummary}>
        <header className={css.panelHeader}>
          <div>
            <h3 className={css.panelTitle}>{t('qualitySummaryTitle')}</h3>
            <p className={css.panelDescription}>{t('qualitySummaryDescription')}</p>
          </div>
          <span className={css.statusPill} data-tone={open === 0 ? 'success' : 'warn'}>{t(open === 0 ? 'noOpenCases' : 'openCases')}</span>
        </header>
        <div className={css.qualitySignals}>
          <div className={css.qualitySignal}>
            <span className={css.signalLabel}>{t('qualityGate')}</span>
            <strong className={css.signalValue}>{passed} / {items.length} {t('qualityGateValue')}</strong>
            <span className={css.signalDetail}>{t('qualityGateHint')}</span>
          </div>
          <div className={css.qualitySignal}>
            <span className={css.signalLabel}>{t('primaryFailureTypes')}</span>
            {primaryFailures.length === 0 ? <strong className={css.signalValue}>{t('noFailureTypes')}</strong> : (
              <div className={css.failureTagList}>
                {primaryFailures.map(([failureType, count]) => (
                  <span className={css.failureTag} key={failureType}>{failureType} · {count}</span>
                ))}
              </div>
            )}
            <span className={css.signalDetail}>{t('primaryFailureHint')}</span>
          </div>
        </div>
      </article>
      <article className={css.panel}>
        <div className={css.toolbar}>
          <h3 className={css.panelTitle}>{t('evaluationTitle')}</h3>
          <div className={css.filterGroup} role="group" aria-label={t('state')}>
            {(['all', 'open', 'closed'] as const).map(value => (
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
        {items.length === 0 ? <p className={css.empty}>{t('evaluationEmpty')}</p> : null}
        {items.length > 0 && filtered.length === 0 ? <p className={css.empty}>{t('evaluationNoMatch')}</p> : null}
        {filtered.length > 0 ? (
          <ul className={css.caseList}>
            {filtered.map(item => (
              <li className={css.caseCard} key={item.badCaseId}>
                <div className={css.caseHeader}>
                  <h3 className={css.caseTitle}>{item.query}</h3>
                  <span className={css.statusPill} data-tone={item.status === 'open' ? 'warn' : 'success'}>{t(item.status)}</span>
                </div>
                <div className={css.caseMeta}>
                  <span>{item.preset}</span>
                  <span>{item.retrieval === 'rag' ? t('ragOption') : t('wikiOption')}</span>
                  <span>{t('capturedAt')}: {formatTimestamp(item.capturedAt) ?? t('unknown')}</span>
                  <span>{t('language')}: {item.queryLanguage}</span>
                  <span>{t('verdict')}: {t(item.verdict)}</span>
                </div>
                <p className={css.caseSummary}>{item.summary}</p>
                <details className={css.caseDetails}>
                  <summary>{t('caseDetails')}</summary>
                  <dl className={css.caseDefinition}>
                    <div><dt>{t('failureTypes')}</dt><dd>{item.failureTypes.join(' · ') || t('unknown')}</dd></div>
                    <div><dt>{t('acceptanceCriteria')}</dt><dd>{item.acceptanceCriteria.join('\n')}</dd></div>
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        ) : null}
      </article>
    </>
  )
}
