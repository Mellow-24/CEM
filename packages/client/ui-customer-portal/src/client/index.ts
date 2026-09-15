/** CEM customer portal route over the existing Session runtime. */

import type { ConnectionHandle, SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-voice/client'
import { CustomerPortal } from './CustomerPortal.tsx'
import type { CustomerPortalInjected } from './CustomerPortal.tsx'

/** Browser path that activates the customer-facing application shell. */
export const CUSTOMER_PORTAL_PATH = '/customer'
/** Agent composition reserved for the customer-facing application. */
export const CUSTOMER_PRESET = 'macau-customer-service'

/**
 * Whether a pathname addresses the customer-facing shell.
 * @param pathname - browser pathname without the origin or query.
 * @returns true only for the dedicated customer route and its trailing-slash form.
 */
export function isCustomerPortalPath(pathname: string): boolean {
  return pathname === CUSTOMER_PORTAL_PATH || pathname === `${CUSTOMER_PORTAL_PATH}/`
}

/** Required browser services. */
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'voiceRuntime']

interface OperationFailure {
  readonly code: string
  readonly message: string
}

type OperationResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: OperationFailure }

function valueOrThrow<Value>(operation: string, result: OperationResult<Value>): Value {
  if (!result.ok) throw new Error(`${operation} failed: ${result.error.code}: ${result.error.message}`)
  return result.value
}

function currentWorkspaceId(ctx: ClientContext, sessionId: SessionId | undefined): WorkspaceId | undefined {
  const state = ctx.workspaces.list.getSnapshot()
  if (sessionId !== undefined) {
    const current = state.items.find(workspace => workspace.sessionIds.includes(sessionId))
    if (current !== undefined) return current.workspaceId
  }
  return state.recentWorkspaceId
}

/** Install the alternate root only on `/customer`; every other URL retains the standard shell. */
export function apply(ctx: ClientContext): void {
  if (!isCustomerPortalPath(window.location.pathname)) return
  const { api } = ctx.get('connection') as ConnectionHandle

  const session = (id: SessionId): SessionFace => {
    const resolved = ctx.sessions.binding(id)?.session
    if (resolved === undefined) throw new Error('服務會話尚未準備好，請稍後再試。')
    return resolved
  }

  const prepareSession = async (id: SessionId): Promise<SessionFace> => {
    const summary = ctx.sessions.list.getSnapshot().byId[id]
    if (summary === undefined) throw new Error('服務會話已失效，請重新整理頁面。')
    if (summary.agentPreset !== CUSTOMER_PRESET) {
      if (!summary.blank) throw new Error('目前會話不屬於澳電智能客服，請建立新會話。')
      const response = await api.agentPresets.select({ sessionId: id, agentPreset: CUSTOMER_PRESET })
      const selected = valueOrThrow('agentPresets.select', response.result)
      ctx.sessions.noteAgentPreset(id, selected.agentPreset)
    }
    return session(id)
  }

  const activate = async (): Promise<SessionId> => {
    const list = ctx.sessions.list.getSnapshot()
    const current = list.current === undefined ? undefined : list.byId[list.current]
    if (current?.blank === true) {
      await prepareSession(current.id)
      ctx.sessions.open(current.id)
      return current.id
    }

    const workspaceId = currentWorkspaceId(ctx, current?.id)
    if (workspaceId === undefined) throw new Error('尚未配置客服工作區，請先在原系統建立工作區。')
    const id = await ctx.workspaces.connectWorkspace(workspaceId)
    ctx.sessions.open(id)
    await prepareSession(id)
    return id
  }

  const callbacks: CustomerPortalInjected = {
    activate,
    openSession: async (id) => {
      const summary = ctx.sessions.list.getSnapshot().byId[id]
      if (summary?.agentPreset !== CUSTOMER_PRESET || summary.blank || summary.origin === 'subagent') {
        throw new Error('所選記錄不是可用的澳電客服會話。')
      }
      ctx.sessions.open(id)
      return id
    },
    archiveSession: async (id) => { await ctx.workspaces.archiveSession(id) },
    resolveSession: id => ctx.sessions.binding(id)?.session,
    send: async (id, text) => {
      const target = await prepareSession(id)
      const result = await target.prompt([{ type: 'text', text }], 'queue')
      valueOrThrow('session.prompt', result)
    },
    cancel: async (id) => {
      const result = await session(id).cancel()
      valueOrThrow('session.cancel', result)
    },
    createVoice: target => ctx.voiceRuntime.create(target),
  }

  ctx.slots.register({ name: 'root', priority: -10, inject: () => callbacks }, CustomerPortal)
}
