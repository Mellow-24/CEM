/** Session-local draft and mobile presentation state. */
import { defineStore } from '@deepseek-ai/dsh-client-runtime/client'

const definition = defineStore({
  init: () => ({ draft: '', voiceMode: false, callExpanded: true, drawer: false }),
  actions: {
    draft: (state, value: string) => { state.draft = value },
    clearDraft: (state, expected: string) => { if (state.draft === expected) state.draft = '' },
    appendTranscript: (state, text: string) => { state.draft = state.draft ? `${state.draft}\n${text}` : text },
    voiceMode: (state, value: boolean) => { state.voiceMode = value },
    callExpanded: (state, value: boolean) => { state.callExpanded = value },
    drawer: (state, value: boolean) => { state.drawer = value },
  },
})

/**
 * Create the interaction store owned by one mounted mobile Session.
 * @returns Slot store declaration; each mount creates a separate instance.
 */
export function createMobileStore(): typeof definition {
  return definition
}
