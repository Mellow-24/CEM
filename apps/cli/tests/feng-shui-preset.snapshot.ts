/** Keyless shipped-Web transcript for the Hong Kong feng shui preset. */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { normalizeSessionLog } from '@deepseek-ai/dsh-acp-snapshot'
import type {} from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type Session, type SessionHeader } from '@deepseek-ai/dsh-session'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { bootWebPresetHarness } from './web-agent-presets-harness.ts'
import {
  DASH_SCOPE_AUDIO,
  DASH_SCOPE_TEXT,
  dashScopeSseResponse,
} from './fixtures/feng-shui-dashscope.ts'

const expectedPath = fileURLToPath(new URL('./snapshots/feng-shui-preset/session.expected.jsonl', import.meta.url))
const expectedProfilePath = fileURLToPath(new URL('./snapshots/feng-shui-preset/speech-profile.expected.json', import.meta.url))
const mockAdapter = fileURLToPath(new URL('./fixtures/feng-shui-mock-llm.ts', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'
const managedEnvironment = ['DASHSCOPE_API_KEY', 'DSH_HK_FENG_SHUI_STT_URL'] as const

let ctx: Context
let root: string
const previousEnvironment = new Map<string, string | undefined>()

/** Serialize the fields this fresh top-level session can carry plus its canonical event log. */
function sessionJsonl(session: Session): string {
  const header: SessionHeader = session.header
  const headerLine = {
    type: 'session',
    version: header.version,
    id: header.id,
    createdAt: header.createdAt,
    cwd: header.cwd,
    delegationDepth: header.delegationDepth ?? 0,
    agentPreset: header.agentPreset,
  }
  return `${[headerLine, ...session.events].map(value => JSON.stringify(value)).join('\n')}\n`
}

/** Normalize volatile ids, times, and the temporary workspace path. */
function normalizedSession(session: Session): string {
  return normalizeSessionLog(sessionJsonl(session), {
    sessionIds: [session.id],
    cwd: session.header.cwd ?? root,
  })
}

beforeAll(async () => {
  for (const name of managedEnvironment) previousEnvironment.set(name, process.env[name])
  process.env.DASHSCOPE_API_KEY = 'dashscope-keyless-fixture'
  Reflect.deleteProperty(process.env, 'DSH_HK_FENG_SHUI_STT_URL')
  root = await mkdtemp(join(tmpdir(), 'dsh-feng-shui-preset-'))
  const settings = join(root, 'settings.yaml')
  await writeFile(settings, '{}\n')
  ctx = await bootWebPresetHarness(settings, [
    { id: 'session-persistence-jsonl', config: { root: join(root, 'sessions'), compression: 'none' } },
    { insert: [{ id: 'feng-shui-mock-llm', name: mockAdapter }] },
  ])
}, 120_000)

afterAll(async () => {
  try {
    await ctx?.fiber.dispose()
  } finally {
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) Reflect.deleteProperty(process.env, name)
      else process.env[name] = value
    }
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})

describe('shipped Hong Kong feng shui preset transcript', () => {
  it('pins the virtual persona, Cantonese model request, and authorized synthesis profile', async () => {
    const sessionId = SessionId('snapshot-hk-feng-shui-session')
    const handle = await ctx.agents.create({
      sessionId,
      meta: { cwd: root, agentPreset: 'hk-feng-shui' },
      agentOptions: { provider: 'feng-shui-mock', model: 'feng-shui-mock' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'hk-feng-shui').then(() => undefined),
    })
    try {
      const selection = await ctx.commands.execute(
        handle.agent,
        '/response-language yue-Hant-HK',
        new AbortController().signal,
      )
      if (selection?.result.kind !== 'success') {
        throw new Error(`Hong Kong Cantonese fixture selection failed: ${JSON.stringify(selection?.result)}`)
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text: '想問客廳擺設。' }],
        source: { kind: 'user' },
      }))
      await handle.agent.whenIdle()

      const actual = normalizedSession(handle.agent.session)
      if (refreshing) {
        await mkdir(dirname(expectedPath), { recursive: true })
        await writeFile(expectedPath, actual)
      }
      expect(actual).toBe(await readFile(expectedPath, 'utf8'))
      expect(actual).toContain('"agentPreset":"hk-feng-shui"')
      expect(actual).toContain('你不是麥玲玲本人')
      expect(actual).toContain('經授權的 AI 合成音色')
      expect(actual).toContain('Reply in natural Hong Kong Cantonese')
      expect(actual).not.toContain('"tools"')
      expect(actual).not.toContain('dashscope-keyless-fixture')
      expect(actual).not.toContain('DASHSCOPE_API_KEY')
      const synthesisProfile = ctx.speechSynthesis.profile(handle.agent, 'hk-feng-shui')
      const synthesisProfileJson = `${JSON.stringify(synthesisProfile, null, 2)}\n`
      if (refreshing) await writeFile(expectedProfilePath, synthesisProfileJson)
      expect(synthesisProfileJson).toBe(await readFile(expectedProfilePath, 'utf8'))
      expect(synthesisProfile).toEqual({
        profile: 'hk-feng-shui',
        mediaType: 'audio/mpeg',
        maxInputChars: 4000,
        maxOutputBytes: 16777216,
      })

      const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
        dashScopeSseResponse())
      vi.stubGlobal('fetch', fetchMock)
      try {
        const output = await ctx.speechSynthesis.resolve(handle.agent, 'hk-feng-shui')
          .synthesize({ text: DASH_SCOPE_TEXT }, new AbortController().signal)
        const audio: number[] = []
        for await (const chunk of output.chunks) audio.push(...chunk)
        expect(Uint8Array.from(audio)).toEqual(DASH_SCOPE_AUDIO)
        expect(output.metadata).toEqual({ mediaType: 'audio/mpeg', sampleRateHz: 22050 })

        const [endpoint, init] = fetchMock.mock.calls[0] ?? []
        const endpointUrl = endpoint instanceof Request
          ? endpoint.url
          : endpoint instanceof URL ? endpoint.href : endpoint
        expect(endpointUrl).toBe(
          'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
        )
        expect(init?.method).toBe('POST')
        expect(init?.redirect).toBe('error')
        const headers = new Headers(init?.headers)
        expect(headers.get('authorization')).toBe('Bearer dashscope-keyless-fixture')
        expect(headers.get('accept')).toBe('text/event-stream')
        expect(headers.get('x-dashscope-sse')).toBe('enable')
        if (typeof init?.body !== 'string') throw new Error('DashScope request body must be JSON text')
        expect(JSON.parse(init.body)).toEqual({
          model: 'qwen-audio-3.0-tts-flash',
          input: {
            text: DASH_SCOPE_TEXT,
            voice: 'qwen-audio-3.0-tts-flash-yishuiyue-e46ca9514e714a479eeb17e5fbfbfab7',
            format: 'mp3',
            sample_rate: 22050,
            instruction: '以自然、親切的香港粵語語氣朗讀；咬字清楚，節奏同停頓自然。',
            enable_aigc_tag: true,
          },
        })
      } finally {
        vi.unstubAllGlobals()
      }
    } finally {
      await handle.dispose()
    }
  })
})
