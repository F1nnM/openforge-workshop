/**
 * The derivation lock: `PIPELINE_VERSION`'s docblock turned into a test.
 *
 * ## What it locks, and why that is the right pair of fields
 *
 * `pipeline/version.ts` states a rule three rows have now decided by argument:
 * `SCHEMA_VERSION` moves when the record *shape* moves, `PIPELINE_VERSION` when
 * a field's *derivation* moves, and neither moves for a *check* — A1's
 * aggregation invariant and C1's config-ref assertion each added one and
 * deliberately bumped nothing, on the grounds that an assertion emits no byte.
 *
 * That claim is checkable, and until this row nothing checked it. The lock
 * records the sha256 of `{tags, records}` — everything the pipeline derives —
 * next to the `(schema, pipeline)` pair that produced it, and {@link checkLock}
 * asserts the **biconditional**: the digest moves if and only if the pair does.
 * Both directions have a distinct failure, because they are distinct mistakes.
 *
 * ## What makes the digest a function of the derivation and nothing else
 *
 * Three inputs are pinned away, in the same way `pipeline/catalog.test.ts`
 * already pins them for its byte-identity test:
 *
 *   - **the clock** — built at `PAYLOAD_TIMESTAMP`, and `built` is outside the
 *     digest anyway since only `{tags, records}` are hashed;
 *   - **the ordinal manifest** — `emptyManifest()`, so the digest does not move
 *     when the checked-in manifest grows. Ordinal *assignment* is still inside
 *     the digest, because `assignOrdinals` is derivation; it is the manifest's
 *     current contents that are input;
 *   - **`version.fixtures`** — a literal, and the real corpus snapshot is
 *     recorded as a separate lock field instead, so a fixture bump is reported
 *     as a corpus change rather than misread as a derivation change.
 *
 * What is left is the derivation code, `src/catalog/schema.ts` and the corpus.
 *
 * ## Two digests, because a base URL is not a derivation
 *
 * `assets` and `sprite` are configuration this pipeline stamps into the file;
 * `ASSET_BASES` gained `lod` in W4 without any field's derivation changing. They
 * are locked separately so that changing one has to be re-locked deliberately —
 * a real check — without it demanding a version bump it does not deserve.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import type { CatalogFile } from '../../src/catalog'
import { SCHEMA_VERSION } from '../../src/catalog'
import type { FixtureRow } from '../../pipeline'
import { PIPELINE_VERSION, buildCatalog, emptyManifest } from '../../pipeline'
import { PAYLOAD_TIMESTAMP } from '../../pipeline/version'

const HERE = dirname(fileURLToPath(import.meta.url))

export const REPO_ROOT = join(HERE, '..', '..')

export const LOCK_PATH = join(HERE, 'derivation.lock.json')

/** The corpus pin CI clones. The lock's `fixtures` must equal this. */
export const FIXTURES_ENV_PATH = join(REPO_ROOT, '.github', 'fixtures.env')

/** `version.fixtures` used for the lock build, so the real ref cannot reach the digest. */
export const LOCK_FIXTURES_REF = 'derivation-lock'

export const DerivationLock = z.object({
  note: z.string().min(1),
  /** `OPENFORGE_CATALOG_SHA` the digests were taken over. */
  fixtures: z.string().min(1),
  /** `SCHEMA_VERSION` at the time of locking. */
  schema: z.number().int().nonnegative(),
  /** `PIPELINE_VERSION` at the time of locking. */
  pipeline: z.number().int().nonnegative(),
  /** Records and interned tags the digest covers, for a legible failure. */
  records: z.number().int().nonnegative(),
  tags: z.number().int().nonnegative(),
  /** sha256 of `{tags, records}`. Governed by the two versions above. */
  content: z.string().length(64),
  /** sha256 of `{assets, sprite}`. Governed by nothing; re-locked deliberately. */
  config: z.string().length(64),
})
export type DerivationLock = z.infer<typeof DerivationLock>

export interface DerivationDigests {
  content: string
  config: string
  records: number
  tags: number
}

/** The two digests over a built file. */
export function derivationDigests(file: CatalogFile): DerivationDigests {
  return {
    content: sha256(JSON.stringify({ tags: file.tags, records: file.records })),
    config: sha256(JSON.stringify({ assets: file.assets, sprite: file.sprite })),
    records: file.records.length,
    tags: file.tags.length,
  }
}

/**
 * The pinned build the digests are taken over.
 *
 * Deliberately not the file the CLI writes: that one carries the real ordinal
 * manifest and the real fixtures ref, both of which are input.
 */
export function lockedBuild(rows: readonly FixtureRow[]): CatalogFile {
  return buildCatalog({
    rows,
    manifest: emptyManifest(),
    fixturesRef: LOCK_FIXTURES_REF,
    builtAt: PAYLOAD_TIMESTAMP,
  }).file
}

export function readLock(path: string = LOCK_PATH): DerivationLock {
  if (!existsSync(path)) throw new Error(`no derivation lock at ${path}`)
  return DerivationLock.parse(JSON.parse(readFileSync(path, 'utf8')))
}

export function writeLock(lock: DerivationLock, path: string = LOCK_PATH): void {
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`)
}

/** `OPENFORGE_CATALOG_SHA` from `.github/fixtures.env`. */
export function pinnedFixturesRef(path: string = FIXTURES_ENV_PATH): string {
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('OPENFORGE_CATALOG_SHA=')) continue
    const value = trimmed.slice('OPENFORGE_CATALOG_SHA='.length).trim()
    if (value) return value
  }
  throw new Error(`no OPENFORGE_CATALOG_SHA in ${path}`)
}

export interface LockCheck {
  /** No violation. */
  ok: boolean
  violations: string[]
  /** What the current tree actually produces, for the re-lock. */
  digests: DerivationDigests
  schema: number
  pipeline: number
}

const RELOCK = 'Re-lock with `npx tsx tools/stamp/cli.ts --relock` and commit tools/stamp/derivation.lock.json.'

/**
 * The biconditional, checked in the one order that reads correctly.
 *
 * The corpus is checked **first**. A fixture bump changes the digest without any
 * derivation changing, so checking the digest first would report it as "a
 * derivation changed and nothing announced it" — the right complaint about the
 * wrong event.
 */
export function checkLock(lock: DerivationLock, file: CatalogFile, fixturesRef: string): LockCheck {
  const digests = derivationDigests(file)
  const violations: string[] = []

  const versionsMoved = lock.schema !== SCHEMA_VERSION || lock.pipeline !== PIPELINE_VERSION
  const versionsNow = `schema ${String(SCHEMA_VERSION)} · pipeline ${String(PIPELINE_VERSION)}`
  const versionsLocked = `schema ${String(lock.schema)} · pipeline ${String(lock.pipeline)}`

  if (lock.fixtures !== fixturesRef) {
    violations.push(
      `the corpus moved: the lock was taken over ${lock.fixtures.slice(0, 12)} and this build read ` +
        `${fixturesRef.slice(0, 12)}. The digests are not comparable across snapshots. ${RELOCK}`,
    )
    return { ok: violations.length === 0, violations, digests, schema: SCHEMA_VERSION, pipeline: PIPELINE_VERSION }
  }

  const contentMoved = lock.content !== digests.content

  if (contentMoved && !versionsMoved) {
    violations.push(
      `a derivation changed and nothing announced it. The emitted {tags, records} hash to ` +
        `${digests.content.slice(0, 16)} and the lock says ${lock.content.slice(0, 16)}, with ` +
        `${versionsNow} unchanged (${String(lock.records)} records and ${String(lock.tags)} tags locked, ` +
        `${String(digests.records)} and ${String(digests.tags)} now). If a field's meaning moved, bump ` +
        'PIPELINE_VERSION; if the record shape moved, bump SCHEMA_VERSION. ' +
        `If neither is true, the change is not a derivation and this digest should not have moved. ${RELOCK}`,
    )
  }

  if (!contentMoved && versionsMoved) {
    violations.push(
      `a check is not a derivation. ${versionsLocked} moved to ${versionsNow}, and the emitted ` +
        '{tags, records} are byte-identical: no consumer can observe the difference this bump ' +
        'announces, and PIPELINE_VERSION is what a consumer memoises its derived layers on. ' +
        'Rows A1 and C1 each declined to bump for exactly this reason. ' +
        `If the bump is deliberate anyway, say why in pipeline/version.ts and ${RELOCK.toLowerCase()}`,
    )
  }

  if (contentMoved && versionsMoved) {
    violations.push(
      `the derivation changed and was announced, but the lock still holds the old digest ` +
        `(${lock.content.slice(0, 16)} to ${digests.content.slice(0, 16)}). ${RELOCK}`,
    )
  }

  if (lock.config !== digests.config) {
    violations.push(
      `assets or the sprite sheet changed (${lock.config.slice(0, 16)} to ${digests.config.slice(0, 16)}). ` +
        'This is configuration, not a derivation, so it demands no version bump — but it does have ' +
        `to be a deliberate change rather than a surprise. ${RELOCK}`,
    )
  }

  return { ok: violations.length === 0, violations, digests, schema: SCHEMA_VERSION, pipeline: PIPELINE_VERSION }
}

/** The lock the current tree would produce. */
export function lockFor(digests: DerivationDigests, fixturesRef: string): DerivationLock {
  return {
    note:
      'Row X4. The emitted {tags, records} change if and only if (schema, pipeline) change; ' +
      'see tools/stamp/lock.ts and pipeline/version.ts. Regenerate with ' +
      '`npx tsx tools/stamp/cli.ts --relock`.',
    fixtures: fixturesRef,
    schema: SCHEMA_VERSION,
    pipeline: PIPELINE_VERSION,
    records: digests.records,
    tags: digests.tags,
    content: digests.content,
    config: digests.config,
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
