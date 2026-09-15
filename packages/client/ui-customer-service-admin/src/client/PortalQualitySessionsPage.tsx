/** Standalone session-quality page with a self-contained execution trace. */

import type { QualityInspection } from '@deepseek-ai/dsh-api-remotes/client'
import type { QualityPageProps, QualitySessionsProps } from './quality-contract.ts'
import { QualitySessionsPage } from './QualityPages.tsx'
import css from './Operations.module.css'

type TraceRecord = QualityInspection['records'][number]

/** Adapt the quality page to the standalone shell without claiming the legacy trace slot. */
export function PortalQualitySessionsPage(props: QualityPageProps) {
  const renderTrace = ((_key: string, owner: object) => (
    <PortalTrace {...owner as Parameters<typeof PortalTrace>[0]} />
  )) as QualitySessionsProps['renderSlot']
  return <QualitySessionsPage {...props} renderSlot={renderTrace} />
}

function PortalTrace({ records, selectedSeq, onSelect }: {
  records: TraceRecord[]
  selectedSeq: number | null
  onSelect: (seq: number) => void
}) {
  if (records.length === 0) return <div className={css.empty}>當前範圍沒有可顯示的執行事件。</div>
  return <ol className={css.portalTrace} aria-label="會話執行過程">
    {records.map(record => (
      <li key={record.seq} data-selected={record.seq === selectedSeq || record.endSeq === selectedSeq}>
        <button onClick={() => { onSelect(record.seq) }}>
          <span><strong>{record.name}</strong><small>#{record.seq} · 輪 {record.turn} · {record.kind}</small></span>
          <span>{record.durationMs === null ? '—' : `${record.durationMs} ms`}</span>
        </button>
        {(record.input || record.output) && <details><summary>查看輸入與輸出</summary>
          {record.input && <pre>{record.input}</pre>}{record.output && <pre>{record.output}</pre>}
        </details>}
      </li>
    ))}
  </ol>
}
