/** Lightweight detection for the response languages supported by this package. */

import type { FixedResponseLanguage } from './types.ts'

/** A decisive local-language detection. Ambiguous input returns no value. */
export interface ResponseLanguageDetection {
  /** Detected language. */
  language: FixedResponseLanguage
  /** Normalized confidence in the decisive features, from zero through one. */
  confidence: number
}

const SIMPLIFIED_ONLY = new Set(Array.from(
  '这来为电个们么户发后里吗时会与办开关应实过还进总现长见让从对无将种张东风云网费证账转处报销钟钱银请释',
))
const TRADITIONAL_ONLY = new Set(Array.from(
  '這來為電個們麼戶發後裡嗎時會與辦開關應實過還進總現長見讓從對無將種張東風雲網費證賬轉處報銷鐘錢銀請釋',
))

const CANTONESE_MARKERS = /(?:點樣|點解|可唔可以|使唔使|有冇|係咪|邊度|幾時|而家|唔該|唔|冇|嘅|咗|喺|咩|哋|畀|嚟|攞|啱|呀)/gu
const HAN = /\p{Script=Han}/gu
const LATIN = /\p{Script=Latin}/gu
const LATIN_WORD = /\p{Script=Latin}+/gu
const PORTUGUESE_DIACRITIC = /[áàâãçéêíóôõú]/iu

const PORTUGUESE_WORDS = new Set([
  'agora', 'ajuda', 'cancelar', 'cartão', 'como', 'conta', 'direto', 'eletricidade',
  'fatura', 'obrigado', 'obrigada', 'onde', 'pagamento', 'pode', 'porque',
  'quando', 'quero', 'qual', 'serviço', 'sim', 'transferência', 'você', 'voce',
])
const ENGLISH_WORDS = new Set([
  'account', 'address', 'application', 'apply', 'automatic', 'bill', 'cancel', 'card',
  'charge', 'contract', 'download', 'due', 'electricity', 'find', 'form', 'hello', 'help',
  'how', 'installation', 'meter', 'move', 'moving', 'number', 'outage', 'pay', 'payment',
  'please', 'power', 'price', 'reading', 'reply', 'service', 'solar', 'status', 'supply',
  'sure', 'thanks', 'transfer', 'usage', 'what', 'when', 'where', 'why', 'would', 'yes',
  'you', 'your',
])

/**
 * Remove material that commonly names another language without expressing the request language.
 * @param input - Direct user-authored text before detection cleanup.
 * @returns Text whose remaining characters may vote in language detection.
 */
export function languageBearingText(input: string): string {
  return input
    .replace(/```[\s\S]*?(?:```|$)/gu, ' ')
    .replace(/`[^`\n]*`/gu, ' ')
    .replace(/^[\t ]*>.*$/gmu, ' ')
    .replace(/(?:https?:\/\/|www\.)\S+/giu, ' ')
    .replace(/"[^"\n]*"/gu, ' ')
    .replace(/“[^”\n]*”/gu, ' ')
    .replace(/「[^」\n]*」/gu, ' ')
    .replace(/『[^』\n]*』/gu, ' ')
    .replace(/(^|[\s([{])'[^'\n]*'(?=$|[\s.,!?;:)\]}])/gmu, '$1 ')
    .replace(/‘[^’\n]*’/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/** Count characters from one precompiled global expression without retaining regexp state. */
function count(input: string, pattern: RegExp): number {
  return input.match(pattern)?.length ?? 0
}

/** Count occurrences of characters unique to one Chinese writing system. */
function scriptScore(input: string, characters: ReadonlySet<string>): number {
  let score = 0
  for (const character of input) if (characters.has(character)) score += 1
  return score
}

/** Detect Cantonese or a Simplified/Traditional Chinese writing system. */
function detectChinese(input: string): ResponseLanguageDetection | undefined {
  const cantonese = count(input, CANTONESE_MARKERS)
  if (cantonese > 0) {
    return { language: 'yue-Hant-MO', confidence: Math.min(0.99, 0.9 + cantonese * 0.03) }
  }
  const simplified = scriptScore(input, SIMPLIFIED_ONLY)
  const traditional = scriptScore(input, TRADITIONAL_ONLY)
  if (simplified > traditional) {
    return { language: 'zh-Hans', confidence: Math.min(0.98, 0.78 + simplified * 0.04) }
  }
  if (traditional > simplified) {
    return { language: 'zh-Hant', confidence: Math.min(0.98, 0.78 + traditional * 0.04) }
  }
  return undefined
}

/** Score a Latin-language lexicon over normalized words. */
function lexiconScore(words: readonly string[], lexicon: ReadonlySet<string>): number {
  let score = 0
  for (const word of words) if (lexicon.has(word)) score += 1
  return score
}

/** Detect English or Portuguese from decisive orthographic and lexical features. */
function detectLatin(input: string): ResponseLanguageDetection | undefined {
  const normalized = input.toLocaleLowerCase('und')
  if (PORTUGUESE_DIACRITIC.test(normalized)) {
    return { language: 'pt', confidence: 0.98 }
  }
  // detectLatin is reached only after the caller counted Latin characters.
  const words = normalized.match(LATIN_WORD) as string[]
  const portuguese = lexiconScore(words, PORTUGUESE_WORDS)
  const english = lexiconScore(words, ENGLISH_WORDS)
  if (portuguese > english && portuguese > 0) {
    return { language: 'pt', confidence: Math.min(0.96, 0.72 + portuguese * 0.08) }
  }
  if (english > portuguese && english > 0) {
    return { language: 'en', confidence: Math.min(0.96, 0.72 + english * 0.08) }
  }
  return undefined
}

/**
 * Detect one supported response language without a model call. URLs, quoted
 * lines, and code do not vote. Short or mixed text with no decisive feature is
 * ambiguous and returns `undefined`, allowing the caller to carry prior state.
 * @param input - Direct user-authored text.
 * @returns A decisive language and confidence, or `undefined`.
 */
export function detectResponseLanguage(input: string): ResponseLanguageDetection | undefined {
  const text = languageBearingText(input)
  if (text === '') return undefined
  const han = count(text, HAN)
  const latin = count(text, LATIN)
  if (han >= 2) {
    const chinese = detectChinese(text)
    if (chinese?.language === 'yue-Hant-MO' || han * 2 >= latin) return chinese
  }
  if (latin >= 2) return detectLatin(text)
  return undefined
}
