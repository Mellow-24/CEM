/** Project a requested Session snapshot to business-readable history without model reasoning. */
import type { HistoryEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConversationReadout } from './operations-contract.ts'

/**
 * Extract recorded customer and assistant text from one bounded history page.
 * @param entries - Validated events returned by the existing history API.
 * @param hasMore - Whether the Host has earlier events.
 * @returns A point-in-time readout with the original timestamps and paging flag.
 */
export function conversationReadout(entries: readonly HistoryEntry[], hasMore: boolean): ConversationReadout {
  return {
    hasMore, beforeSeq: entries[0]?.event.seq,
    messages: entries.flatMap(({ event }) => {
      if (event.type === 'user/message') {
        if (event.data.source.kind !== 'user') return []
        const text = event.data.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
        return text ? [{ seq: event.seq, time: event.time, role: '客戶', text }] : []
      }
      if (event.type === 'assistant/message') {
        const text = event.data.message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
        return text ? [{ seq: event.seq, time: event.time, role: '客服', text }] : []
      }
      // Tool, context, and lifecycle events stay in the canonical technical replay.
      return []
    }),
  }
}
