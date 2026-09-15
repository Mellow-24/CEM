/** `settings.locale` namespace dictionaries (the Language row's copy). */

/** Traditional Chinese dictionary (the key-set source of truth). */
export const zh = {
  'language.title': '語言',
} satisfies Record<string, string>

/** The settings.locale namespace key union. */
export type SettingsLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'language.title': 'Language',
} satisfies Record<SettingsLocaleKey, string>

/** Portuguese dictionary, checked complete against the Chinese key set. */
export const pt = {
  'language.title': 'Idioma',
} satisfies Record<SettingsLocaleKey, string>
