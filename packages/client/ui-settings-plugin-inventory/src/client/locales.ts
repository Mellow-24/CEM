/** Copy dictionaries for the plugin inventory Settings section. */

/** Traditional Chinese dictionary and key source of truth. */
export const zh = {
  tab: '插件列表',
  loading: '正在讀取插件…',
  error: '暫時無法讀取插件。',
  retry: '重試',
  search: '搜索插件',
  catalog: '插件列表',
  empty: '暫無插件。',
  emptySearch: '沒有匹配的插件。',
  enabledTag: '已啟用',
  disabledTag: '已停用',
  configuration: '配置狀態',
  cordis: 'Cordis 狀態',
  unobserved: '未掛載',
  pending: '等待依賴',
  loadingPhase: '載入中',
  active: '已掛載',
  failed: '掛載失敗',
  unloading: '卸載中',
} satisfies Record<string, string>

/** Plugin inventory locale key union. */
export type PluginInventoryLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin list',
  loading: 'Reading plugins…',
  error: 'Plugins are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search plugins',
  catalog: 'Plugin list',
  empty: 'No plugins are available.',
  emptySearch: 'No matching plugins.',
  enabledTag: 'Enabled',
  disabledTag: 'Disabled',
  configuration: 'Configuration',
  cordis: 'Cordis status',
  unobserved: 'Not mounted',
  pending: 'Waiting for dependencies',
  loadingPhase: 'Loading',
  active: 'Mounted',
  failed: 'Mount failed',
  unloading: 'Unloading',
} satisfies Record<PluginInventoryLocaleKey, string>
