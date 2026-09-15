/** Customer-only message projection and mobile entry selection. */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { VoiceCallView } from '@deepseek-ai/dsh-client-ui-voice/client'

/** Customer-visible text, excluding reasoning and tool internals. */
export interface MobileMessage {
  key: string
  role: 'user' | 'assistant'
  text: string
  time?: number
  interrupted?: boolean | undefined
  partial?: boolean
}

/**
 * Select only the explicit mobile document; never replace desktop or the customer portal.
 * @param url - Current document address.
 * @param mode - Whether the unqualified mobile document selects this interface.
 * @returns Whether to register the mobile root.
 */
export function mobileEntry(url: URL, mode: 'preview' | 'default'): boolean {
  if (url.pathname !== '/mobile.html') return false
  const selection = url.searchParams.get('ui')
  return selection === 'cem-chat' || (selection === null && mode === 'default')
}

/**
 * Project durable customer prose and the current partial answer without synthetic messages.
 * @param snapshot - Authoritative Session conversation snapshot.
 * @returns Ordered visible messages.
 */
export function messagesOf(snapshot: ConversationSnapshot): MobileMessage[] {
  const messages: MobileMessage[] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'user' || node.kind === 'steering') {
      const text = node.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('')
      if (text.trim()) messages.push({ key: `user-${node.seq}`, role: 'user', text, time: node.time })
    } else if (node.kind === 'assistant') {
      const text = node.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('')
      if (text.trim()) messages.push({ key: `assistant-${node.seq}`, role: 'assistant', text, time: node.time, interrupted: node.interrupted })
    }
  }
  if (snapshot.partial !== null) {
    const text = snapshot.partial.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('')
    if (text.trim()) messages.push({ key: 'partial', role: 'assistant', text, partial: true })
  }
  return messages
}

/**
 * Readable call state; animation is never the only status cue.
 * @param call - Current controller state.
 * @returns Traditional Chinese status label.
 */
export function callLabel(call: VoiceCallView): string {
  if (call.muted && call.phase === 'listening') return '麥克風已靜音'
  switch (call.phase) {
    case 'idle': return '通話已結束'
    case 'connecting': return '正在接通，請稍候…'
    case 'listening': return '正在聆聽，請說…'
    case 'transcribing': return '正在識別您的語音…'
    case 'thinking': return '正在查詢，請稍候…'
    case 'generating': return '正在準備語音回答…'
    case 'playing': return '澳電助手正在回答…'
    case 'ending': return '正在結束通話…'
    case 'error': return '通話暫時中斷'
  }
}

/**
 * Format elapsed call seconds independently of wall-clock locale.
 * @param seconds - Elapsed nonnegative whole seconds.
 * @returns Minutes and seconds.
 */
export function duration(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
