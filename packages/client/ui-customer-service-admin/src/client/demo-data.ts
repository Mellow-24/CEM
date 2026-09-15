/** Synthetic scenarios for operator rehearsal; never inputs to a live customer session. */

export const OPERATION_PAGES = [
  ['overview', '工作台'], ['agents', '智能體與渠道'], ['flows', '對話編排'], ['knowledge', '知識與回答'],
  ['voice', '模型與發音'], ['sessions', '會話中心'], ['evaluation', '質檢與評測'], ['reports', '報表與大屏'],
] as const

/** Registered operations section key. */
export type OperationPage = typeof OPERATION_PAGES[number][0]

/** Business pages exposed by the standalone CEM operations portal. */
export const CUSTOMER_ADMIN_PAGES = [
  ['overview', '工作台'], ['agents', '智能體與渠道'], ['knowledge', '當前知識庫'],
  ['voice', '發音與詞庫'], ['sessions', '會話中心'], ['evaluation', '質檢與評測'], ['reports', '報表與大屏'],
] as const satisfies readonly (readonly [OperationPage, string])[]
/** Fixed, business-template, or evidence-based answer policy. */
export type AnswerClass = 'A' | 'B' | 'C'
/** Deterministic query outcome selected by the operator. */
export type Scenario = 'normal' | 'empty' | 'timeout'
/** Editable node with one normal successor and canvas coordinates. */
export type FlowNode = { id: string; label: string; kind: string; x: number; y: number; next: string }
/** Bounded workflow fixture; never executable Host configuration. */
export type DemoFlow = { id: string; name: string; description: string; nodes: FlowNode[] }
/** Synthetic conversation with explicit answer evidence and workflow identity. */
export type DemoSession = {
  id: string
  title: string
  channel: string
  language: string
  answerClass: AnswerClass
  result: string
  query: string
  answer: string
  evidence: string
  flowId: string
}

/**
 * Assert that an operator selection still belongs to its owning collection.
 * @param entry - Entry resolved from the selected key.
 * @returns The selected entry; missing owned entries are an application error.
 */
export function selectedEntry<T>(entry: T | undefined): T {
  if (entry === undefined) throw new Error('The selected operations entry is missing.')
  return entry
}

/** Initial rehearsal text for the three answer policies. */
export const ANSWERS = [
  { id: 'A', name: '標準話術', title: '用電安全提醒', body: '如發現電線破損或設備冒煙，請勿觸碰，並遠離危險範圍。', rule: '固定原文輸出，不交由模型改寫。' },
  { id: 'B', name: '業務模板', title: '賬單查詢', body: '您的本期應繳金額為澳門元 {{amount}}，繳費期限為 {{date}}。', rule: '只填充業務字段；未認證、無記錄和超時分別處理。' },
  { id: 'C', name: '知識問答', title: '繳費方式諮詢', body: '僅根據已審核知識回答；證據不足時澄清或轉人工。電話播報不包含來源編號。', rule: '後臺保留證據，客戶側使用簡潔自然的回答。' },
] as const

/** Local terminology fixtures with textual Cantonese and Portuguese references. */
export const PRONUNCIATIONS = [
  ['氹仔', 'taam5 zai2', 'Taipa', '地名'], ['路氹', 'lou6 taam5', 'Cotai', '地名'],
  ['筷子基', 'faai3 zi2 gei1', 'Fai Chi Kei', '地名'], ['石排灣', 'sek6 paai4 waan1', 'Seac Pai Van', '地名'],
  ['望廈', 'mong6 haa6', 'Mong Ha', '地名'], ['黑沙環', 'hak1 saa1 waan4', 'Areia Preta', '地名'],
  ['青洲', 'cing1 zau1', 'Ilha Verde', '地名'], ['新口岸', 'san1 hau2 ngon6', 'NAPE', '地名'],
  ['澳電', 'ou3 din6', 'CEM', '機構'], ['澳門元', 'ou3 mun4 jyun4', 'MOP', '幣種'],
  ['繳費', 'giu2 fai3', 'Pagamento', '業務'], ['合約', 'hap6 joek3', 'Contrato', '業務'],
  ['電錶', 'din6 biu2', 'Contador', '業務'], ['覆電', 'fuk6 din6', 'Religação', '業務'],
  ['轉賬', 'zyun2 zoeng3', 'Transferência', '業務'], ['路環', 'lou6 waan4', 'Coloane', '地名'],
] as const

/**
 * Build independent editable copies of three bounded demonstration workflows.
 * @returns Fresh billing, outage, and FAQ graphs.
 */
export function demoFlows(): DemoFlow[] {
  return [
    { id: 'billing', name: '電費賬單查詢', description: '身份確認 · 賬單查詢 · B 類業務模板', nodes: [
      { id: 'start', label: '客戶進入', kind: '開始', x: 40, y: 70, next: 'identify' },
      { id: 'identify', label: '身份確認', kind: '確認', x: 280, y: 70, next: 'query' },
      { id: 'query', label: '查詢本期賬單', kind: '業務查詢', x: 520, y: 70, next: 'answer' },
      { id: 'answer', label: 'B 類賬單模板', kind: '回答', x: 520, y: 260, next: 'end' },
      { id: 'end', label: '服務結束', kind: '結束', x: 280, y: 260, next: '' },
    ] },
    { id: 'outage', name: '停電諮詢與報修', description: '地址採集 · 停電查詢 · 報修確認', nodes: [
      { id: 'start', label: '客戶進入', kind: '開始', x: 40, y: 70, next: 'address' },
      { id: 'address', label: '確認澳門地址', kind: '確認', x: 280, y: 70, next: 'query' },
      { id: 'query', label: '查詢停電信息', kind: '業務查詢', x: 520, y: 70, next: 'answer' },
      { id: 'answer', label: '確認報修意願', kind: '回答', x: 520, y: 260, next: 'end' },
      { id: 'end', label: '報修登記確認', kind: '結束', x: 280, y: 260, next: '' },
    ] },
    { id: 'faq', name: '常見問題知識問答', description: '意圖判斷 · 知識檢索 · C 類有據回答', nodes: [
      { id: 'start', label: '客戶進入', kind: '開始', x: 40, y: 70, next: 'intent' },
      { id: 'intent', label: '識別諮詢意圖', kind: '判斷', x: 280, y: 70, next: 'query' },
      { id: 'query', label: '檢索已審核知識', kind: '知識檢索', x: 520, y: 70, next: 'answer' },
      { id: 'answer', label: 'C 類知識回答', kind: '回答', x: 520, y: 260, next: 'end' },
      { id: 'end', label: '確認解決並結束', kind: '結束', x: 280, y: 260, next: '' },
    ] },
  ]
}

/** Fixed synthetic batch shared by the rehearsal table and report aggregates. */
export const DEMO_SESSIONS: readonly DemoSession[] = Array.from({ length: 24 }, (_, index) => {
  const address = index % 5 === 0
  const answerClass = address || index % 3 === 0 ? 'C' : index % 3 === 1 ? 'B' : 'A'
  return {
    id: `CS-${String(index + 1).padStart(3, '0')}`,
    title: address ? '氹仔地址讀音核對' : answerClass === 'B' ? '本期賬單金額查詢' : answerClass === 'A' ? '用電安全諮詢' : '繳費方式諮詢',
    channel: address || index % 3 === 0 ? '電話' : index % 3 === 1 ? 'Web' : 'App', language: address || index % 3 === 0 ? '澳門粵語' : '繁體中文',
    answerClass, result: index % 5 === 0 ? '待覆核' : '已解決',
    query: address ? '我住氹仔，想問下附近邊度可以交電費？' : answerClass === 'B' ? '請問本期應繳電費是多少？' : answerClass === 'A' ? '如果發現電線破損，應該怎樣處理？' : '有咩方法可以交電費？',
    answer: address ? '您可以選擇網上繳費，或者前往客戶服務中心。地址讀音需要人工覆核。'
      : answerClass === 'B' ? '【虛擬賬單】本期應繳澳門元 328.50，繳費期限為 9 月 30 日。'
        : answerClass === 'A' ? ANSWERS[0].body : '您可以使用網上銀行或指定電子支付渠道繳費。',
    evidence: answerClass === 'A' ? '標準話術 A-001 · v1' : answerClass === 'B' ? '測試賬單 B-001 · 身份驗證通過' : '工作區知識《繳費服務指南》· 切片 02 · v1',
    flowId: answerClass === 'B' ? 'billing' : 'faq',
  }
})

/**
 * Validate the editable single-successor graph before rehearsal.
 * @param flow - Operator-edited workflow.
 * @returns Missing names, exits, reachability, or cycle errors.
 */
export function validateFlow(flow: DemoFlow): string[] {
  const issues: string[] = []
  const seen = new Set<string>()
  for (const node of flow.nodes) {
    if (!node.label.trim()) issues.push(`${node.id} 缺少名稱`)
    if (node.kind !== '結束' && !flow.nodes.some(item => item.id === node.next)) issues.push(`${node.label} 缺少有效出口`)
  }
  let current = flow.nodes.find(node => node.kind === '開始')
  if (!current) issues.push('缺少開始節點')
  while (current) {
    if (seen.has(current.id)) { issues.push('流程包含循環'); break }
    seen.add(current.id)
    if (current.kind === '結束') break
    current = flow.nodes.find(node => node.id === current?.next)
  }
  if (seen.size !== flow.nodes.length) issues.push('存在不可達節點')
  return issues
}

/**
 * Resolve a validated graph to an ordered simulated path, with explicit failure exits.
 * @param flow - Operator-edited workflow.
 * @param scenario - Selected query outcome.
 * @returns Ordered node identifiers, or an empty path for an invalid graph.
 */
export function flowPath(flow: DemoFlow, scenario: Scenario): string[] {
  if (validateFlow(flow).length) return []
  const path: string[] = []
  let current = flow.nodes.find(node => node.kind === '開始')
  while (current) {
    path.push(current.id)
    if (current.id === 'query' && scenario !== 'normal') { path.push(scenario); break }
    if (current.kind === '結束') break
    current = flow.nodes.find(node => node.id === current?.next)
  }
  return path
}
