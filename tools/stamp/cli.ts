#!/usr/bin/env tsx
/**
 * The version stamp, in one command.
 *
 *     npx tsx tools/stamp/cli.ts                     # regenerate, check, write
 *     npx tsx tools/stamp/cli.ts --dry-run           # check, write nothing
 *     npx tsx tools/stamp/cli.ts --require thumbs,lod
 *     npx tsx tools/stamp/cli.ts --relock            # re-take the derivation lock
 *     npx tsx tools/stamp/cli.ts --worklist tools/stamp/out/worklist.json
 *
 * This is the CI step. It replaces `npm run import:catalog` there — it does the
 * same build and writes the same two files — and adds the four checks the row is
 * for. Exit code 1 on any failure, with every failure printed.
 *
 * `--relock` is the maintenance path and the only writer of
 * `derivation.lock.json`. Run it when a derivation change is deliberate and the
 * version bump that announces it is in place, or after a fixture bump; the
 * failure messages say which.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { fixturesDir, loadFixtureRows, resolveFixturesRef } from '../../pipeline'

import type { Args } from './args'
import { USAGE, parseArgs } from './args'
import { LOCK_PATH, derivationDigests, lockFor, lockedBuild, readLock, writeLock } from './lock'
import { formatReport, markdownSummary, serialiseStamp, serialiseWorklist } from './report'
import { runStamp } from './run'

function relock(fixtures: string | undefined): number {
  const dir = fixturesDir(fixtures)
  const ref = resolveFixturesRef(dir)
  const before = safeLock()
  const digests = derivationDigests(lockedBuild(loadFixtureRows(dir)))
  const lock = lockFor(digests, ref)
  writeLock(lock)

  const lines = [
    `fixtures      ${ref}`,
    `versions      schema ${String(lock.schema)} · pipeline ${String(lock.pipeline)}`,
    `content       ${before?.content === lock.content ? 'unchanged' : `${String(before?.content.slice(0, 16) ?? 'none')} to ${lock.content.slice(0, 16)}`}`,
    `config        ${before?.config === lock.config ? 'unchanged' : `${String(before?.config.slice(0, 16) ?? 'none')} to ${lock.config.slice(0, 16)}`}`,
    `records       ${String(lock.records)} over ${String(lock.tags)} interned tags`,
    `output        ${LOCK_PATH}`,
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
  return 0
}

function safeLock(): ReturnType<typeof readLock> | undefined {
  try {
    return readLock()
  } catch {
    return undefined
  }
}

function main(): number {
  let args: Args | 'help'
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }

  if (args === 'help') {
    process.stdout.write(USAGE)
    return 0
  }

  if (args.relock) return relock(args.fixtures)

  const run = runStamp({
    write: !args.dryRun,
    require: args.require,
    ...(args.fixtures === undefined ? {} : { fixtures: args.fixtures }),
    ...(args.sidecar === undefined ? {} : { sidecar: args.sidecar }),
    ...(args.thumbs === undefined ? {} : { thumbs: args.thumbs }),
    ...(args.lod === undefined ? {} : { lod: args.lod }),
  })

  process.stdout.write(formatReport(run.report))

  if (!args.dryRun) {
    write(args.stamp, serialiseStamp(run.report))
    if (args.worklist !== undefined) {
      write(args.worklist, serialiseWorklist(run.report, run.report.corpus))
    }
  }

  if (args.summary !== undefined && args.summary !== '') {
    appendFileSync(args.summary, markdownSummary(run.report))
  }

  return run.report.failures.length === 0 ? 0 : 1
}

function write(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents)
}

process.exitCode = main()
