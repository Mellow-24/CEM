/** Operations overview backed by the customer-service admin Remote. */

import type { ReactNode } from 'react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AdminOverview, CustomerServiceAdminInjected } from './contracts.ts'
import type { CustomerServiceAdminLocaleKey } from './locales.ts'
import { useResource } from './useResource.ts'
import { AdminPageHeader, ResourceFeedback } from './AdminPage.tsx'
import css from './AdminSection.module.css'

type OverviewInjected = Pick<CustomerServiceAdminInjected, 'overview'>

/** Props assembled for the operations overview Settings entry. */
export type OverviewSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customerServiceAdmin'>
  & InjectFace<OverviewInjected>
  & { readonly standalone?: boolean }

const INDEX_KEYS = {
  missing: 'indexMissing',
  present: 'indexPresent',
  invalid: 'indexInvalid',
} satisfies Record<AdminOverview['rag']['index']['state'], CustomerServiceAdminLocaleKey>

const INDEX_TONES = {
  missing: 'warn',
  present: 'success',
  invalid: 'error',
} satisfies Record<AdminOverview['rag']['index']['state'], 'warn' | 'success' | 'error'>

function Metric({ label, value, hint, tone }: {
  label: string
  value: string | number
  hint: string
  tone?: 'success' | 'warn' | 'error' | undefined
}): ReactNode {
  return (
    <div className={css.metricCard} data-tone={tone}>
      <span className={css.metricLabel}>{label}</span>
      <strong className={css.metricValue}>{value}</strong>
      <span className={css.metricHint}>{hint}</span>
    </div>
  )
}

function isHistoricalConversation(session: SessionSummary): boolean {
  return !session.blank && session.origin !== 'subagent'
}

function Definition({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <div className={css.definitionItem}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Render the live customer-service operations overview. */
export function OverviewSection({ overview, useSessions, t, standalone }: OverviewSectionProps): ReactNode {
  const resource = useResource(overview)
  const sessionState = useSessions(state => state)

  return (
    <section className={css.page} aria-busy={resource.state.status === 'loading'}>
      <AdminPageHeader
        eyebrow={t('overviewNav')} title={t('overviewTitle')} description={t('overviewDescription')} badge={t('currentSnapshot')}
      />
      <ResourceFeedback status={resource.state.status} onRetry={resource.retry} t={t} />
      {resource.state.status === 'ready' ? <OverviewBody value={resource.state.value} sessionState={sessionState} t={t} hideModelIdentity={standalone === true} /> : null}
    </section>
  )
}

function OverviewBody({ value, sessionState, t, hideModelIdentity }: {
  value: AdminOverview
  sessionState: SessionListState
  t: OverviewSectionProps['t']
  hideModelIdentity: boolean
}): ReactNode {
  const index = value.rag.index
  const config = value.rag.config
  const wiki = value.wiki.release
  const identityMismatch = index.state === 'present' && index.matchesConfiguredIdentity === false
  const indexKey = identityMismatch ? 'identityMismatched' : INDEX_KEYS[index.state]
  const indexTone = identityMismatch ? 'error' : INDEX_TONES[index.state]
  const sessions = sessionState.ids
    .map(id => sessionState.byId[id] as SessionSummary)
    .filter(isHistoricalConversation)
  const runningSessions = sessions.filter(session => session.running).length
  const presetCount = new Set(sessions.map(session => session.agentPreset).filter(Boolean)).size
  const liveIndex = index.state === 'present' && !identityMismatch
  const attentionCount = value.badCases.open + (liveIndex ? 0 : 1)
  return (
    <>
      <div className={css.metricGrid}>
        <Metric label={t('documents')} value={value.rag.documents} hint={t('ragKnowledge')} />
        <Metric label={t('chunks')} value={value.rag.chunks} hint={t(indexKey)} tone={indexTone} />
        <Metric label={t('activeConversations')} value={sessionState.phase === 'ready' ? sessions.length : '—'} hint={sessionState.phase === 'ready' ? `${t('runningConversations')} ${runningSessions}` : t('sessionsLoading')} tone={runningSessions > 0 ? 'warn' : undefined} />
        <Metric label={t('attentionItems')} value={attentionCount} hint={`${t('evaluationNav')} · ${value.badCases.open}`} tone={attentionCount > 0 ? 'warn' : 'success'} />
      </div>

      <article className={css.commandCenter}>
        <header className={css.panelHeader}>
          <div>
            <h3 className={css.panelTitle}>{t('serviceCommandTitle')}</h3>
            <p className={css.panelDescription}>{t('serviceCommandDescription')}</p>
          </div>
          <span className={css.statusPill} data-tone={liveIndex ? 'success' : indexTone}>{t(liveIndex ? 'serviceReady' : 'serviceNeedsAttention')}</span>
        </header>
        <div className={css.commandGrid}>
          <ServiceSignal
            label={t('retrievalService')}
            value={t(indexKey)}
            detail={`${t('documents')} ${value.rag.documents} · ${t('chunks')} ${value.rag.chunks}`}
            tone={indexTone}
          />
          <ServiceSignal
            label={t('knowledgeRelease')}
            value={wiki.releaseId}
            detail={`${t('pages')} ${wiki.pages.length} · ${t('sourceArtifacts')} ${wiki.sourceArtifacts}`}
            tone="success"
          />
          <ServiceSignal
            label={t('conversationOperations')}
            value={t(sessionState.phase === 'ready' ? 'sessionCatalogReady' : 'sessionsLoading')}
            detail={sessionState.phase === 'ready' ? `${t('sessionCount')} ${sessions.length} · ${t('presetCount')} ${presetCount}` : t('sessionsLoading')}
            tone={sessionState.phase === 'ready' ? 'success' : 'warn'}
          />
          <ServiceSignal
            label={t('evaluationNav')}
            value={t(value.badCases.open === 0 ? 'noOpenCases' : 'openCases')}
            detail={`${t('openCases')} ${value.badCases.open} · ${t('closedCases')} ${value.badCases.closed}`}
            tone={value.badCases.open === 0 ? 'success' : 'warn'}
          />
        </div>
      </article>

      <div className={css.twoColumns}>
        <article className={css.panel}>
          <header className={css.panelHeader}>
            <h3 className={css.panelTitle}>{t('ragKnowledge')}</h3>
            <span className={css.statusPill} data-tone={indexTone}>{t(indexKey)}</span>
          </header>
          <dl className={css.definitionGrid}>
            {hideModelIdentity ? null : <>
              <Definition label={t('embeddingModel')} value={config.embeddingModel} />
              <Definition label={t('rerankerModel')} value={config.rerankerModel} />
            </>}
            <Definition label={t('rerank')} value={t(config.rerank ? 'enabled' : 'disabled')} />
            <Definition label={t('chunkSize')} value={config.chunkChars} />
            <Definition label={t('chunkOverlap')} value={config.chunkOverlapChars} />
            <Definition label={t('candidates')} value={config.candidateCount} />
            <Definition label={t('results')} value={config.resultCount} />
            <Definition label={t('vectorThreshold')} value={config.minimumVectorScore} />
            <Definition label={t('rerankThreshold')} value={config.minimumRerankScore} />
            <Definition label={t('indexedChunks')} value={index.indexedChunks ?? t('unknown')} />
            <Definition label={t('vectorDimension')} value={index.vectorDimension ?? t('unknown')} />
            {index.matchesConfiguredIdentity === undefined ? null : (
              <Definition
                label={t('indexStatus')}
                value={t(index.matchesConfiguredIdentity ? 'identityMatched' : 'identityMismatched')}
              />
            )}
          </dl>
        </article>

        <article className={css.panel}>
          <header className={css.panelHeader}>
            <h3 className={css.panelTitle}>{t('wikiKnowledge')}</h3>
            <span className={css.statusPill} title={wiki.releaseId}>
              <span className={css.releaseId}>{wiki.releaseId}</span>
            </span>
          </header>
          <dl className={css.definitionGrid}>
            <Definition label={t('release')} value={wiki.releaseId} />
            <Definition label={t('policyHash')} value={wiki.policyHash} />
            <Definition label={t('pages')} value={wiki.pages.length} />
            <Definition label={t('sourceArtifacts')} value={wiki.sourceArtifacts} />
            <Definition label={t('openCases')} value={value.badCases.open} />
            <Definition label={t('closedCases')} value={value.badCases.closed} />
          </dl>
        </article>
      </div>
    </>
  )
}

function ServiceSignal({ label, value, detail, tone }: {
  label: string
  value: string
  detail: string
  tone: 'success' | 'warn' | 'error'
}): ReactNode {
  return (
    <div className={css.serviceSignal} data-tone={tone}>
      <span className={css.signalLabel}>{label}</span>
      <strong className={css.signalValue}>{value}</strong>
      <span className={css.signalDetail}>{detail}</span>
    </div>
  )
}
