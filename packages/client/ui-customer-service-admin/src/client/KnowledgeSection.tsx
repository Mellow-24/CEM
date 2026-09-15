/** Knowledge assets, safe staging, and retrieval validation. */

import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AdminDocumentList,
  AdminOverview,
  AdminSearchTestRequest,
  AdminSearchTestResult,
  AdminStagedDocumentList,
  AdminStageDocumentResult,
  CustomerServiceAdminInjected,
} from './contracts.ts'
import type { CustomerServiceAdminLocaleKey } from './locales.ts'
import { useResource } from './useResource.ts'
import { AdminPageHeader, formatTimestamp, ResourceFeedback } from './AdminPage.tsx'
import css from './AdminSection.module.css'

type KnowledgeInjected = Pick<CustomerServiceAdminInjected,
  'overview' | 'listDocuments' | 'listStagedDocuments' | 'stageTextDocument' | 'searchTest'>

/** Props assembled for the knowledge-base Settings entry. */
export type KnowledgeSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customerServiceAdmin'>
  & InjectFace<KnowledgeInjected>
  & { readonly standalone?: boolean }

interface KnowledgeSnapshot {
  readonly overview: AdminOverview
  readonly documents: AdminDocumentList
  readonly staged: AdminStagedDocumentList
}

type UploadNotice =
  | { readonly kind: 'success'; readonly key: CustomerServiceAdminLocaleKey }
  | { readonly kind: 'error'; readonly key: CustomerServiceAdminLocaleKey }
  | undefined

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly result: AdminSearchTestResult }

type StageErrorCode = Extract<AdminStageDocumentResult, { readonly ok: false }>['error']['code']
type WikiPageId = Extract<AdminSearchTestRequest, { readonly retrieval: 'llm-wiki' }>['pageId']

const DOCUMENT_STATE_KEYS = {
  approved: 'approved',
  published: 'published',
  changed: 'changed',
  unpublished: 'unpublished',
} satisfies Record<AdminDocumentList['items'][number]['state'], CustomerServiceAdminLocaleKey>

const DOCUMENT_STATE_TONES = {
  approved: 'success',
  published: 'success',
  changed: 'warn',
  unpublished: 'neutral',
} satisfies Record<AdminDocumentList['items'][number]['state'], 'success' | 'warn' | 'neutral'>

const STAGE_ERROR_KEYS = {
  'invalid-name': 'stageInvalidName',
  'unsupported-extension': 'stageUnsupported',
  'invalid-utf8': 'stageInvalidUtf8',
  'empty-document': 'stageEmpty',
  'document-too-large': 'stageTooLarge',
  'document-exists': 'stageExists',
  'staging-conflict': 'stageConflict',
} satisfies Record<StageErrorCode, CustomerServiceAdminLocaleKey>

function formatBytes(bytes: number): string {
  return `${bytes.toLocaleString()} B`
}

function shortHash(hash: string): string {
  return hash.length > 16 ? `${hash.slice(0, 16)}…` : hash
}

/** Render active knowledge, isolated staging, and the retrieval test bench. */
export function KnowledgeSection(props: KnowledgeSectionProps): ReactNode {
  const { overview, listDocuments, listStagedDocuments, t } = props
  const [uploadNotice, setUploadNotice] = useState<UploadNotice>()
  const load = useCallback(async (): Promise<KnowledgeSnapshot> => {
    const [overviewValue, documents, staged] = await Promise.all([
      overview(), listDocuments(), listStagedDocuments(),
    ])
    return { overview: overviewValue, documents, staged }
  }, [listDocuments, listStagedDocuments, overview])
  const resource = useResource(load)

  return (
    <section className={css.page} aria-busy={resource.state.status === 'loading'}>
      <AdminPageHeader
        eyebrow={t('knowledgeNav')} title={t('knowledgeTitle')} description={t('knowledgeDescription')}
      />

      {uploadNotice === undefined ? null : (
        <p
          className={css.notice}
          data-kind={uploadNotice.kind}
          role={uploadNotice.kind === 'error' ? 'alert' : 'status'}
        >
          {t(uploadNotice.key)}
        </p>
      )}
      <ResourceFeedback status={resource.state.status} onRetry={resource.retry} t={t} />
      {resource.state.status === 'ready' ? (
        <KnowledgeBody
          {...props}
          snapshot={resource.state.value}
          reload={resource.retry}
          setUploadNotice={setUploadNotice}
        />
      ) : null}
    </section>
  )
}

function KnowledgeBody(props: KnowledgeSectionProps & {
  snapshot: KnowledgeSnapshot
  reload: () => void
  setUploadNotice: (notice: UploadNotice) => void
}): ReactNode {
  return (
    <>
      <KnowledgeWorkflow snapshot={props.snapshot} t={props.t} hideModelIdentity={props.standalone === true} />
      <KnowledgeCatalog snapshot={props.snapshot} t={props.t} />
      <div className={css.twoColumns}>
        <StagingPanel {...props} />
        <SearchTestPanel {...props} />
      </div>
    </>
  )
}

function KnowledgeWorkflow({ snapshot, t, hideModelIdentity }: {
  snapshot: KnowledgeSnapshot
  t: KnowledgeSectionProps['t']
  hideModelIdentity: boolean
}): ReactNode {
  const index = snapshot.overview.rag.index
  const configured = index.state === 'present' && index.matchesConfiguredIdentity !== false
  const averageChunks = snapshot.overview.rag.documents === 0
    ? 0
    : Math.round(snapshot.overview.rag.chunks / snapshot.overview.rag.documents)
  return (
    <article className={css.knowledgeWorkflow}>
      <header className={css.panelHeader}>
        <div>
          <h3 className={css.panelTitle}>{t('knowledgeFlowTitle')}</h3>
          <p className={css.panelDescription}>{t('knowledgeFlowDescription')}</p>
        </div>
        <span className={css.statusPill} data-tone={configured ? 'success' : 'warn'}>
          {t(configured ? 'pipelineReady' : 'pipelineNeedsAttention')}
        </span>
      </header>
      <div className={css.pipelineRail}>
        <PipelineStep
          label={t('sourceStage')}
          value={`${snapshot.documents.items.length} ${t('documents')}`}
          detail={`${t('averageChunks')} ${averageChunks}`}
          tone="success"
        />
        <PipelineStep
          label={t('stagedAssets')}
          value={`${snapshot.staged.items.length} ${t('stagedDocuments')}`}
          detail={t('uploadDescription')}
          tone={snapshot.staged.items.length === 0 ? 'neutral' : 'warn'}
        />
        <PipelineStep
          label={t('indexStage')}
          value={t(index.state === 'present' ? (configured ? 'indexPresent' : 'identityMismatched') : index.state === 'missing' ? 'indexMissing' : 'indexInvalid')}
          detail={hideModelIdentity
            ? `${t('indexedChunks')} ${index.indexedChunks ?? t('unknown')}`
            : `${t('embeddingModel')} ${snapshot.overview.rag.config.embeddingModel}`}
          tone={configured ? 'success' : 'warn'}
        />
        <PipelineStep
          label={t('validationStage')}
          value={t('readyForSearch')}
          detail={`${t('rerank')} ${t(snapshot.overview.rag.config.rerank ? 'enabled' : 'disabled')}`}
          tone="neutral"
        />
      </div>
    </article>
  )
}

function PipelineStep({ label, value, detail, tone }: {
  label: string
  value: string
  detail: string
  tone: 'success' | 'warn' | 'neutral'
}): ReactNode {
  return (
    <div className={css.pipelineStep} data-tone={tone}>
      <span className={css.pipelineLabel}>{label}</span>
      <strong className={css.pipelineValue}>{value}</strong>
      <span className={css.pipelineDetail}>{detail}</span>
    </div>
  )
}

function KnowledgeCatalog({ snapshot, t }: {
  snapshot: KnowledgeSnapshot
  t: KnowledgeSectionProps['t']
}): ReactNode {
  const [query, setQuery] = useState('')
  const [strategy, setStrategy] = useState('all')
  const documents = snapshot.documents.items.filter(document =>
    document.relativePath.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (strategy === 'all' || document.retrieval === strategy))
  return (
    <article className={css.panel}>
      <header className={css.panelHeader}>
        <div>
          <h3 className={css.panelTitle}>{t('activeDocuments')}</h3>
          <p className={css.panelDescription}>
            {t('documents')} {snapshot.documents.items.length} · {t('chunks')} {snapshot.overview.rag.chunks}
          </p>
        </div>
      </header>
      <div className={css.toolbar}>
        <input className={css.input} type="search" aria-label={t('searchDocuments')} placeholder={t('searchDocuments')} value={query} onChange={(event) => { setQuery(event.currentTarget.value) }} />
        <select className={css.select} aria-label={t('documentStrategy')} value={strategy} onChange={(event) => { setStrategy(event.currentTarget.value) }}>
          <option value="all">{t('all')}</option>
          <option value="rag">{t('ragOption')}</option>
          <option value="llm-wiki">{t('wikiOption')}</option>
        </select>
      </div>
      {snapshot.documents.items.length > 0 && documents.length === 0 ? <p className={css.empty}>{t('documentsNoMatch')}</p> : null}
      {snapshot.documents.items.length === 0 ? <p className={css.empty}>{t('knowledgeEmpty')}</p> : (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead><tr><th>{t('file')}</th><th>{t('retrieval')}</th><th>{t('size')}</th><th>{t('state')}</th></tr></thead>
            <tbody>
              {documents.map(document => (
                <tr key={document.documentId}>
                  <td className={css.fileCell}>
                    <span className={css.filePath} title={document.relativePath}>{document.relativePath}</span>
                    <span className={css.hash} title={document.sha256}>{shortHash(document.sha256)}</span>
                  </td>
                  <td>{document.retrieval === 'rag' ? t('ragOption') : t('wikiOption')}</td>
                  <td>{formatBytes(document.sizeBytes)}</td>
                  <td>
                    <span className={css.statusPill} data-tone={DOCUMENT_STATE_TONES[document.state]}>
                      {t(DOCUMENT_STATE_KEYS[document.state])}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}

function StagingPanel({ snapshot, stageTextDocument, reload, setUploadNotice, t }: KnowledgeSectionProps & {
  snapshot: KnowledgeSnapshot
  reload: () => void
  setUploadNotice: (notice: UploadNotice) => void
}): ReactNode {
  const [file, setFile] = useState<File>()
  const [submitting, setSubmitting] = useState(false)

  const submit = async (selectedFile: File): Promise<void> => {
    setSubmitting(true)
    setUploadNotice(undefined)
    try {
      const content = await selectedFile.text()
      const result = await stageTextDocument({
        name: selectedFile.name,
        content,
        expectedRevision: snapshot.staged.revision,
      })
      if (!result.ok) {
        setUploadNotice({ kind: 'error', key: STAGE_ERROR_KEYS[result.error.code] })
        if (result.error.code === 'staging-conflict') reload()
        return
      }
      setUploadNotice({ kind: 'success', key: 'stageSuccess' })
      setFile(undefined)
      reload()
    } catch {
      setUploadNotice({ kind: 'error', key: 'stageError' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className={css.panel}>
      <header className={css.panelHeader}>
        <div>
          <h3 className={css.panelTitle}>{t('uploadTitle')}</h3>
          <p className={css.panelDescription}>{t('uploadDescription')}</p>
        </div>
      </header>
      <label className={css.field}>
        <span>{t('chooseDocument')}</span>
        <input
          className={css.fileInput}
          type="file"
          disabled={submitting}
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0])
            setUploadNotice(undefined)
          }}
        />
      </label>
      <div className={css.formActions}>
        <span className={css.fileName}>{file?.name ?? t('noFileSelected')}</span>
        <button
          className={css.primaryButton}
          type="button"
          disabled={file === undefined || submitting}
          onClick={() => { void submit(file as File) }}
        >
          {submitting ? t('staging') : t('stageDocument')}
        </button>
      </div>
      <header className={css.panelHeader}>
        <div>
          <h3 className={css.panelTitle}>{t('stagedDocuments')}</h3>
          <p className={css.panelDescription}>{snapshot.staged.items.length}</p>
        </div>
      </header>
      {snapshot.staged.items.length === 0 ? <p className={css.empty}>{t('stagedEmpty')}</p> : (
        <div className={css.tableWrap}>
          <table className={css.table}>
            <thead><tr><th>{t('file')}</th><th>{t('size')}</th><th>{t('modifiedAt')}</th></tr></thead>
            <tbody>
              {snapshot.staged.items.map(document => (
                <tr key={document.documentId}>
                  <td className={css.fileCell}>
                    <span className={css.filePath}>{document.name}</span>
                    <span className={css.hash} title={document.sha256}>{shortHash(document.sha256)}</span>
                  </td>
                  <td>{formatBytes(document.sizeBytes)}</td>
                  <td>{formatTimestamp(document.modifiedAt) ?? t('unknown')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </article>
  )
}

function SearchTestPanel({ snapshot, searchTest, t }: KnowledgeSectionProps & {
  snapshot: KnowledgeSnapshot
}): ReactNode {
  const [retrieval, setRetrieval] = useState<'rag' | 'llm-wiki'>('rag')
  const [query, setQuery] = useState('')
  const [wikiPageId, setWikiPageId] = useState<WikiPageId>()
  const [search, setSearch] = useState<SearchState>({ status: 'idle' })
  const pages = snapshot.overview.wiki.release.pages
  const selectedPageId = wikiPageId ?? pages[0]?.pageId
  const disabled = query.trim().length === 0 || search.status === 'loading'
    || (retrieval === 'llm-wiki' && selectedPageId === undefined)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const normalized = query.trim()
    if (normalized.length === 0) return
    let request: AdminSearchTestRequest
    if (retrieval === 'rag') {
      request = { retrieval, query: normalized }
    } else {
      if (selectedPageId === undefined) return
      request = { retrieval, query: normalized, pageId: selectedPageId }
    }
    setSearch({ status: 'loading' })
    try {
      setSearch({ status: 'ready', result: await searchTest(request) })
    } catch {
      setSearch({ status: 'error' })
    }
  }

  return (
    <article className={css.panel}>
      <header className={css.panelHeader}>
        <div>
          <h3 className={css.panelTitle}>{t('searchTestTitle')}</h3>
          <p className={css.panelDescription}>{t('searchTestDescription')}</p>
        </div>
      </header>
      <form className={css.formGrid} onSubmit={(event) => { void submit(event) }}>
        <div className={css.querySuggestions} role="group" aria-label={t('sampleQuestions')}>
          {(['sampleBilling', 'sampleContract', 'sampleOutage'] as const).map(key => (
            <button className={css.filterButton} type="button" key={key} disabled={search.status === 'loading'} onClick={() => { setQuery(t(key)); setSearch({ status: 'idle' }) }}>{t(key)}</button>
          ))}
        </div>
        <label className={css.field}>
          <span>{t('retrieval')}</span>
          <select
            className={css.select}
            value={retrieval}
            disabled={search.status === 'loading'}
            onChange={(event) => {
              setRetrieval(event.currentTarget.value as typeof retrieval)
              setSearch({ status: 'idle' })
            }}
          >
            <option value="rag">{t('ragOption')}</option>
            <option value="llm-wiki">{t('wikiOption')}</option>
          </select>
        </label>
        {retrieval === 'llm-wiki' ? (
          <label className={css.field}>
            <span>{t('wikiPage')}</span>
            <select
              className={css.select}
              value={selectedPageId ?? ''}
              disabled={pages.length === 0 || search.status === 'loading'}
              onChange={(event) => {
                setWikiPageId(event.currentTarget.value as WikiPageId)
                setSearch({ status: 'idle' })
              }}
            >
              {pages.map(page => <option key={page.pageId} value={page.pageId}>{page.title}</option>)}
            </select>
          </label>
        ) : null}
        <label className={css.fieldWide}>
          <span>{t('query')}</span>
          <input
            className={css.input}
            value={query}
            placeholder={t('queryPlaceholder')}
            disabled={search.status === 'loading'}
            onChange={(event) => {
              setQuery(event.currentTarget.value)
              setSearch({ status: 'idle' })
            }}
          />
        </label>
        <div className={css.formActions}>
          <span className={css.fileName}>{retrieval === 'rag' ? t('ragOption') : t('wikiOption')}</span>
          <button className={css.primaryButton} type="submit" disabled={disabled}>{search.status === 'loading' ? t('searching') : t('runSearch')}</button>
        </div>
      </form>
      {search.status === 'error' ? <p className={css.notice} data-kind="error" role="alert">{t('searchError')}</p> : null}
      {search.status === 'ready' ? <SearchResult result={search.result} t={t} /> : null}
    </article>
  )
}

function SearchResult({ result, t }: {
  result: AdminSearchTestResult
  t: KnowledgeSectionProps['t']
}): ReactNode {
  const found = result.status === 'found' && result.sources.length > 0
  return (
    <div className={css.searchResult}>
      <div className={css.searchSummary}>
        <strong>{found ? t('searchFound') : t('searchNotFound')}</strong>
        <span className={css.statusPill} data-tone={found ? 'success' : 'warn'}>{t('duration')} {result.durationMs} ms</span>
      </div>
      {result.retrieval === 'rag' ? <p className={css.panelDescription}>{t('reranked')}: {t(result.reranked ? 'enabled' : 'disabled')}</p> : null}
      <p className={css.panelDescription}>{t('evidenceCount')}: {result.sources.length} · {t('evidenceHint')}</p>
      {found ? (
        <ol className={css.sourceList}>
          {result.sources.map(source => (
            <li className={css.sourceCard} key={source.evidenceId}>
              <div className={css.sourceMeta}>
                <strong>{'title' in source ? source.title : source.relativePath}</strong>
                <span>{t('score')} {source.score.toFixed(3)}</span>
                {'section' in source ? <span>{source.section}</span> : null}
                {'start' in source ? <span>{source.start}–{source.end}</span> : null}
              </div>
              <p className={css.sourceExcerpt}>{source.excerpt}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
