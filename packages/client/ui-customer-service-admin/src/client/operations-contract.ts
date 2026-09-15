/** Props derived for the shared operator rehearsal pages and real-data callbacks. */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { CustomerServiceAdminInjected } from './contracts.ts'
import type { createRehearsalStore } from './demo-store.ts'
import type { OperationPage } from './demo-data.ts'

/** Bounded recorded text with an earlier-history cursor from the source event page. */
export type ConversationReadout = {
  messages: { seq: number; role: string; text: string; time: number }[]
  hasMore: boolean
  beforeSeq: number | undefined
}
/** Slot-derived runtime, locale, rehearsal state, and injected real-data callbacks. */
export type OperationsProps = PropsRuntime<'settings.section'>
  & PropsLocale<'settings.customerServiceAdmin'>
  & PropsStore<ReturnType<typeof createRehearsalStore>>
  & CustomerServiceAdminInjected
  & {
    page: OperationPage
    /** Standalone portal presentation; absent inside the legacy Settings console. */
    standalone?: boolean
    readConversation: (id: SessionId, beforeSeq?: number) => Promise<ConversationReadout>
  }
