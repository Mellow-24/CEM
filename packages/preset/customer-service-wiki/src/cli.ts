/** Operator CLI for compiling, linting, and publishing a customer-service Wiki. */

import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { WikiCompiler } from './wiki.ts'
import type { WikiCompilerConfig } from './wiki.ts'

/** Stable help text for the published `dsh-customer-service-wiki` executable. */
export const WIKI_CLI_USAGE = `Usage: dsh-customer-service-wiki <compile|lint|publish> [options]

Options:
  --root <path>     Operator knowledge root (default: knowledge/macau-customer-service-wiki)
  --force           Recompile matching pages as drafts (compile only)
  --source-only     Create navigation-only drafts without an LLM request (compile only)
  --help, -h        Show this help

Paths and compiler settings accept DSH_MACAU_WIKI_* environment overrides.
`

/** Injectable process dependencies for deterministic CLI tests. */
export interface WikiCliOptions {
  readonly cwd: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
}

function positiveInteger(env: WikiCliOptions['env'], name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`)
  return value
}

function compilerConfig(root: string, options: WikiCliOptions): WikiCompilerConfig {
  const env = options.env
  return {
    sourceDirectory: env['DSH_MACAU_WIKI_SOURCE_DIR'] ?? resolve(root, 'sources'),
    draftDirectory: env['DSH_MACAU_WIKI_DRAFT_DIRECTORY'] ?? resolve(root, 'wiki'),
    releaseDirectory: env['DSH_MACAU_WIKI_RELEASE_DIRECTORY'] ?? resolve(root, 'release'),
    baselinePath: env['DSH_MACAU_WIKI_BASELINE'] ?? resolve(root, 'baseline-qa.md'),
    rulesPath: env['DSH_MACAU_WIKI_RULES'] ?? resolve(root, 'rules.md'),
    sourceManifestPath: env['DSH_MACAU_WIKI_MANIFEST'] ?? resolve(root, 'source-manifest.json'),
    knowledgeMapPath: env['DSH_MACAU_WIKI_MAP'] ?? resolve(root, 'knowledge-map.md'),
    schemaPath: env['DSH_MACAU_WIKI_SCHEMA'] ?? resolve(root, 'schema.md'),
    compilerBaseURL: env['DSH_MACAU_WIKI_COMPILER_BASE_URL'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    compilerModel: env['DSH_MACAU_WIKI_COMPILER_MODEL'] ?? 'qwen3.7-plus',
    ...env['DASHSCOPE_API_KEY'] === undefined ? {} : { compilerApiKey: env['DASHSCOPE_API_KEY'] },
    compilerMaxSourceChars: positiveInteger(env, 'DSH_MACAU_WIKI_COMPILER_MAX_SOURCE_CHARS', 4_000),
    compilerMaxOutputTokens: positiveInteger(env, 'DSH_MACAU_WIKI_COMPILER_MAX_OUTPUT_TOKENS', 2_048),
    compilerMaxResponseChars: positiveInteger(env, 'DSH_MACAU_WIKI_COMPILER_MAX_RESPONSE_CHARS', 16_384),
    compilerMaxRequestChars: positiveInteger(env, 'DSH_MACAU_WIKI_COMPILER_MAX_REQUEST_CHARS', 20_000),
    operatorContextMaxChars: positiveInteger(env, 'DSH_MACAU_WIKI_OPERATOR_CONTEXT_MAX_CHARS', 8_000),
    crossSourceMaxPageChars: positiveInteger(env, 'DSH_MACAU_WIKI_CROSS_SOURCE_MAX_PAGE_CHARS', 6_000),
    crossSourcePageId: env['DSH_MACAU_WIKI_CROSS_SOURCE_PAGE_ID'] ?? 'company-knowledge-overview',
    requestTimeoutMs: positiveInteger(env, 'DSH_MACAU_WIKI_REQUEST_TIMEOUT_MS', 30_000),
  }
}

/**
 * Run one operator command without terminating the process.
 * @param args - command-line arguments after the executable name.
 * @param options - process environment and output sinks.
 * @returns process exit code; diagnostics are written to `stderr`.
 */
export async function runWikiCli(args: readonly string[], options: WikiCliOptions): Promise<number> {
  try {
    const parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        root: { type: 'string' },
        force: { type: 'boolean', default: false },
        'source-only': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    })
    if (parsed.values.help) {
      options.stdout(WIKI_CLI_USAGE)
      return 0
    }
    const command = parsed.positionals[0]
    if (parsed.positionals.length !== 1 || (command !== 'compile' && command !== 'lint' && command !== 'publish')) {
      throw new Error('expected exactly one command: compile, lint, or publish')
    }
    if (command !== 'compile' && (parsed.values.force || parsed.values['source-only'])) {
      throw new Error('--force and --source-only are valid only with compile')
    }
    const defaultRoot = resolve(options.env['DSH_CWD'] ?? options.cwd, 'knowledge/macau-customer-service-wiki')
    const root = resolve(options.cwd, parsed.values.root ?? defaultRoot)
    const wiki = new WikiCompiler(compilerConfig(root, options), (message) => { options.stderr(`${message}\n`) })
    if (command === 'compile') {
      const result = await wiki.compile(undefined, parsed.values.force, parsed.values['source-only'])
      options.stdout(`${JSON.stringify(result)}\n`)
      const lint = await wiki.lint()
      options.stdout(`${JSON.stringify(lint)}\n`)
      /* v8 ignore next -- compile rejects invalid existing drafts and writes a lint-clean planned set; external races remain fail-closed */
      return lint.errors.length === 0 ? 0 : 1
    }
    if (command === 'lint') {
      const lint = await wiki.lint()
      options.stdout(`${JSON.stringify(lint)}\n`)
      return lint.errors.length === 0 ? 0 : 1
    }
    const result = await wiki.publish()
    options.stdout(`${JSON.stringify(result)}\n`)
    return 0
  } catch (error: unknown) {
    /* v8 ignore next -- parseArgs, WikiCompiler, and Node filesystem APIs throw Error instances */
    options.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${WIKI_CLI_USAGE}`)
    return 1
  }
}
