/**
 * Browser plugin integration over a real SlotRegistry: waits for the
 * conversation declaration, registers one right-row control, sends the exact
 * response-language command, folds Remote outcomes, and unwinds on teardown.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ResponseLanguageSelectInjected } from '../src/client/ResponseLanguageSelect.tsx'
import { ResponseLanguageSelect } from '../src/client/ResponseLanguageSelect.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 'response-language-session' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) => Promise.resolve({
    ok: true as const,
    value: { commandId: 'language-command', result: { kind: 'success' as const } },
  }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, execute }
}

describe('ui-response-language browser apply', () => {
  it('declares every service it binds and keeps the Node half inert', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits for the conversation declaration before registering', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('remote', { commands: {} })
    ctx.provide('remote.commands', {})
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.right')).toHaveLength(0)

    ctx.slots.register({
      name: 'root',
      children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.right')).toHaveLength(1)
  })

  it('registers the control, executes the selected preference, and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.ctx.slots.entries('conversation.input.right')[0]!
    expect(entry.component).toBe(ResponseLanguageSelect)
    expect(entry.options).toMatchObject({ id: 'response-language', order: 0 })
    expect(entry.locale).toBe('responseLanguage')
    const face = (entry.inject as unknown as (id: SessionId) => ResponseLanguageSelectInjected)(SID)

    await expect(face.select('en')).resolves.toBeNull()
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/response-language en')

    b.execute.mockResolvedValueOnce({
      ok: false,
      error: { code: 'session-not-found', message: 'gone', details: {} },
    } as never)
    await expect(face.select('pt')).resolves.toBe('gone (session-not-found)')

    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(face.select('auto')).resolves.toBe('unknown command: /response-language')

    await fiber.dispose()
    expect(b.ctx.slots.entries('conversation.input.right')).toHaveLength(0)
  })
})
