/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'presetMacauCustomerServiceName' | 'presetMacauCustomerServiceDescription'
  | 'presetMacauCustomerServiceWikiName' | 'presetMacauCustomerServiceWikiDescription'
  | 'presetHongKongFengShuiName' | 'presetHongKongFengShuiDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Duplicate an existing one and make it yours, or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetCodeName: 'Code mode',
  presetCodeDescription:
    'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  presetMacauCustomerServiceName: 'Macau customer service',
  presetMacauCustomerServiceDescription:
    'Multilingual customer-service agent with Auto or fixed reply language, grounded in a local vector knowledge base and citeable company sources.',
  presetMacauCustomerServiceWikiName: 'Macau customer service · LLM Wiki',
  presetMacauCustomerServiceWikiDescription:
    'Multilingual customer-service agent with Auto or fixed reply language that navigates reviewed linked Wiki pages and raw evidence over multiple steps.',
  presetHongKongFengShuiName: 'Hong Kong feng shui adviser',
  presetHongKongFengShuiDescription:
    'Virtual Hong Kong Cantonese feng shui culture adviser for entertainment and general lifestyle guidance; never impersonates a real person or substitutes for professional advice.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  copyOf: 'Copied from',
  composition: 'Composition (agent.cordis.yml)',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset with Creator mode',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Traditional Chinese copy. */
export const zh: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent 預設',
  description: '對此後新建的會話生效。運行中的會話保持它開始時的預設。',
  loading: '正在加載預設…',
  error: '無法加載 Agent 預設。',
  userTrust: '自定義',
  seatHint: '即將開始的這個會話所用的 Agent 預設',
  headerHint: '本會話運行的 Agent 預設，開始時即固定',
  nav: 'Agent 預設',
  sectionIntro: '預設即一個會話的 Agent 所運行的插件組裝 —— 它的工具、提示詞與能力。複製一份既有預設改成自己的，或用「創造模式」讓 Agent 幫你創建。',
  builtIn: '內置',
  setDefault: '設為預設',
  view: '查看',
  presetStandardName: '標準模式',
  presetStandardDescription: '功能完整的編碼 Agent，支持文件編輯、Shell、文件與網頁檢索、Skills、計劃、目標、子代理和工作流。',
  presetCodeName: 'PTC 模式',
  presetCodeDescription: '具備標準模式的全部能力，並通過 Code Mode SDK 呈現工具，讓模型用一個 TypeScript 程序組合多步操作。',
  presetMinimalName: '極簡模式',
  presetMinimalDescription: '僅提供持久 bash 與 str_replace_editor 的雙工具編碼 Agent。',
  presetCordisName: '創造模式',
  presetCordisDescription: '用於創建自定義 Agent preset：具備標準模式的全部能力，並提供運行時檢查、插件實驗和 preset 創作指導。',
  presetMacauCustomerServiceName: '澳門智能客服',
  presetMacauCustomerServiceDescription: '基於本機向量知識庫的多語言客服 Agent；支持 Auto 或固定回覆語言，僅依據可引述的公司資料回答。',
  presetMacauCustomerServiceWikiName: '澳門智能客服 · LLM Wiki',
  presetMacauCustomerServiceWikiDescription: '通過已審核的互聯 Wiki 頁面與原始證據進行多步導航，並支持 Auto 或固定回覆語言的多語言客服 Agent。',
  presetHongKongFengShuiName: '香港風水顧問',
  presetHongKongFengShuiDescription: '以香港粵語提供風水文化娛樂與一般生活建議的虛擬 AI；不冒充真人，不替代專業意見。',
  duplicate: '複製',
  duplicateUnavailable: '此部署未配置可寫的預設目錄',
  delete: '刪除',
  presetId: '標識符',
  presetIdPlaceholder: 'my-agent',
  displayName: '名稱',
  displayNamePlaceholder: '選擇器中顯示的名字，缺省用標識符',
  inUse: '當前使用',
  builtInGroup: '內置',
  customGroup: '自定義',
  noDescription: '暫無描述。',
  brokenBadge: '加載失敗',
  brokenNoCopy: '預設加載失敗，不能複製',
  copyOf: '複製自',
  composition: '組裝（agent.cordis.yml）',
  cancel: '取消',
  close: '關閉',
  retry: '重試',
  copyTitle: '複製預設',
  copyIntro: '整個預設會在本機複製一份。標識符將成為目錄名，事後無法更改；其餘內容之後直接在預設自己的文件裏編輯。',
  create: '創建',
  creating: '正在創建…',
  creatorDraft: '用「創造模式」創作自定義預設',
  openLocation: '打開目錄',
  showLocation: '查看路徑',
  revealedPathLabel: '預設文件：',
  idRequired: '請填寫標識符。',
  idInvalid: '只能使用小寫字母、數字與連字符，且以字母或數字開頭。',
  idTaken: '該標識符已被佔用。',
  deleteTitle: '刪除該預設？',
  deleteDescription: '預設目錄將被刪除。已在其上運行的會話不受影響；新會話將無法再選擇它。',
  deleteConfirm: '刪除',
  deleting: '正在刪除…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
  'macau-customer-service': {
    name: 'presetMacauCustomerServiceName',
    description: 'presetMacauCustomerServiceDescription',
  },
  'macau-customer-service-wiki': {
    name: 'presetMacauCustomerServiceWikiName',
    description: 'presetMacauCustomerServiceWikiDescription',
  },
  'hk-feng-shui': {
    name: 'presetHongKongFengShuiName',
    description: 'presetHongKongFengShuiDescription',
  },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
