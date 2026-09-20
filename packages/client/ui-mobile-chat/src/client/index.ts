/** Isolated mobile composition over the existing Session and browser speech services. */
import type { ClientResponse, ConnectionHandle, SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'
import type { BrowserVoiceRuntime } from '@deepseek-ai/dsh-client-ui-voice/client'
import type {} from '@deepseek-ai/dsh-client-ui-voice/client'
import { Config } from '../config.ts'
import { MobileChatRoot, MobileConversation } from './MobileChat.tsx'
import { createMobileStore } from './store.ts'
import { mobileEntry } from './presenter.ts'

export { Config } from '../config.ts'
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'voiceRuntime']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * Complete CEM Session view, including draft, history, and media controls. No owner props;
     * registrants receive the Session runtime kit. A replacement owns the entire view;
     * without a registration the mobile root has no conversation content.
     */
    'mobile-chat.conversation': { kind: 'single'; scope: 'session'; owner: {} }
  }
}

/** Register only the selected mobile entry and dispose all owned media on departure. */
export function apply(ctx: ClientContext, config: Config): void {
  if (!mobileEntry(new URL(window.location.href), config.entryMode)) return
  if (!config.servicePresets.includes(config.defaultPreset)) throw new Error('mobile-chat: defaultPreset must appear in servicePresets')
  const { api } = ctx.get('connection') as ConnectionHandle
  const voices = new Map<SessionId, BrowserVoiceRuntime>()
  const rememberedKey = 'cem.mobile.lastSession.v2'
  let navigation: Promise<void> | undefined
  let recoveryGeneration = 0
  let alive = true
  const isAlive = (): boolean => alive
  const isCustomer = (id: SessionId): boolean => {
    const summary = ctx.sessions.list.getSnapshot().byId[id]
    return summary !== undefined && config.servicePresets.includes(summary.agentPreset ?? '')
      && !ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(id)
  }
  const session = (id: SessionId): SessionFace => {
    const target = ctx.sessions.binding(id)?.session
    if (target === undefined || !isCustomer(id)) throw new Error('客服對話不可用，請建立新對話。')
    return target
  }
  const remember = (id: SessionId): void => {
    try { localStorage.setItem(rememberedKey, id) } catch { /* Browsers may deny optional UI persistence. */ }
  }
  const select = async (id: SessionId): Promise<void> => {
    if (!isCustomer(id)) throw new Error('無法開啟這段客服對話。')
    const summary = ctx.sessions.list.getSnapshot().byId[id]
    if (summary === undefined) throw new Error('對話已不可用，請重新選擇。')
    if (summary.cwd === undefined) throw new Error('對話工作區資料未就緒，請重試。')
    // Explicit-id creation resumes a dormant Session under its persisted preset without a model turn.
    const response = await api.sessions.create({ sessionId: id, cwd: summary.cwd,
      ...(summary.agentPreset === undefined ? {} : { agentPreset: summary.agentPreset }) })
    if (!response.result.ok) throw new Error(response.result.error.message)
    if (!isAlive()) return
    ctx.sessions.open(id)
    remember(id)
  }
  const stopMedia = async (): Promise<void> => {
    await Promise.all([...voices.values()].map(async (voice) => {
      voice.controller.cancelRecording()
      voice.controller.stopPlayback()
      await voice.call.stop()
    }))
  }
  const activate = (fresh = false, preset = config.defaultPreset): Promise<void> => {
    if (navigation !== undefined) return navigation
    navigation = (async () => {
      if (!config.servicePresets.includes(preset)) throw new Error('未配置此客服服務。')
      if (!fresh) {
        let remembered: string | null = null
        try { remembered = localStorage.getItem(rememberedKey) } catch { /* Optional UI persistence may be unavailable. */ }
        const rememberedId = remembered as SessionId | null
        const restored = rememberedId !== null && isCustomer(rememberedId)
          ? rememberedId
          : undefined
        if (restored !== undefined) { await select(restored); return }
      }
      await stopMedia()
      const workspace = ctx.workspaces.list.getSnapshot().recentWorkspaceId
      if (workspace === undefined) throw new Error('客服工作區尚未設定，請聯絡管理員。')
      const id = await ctx.workspaces.connectWorkspace(workspace)
      if (!alive) return
      const summary = ctx.sessions.list.getSnapshot().byId[id]
      if (summary?.blank !== true) throw new Error('新對話未能建立，請重試。')
      if (summary.agentPreset !== preset) {
        const response = await api.agentPresets.select({ sessionId: id, agentPreset: preset })
        if (!response.result.ok) throw new Error(response.result.error.message)
        ctx.sessions.noteAgentPreset(id, response.result.value.agentPreset)
      }
      // A preset selection may outlive plugin disposal while its RPC is pending.
      if (isAlive()) await select(id)
    })().finally(() => { navigation = undefined })
    return navigation
  }
  const voiceFor = (id: SessionId): BrowserVoiceRuntime => {
    const existing = voices.get(id)
    if (existing !== undefined) return existing
    const voice = ctx.voiceRuntime.create(session(id))
    voices.set(id, voice)
    return voice
  }
  let previous = ctx.sessions.list.getSnapshot().current
  ctx.effect(() => ctx.sessions.list.subscribe(() => {
    const current = ctx.sessions.list.getSnapshot().current
    if (current === previous) return
    if (previous !== undefined) {
      const old = voices.get(previous)
      voices.delete(previous)
      if (old !== undefined) void old.dispose()
    }
    previous = current
  }), 'mobile-chat: media follows selection')
  ctx.on('connection/reset', () => {
    const generation = ++recoveryGeneration
    const active = [...voices.entries()]
    for (const [, voice] of active) {
      voice.controller.deactivate()
    }
    void (async () => {
      await Promise.all(active.map(async ([, voice]) => {
        try {
          await voice.call.stop()
        } catch {
          // Connection loss may prevent the call's final Session cancellation; exact-id resume repairs authority below.
        }
      }))
      for (const [id, voice] of active) {
        if (!alive || generation !== recoveryGeneration || voices.get(id) !== voice) return
        try {
          await select(id)
        } catch {
          // A failed resume is reported by the profile request through the existing mobile error row.
        }
        // select awaits RPC while disposal or a newer reset may replace this runtime.
        // oxlint-disable-next-line typescript/no-unnecessary-condition
        if (!alive || generation !== recoveryGeneration || voices.get(id) !== voice) return
        voice.controller.refreshProfile()
      }
    })()
  })
  ctx.effect(() => {
    const leave = (): void => { void stopMedia() }
    window.addEventListener('pagehide', leave)
    return async () => {
      alive = false
      recoveryGeneration++
      window.removeEventListener('pagehide', leave)
      await Promise.all([...voices.values()].map(voice => voice.dispose()))
      voices.clear()
    }
  }, 'mobile-chat: page media lifetime')

  ctx.effect(() => ctx.slots.register({
    name: 'root', priority: -20,
    children: { 'mobile-chat.conversation': { kind: 'single', scope: 'session' } },
    inject: () => ({ initialize: () => activate() }),
  }, MobileChatRoot), 'mobile-chat: root')

  ctx.slots.inject('mobile-chat.conversation', () => ctx.slots.register({
    name: 'mobile-chat.conversation', store: createMobileStore,
    inject: (id) => {
      const voice = voiceFor(id)
      return {
        hooks: { voice: voice.controller, call: voice.call },
        servicePresets: config.servicePresets,
        language: config.language,
        send: async (text: string) => {
          const target = session(id)
          const state = target.getSnapshot()
          if (state.running || state.removed || state.pending.length > 0 || voice.call.getSnapshot().phase !== 'idle') throw new Error('請先完成目前操作。')
          const result = await target.prompt([{ type: 'text', text }], 'queue')
          if (!result.ok) throw new Error(result.error.message)
        },
        cancel: async () => {
          const result = await session(id).cancel()
          if (!result.ok) throw new Error(result.error.message)
        },
        open: async (target: SessionId) => { await stopMedia(); await select(target) },
        newSession: (preset?: string) => activate(true, preset),
        loadOlder: () => session(id).loadOlder(),
        ensureVoice: () => voice.controller.ensureProfile(),
        refreshVoice: async () => { await select(id); voice.controller.refreshProfile(); await voice.controller.ensureProfile() },
        record: () => voice.controller.startRecording(),
        finishRecording: () => voice.controller.stopRecording(),
        cancelRecording: () =>{  voice.controller.cancelRecording() },
        prepareCall: () => {
          const profile = voice.controller.getSnapshot().profile
          if (profile?.call !== undefined) voice.call.prepareGreeting(profile, config.language)
        },
        startCall: () => {
          const profile = voice.controller.getSnapshot().profile
          if (!profile?.call || !profile.transcription?.realtime || !profile.synthesis) throw new Error('語音服務尚未就緒，請稍後重試。')
          voice.controller.cancelRecording()
          voice.controller.stopPlayback()
          voice.call.start(profile, config.language)
        },
        endCall: () => voice.call.stop(),
        muteCall: (muted: boolean) =>{  voice.call.setMuted(muted) },
        interruptCall: () =>{  voice.call.interrupt() },
        respond: async (key: string, result: ClientResponse['result']) => {
          const wait = session(id).getSnapshot().pending.find(item => item.key === key)
          if (wait === undefined) throw new Error('此請求已失效。')
          const receipt = await wait.respond(result)
          if (!receipt.accepted) throw new Error('回覆未被接受，請重新整理。')
        },
      }
    },
  }, MobileConversation))
}
