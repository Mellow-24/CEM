/**
 * Reusable real-Loader Web composition for shipped agent-preset tests.
 *
 * The harness removes only host side effects unrelated to agent composition:
 * bound ports, frontend modules, telemetry export, and machine-owned storage.
 * Preset discovery, package resolution, registries, prompt assembly, and tools
 * stay on the product paths used by `dsh web`.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'

/** App-owned config root used in source and built test layouts. */
export const CONFIG_DIR = fileURLToPath(new URL('../config/', import.meta.url))
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const WEB_PATCH = join(REPO_ROOT, 'packages/bundle/web-app/cordis.patch.yml')
const INSTALL_ANCHOR = join(REPO_ROOT, 'apps/cli/package.json')
/** Example package anchor used by tests that add example-owned product providers. */
export const EXAMPLES_INSTALL_ANCHOR = join(REPO_ROOT, 'examples/package.json')

/**
 * Boot the shipped Web composition with deterministic local storage and no bound server.
 * @param settingsFile - isolated settings document for this runtime.
 * @param extra - patches applied after the standard hermetic test overrides.
 * @param extraInstallAnchor - optional package manifest whose dependencies join module fallback resolution.
 * @returns the fully booted product context.
 */
export async function bootWebPresetHarness(
  settingsFile: string,
  extra: PatchOptions[] = [],
  extraInstallAnchor?: string,
): Promise<Context> {
  const storageRoot = join(dirname(settingsFile), 'storages')
  const patches: PatchOptions[] = [
    ...loadOverlayPatches('dsh-test', BASE_PATCH),
    ...loadOverlayPatches('dsh-test', WEB_PATCH),
    // Pin machine-owned settings and storage so a developer's default preset or
    // persisted documents cannot decide a supposedly hermetic scenario.
    { id: 'settings', config: { path: settingsFile, watch: false } },
    { id: 'storage-json', config: { root: storageRoot } },
    // Port binding, frontend serving, and telemetry do not decide an agent's
    // capabilities. The API gateway remains enabled deliberately: its host-side
    // injections catch a service incorrectly moved behind a preset realm.
    { id: 'webserver', disabled: true },
    { id: 'web-runtime', disabled: true },
    { id: 'session-telemetry-otel', disabled: true },
    // A global skill contribution proves preset-scoped skill discovery still
    // merges deployment-level registrations.
    { id: 'skill-badge', disabled: false },
    { id: 'modules', disabled: true },
    { id: 'connection', disabled: true },
    // The browser speech routes require Connection and do not decide preset
    // provider registration, so the headless composition disables both rows.
    { id: 'speech-web', disabled: true },
    { id: 'client-hmr', disabled: true },
    // The automatic chooser waits for the disabled webserver; the browse
    // provider supplies the same host service without binding a port.
    { id: 'directory-picker', disabled: true },
    { insert: [
      { id: 'directory-picker-browse', name: '@deepseek-ai/dsh-host-directory-picker-browse' },
      { id: 'ui-directory-picker-browse', name: '@deepseek-ai/dsh-client-ui-directory-picker-browse' },
    ] },
    {
      // Only the shipped root: a developer's own roster must not affect tests.
      id: 'agent-presets',
      config: {
        default: 'standard',
        roots: [{ path: join(CONFIG_DIR, 'agent-presets'), trust: 'system' }],
        includeUserRoot: false,
      },
    },
    ...extra,
  ]
  const home = dirname(settingsFile)
  // The profile root is outside the workspace, so bare preset packages resolve
  // through the same installation fallback the product launcher maintains.
  healProfilesModuleFallback(INSTALL_ANCHOR, home)
  if (extraInstallAnchor !== undefined) healProfilesModuleFallback(extraInstallAnchor, home)
  const profileDir = join(home, 'profiles', 'spec')
  await mkdir(profileDir, { recursive: true })
  const rootConfig = join(profileDir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  return await boot('dsh-test', rootConfig, patches, (bootCtx) => {
    provideCmdline(bootCtx, { args: [], exit: () => {} })
  })
}

/** Model-visible tool names for the global layer or one agent scope. */
export const toolNames = (ctx: Context, agent?: Agent): string[] =>
  ctx.tools.schemas(agent).map(schema => schema.name).sort()
