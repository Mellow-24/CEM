/** Read-only operations inspection through the same trajectory ledger as the conversation tab. */
import { useMemo, useState } from 'react'
import type { QualityTraceRecord } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { TrajectoryTable } from './TrajectoryTable.tsx'
import type { TrajectoryTurnModel } from './layout.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Host-inspected events, independent of the currently active conversation. */
    'operations.trace': {
      kind: 'single'
      scope: 'root'
      owner: {
        records: QualityTraceRecord[]
        selectedSeq: number | null
        onSelect: (seq: number) => void
      }
    }
  }
}

/** Render pinned inspection records with the existing trace selection, timing and input/output inspector. */
export function OperationsTrace({ records, selectedSeq, onSelect }: PropsRuntime<'operations.trace'>) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set())
  const turns = useMemo((): TrajectoryTurnModel[] => [...new Set(records.map(record => record.turn))].map(turn => ({
    turn,
    groups: [...new Set(records.filter(record => record.turn === turn).map(record => record.step))].map(step => ({
      title: `Step ${step}`,
      cells: records.filter(record => record.turn === turn && record.step === step).map(record => ({
        index: record.seq + 1, sourceSeq: record.seq, kind: record.kind === 'assistant' ? 'message' as const
          : record.kind === 'lifecycle' ? 'context' as const : record.kind,
        text: record.name, inputDetail: record.input, outputDetail: record.output, ...(record.error ? { result: '异常' } : {}),
        startedAt: record.time, timeSeconds: record.durationMs === null ? null : record.durationMs / 1000,
        isError: record.error, ...(record.tokens === null ? {} : { output: record.tokens }),
      })),
    })),
  })), [records])
  const selected = records.find(record => record.seq === selectedSeq || record.endSeq === selectedSeq)
  return <TrajectoryTable turns={turns} collapsedTurns={collapsed} collapsedAssistants={new Set()}
    onToggleTurn={(turn) => { setCollapsed((previous) => {
      const next = new Set(previous); if (next.has(turn)) next.delete(turn); else next.add(turn); return next
    }) }} onToggleAssistant={() => {}}
    recordSelection={selected ? { index: selected.seq + 1 } : null}
    onRecordSelect={(index) => { onSelect(index - 1) }} />
}
