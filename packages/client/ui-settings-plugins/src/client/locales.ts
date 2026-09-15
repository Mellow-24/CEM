/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The DeepSeek search provider.',
  webSearchApiKey: 'API key',
  webSearchApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  webSearchApiKeySet: 'A key is configured.',
  webSearchApiKeyUnset: 'No key is configured; search is unavailable until one is.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'Leave blank to use the provider default.',
  webSearchMaxUses: 'Max searches per request',
  webSearchMaxUsesHint: 'How many times one request may search before it must answer.',
}

/** Traditional Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '插件',
  title: '插件',
  intro: '配置和查看本部署已安裝的插件。',
  tabs: '插件視圖',
  configurableTab: '插件配置',
  empty: '本部署沒有開放任何插件設定。',
  overridden: '已覆蓋',
  reset: '恢復預設',
  readOnly: '本部署的設定為只讀。',
  expand: '展開設定',
  collapse: '收起設定',
  save: '保存',
  saving: '保存中…',
  discard: '放棄修改',
  unsaved: '未保存',
  saveFailed: '本部署沒有接受這些值，已保留供你修改。',
  invalidNumber: '請填數字；留空表示使用預設值。',
  bashTitle: '終端',
  bashDescription: '限制 agent 運行的每一條命令。',
  bashTimeoutMs: '命令超時（毫秒）',
  bashTimeoutMsHint: '單條命令允許運行多久，超時即終止。',
  bashMaxOutputBytes: '單流輸出上限（字節）',
  bashMaxOutputBytesHint: '超出部分會轉存到臨時文件，而不是被丟棄。',
  agentLoopTitle: 'Agent 循環',
  agentLoopDescription: 'Agent 如何派發工具調用。',
  agentLoopMaxParallel: '並行工具調用數',
  agentLoopMaxParallelHint: '同一步內最多同時運行多少個可並行的調用。',
  webSearchTitle: '網頁搜索',
  webSearchDescription: 'DeepSeek 搜索提供方。',
  webSearchApiKey: 'API Key',
  webSearchApiKeyHint: '不寫入設定文件。留空表示保持當前密鑰。',
  webSearchApiKeySet: '已配置密鑰。',
  webSearchApiKeyUnset: '未配置密鑰；配置之前搜索不可用。',
  webSearchBaseUrl: '接口地址',
  webSearchBaseUrlHint: '留空則使用提供方預設地址。',
  webSearchMaxUses: '單次請求最多搜索次數',
  webSearchMaxUsesHint: '一次請求在必須作答前最多可以搜索多少次。',
}
