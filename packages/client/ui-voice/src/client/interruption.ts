/** Transcript- and context-based intent screening for automatic call interruption. */

import type { SpeechCallOptions } from './contract.ts'

/** Result for the latest ASR hypothesis while an assistant answer is active. */
export type InterruptionDecision = 'wait' | 'interrupt' | 'ignore' | 'classify'

const BACKCHANNEL = new RegExp(`^(?:${[
  '[嗯唔哦噢喔啊呀诶欸]', '嗯嗯', '唔唔', '哦哦', '好(?:的|呀|啊)?', '係', '系', '是(?:的)?', '對', '对',
  '明白', '知道(?:了|啦)?', '收到', '可以', '行', 'ok(?:ay)?', 'yes', 'yeah', 'right', 'sim', 'certo', 'entendi',
].join('|')})[.!?。！？~～]*$`, 'iu')
const ACKNOWLEDGEMENT = new RegExp(`^(?:${[
  /(?:嗯|唔|哦|好(?:的|啦|呀|啊)?|係呀|系呀|明白(?:了|啦)?|知道(?:了|啦)?|收到|多謝|唔該|謝謝|谢谢|我知道|我明白)[\s，,。.!！?？]*/u.source,
  /(?:ok(?:ay)?|yes|yeah|right|thanks|thank (?:you|u)(?: very much)?|bye(?: bye)?)[\s,.;!?]*/u.source,
].join('|')})+$`, 'iu')
const POLITE_PREFIX = new RegExp(`^(?:${[
  /(?:嗯|哦|好(?:的|啦)?|唔該|唔该|麻煩你?|麻烦你?|請你?|请你?|客服|澳電客服|澳电客服)[\s，,。.!！]*/u.source,
  /(?:你)?(?:可唔可以|可不可以|能不能)[\s，,]*/u.source,
  /(?:okay|ok|sorry|excuse me|please|(?:can|could|would) you)[\s,.:!]*/u.source,
].join('|')})+`, 'iu')
const STOP_REQUESTS = [
  /^(?:停(?:一下|一陣|一阵|低|吓)?|暫停(?:一下)?|暂停(?:一下)?|等(?:一下|一陣|一阵|等)|先停(?:一下)?|先等(?:一下|一陣|一阵))[呀啊啦喇吓]?$/u,
  /^(?:停一停|等陣|等阵|等等|停一陣|停一阵)(?:先|吖|啊)?$/u,
  /^(?:唔好|不要|別|别)(?:再|繼續|继续)?(?:講|讲|說|说|播|讀|读)(?:落去|下去|住|了|啦)?[呀啊啦喇吓]?$/u,
  /^(?:stop(?:\s+(?:speaking|talking|reading))?|pause|hold on|wait(?:\s+(?:a moment|a second))?)(?:\s+now)?(?:\s+please)?$/iu,
]
const DIRECTED_REQUESTS = [
  /^(?:唔係|唔系|不是|不對|不对)[，,\s]*(?:呢個意思|这个意思|這個意思|呢個問題|這個問題|这个问题|我(?:係|系|是)?(?:想|要|問|问|講|讲|說|说))/u,
  /^你(?:理解錯|理解错|聽錯|听错|答錯|答错|搞錯|搞错)/u,
  /^我(?:講|讲|說|说|問|问)(?:嘅|的|既|緊|紧)?(?:係|系|是)/u,
  /^(?:你)?(?:可唔可以|可不可以|能不能|可以幫我|可以帮我|幫我|帮我)(?:再|重新)?(?:講|讲|說|说|解釋|解释|重複|重复)/u,
  /^(?:講|讲|說|说)(?:慢啲|慢點|慢点|多次|多一次|清楚啲)(?:呀|啊|啦)?$/u,
  /^(?:客服|澳電客服|澳电客服)[，,\s]*(?:我|請|请|幫|帮|可)/u,
  /^(?:no[,\s]+)?(?:that(?:'s| is) not (?:what i (?:asked|meant)|my question)|i (?:meant|asked (?:about|for)))\b/iu,
  /^(?:(?:can|could|would) you|please)\s+(?:repeat|explain|clarify|speak (?:more slowly|slower)|slow down|stop|pause)\b/iu,
]

/**
 * Identify a standalone stop command that cancels playback without asking another question.
 * @param text - Recognized caller text, including optional polite prefixes.
 * @returns Whether the complete utterance contains only a stop request.
 */
export function isStandaloneStopRequest(text: string): boolean {
  if (isSingleCharacterUtterance(text)) return false
  const clean = text.trim().replace(POLITE_PREFIX, '').replace(/[.!?。！？~～]+$/u, '').trim()
  return STOP_REQUESTS.some(pattern => pattern.test(clean))
}

function stopRequest(text: string, final: boolean): boolean {
  const clean = text.replace(/[.!?。！？~～]+$/u, '').trim()
  if (STOP_REQUESTS.some(pattern => pattern.test(clean))) return true
  // A completed stop command may introduce a correction in the same ASR segment.
  if (!final) return false
  const firstClause = clean.split(/[，,。.!！:：]/u)[0]?.trim() ?? ''
  const beforeQuestion = firstClause.split(/(?=我(?:想|要|係想|系想|是想))/u)[0]?.trim() ?? ''
  return STOP_REQUESTS.some(pattern => pattern.test(beforeQuestion))
}

function normalized(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/**
 * Detect one spoken character after optional polite prefixes; English words retain their letters.
 * @param text - Recognized caller text.
 * @returns Whether exactly one Unicode letter or number remains after removing optional prefixes and punctuation.
 */
export function isSingleCharacterUtterance(text: string): boolean {
  const request = text.trim().replace(POLITE_PREFIX, '')
  return Array.from(normalized(request || text)).length === 1
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
  if (spoken.length === 0) return false
  if (heard.length >= options.minimumMeaningfulCharacters && spoken.includes(heard)) return true
  if (heard.length < options.echoMinimumCharacters) return false
  return diceSimilarity(heard, spoken) >= options.echoSimilarityThreshold
}

/**
 * Classify whether recognized speech claims the conversational turn.
 * Stop commands use a local fast path. With semantic classification enabled, other
 * completed substantive speech requires the Host verdict regardless of minimumMeaningfulCharacters;
 * otherwise directed rules apply.
 * Isolated characters and passive acknowledgements never claim a turn. Playback-like speech
 * requires a semantic verdict when configured and is otherwise ignored.
 * @param input - Latest cumulative recognizer hypothesis and active answer context.
 * @param options - Host-selected timing and language-independent thresholds.
 * @returns Whether to keep listening, interrupt, request semantic classification, or discard the utterance.
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
  if (isSingleCharacterUtterance(text)) return input.final ? 'ignore' : 'wait'
  if (ACKNOWLEDGEMENT.test(text)) return input.final ? 'ignore' : 'wait'

  if (resemblesPlayback(text, input.answer, options)) {
    return input.final ? options.semantic === undefined ? 'ignore' : 'classify' : 'wait'
  }
  if (semantic.length <= options.backchannelMaximumCharacters && BACKCHANNEL.test(text)) {
    return input.final ? 'ignore' : 'wait'
  }

  const request = text.replace(POLITE_PREFIX, '')
  const stop = stopRequest(request, input.final)
  if (input.final) {
    if (stop) return 'interrupt'
    if (options.semantic !== undefined) return 'classify'
    const directed = semantic.length >= options.minimumMeaningfulCharacters
      && DIRECTED_REQUESTS.some(pattern => pattern.test(text) || pattern.test(request))
    return directed ? 'interrupt' : 'ignore'
  }
  return stop && input.elapsedMs >= options.confirmationMs ? 'interrupt' : 'wait'
}
