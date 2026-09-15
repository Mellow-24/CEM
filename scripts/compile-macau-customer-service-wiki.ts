/** Repository convenience wrapper for the published Wiki operator CLI. */

import { runWikiCli } from '../packages/preset/customer-service-wiki/src/cli.ts'

process.exitCode = await runWikiCli(['compile', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => { process.stdout.write(text) },
  stderr: (text) => { process.stderr.write(text) },
})
