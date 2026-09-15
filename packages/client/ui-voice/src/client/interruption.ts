/** Transcript- and context-based intent screening for automatic call interruption. */

import type { SpeechCallOptions } from './contract.ts'

/** Result for the latest ASR hypothesis while an assistant answer is active. */
export type InterruptionDecision = 'wait' | 'interrupt' | 'ignore'

const BACKCHANNEL = new RegExp(`^(?:${[
  '[嗯唔哦噢喔啊呀诶欸]', '嗯嗯', '唔唔', '哦哦', '好(?:的|呀|啊)?', '係', '系', '是(?:的)?', '對', '对',
  '明白', '知道(?:了|啦)?', '收到', '可以', '行', 'ok(?:ay)?', 'yes', 'yeah', 'right', 'sim', 'certo', 'entendi',
].join('|')})[.!?。！？~～]*$`, 'iu')
const TURN_CLAIM = new RegExp([
  '[?？]', '嗎', '吗', '呢', '乜', '咩', '點解', '点解', '點樣', '点样', '怎麼', '怎么', '如何', '邊度', '边度',
  '哪裡', '哪里', '幾時', '几时', '何時', '何时', '誰', '谁', '不是', '唔係', '不對', '不对', '等等', '等一下',
  '先停', '停一下', '不要', '唔好', '其實', '其实', '我想', '我要', '我係想', '我系想', '改為', '改为', '換',
  '换', '另外', '還有', '还有', '\\b(?:what|where|how|why|but|wait|stop|hold on|actually|instead)\\b',
  '\\b(?:onde|como|quando|mas|espere|pare)\\b',
].join('|'), 'iu')

function normalized(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function bigrams(text: string): Set<string> {
  const result = new Set<string>()
  for (let index = 0; index + 1 < text.length; index++) result.add(text.slice(index, index + 2))
  return result
}

function diceSimilarity(left: string, right: string): number {
  if (left === right) return 1
  if (left.length < 2 || right.length < 2) return 0
  const a = bigrams(left)
  const b = bigrams(right)
  let overlap = 0
  for (const gram of a) if (b.has(gram)) overlap++
  return 2 * overlap / (a.size + b.size)
}

function resemblesPlayback(text: string, answer: string, options: SpeechCallOptions['interruption']): boolean {
  const heard = normalized(text)
  const spoken = normalized(answer)
  if (heard.length < options.echoMinimumCharacters || spoken.length === 0) return false
  if (spoken.includes(heard)) return true
  return diceSimilarity(heard, spoken) >= options.echoSimilarityThreshold
}

/**
 * Classify whether recognized speech claims the conversational turn.
 * The decision combines ASR finality, sustained speech, lexical diversity, sentence form,
 * short backchannel structure, and similarity to the answer being played.
 * @param input - Latest cumulative recognizer hypothesis and active answer context.
 * @param options - Host-selected timing and language-independent thresholds.
 * @returns Whether to keep listening, interrupt the answer, or discard a non-turn utterance.
 */
export function classifyInterruption(input: {
  readonly text: string
  readonly answer: string
  readonly final: boolean
  readonly elapsedMs: number
}, options: SpeechCallOptions['interruption']): InterruptionDecision {
  const text = input.text.trim()
  const semantic = normalized(text)
  if (semantic === '') return input.final ? 'ignore' : 'wait'

  const claimsTurn = TURN_CLAIM.test(text)
  if (!claimsTurn && resemblesPlayback(text, input.answer, options)) return input.final ? 'ignore' : 'wait'
  if (semantic.length <= options.backchannelMaximumCharacters && BACKCHANNEL.test(text)) {
    return input.final ? 'ignore' : 'wait'
  }

  const distinct = new Set(semantic).size
  const meaningful = semantic.length >= options.minimumMeaningfulCharacters && distinct >= 2
  if (input.final) return claimsTurn || meaningful ? 'interrupt' : 'ignore'
  if (input.elapsedMs < options.confirmationMs) return 'wait'
  return claimsTurn || meaningful ? 'interrupt' : 'wait'
}
