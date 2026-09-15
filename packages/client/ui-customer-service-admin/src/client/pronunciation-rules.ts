/** Language-aware speech normalization fixtures used by the operations workspace. */

/** Speech language selected before pronunciation normalization. */
export type SpeechLanguage = '澳門粵語' | '普通話' | '葡語' | '英語'

/** One operator-visible rule describing its production matching intent. */
export type PronunciationRule = {
  id: string
  name: string
  category: '地址' | '數字' | '機構' | '金額' | '日期'
  languages: readonly SpeechLanguage[]
  matchType: '正則模式' | '縮寫表'
  priority: number
  pattern: string
  output: string
  exampleInput: string
  exampleOutput: string
  source: string
}

/** One rule application reported by the text-only tryout. */
export type PronunciationMatch = { ruleId: string; name: string; count: number }

/** Display text plus the separate text that would be sent to synthesis. */
export type PronunciationPreview = {
  displayText: string
  spokenText: string
  matches: readonly PronunciationMatch[]
}

/** Address abbreviations transcribed from the supplied Macau reference workbook. */
export const ADDRESS_ALIASES = [
  ['R/C', '地下'], ['RC', '地下'], ['S/L', '閣樓'], ['SL', '閣樓'], ['S/LOJA', '閣樓'],
  ['C/V', '地庫'], ['CV', '地庫'], ['CAVE', '地庫'], ['S/C', '公眾電錶'], ['SC', '公眾電錶'],
  ['S.COMUNS', '公眾電錶'], ['S/N', '無門牌號碼'], ['SN', '無門牌號碼'], ['ML', '夾層'],
  ['DTO', '右'], ['ESQ', '左'], ['EV CHARGER', '電動車充電樁'], ['HUTCHISON', '電信錶'],
  ['SMARTONE', '數碼通電信錶'], ['CHINATELE', '中國電信電信錶'], ['GAS', '石油氣'],
] as const

/** Bank names and abbreviations transcribed from the supplied Macau reference workbook. */
export const BANK_ALIASES = [
  ['TFB', '大豐銀行', 'Tai Fung Bank'], ['BOC', '中國銀行', 'Bank of China'],
  ['LIB', '國際銀行', 'Luso International Bank'], ['BNU', '大西洋銀行', 'Banco Nacional Ultramarino'],
  ['WEN', '華僑銀行', 'OCBC WING HANG'], ['BCM', '商業銀行', 'Banco Commercial de Macau'],
  ['HKB', '匯豐銀行', 'Hongkong & Shanghai Bank'], ['BDA', '匯業銀行', 'Banco Delta Asia'],
  ['SHB', '工商銀行', 'Industrial and Commercial Bank of China Limited'],
  ['CGB', '廣發銀行', 'China GuangFa Bank'], ['CCB', '中國建設銀行', 'China Construction Bank'],
  ['WLB', '立橋銀行', 'Well Link Bank'],
] as const

/** Ordered rules shown by the operations workspace and applied by its text tryout. */
export const PRONUNCIATION_RULES = [
  {
    id: 'address-alias', name: '澳門地址縮寫展開', category: '地址', languages: ['澳門粵語', '普通話'],
    matchType: '縮寫表', priority: 10, pattern: 'R/C、S/L、C/V、DTO、ESQ……', output: '按地址語義展開',
    exampleInput: 'R/C+S/L', exampleOutput: '地下加閣樓', source: '參考表·Address info',
  },
  {
    id: 'address-building', name: '樓棟號連續數讀法', category: '數字', languages: ['澳門粵語', '普通話'],
    matchType: '正則模式', priority: 20, pattern: '([0-9]+)(棟|棟)', output: '數值讀法 + 棟',
    exampleInput: '123棟', exampleOutput: '一百二十三棟', source: '地址播報通用規則',
  },
  {
    id: 'address-floor-range', name: '樓層範圍與組合', category: '地址', languages: ['澳門粵語', '普通話'],
    matchType: '正則模式', priority: 5, pattern: 'R/C - 3、R/C+1+2', output: '地下至三樓、地下加一樓加二樓',
    exampleInput: 'R/C - 3', exampleOutput: '地下至三樓', source: '參考表·Address info 範例',
  },
  {
    id: 'bank-alias', name: '銀行縮寫按語言展開', category: '機構', languages: ['澳門粵語', '普通話', '葡語', '英語'],
    matchType: '縮寫表', priority: 40, pattern: 'BNU、BOC、CCB、WLB……', output: '選定語言的機構全稱',
    exampleInput: 'BNU', exampleOutput: '粵語：大西洋銀行；葡語：Banco Nacional Ultramarino', source: '參考表·Bank info',
  },
  {
    id: 'date', name: '月日日期讀法', category: '日期', languages: ['澳門粵語', '普通話'],
    matchType: '正則模式', priority: 50, pattern: '([0-9]{1,2})月([0-9]{1,2})日', output: '月份和日期轉換為中文數值',
    exampleInput: '12月18日', exampleOutput: '十二月十八日', source: '參考表·Bill payment info',
  },
  {
    id: 'currency', name: '澳門元金額讀法', category: '金額', languages: ['澳門粵語', '普通話'],
    matchType: '正則模式', priority: 60, pattern: '$([0-9]+(?:.[0-9]+)?)', output: '澳門元 + 數值讀法',
    exampleInput: '$50', exampleOutput: '澳門元五十', source: '參考表·Bill payment info',
  },
  {
    id: 'percentage', name: '百分比讀法', category: '數字', languages: ['澳門粵語', '普通話'],
    matchType: '正則模式', priority: 70, pattern: '([0-9]+(?:.[0-9]+)?)%', output: '百分之 + 數值讀法',
    exampleInput: '3.5%', exampleOutput: '百分之三點五', source: '參考表·Bill payment info',
  },
] as const satisfies readonly PronunciationRule[]

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const

function digitName(value: number): string {
  return DIGITS[value] ?? String(value)
}

/** Convert a bounded positive decimal to an unambiguous Chinese reading. */
function chineseNumber(value: string): string {
  const [integer = '', decimal] = value.split('.')
  const number = Number(integer)
  let result: string
  if (!Number.isSafeInteger(number) || number < 0 || number > 9999) {
    result = integer.split('').map(char => digitName(Number(char))).join('')
  } else if (number < 10) result = digitName(number)
  else {
    const places = [1000, 100, 10, 1] as const
    const units = ['千', '百', '十', ''] as const
    let pendingZero = false
    result = ''
    for (let index = 0; index < places.length; index += 1) {
      const place = places[index] ?? 1
      const digit = Math.floor(number / place) % 10
      if (digit === 0) { pendingZero = result !== ''; continue }
      if (pendingZero) result += '零'
      if (!(digit === 1 && place === 10 && result === '')) result += digitName(digit)
      result += units[index] ?? ''
      pendingZero = false
    }
  }
  return decimal === undefined ? result : `${result}點${decimal.split('').map(char => digitName(Number(char))).join('')}`
}

function replaceWithCount(text: string, pattern: RegExp, replacement: string | ((...args: string[]) => string)): [string, number] {
  let count = 0
  return [text.replace(pattern, (...args: string[]) => {
    count += 1
    return typeof replacement === 'string' ? replacement : replacement(...args)
  }), count]
}

function aliasPattern(alias: string): RegExp {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![A-Z])${escaped}(?![A-Z])`, 'giu')
}

/**
 * Apply enabled general rules to a synthesis-only copy of the answer.
 * @param text - Final answer text retained for the conversation display.
 * @param language - Language selected for synthesis.
 * @param enabledRuleIds - Draft rule ids enabled by the operator.
 * @returns Separate spoken text and an ordered rule-hit summary.
 */
export function applyPronunciationRules(
  text: string, language: SpeechLanguage, enabledRuleIds: ReadonlySet<string>,
): PronunciationPreview {
  let spokenText = text
  const matches: PronunciationMatch[] = []
  const apply = (rule: PronunciationRule, transform: (input: string) => [string, number]) => {
    if (!enabledRuleIds.has(rule.id) || !rule.languages.includes(language)) return
    const [next, count] = transform(spokenText)
    spokenText = next
    if (count > 0) matches.push({ ruleId: rule.id, name: rule.name, count })
  }
  const rules = [...PRONUNCIATION_RULES].sort((left, right) => left.priority - right.priority)
  for (const rule of rules) {
    if (rule.id === 'address-floor-range') {
      apply(rule, (input) => {
        const range = replaceWithCount(
          input, /R\/C\s*-\s*(\d+)/giu, (_match, floor) => `地下至${chineseNumber(floor)}樓`,
        )
        const combined = replaceWithCount(
          range[0], /R\/C((?:\s*\+\s*\d+)+)/giu,
          (_match, floors) => `地下${floors.split('+').slice(1)
            .map(value => `加${chineseNumber(value.trim())}樓`).join('')}`,
        )
        return [combined[0], range[1] + combined[1]]
      })
    } else if (rule.id === 'address-alias') {
      apply(rule, (input) => {
        let total = 0; let next = input
        for (const [alias, meaning] of ADDRESS_ALIASES) {
          const replaced = replaceWithCount(next, aliasPattern(alias), meaning)
          next = replaced[0]; total += replaced[1]
        }
        next = next.replace(/\s*\+\s*/gu, '加')
        return [next, total]
      })
    } else if (rule.id === 'address-building') {
      apply(rule, input => replaceWithCount(
        input, /(\d+)(?:棟|棟)/gu, (_match, number) => `${chineseNumber(number)}棟`,
      ))
    } else if (rule.id === 'bank-alias') {
      apply(rule, (input) => {
        let total = 0; let next = input
        for (const [alias, chinese, latin] of BANK_ALIASES) {
          const replacement = language === '葡語' || language === '英語' ? latin : chinese
          const replaced = replaceWithCount(next, aliasPattern(alias), replacement)
          next = replaced[0]; total += replaced[1]
        }
        return [next, total]
      })
    } else if (rule.id === 'date') {
      apply(rule, input => replaceWithCount(
        input, /(\d{1,2})月(\d{1,2})日/gu,
        (_match, month, day) => `${chineseNumber(month)}月${chineseNumber(day)}日`,
      ))
    } else if (rule.id === 'currency') {
      apply(rule, input => replaceWithCount(
        input, /\$(\d+(?:\.\d+)?)/gu, (_match, amount) => `澳門元${chineseNumber(amount)}`,
      ))
    } else {
      apply(rule, input => replaceWithCount(
        input, /(\d+(?:\.\d+)?)%/gu, (_match, amount) => `百分之${chineseNumber(amount)}`,
      ))
    }
  }
  return { displayText: text, spokenText, matches }
}
