import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { type SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import {
  applyResponseLanguageEvent,
  foldResponseLanguage,
  responseLanguageProjection,
  type ResponseLanguageState,
} from '../src/index.ts'
import * as ResponseLanguage from '../src/index.ts'

const EMPTY: ResponseLanguageState = {
  available: false,
  currentValue: 'auto',
  resolved: null,
}

/** Build a detached log-only event for the pure projection fold. */
function event(type: string, data: unknown, seq = 0): SessionEvent {
  return { type, data, seq, time: seq } as SessionEvent
}

describe('response-language projection', () => {
  it('folds preference, resolution, and preset changes as whole values', () => {
    const selected = applyResponseLanguageEvent(
      EMPTY,
      event('response-language/preference', { value: 'en' }),
    )
    expect(selected).toEqual({ available: true, currentValue: 'en', resolved: null })
    expect(applyResponseLanguageEvent(
      selected,
      event('response-language/preference', { value: 'en' }),
    )).toBe(selected)
    expect(applyResponseLanguageEvent(selected, event('turn/start', { turn: 1 }))).toBe(selected)

    const resolved = applyResponseLanguageEvent(selected, event('response-language/resolved', {
      turn: 1,
      step: 1,
      preference: 'en',
      language: 'en',
      basis: 'fixed',
    }))
    expect(resolved).toEqual({
      available: true,
      currentValue: 'en',
      resolved: { language: 'en', basis: 'fixed' },
    })
    expect(applyResponseLanguageEvent(resolved, event('response-language/resolved', {
      turn: 1,
      step: 2,
      preference: 'en',
      language: 'en',
      basis: 'fixed',
    }))).toBe(resolved)

    const unavailable = applyResponseLanguageEvent(
      resolved,
      event('agent-preset/selected', { agentPreset: 'standard' }),
    )
    expect(unavailable).toEqual({ available: false, currentValue: 'en', resolved: null })
    expect(applyResponseLanguageEvent(unavailable, event('agent-preset/selected', {
      agentPreset: 'minimal',
    }))).toBe(unavailable)

    const restored = applyResponseLanguageEvent(
      unavailable,
      event('response-language/preference', { value: 'en' }),
    )
    expect(restored).toEqual({ available: true, currentValue: 'en', resolved: null })
  })

  it('clears a stale resolution when the selected preference changes', () => {
    const state = foldResponseLanguage([
      event('response-language/preference', { value: 'auto' }, 0),
      event('response-language/resolved', {
        turn: 1,
        step: 1,
        preference: 'auto',
        language: 'pt',
        basis: 'detected',
        messageId: 'm-1',
        confidence: 0.9,
      }, 1),
      event('response-language/preference', { value: 'zh-Hans' }, 2),
    ])
    expect(state).toEqual({ available: true, currentValue: 'zh-Hans', resolved: null })
  })

  it('renders the closed option list and omits an absent resolution', () => {
    expect(responseLanguageProjection(EMPTY)).toEqual({
      available: false,
      options: [
        { value: 'auto', name: '自动' },
        { value: 'zh-Hans', name: '简体中文' },
        { value: 'zh-Hant', name: '繁體中文' },
        { value: 'yue-Hant-MO', name: '澳門粵語' },
        { value: 'yue-Hant-HK', name: '香港粵語' },
        { value: 'en', name: 'English' },
        { value: 'pt', name: 'Português' },
      ],
      currentValue: 'auto',
    })
  })

  it('serves explicit unavailable state process-wide and drops the key on unload', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SessionProjectionRegistry)
    const scoped = createScope(ctx, { responseLanguageTest: true })
    const fiber = await scoped.ctx.plugin(ResponseLanguage, { fallbackLanguage: 'zh-Hant' })
    const unrelated = ctx.sessions.create()

    expect(ctx.sessionProjections.snapshot(unrelated).values.responseLanguage).toMatchObject({
      available: false,
      currentValue: 'auto',
    })
    unrelated.append('response-language/preference', { value: 'pt' })
    expect(ctx.sessionProjections.snapshot(unrelated).values.responseLanguage).toMatchObject({
      available: true,
      currentValue: 'pt',
    })

    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(unrelated).values).not.toHaveProperty('responseLanguage')
    await scoped.dispose()
    await ctx.fiber.dispose()
  })
})
