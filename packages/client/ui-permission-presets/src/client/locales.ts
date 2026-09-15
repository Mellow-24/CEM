/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Traditional Chinese dictionary (the key-set source of truth). */
export const zh = {
  'title': '權限',
  'description': '選擇新會話的預設權限模式',
  'loading': '載入中',
  'unavailable': '不可用',
  'confirm.title': '確認啟用 Full access？',
  'confirm.description': '啟用 Full access 後，新會話將減少確認步驟，並且可以直接執行更多操作，包括敏感操作、文件修改或外部命令。僅建議在你信任後續任務時使用。',
  'confirm.acknowledge': '我已了解風險，並願意繼續',
  'confirm.cancel': '取消',
  'confirm.enable': '啟用 Full access',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Traditional Chinese dictionary for the current-session popup gate. */
export const accessZh = {
  'confirm.title': '確認啟用 Full access？',
  'confirm.description': '啟用 Full access 後，agent 將減少確認步驟，並且可以直接執行更多操作，包括敏感操作、文件修改或外部命令。僅建議在你信任當前任務時使用。',
  'confirm.acknowledge': '我已了解風險，並願意繼續',
  'confirm.cancel': '取消',
  'confirm.enable': '啟用 Full access',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessZh

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>
