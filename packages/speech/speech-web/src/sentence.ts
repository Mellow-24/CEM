/** Authorize an audible sentence against the exact logged assistant text prefix. */

import type {} from '@deepseek-ai/dsh-llm-retry'
import { createHash } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** Logged assistant block coordinates and a digest of the prefix ending at the requested sentence. */
export interface SpeechSentenceSelector {
  readonly turn: number
  readonly step: number
  readonly block: number
  readonly start: number
  readonly end: number
  readonly digest: string
}

/**
 * Recover a sentence from logged text deltas or a committed message; reasoning is never admitted.
 * @param agent - exact live authorized Agent.
 * @param selector - validated block coordinates and prefix digest.
 * @returns matching sentence, or undefined for stale/revised/unavailable text.
 */
export function loggedSentence(agent: Agent, selector: SpeechSentenceSelector): string | undefined {
  let blocks: ({ text: string; readable: boolean } | undefined)[] = []
  for (const event of agent.session.events) {
    if (event.type === 'assistant/chunk' && event.data.turn === selector.turn && event.data.step === selector.step) {
      const chunk = event.data.chunk
      if (chunk.type === 'block-start') blocks[chunk.index] = { text: '', readable: chunk.blockType === 'text' }
      else if (chunk.type === 'text-delta') {
        const block = blocks[chunk.index]
        if (block?.readable) block.text += chunk.text
      } else if (chunk.type === 'block-end') {
        blocks[chunk.index] = { readable: chunk.block.type === 'text', text: chunk.block.type === 'text' ? chunk.block.text : '' }
      }
    } else if (event.type === 'assistant/message' && event.surfaceOp === 'append'
      && event.data.turn === selector.turn && event.data.step === selector.step) {
      blocks = event.data.message.content.map(block => ({ readable: block.type === 'text', text: block.type === 'text' ? block.text : '' }))
    } else if (event.type === 'llm/retry' && event.data.turn === selector.turn && event.data.step === selector.step) {
      blocks = []
    }
  }
  const block = blocks.filter(value => value !== undefined)[selector.block]
  if (!block?.readable || selector.end > block.text.length) return undefined
  const prefix = block.text.slice(0, selector.end)
  if (createHash('sha256').update(prefix).digest('hex') !== selector.digest) return undefined
  const sentence = block.text.slice(selector.start, selector.end)
  return sentence.trim() === '' ? undefined : sentence
}
