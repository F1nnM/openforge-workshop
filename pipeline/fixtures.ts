/**
 * Reading the `openforge-catalog` blueprint fixtures, and recording where they came from.
 *
 * The fixtures directory holds `*.json` **and** `*.yaml` files. Only the JSON is
 * read, because that is what `docs/verify-catalog-facts.py` reads, and this
 * pipeline's counts are asserted against that script. Globbing `*` here would
 * silently change every number in the plan.
 *
 * Rows are validated with Zod rather than cast. The fixtures are an external
 * input maintained in another repository by a different process; a shape change
 * there should fail this build with the offending row's path, not surface three
 * layers later as `undefined` in a display name.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { z } from 'zod'

/**
 * Default fixtures location — the same literal `verify-catalog-facts.py` uses,
 * and overridable by `OPENFORGE_FIXTURES` exactly as the verify script's
 * positional argument is.
 */
export const DEFAULT_FIXTURES_DIR = '/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints'

/** Resolve the fixtures directory: explicit argument, then `OPENFORGE_FIXTURES`, then the default. */
export function fixturesDir(explicit?: string): string {
  return resolve(explicit ?? process.env.OPENFORGE_FIXTURES ?? DEFAULT_FIXTURES_DIR)
}

/* ------------------------------------------------------------------ row shape */

const TagRefIn = z.object({ tag: z.string().min(1) })
const FilterRefIn = z.object({ filter: z.string().min(1) })

/**
 * The composition grammar, carried through **unresolved**.
 *
 * architecture-plan.md §5 flags `constrain` semantics as the largest open
 * question in the plan — a join, not a filter, and the two readings differ by
 * two orders of magnitude in precomputed candidate-set size. This pipeline
 * therefore models the raw grammar faithfully and resolves nothing.
 */
const FixtureConfig = z.object({
  parts: z
    .array(
      z.object({
        name: z.string().min(1),
        id: z.string().min(1).optional(),
        optional: z.boolean().optional(),
        tags: z.object({
          require: z.array(TagRefIn).optional(),
          deny: z.array(TagRefIn).optional(),
          constrain: z.array(z.union([TagRefIn, FilterRefIn])).optional(),
        }),
      }),
    )
    .optional(),
  fulfills: z.array(z.object({ part: z.string().min(1) })).optional(),
})

const FixtureRow = z.object({
  /** Truthy on the 19 rows that never reach a `CatalogRecord`. */
  deprecated: z.unknown().optional(),
  tags: z.array(z.string().min(1)).default([]),
  config: FixtureConfig.optional(),
  file_metadata: z.object({
    file: z.string().min(1),
    full_name: z.string().min(1),
    md5: z.string().min(1),
    size: z.number().int().nonnegative(),
    storage_address: z.string().optional(),
  }),
  /** 8,701 live rows carry exactly one sprite sheet; one carries none. */
  images: z
    .array(z.object({ image_url: z.string().optional() }))
    .optional(),
})

export type FixtureRow = z.infer<typeof FixtureRow>
export type FixtureConfig = z.infer<typeof FixtureConfig>

/* -------------------------------------------------------------------- loading */

/** Every row in every `*.json` fixture, in the same order the verify script reads them. */
export function loadFixtureRows(dir: string): FixtureRow[] {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
  if (files.length === 0) throw new Error(`no *.json fixtures in ${dir}`)

  const rows: FixtureRow[] = []
  for (const name of files) {
    const parsed: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    if (!Array.isArray(parsed)) throw new Error(`${name}: expected an array of blueprint rows`)
    parsed.forEach((row, i) => {
      const result = FixtureRow.safeParse(row)
      if (!result.success) {
        throw new Error(`${name}[${String(i)}] does not match the fixture shape: ${result.error.message}`)
      }
      rows.push(result.data)
    })
  }
  return rows
}

/** Live rows only — `deprecated` truthy is excluded, matching the verify script. */
export function liveRows(rows: readonly FixtureRow[]): FixtureRow[] {
  return rows.filter((row) => !row.deprecated)
}

/* ----------------------------------------------------------------- provenance */

/**
 * The `version.fixtures` stamp: which snapshot of `openforge-catalog` this build read.
 *
 * §16 names import drift as risk 1 — three artefacts derive from one pinned
 * fixture snapshot and a mismatch has no symptom until a share link opens the
 * wrong room. So this always returns something identifying, in falling order of
 * precision:
 *
 *   1. `OPENFORGE_FIXTURES_COMMIT`, for a CI job that already knows the SHA.
 *   2. The commit of the git repository the fixtures live in, read straight out
 *      of `.git` — no subprocess, no `git` binary, nothing that can mutate a
 *      working tree.
 *   3. `content:<sha256 prefix>` over the fixture bytes, when the fixtures are
 *      not in a git checkout at all (a tarball in CI, say). Less precise, still
 *      a fingerprint that changes when the input changes.
 */
export function resolveFixturesRef(dir: string): string {
  const fromEnv = process.env.OPENFORGE_FIXTURES_COMMIT?.trim()
  if (fromEnv) return fromEnv

  const head = readGitHead(dir)
  if (head) return head

  return `content:${hashDirectory(dir).slice(0, 16)}`
}

/** Walk up from `dir` to the nearest git repository and read the commit `HEAD` points at. */
function readGitHead(dir: string): string | undefined {
  const gitDir = findGitDir(dir)
  if (!gitDir) return undefined

  const headPath = join(gitDir, 'HEAD')
  if (!existsSync(headPath)) return undefined
  const head = readFileSync(headPath, 'utf8').trim()

  if (!head.startsWith('ref:')) return /^[0-9a-f]{40}$/.test(head) ? head : undefined

  const ref = head.slice(4).trim()
  const loose = join(gitDir, ref)
  if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()

  const packed = join(gitDir, 'packed-refs')
  if (!existsSync(packed)) return undefined
  for (const line of readFileSync(packed, 'utf8').split('\n')) {
    const [sha, name] = line.split(' ')
    if (name === ref && sha) return sha
  }
  return undefined
}

/** The `.git` directory governing `from`, following the `gitdir:` pointer a worktree uses. */
function findGitDir(from: string): string | undefined {
  let current = resolve(from)
  for (;;) {
    const candidate = join(current, '.git')
    if (existsSync(candidate)) {
      if (statSync(candidate).isDirectory()) return candidate
      const pointer = readFileSync(candidate, 'utf8').trim()
      const match = /^gitdir:\s*(.+)$/.exec(pointer)
      return match?.[1] ? resolve(current, match[1]) : undefined
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** A stable fingerprint of every `*.json` fixture's bytes, for when there is no git checkout. */
function hashDirectory(dir: string): string {
  const hash = createHash('sha256')
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    hash.update(name)
    hash.update(readFileSync(join(dir, name)))
  }
  return hash.digest('hex')
}
