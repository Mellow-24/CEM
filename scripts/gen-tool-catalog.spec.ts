import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertManifestComplete, type ToolPackage } from './gen-tool-catalog.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Create one temporary repository-shaped package source. */
async function sourcePackage(group: string, dir: string, source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tool-catalog-'))
  roots.push(root)
  const sourceDir = join(root, 'packages', group, dir, 'src')
  await mkdir(sourceDir, { recursive: true })
  await writeFile(join(sourceDir, 'index.ts'), source)
  return root
}

/** Minimal manifest recipe for completeness-only tests. */
function recipe(dir: string): ToolPackage {
  return {
    pkg: `@deepseek-ai/dsh-${dir}`,
    dir,
    source: `packages/test/${dir}/src/index.ts`,
    requires: [],
    writes: [],
    mount: () => Promise.resolve(),
  }
}

describe('tool-catalog manifest completeness', () => {
  it('finds a tool registrant outside the tool-* naming convention', async () => {
    const root = await sourcePackage(
      'preset',
      'customer-tools',
      'export function apply(ctx: any) { ctx.tools.register({ name: "customer" }) }\n',
    )

    expect(() => { assertManifestComplete([], root, []) })
      .toThrow(/tool-registering package.*customer-tools/)
    expect(() => { assertManifestComplete([recipe('customer-tools')], root, []) })
      .not.toThrow()
  })

  it('requires runtime-schema registrants to carry an explicit reason', async () => {
    const root = await sourcePackage(
      'mcp',
      'dynamic-tools',
      'export function apply(childCtx: any) { childCtx.tools.register({ name: getName() }) }\n',
    )

    expect(() => { assertManifestComplete([], root, [{ dir: 'dynamic-tools', reason: '' }]) })
      .toThrow(/must state why/)
    expect(() => {
      assertManifestComplete([], root, [{ dir: 'dynamic-tools', reason: 'server-supplied schema' }])
    })
      .not.toThrow()
  })

  it('does not mistake prose containing a registration spelling for an AST call', async () => {
    const root = await sourcePackage(
      'preset',
      'registration-docs',
      'export const guidance = "call ctx.tools.register(...) only from a plugin"\n',
    )

    expect(() => { assertManifestComplete([], root, []) }).not.toThrow()
  })

  it('keeps conventional tool packages in the inventory even before they register', async () => {
    const root = await sourcePackage(
      'web',
      'tool-empty',
      'export const guidance = "call ctx.tools.register(...) only from a plugin"\n',
    )

    expect(() => { assertManifestComplete([], root, []) })
      .toThrow(/tool-registering package.*tool-empty/)
    expect(() => { assertManifestComplete([recipe('tool-empty')], root, []) })
      .not.toThrow()
  })

  it('rejects stale and overlapping runtime exclusions', async () => {
    const root = await sourcePackage(
      'preset',
      'fixed-tools',
      'export function apply(ctx: any) { ctx.tools.register({ name: "fixed" }) }\n',
    )

    expect(() => {
      assertManifestComplete([recipe('fixed-tools')], root, [
        { dir: 'fixed-tools', reason: 'not actually dynamic' },
      ])
    }).toThrow(/both catalogued and excluded/)
    expect(() => {
      assertManifestComplete([recipe('fixed-tools')], root, [
        { dir: 'gone-tools', reason: 'no longer present' },
      ])
    }).toThrow(/no longer register model tools/)
  })
})
