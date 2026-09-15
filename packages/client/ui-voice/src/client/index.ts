/** Browser voice UI assembly over the optional Host speech client. */

import type { ClientContext, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createWebVoiceClient } from './client.ts'
import { VoiceSessionController } from './controller.ts'
import { browserVoicePlatform } from './platform.ts'
import { createMobilePlayback } from './mobile-playback.ts'
import type { VoicePlatform } from './contract.ts'
import { VoiceInputButton } from './VoiceInputButton.tsx'
import { VoicePlaybackAction } from './VoicePlaybackAction.tsx'
import { VoiceStatus } from './VoiceStatus.tsx'
import { VoiceCallButton } from './VoiceCallButton.tsx'
import { VoiceCallController } from './call.ts'
import type { VoiceCallInjected } from './slots.ts'
import type { VoiceInputInjected, VoicePlaybackInjected, VoiceStatusInjected } from './slots.ts'
import { en, zh } from './locales.ts'

export type {
  SpeechProfile, SpeechSynthesisProfile, SpeechTranscriptionProfile, VoiceAudioSource, VoiceClient,
} from './contract.ts'
export type { VoiceCallView } from './call.ts'
export type { VoiceKey } from './locales.ts'

/** Browser voice controllers that another customer-facing shell can render. */
export interface BrowserVoiceRuntime {
  /** Recording, transcription, profile, and message-playback state. */
  readonly controller: VoiceSessionController
  /** Continuous recognition and synthesized-answer call state. */
  readonly call: VoiceCallController
  /** Stop media and release every observer owned by this runtime. */
  dispose(): Promise<void>
}

/** Voice runtime factory published for independently rendered client shells. */
export interface BrowserVoiceRuntimeService {
  /**
   * Create controllers scoped to one live Session.
   * @param session - Session that receives recognized customer turns.
   * @returns runtime that the caller must dispose when its surface unmounts.
   */
  create(session: SessionFace): BrowserVoiceRuntime
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared browser speech implementation for alternate conversation shells. */
    voiceRuntime: BrowserVoiceRuntimeService
  }
}

function configuredBrowserPlatform(): VoicePlatform {
  return document.documentElement.hasAttribute('data-dsh-mobile')
    ? { ...browserVoicePlatform, ...createMobilePlayback() }
    : browserVoicePlatform
}

/**
 * Create the same browser speech controllers used by the standard conversation UI.
 * @param session - live Session that receives transcribed questions and owns spoken answers.
 * @returns independently disposable browser voice runtime.
 */
function createBrowserVoiceRuntime(session: SessionFace): BrowserVoiceRuntime {
  const client = createWebVoiceClient()
  const platform = configuredBrowserPlatform()
  const controller = new VoiceSessionController(session.sessionId, client, platform)
  const call = new VoiceCallController(session, client, platform)
  const unsubscribe = call.subscribe(() => { controller.setCallActive(call.getSnapshot().phase !== 'idle') })
  let disposed = false
  return {
    controller,
    call,
    async dispose() {
      if (disposed) return
      disposed = true
      unsubscribe()
      await call.stop()
      controller.dispose()
    },
  }
}

/** Required global Client services. */
export const inject = ['slots', 'locale', 'sessions']

/** Mount voice entries; a missing Host route resolves as unavailable per Session. */
export function apply(ctx: ClientContext): void {
  ctx.provide('voiceRuntime', { create: createBrowserVoiceRuntime })
  ctx.effect(() => ctx.locale.register('voice', { zh, en }), 'ui-voice: dictionaries')
  const scope = ctx
  const voiceClient = createWebVoiceClient()
  const platform = configuredBrowserPlatform()
  const controllers = new Map<SessionId, VoiceSessionController>()
  const calls = new Map<SessionId, VoiceCallController>()
  const knownPresets = new Map<SessionId, string | undefined>()
  const knownRunning = new Map<SessionId, boolean>()
  const controllerFor = (sessionId: SessionId): VoiceSessionController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      const sessionScope = scope.sessions.scope(sessionId)
      if (sessionScope === undefined) throw new Error(`ui-voice: Session ${JSON.stringify(sessionId)} has no client scope`)
      controller = new VoiceSessionController(sessionId, voiceClient, platform)
      controllers.set(sessionId, controller)
      knownPresets.set(sessionId, scope.sessions.list.getSnapshot().byId[sessionId]?.agentPreset)
      knownRunning.set(sessionId, scope.sessions.list.getSnapshot().byId[sessionId]?.running ?? false)
      const owned = controller
      const session = scope.sessions.sessionOf(sessionScope)
      if (session === undefined) throw new Error('ui-voice: call Session is unavailable')
      const call = new VoiceCallController(session, voiceClient, platform)
      calls.set(sessionId, call)
      const unsubscribeCall = call.subscribe(() => { owned.setCallActive(call.getSnapshot().phase !== 'idle') })
      sessionScope.effect(() => async () => {
        unsubscribeCall()
        await call.stop()
        calls.delete(sessionId)
      }, 'ui-voice: scoped call')
      sessionScope.effect(() => () => {
        owned.dispose()
        if (controllers.get(sessionId) === owned) controllers.delete(sessionId)
        knownPresets.delete(sessionId)
        knownRunning.delete(sessionId)
      }, 'ui-voice: scoped Session controller')
    }
    return controller
  }

  let current = scope.sessions.list.getSnapshot().current
  scope.effect(() => scope.sessions.list.subscribe(() => {
    const list = scope.sessions.list.getSnapshot()
    const next = list.current
    if (current !== undefined && current !== next) {
      controllers.get(current)?.deactivate()
      void calls.get(current)?.stop()
    }
    for (const [sessionId, controller] of controllers) {
      const summary = list.byId[sessionId]
      const preset = summary?.agentPreset
      const running = summary?.running ?? false
      const presetChanged = knownPresets.get(sessionId) !== preset
      const becameLive = knownRunning.get(sessionId) === false && running
      knownPresets.set(sessionId, preset)
      knownRunning.set(sessionId, running)
      if (presetChanged) {
        void calls.get(sessionId)?.stop()
        controller.deactivate()
        if (sessionId === next) controller.refreshProfile()
      } else if (becameLive && sessionId === next
        && (controller.getSnapshot().profileState === 'error'
          || controller.getSnapshot().profileState === 'unavailable')) {
        controller.refreshProfile()
      }
    }
    current = next
  }), 'ui-voice: stop resources after Session switch')

  scope.on('connection/reset', () => {
    for (const call of calls.values()) void call.stop()
    for (const controller of controllers.values()) controller.refreshProfile()
  })

  scope.effect(() => async () => {
    await Promise.all([...calls.values()].map(call => call.stop()))
    calls.clear()
    for (const controller of controllers.values()) controller.dispose()
    controllers.clear()
    knownPresets.clear()
    knownRunning.clear()
  }, 'ui-voice: session controllers')

  scope.slots.inject('conversation.input.right', () => scope.slots.register({
    name: 'conversation.input.right',
    id: 'voice-input',
    order: 50,
    locale: 'voice',
    inject: (sessionId: SessionId): VoiceInputInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { voice: controller },
        ensureProfile: () => controller.ensureProfile(),
        startRecording: () => controller.startRecording(),
        stopRecording: () => controller.stopRecording(),
        cancelRecording: () => { controller.cancelRecording() },
        markVoiceDraft: (draft) => { controller.markVoiceDraft(draft) },
        clearVoiceDraft: () => { controller.clearVoiceDraft() },
        armAutoPlayback: (committedThroughSeq) => { controller.armAutoPlayback(committedThroughSeq) },
        clearAutoPlayback: () => { controller.clearAutoPlayback() },
      }
    },
  }, VoiceInputButton))

  scope.slots.inject('conversation.input.right', () => scope.slots.register({
    name: 'conversation.input.right',
    id: 'voice-call',
    order: 51,
    locale: 'voice',
    inject: (sessionId: SessionId): VoiceCallInjected => {
      const controller = controllerFor(sessionId)
      const call = calls.get(sessionId)
      if (call === undefined) throw new Error('ui-voice: call controller is unavailable')
      return {
        hooks: { voice: controller, call },
        ensureProfile: () => controller.ensureProfile(),
        prepareGreeting: (language) => {
          const profile = controller.getSnapshot().profile
          if (profile !== undefined) call.prepareGreeting(profile, language)
        },
        startCall: (language) => {
          controller.deactivate()
          const profile = controller.getSnapshot().profile
          if (profile !== undefined) call.start(profile, language)
        },
        endCall: () => call.stop(),
      }
    },
  }, VoiceCallButton))

  scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
    name: 'conversation.composer.dock',
    id: 'voice-status',
    order: -10,
    locale: 'voice',
    inject: (sessionId: SessionId): VoiceStatusInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { voice: controller },
        ensureProfile: () => controller.ensureProfile(),
      }
    },
  }, VoiceStatus))

  scope.slots.inject('conversation.chat.assistant-actions', () => scope.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'voice-playback',
    order: 5,
    locale: 'voice',
    inject: (sessionId: SessionId): VoicePlaybackInjected => {
      const controller = controllerFor(sessionId)
      return {
        hooks: { voice: controller },
        ensureProfile: () => controller.ensureProfile(),
        claimAutoPlayback: messageSeq => controller.claimAutoPlayback(messageSeq),
        play: messageId => controller.play(messageId),
        stop: (messageId) => { controller.stopPlayback(messageId) },
      }
    },
  }, VoicePlaybackAction))
}
