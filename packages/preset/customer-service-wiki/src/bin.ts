#!/usr/bin/env node
/** Published process wrapper for `dsh-customer-service-wiki`. */

import { runWikiCli } from './cli.ts'

/* v8 ignore start -- process glue delegates all behavior to runWikiCli */
process.exitCode = await runWikiCli(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (text) => { process.stdout.write(text) },
  stderr: (text) => { process.stderr.write(text) },
})
/* v8 ignore stop */
