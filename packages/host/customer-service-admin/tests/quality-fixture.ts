/** Keyless external-model double and real session events for quality workflow tests. */
import { LlmAdapter, CallId, ReasoningEffortId, createMessage, createToolResultMessage,
  createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { QualityTurnResult } from '../src/quality-types.ts'
import { qualityDimensions } from '../src/quality-schema.ts'

export function seedQualityConversation(session: Session) {
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('user/message', createUserMessage({ source: { kind: 'user' },
    content: [{ type: 'text', text: '如何繳費？' }] }), { surfaceOp: 'append' })
  session.append('tool/call', { turn: 1, step: 1, callId: CallId('quality-search'), name: 'search_company_knowledge', arguments: '{"query":"繳費方式"}' })
  session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: CallId('quality-search'),
    content: [{ type: 'text', text: '{"sources":[{"title":"繳費方式","excerpt":"可通過澳電 App 繳費。","score":0.8}]}' }], isError: false }) },
  { surfaceOp: 'append' })
  session.append('assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '可以' } })
  session.append('assistant/message', { turn: 1, step: 1, message: createMessage({ role: 'assistant',
    source: { kind: 'model', provider: 'test', model: 'test' }, content: [{ type: 'reasoning', text: 'PRIVATE_REASONING' },
      { type: 'text', text: '您可以使用澳電 App 繳費。' }] }), usage: { inputTokens: 50, outputTokens: 20 } }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
}

export function qualityAnswer(): { turns: QualityTurnResult[] } {
  return { turns: [{ turn: 1, intent: '繳費方式查詢', scores: qualityDimensions.map(dimension => ({ dimension,
    status: 'scored', score: dimension === 'retrieval' ? 75 : 90,
    reason: dimension === 'retrieval' ? '回答提到可透過澳電應用程式繳費，但涵蓋的方式有限。' : '回答與客戶問題及已記錄證據一致。',
    evidenceSeqs: [dimension === 'intent' ? 2 : dimension === 'retrieval' ? 3 : 6],
    severity: dimension === 'retrieval' ? 'minor' : 'none', suggestion: dimension === 'retrieval' ? '檢查知識庫對各種繳費方式的涵蓋情況。' : '',
  })) }] }
}

export class QualityAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  answer = JSON.stringify(qualityAnswer())
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model,
      reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }] } }
  }
  override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.answer }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}
