import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WIKI_CLI_USAGE, runWikiCli } from '../src/cli.ts'
import type { WikiCliOptions } from '../src/cli.ts'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function operatorRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-wiki-cli-'))
  temporaryDirectories.push(root)
  await mkdir(join(root, 'sources'))
  await mkdir(join(root, 'wiki'))
  await writeFile(join(root, 'schema.md'), 'schema')
  await writeFile(join(root, 'rules.md'), 'rules')
  await writeFile(join(root, 'baseline-qa.md'), 'baseline')
  return root
}

function invocation(cwd: string, env: Record<string, string | undefined> = {}): {
  readonly options: WikiCliOptions
  readonly stdout: string[]
  readonly stderr: string[]
} {
  const stdout: string[] = []
  const stderr: string[] = []
  return {
    stdout,
    stderr,
    options: { cwd, env, stdout: (text) => { stdout.push(text) }, stderr: (text) => { stderr.push(text) } },
  }
}

describe('dsh-customer-service-wiki CLI', () => {
  it('prints stable help and rejects invalid command forms', async () => {
    const root = await operatorRoot()
    const help = invocation(root)
    expect(await runWikiCli(['--help'], help.options)).toBe(0)
    expect(help.stdout).toEqual([WIKI_CLI_USAGE])

    for (const args of [[], ['unknown'], ['lint', '--force'], ['publish', '--source-only'], ['lint', 'extra'], ['--unknown']]) {
      const invalid = invocation(root)
      expect(await runWikiCli(args, invalid.options)).toBe(1)
      expect(invalid.stderr.join('')).toContain(WIKI_CLI_USAGE)
    }
  })

  it('compiles, lints, and publishes through the package CLI', async () => {
    const root = await operatorRoot()
    await writeFile(join(root, 'sources', 'hours.md'), 'Open Monday to Friday')
    const compiled = invocation(root, {
      DSH_MACAU_WIKI_COMPILER_MAX_SOURCE_CHARS: '100',
      DSH_MACAU_WIKI_QUERY_UNUSED: undefined,
    })
    expect(await runWikiCli(['compile', '--root', root, '--source-only', '--force'], compiled.options)).toBe(0)
    expect(compiled.stdout.join('')).toContain('sourcePagesDrafted')
    expect(compiled.stdout.join('')).toContain('draftPages')

    const linted = invocation(root)
    expect(await runWikiCli(['lint', '--root', root], linted.options)).toBe(0)
    expect(linted.stdout.join('')).toContain('"errors":[]')

    const earlyPublish = invocation(root)
    expect(await runWikiCli(['publish', '--root', root], earlyPublish.options)).toBe(1)
    expect(earlyPublish.stderr.join('')).toContain('no approved pages')

    const file = join(root, 'wiki', (await readdir(join(root, 'wiki'))).find(name => name.endsWith('.md')) ?? '')
    await writeFile(file, (await readFile(file, 'utf8')).replace('"status": "draft"', '"status": "approved"'))
    const published = invocation(root)
    expect(await runWikiCli(['publish', '--root', root], published.options)).toBe(0)
    expect(published.stdout.join('')).toContain('releaseId')
  })

  it('uses DSH_CWD and path overrides and diagnoses invalid numeric environment values', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-wiki-cli-cwd-'))
    temporaryDirectories.push(cwd)
    const root = join(cwd, 'knowledge', 'macau-customer-service-wiki')
    await mkdir(join(root, 'sources'), { recursive: true })
    await mkdir(join(root, 'wiki'))
    await writeFile(join(root, 'schema.md'), 'schema')
    await writeFile(join(root, 'rules.md'), 'rules')
    await writeFile(join(root, 'baseline-qa.md'), 'baseline')
    await writeFile(join(root, 'sources', 'a.md'), 'alpha')

    const defaulted = invocation('/unused', { DSH_CWD: cwd })
    expect(await runWikiCli(['compile', '--source-only'], defaulted.options)).toBe(0)

    const invalid = invocation(cwd, { DSH_MACAU_WIKI_REQUEST_TIMEOUT_MS: 'zero' })
    expect(await runWikiCli(['lint', '--root', root], invalid.options)).toBe(1)
    expect(invalid.stderr.join('')).toContain('must be a positive integer')

    await writeFile(join(root, 'wiki', 'broken.md'), 'broken')
    const lintFailure = invocation(cwd)
    expect(await runWikiCli(['lint', '--root', root], lintFailure.options)).toBe(1)
    expect(lintFailure.stdout.join('')).toContain('broken.md')
  })

  it('reports a structured-output retry through the CLI diagnostic sink', async () => {
    const root = await operatorRoot()
    await writeFile(join(root, 'sources', 'a.md'), 'alpha')
    let call = 0
    const fetch = vi.fn(async (_input: string | URL, _init?: RequestInit): Promise<Response> => {
      if (call++ === 0) return new Response('unsupported', { status: 400 })
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        title: 'A', language: 'en', summary: 'Summary', sections: [{ heading: 'Scope', content: 'Content' }], links: [],
      }) } }] })
    })
    vi.stubGlobal('fetch', fetch)
    const result = invocation(root, { DASHSCOPE_API_KEY: 'dashscope-secret' })
    expect(await runWikiCli(['compile', '--root', root], result.options)).toBe(0)
    expect(result.stderr.join('')).toContain('retrying plain JSON')
    expect(fetch.mock.calls[0]?.[0]).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions')
    expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get('authorization')).toBe('Bearer dashscope-secret')
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { model: string }
    expect(body.model).toBe('qwen3.7-plus')
  })
})
