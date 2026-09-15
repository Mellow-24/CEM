/** Shared rehearsal drafts and progress, isolated from Host configuration and Session data. */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'
import { ANSWERS, demoFlows, PRONUNCIATIONS } from './demo-data.ts'
import { PRONUNCIATION_RULES } from './pronunciation-rules.ts'
import type { DemoFlow } from './demo-data.ts'

/** In-memory interaction drafts and version-checked rehearsal progress. */
export type RehearsalDraft = {
  resetVersion: number
  flows: DemoFlow[]
  selectedSession: string
  selectedTerm: string
  voiceTab: string
  terms: Record<string, string>
  termVersion: number
  pronunciationRules: Record<string, boolean>
  pronunciationRuleVersion: number
  testedVersion: number
  reviewedVersion: number
  issueCreated: boolean
  issueClosed: boolean
  channels: Record<string, { greeting: string; language: string; enabled: boolean }>
  answers: Record<string, string>
  documentName: string
  documentText: string
  documentStep: number
  documentQuery: string
  documentVerified: boolean
  documentApproved: boolean
  chunks: string[]
  notice: string
}

function initialDraft(): RehearsalDraft {
  return {
    resetVersion: 0,
    flows: demoFlows(), selectedSession: 'CS-001', selectedTerm: '氹仔', voiceTab: '發音規則庫',
    terms: Object.fromEntries(PRONUNCIATIONS.map(([term, reading]) => [term, term === '氹仔' ? '' : reading])),
    termVersion: 1,
    pronunciationRules: Object.fromEntries(PRONUNCIATION_RULES.map(rule => [rule.id, true])), pronunciationRuleVersion: 1,
    testedVersion: 0, reviewedVersion: 0, issueCreated: false, issueClosed: false,
    channels: Object.fromEntries(['電話', 'Web', 'App'].map(channel => [channel, {
      greeting: '你好，我係澳電智能客服，請問有咩可以幫到你？', language: '澳門粵語', enabled: true,
    }])),
    answers: Object.fromEntries(ANSWERS.map(answer => [answer.id, answer.body])),
    documentName: '計劃停電通知.txt',
    documentText: '【待審核草稿，不作為停電公告】\n氹仔示例區域計劃於 9 月 15 日 09:00 至 11:00 進行供電設備維護。\n\n查詢方式：客戶可通過線上客服確認示例區域及預計恢復供電時間。涉及實際停電安排請以官方公告為準。',
    documentStep: 0, documentQuery: '氹仔', documentVerified: false, documentApproved: false, chunks: [], notice: '',
  }
}

/**
 * Create root-scoped rehearsal interaction state; refreshing the application resets it.
 * @returns A shared slot store handle; no production configuration is persisted or changed.
 */
export function createRehearsalStore(): ReturnType<typeof defineRehearsalStore> {
  return defineRehearsalStore()
}

function defineRehearsalStore() {
  return defineStore({
    init: initialDraft,
    actions: {
      reset: (draft) => {
        const revision = draft.resetVersion + 1
        Object.assign(draft, initialDraft())
        draft.resetVersion = revision
        draft.notice = '工作區已重置，運行配置未改變。'
      },
      selectSession: (draft, id: string) => { draft.selectedSession = id },
      selectTerm: (draft, term: string) => { draft.selectedTerm = term; draft.voiceTab = '詞條糾偏' },
      selectVoiceTab: (draft, tab: string) => { draft.voiceTab = tab },
      togglePronunciationRule: (draft, id: string, enabled: boolean) => {
        if (draft.pronunciationRules[id] === undefined || draft.pronunciationRules[id] === enabled) return
        draft.pronunciationRules[id] = enabled
        draft.pronunciationRuleVersion += 1
        draft.notice = `發音規則已${enabled ? '啟用' : '停用'}，等待試讀與發佈審核。`
      },
      createIssue: (draft) => { draft.issueCreated = true; draft.notice = '已建立整改任務：氹仔地址讀音核對。' },
      saveTerm: (draft, term: string, reading: string) => {
        if (!reading.trim()) { draft.notice = '請填寫讀音規則。'; return }
        if (draft.terms[term] === reading.trim()) { draft.notice = '讀音規則沒有變化。'; return }
        draft.terms[term] = reading.trim()
        draft.termVersion += 1
        draft.testedVersion = 0
        draft.reviewedVersion = 0
        draft.issueClosed = false
        draft.notice = '發音規則已保存，等待迴歸與覆核。'
      },
      runTests: (draft) => {
        draft.testedVersion = draft.termVersion
        draft.notice = draft.terms['氹仔'] === 'taam5 zai2' ? '規則迴歸完成：20 / 20 通過。等待覆核。' : '規則迴歸完成：18 / 20 通過。請核對氹仔讀音。'
      },
      review: (draft) => {
        if (!draft.issueCreated || draft.testedVersion !== draft.termVersion || draft.terms['氹仔'] !== 'taam5 zai2') {
          draft.notice = '請先建立整改任務，並通過當前版本的規則迴歸。'; return
        }
        draft.reviewedVersion = draft.termVersion
        draft.issueClosed = true
        draft.notice = '覆核已完成，等待發布至電話服務。'
      },
      saveChannel: (draft, channel: string, greeting: string, language: string, enabled: boolean) => {
        if (!greeting.trim()) { draft.notice = '歡迎語不能為空。'; return }
        draft.channels[channel] = { greeting: greeting.trim(), language, enabled }
        draft.notice = '渠道草稿已保存，線路尚未接入。'
      },
      saveAnswer: (draft, answerClass: string, body: string) => {
        if (!body.trim()) { draft.notice = '回答內容不能為空。'; return }
        if (answerClass === 'B' && (!body.includes('{{amount}}') || !body.includes('{{date}}'))) {
          draft.notice = '業務模板必須保留 {{amount}} 和 {{date}}。'; return
        }
        draft.answers[answerClass] = body
        draft.notice = '回答草稿已保存，尚未發佈至客服。'
      },
      editNode: (draft, flowId: string, nodeId: string, label: string, next: string) => {
        const node = draft.flows.find(flow => flow.id === flowId)?.nodes.find(item => item.id === nodeId)
        if (node) { node.label = label; node.next = next }
      },
      moveNode: (draft, flowId: string, nodeId: string, x: number, y: number) => {
        const node = draft.flows.find(flow => flow.id === flowId)?.nodes.find(item => item.id === nodeId)
        if (node) { node.x = Math.max(0, Math.min(600, x)); node.y = Math.max(0, Math.min(350, y)) }
      },
      setDocument: (draft, name: string, text: string) => {
        draft.documentName = name; draft.documentText = text; draft.documentStep = 0; draft.chunks = []
        draft.documentVerified = false; draft.documentApproved = false
      },
      editChunk: (draft, index: number, text: string) => {
        if (index >= 0 && index < draft.chunks.length) {
          draft.chunks[index] = text; draft.documentStep = 2
          draft.documentVerified = false; draft.documentApproved = false
        }
      },
      setDocumentQuery: (draft, query: string) => {
        draft.documentQuery = query; draft.documentVerified = false; draft.documentApproved = false
        draft.documentStep = Math.min(2, draft.documentStep)
      },
      verifyDocument: (draft) => {
        const query = draft.documentQuery.trim().toLowerCase()
        draft.documentVerified = draft.documentStep >= 2 && query.length > 0
          && draft.chunks.some(chunk => chunk.toLowerCase().includes(query))
        draft.notice = draft.documentVerified ? '檢索驗證通過，可以提交審核。' : '未命中有效切片，請調整檢索內容。'
      },
      approveDocument: (draft, approved: boolean) => {
        draft.documentApproved = draft.documentStep === 4 && draft.documentVerified && approved
      },
      advanceDocument: (draft) => {
        if (!draft.documentText.trim()) { draft.notice = '文檔內容不能為空。'; return }
        if (draft.documentStep === 2 && !draft.documentVerified) { draft.notice = '請先完成切片檢索驗證。'; return }
        if (draft.documentStep === 4 && !draft.documentApproved) { draft.notice = '請先核對原文並確認審核。'; return }
        if (draft.documentStep === 1) draft.chunks = draft.documentText.split(/\n\s*\n/u).filter(Boolean)
        if (draft.chunks.some(chunk => !chunk.trim())) { draft.notice = '切片內容不能為空。'; return }
        draft.documentStep = Math.min(5, draft.documentStep + 1)
        draft.notice = draft.documentStep === 5 ? '文檔審核已完成，尚未發佈至運行知識庫。' : '處理步驟已完成。'
      },
      notify: (draft, message: string) => { draft.notice = message },
    },
  })
}
