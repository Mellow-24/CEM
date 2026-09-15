/** Keyless customer-service adapter that exercises the shipped retrieval paths in model order. */

import type { Context } from '@deepseek-ai/cordis'
import {
  CallId,
  LlmAdapter,
  ReasoningEffortId,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

/** Return every durable tool-result text currently projected into the request. */
function toolResults(options: GenerateOptions): string[] {
  return options.messages.flatMap(message => message.content)
    .filter(block => block.type === 'tool-result')
    .map(block => block.content.filter(item => item.type === 'text').map(item => item.text).join(''))
}

/** Return automatic RAG evidence injected for the current direct customer message. */
function automaticKnowledge(options: GenerateOptions): string[] {
  return options.messages
    .filter(message => message.source.kind === 'plugin'
      && message.source.plugin === 'customer-service-knowledge')
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => block.text)
}

/** Emit one complete tool call using the native streaming vocabulary. */
function * callTool(id: string, name: string, args: Record<string, string>): Generator<StreamChunk> {
  const argumentsJson = JSON.stringify(args)
  const callId = CallId(id)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: argumentsJson }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: argumentsJson } }
  yield { type: 'usage', usage: { inputTokens: 8, outputTokens: 3 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** Emit one complete customer-facing answer. */
function * answer(text: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'usage', usage: { inputTokens: 7, outputTokens: 5 } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/** Read the immutable Wiki release selected by the map tool. */
function wikiRelease(results: readonly string[]): string {
  const release = /Published company Wiki release: ([a-f0-9]{64})/u.exec(results[0] ?? '')?.[1]
  if (release === undefined) throw new Error('customer-service mock: Wiki map did not return a release id')
  return release
}

/** Deterministic adapter for the RAG and LLM Wiki snapshot compositions. */
class CustomerServiceMockAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider,
      id: model,
      name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const mode = process.env.DSH_CUSTOMER_SERVICE_FIXTURE
    const results = toolResults(options)
    if (mode === 'rag') {
      const evidence = automaticKnowledge(options)
      if (evidence.length !== 1 || !evidence[0]?.includes('自動轉賬')) {
        throw new Error('customer-service mock: automatic company knowledge is missing')
      }
      if (options.system?.includes('Reply in English.')) {
        yield * answer('Customers can cancel automatic transfer through a designated bank\'s mobile app, or by bringing the electricity bill, identity document, and bank passbook.')
      } else {
        yield * answer('可以透過指定銀行手機應用程式，或攜帶電費單、身份證明文件及銀行存摺辦理取消自動轉賬。')
      }
      return
    }
    if (mode !== 'wiki') throw new Error(`customer-service mock: unsupported fixture mode ${JSON.stringify(mode)}`)
    if (results.length === 0) {
      yield * callTool('customer-wiki-map', 'read_company_wiki_map', {})
      return
    }
    if (results.length === 1) {
      yield * callTool('customer-wiki-page', 'read_company_wiki', {
        release_id: wikiRelease(results),
        page_id: 'autopay',
      })
      return
    }
    if (results.length === 2) {
      yield * callTool('customer-wiki-evidence', 'open_company_wiki_evidence', {
        release_id: wikiRelease(results),
        page_id: 'autopay',
        query: '點樣取消自動轉賬？',
      })
      return
    }
    const citation = /\[[^\]\n]+\]/u.exec(results.at(-1) ?? '')?.[0] ?? '[missing-evidence-id]'
    yield * answer(`可以透過指定銀行手機應用程式，或攜帶電費單、身份證明文件及銀行存摺辦理取消自動轉賬 ${citation}。`)
  }
}

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'customer-service-mock-llm'

/** LLM registry required by this fixture adapter. */
export const inject = ['llm']

/** Register the keyless customer-service adapter. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['customer-service-mock'], new CustomerServiceMockAdapter())
}
