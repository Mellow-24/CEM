/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Traditional Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '設定',
  'title': '設定',
  'management.trigger': '營運管理',
  'management.title': '澳門電力智能客服營運管理台',
  'management.maintenance': '開發維護',
  'close': '關閉',
  'openDocument': '打開配置文件',
  'openDocument.error': '無法打開配置文件',
  'general.nav': '通用設定',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'management.trigger': 'Operations',
  'management.title': 'Macau Power Intelligent Customer Service Operations Console',
  'management.maintenance': 'Developer maintenance',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
} satisfies Record<SettingsKey, string>

/** Portuguese dictionary, checked complete against the Chinese key set. */
export const pt = {
  'trigger': 'Definições',
  'title': 'Definições',
  'management.trigger': 'Operações',
  'management.title': 'Consola de Operações do Atendimento Inteligente da CEM',
  'management.maintenance': 'Manutenção técnica',
  'close': 'Fechar',
  'openDocument': 'Abrir ficheiro de configuração',
  'openDocument.error': 'Não foi possível abrir o ficheiro de configuração',
  'general.nav': 'Geral',
} satisfies Record<SettingsKey, string>
