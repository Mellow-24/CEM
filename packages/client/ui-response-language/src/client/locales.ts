/** `responseLanguage` namespace dictionaries for the composer selector. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'option.auto': '自动',
  'trigger.aria': '回复语言：{name}',
  'trigger.title': '回复语言：{name}。固定选项不会因提问语言改变。',
  'trigger.fallback': '回复语言',
  'trigger.saving': '正在切换回复语言为 {name}',
  'error.select': '切换回复语言失败：{message}',
} satisfies Record<string, string>

/** The reply-language selector namespace key union. */
export type ResponseLanguageKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'option.auto': 'Auto',
  'trigger.aria': 'Response language: {name}',
  'trigger.title': 'Response language: {name}. A fixed choice does not change with the question language.',
  'trigger.fallback': 'Response language',
  'trigger.saving': 'Switching response language to {name}',
  'error.select': 'Could not switch response language: {message}',
} satisfies Record<ResponseLanguageKey, string>
