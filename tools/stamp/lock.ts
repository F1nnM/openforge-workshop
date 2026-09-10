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
 *     as a corpus change rather than misread as a derivation change;
 *   - **the thumbnail inventory** — row P3's `BuildOptions.thumbs`, left
 *     unpassed so it is the empty set. It is the one input here that lives
 *     outside this repository: `pipeline/thumbs/inventory.json` records what
 *     somebody else's R2 bucket contained the last time it was probed, so
 *     letting it reach the digest would make the lock move when a backfill runs
 *     and demand a `SCHEMA_VERSION` bump for an event no derivation took part
 *     in. `CatalogRecord.thumb` is therefore `false` on every record of the
 *     locked build, which is what makes the digest a statement about this tree.
 *   - **the mount inventory** — `BuildOptions.mounts`, passed as
 *     `emptyMountInventory()` on the same argument one artefact along.
 *     `pipeline/mounts/inventory.json` records what 16.34 GB of somebody else's
 *     meshes measured to the last time they were read, and a re-measurement is
 *     not a derivation this tree performs. `CatalogRecord.mounts` and
 *     `CatalogRecord.anchor` are therefore absent from every record of the
 *     locked build.
 *
 * What is left is the derivation code, `src/catalog/schema.ts` and the corpus.
 *
 * ## Two digests, because a base URL is not a derivation
 *
 * `assets` and `sprite` are configuration this pipeline stamps into the file;
 * `ASSET_BASES` gained `lod` in W4 without any field's derivation changing. They
 * are locked separately so that changing one has to be re-locked deliberately —
 * a real check — without it demanding a version bump it does not deserve.
 *
 * ## Every top-level key is classified, because the digest cannot be total
 *
 * Row X8 found the hole in this file while deciding where to put the 40 recipe
 * templates: `derivationDigests` cannot see a **new** top-level key at all.
 * Adding a 40-entry `templates` key to the locked build leaves *both digests
 * byte-identical* — X8 verified it, and `lock.test.ts` now keeps the same
 * experiment as an assertion. Had the templates gone into `catalog.json`, "a
 * derivation changed and nothing announced it" would never have fired.
 *
 * The answer is not a digest over the whole file, for three reasons:
 *
 *   - **It cannot be over the whole file.** `version.built` is a clock and moves
 *     on every build, so `version` has to be out; "the whole file" is therefore
 *     always "the whole file minus an exemption list", which is exactly the
 *     partition below with the classification left implicit instead of written
 *     down.
 *   - **A total digest classifies every future key as a derivation, and that
 *     default is wrong for configuration.** `assets` and `sprite` are hashed
 *     apart because W4 added `ASSET_BASES.lod` with no field's derivation
 *     changing; under one digest over everything-but-`version` that would have
 *     reported "a derivation changed and nothing announced it" and demanded a
 *     `PIPELINE_VERSION` bump no consumer could observe — the misattribution the
 *     split exists to prevent. A new key inherits the same wrong default.
 *   - **The digest's scope is quoted in three other modules.**
 *     `pipeline/version.ts`, `src/catalog/schema.ts` and `pipeline/thumbs.ts`
 *     each state the biconditional over `{tags, records}`. Widening it makes
 *     three docblocks false and forces a re-lock, to buy a coverage the
 *     classification gives without moving a byte.
 *
 * So {@link DIGEST_SLOTS} maps **every** key of `CatalogFile` to the digest it
 * lives in, and both digests are projected *from that map* rather than from a
 * literal — the map cannot claim a coverage the hash does not have. It is
 * `satisfies Record<keyof CatalogFile, DigestSlot>`, so a key added to
 * `CatalogFile` is a **compile error in this file** naming the key, and
 * {@link unclassifiedKeys} re-checks the map against the schema's own shape at
 * runtime, because `npx tsx tools/stamp/cli.ts` does not typecheck and the CI
 * step has to fail on its own.
 *
 * What this does **not** do is make the digest total. A key marked `exempt` is
 * trusted on the classifier's word; the guard makes the decision mandatory and
 * visible, not correct. It is top-level only, matching the digests' own
 * granularity — a new field *inside* `version` is still invisible to both, and
 * `stampDifference` in `artefacts.ts` would drop it too.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import type { CatalogFile } from '../../src/catalog'
import { CatalogFile as CatalogFileSchema, SCHEMA_VERSION } from '../../src/catalog'
import type { FixtureRow } from '../../pipeline'
import {
  PAYLOAD_TIMESTAMP,
  PIPELINE_VERSION,
  buildCatalog,
  emptyManifest,
  emptyMountInventory,
} from '../../pipeline'

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

/** Which of the two digests a top-level key of the emitted file belongs to. */
export type DigestSlot = 'content' | 'config' | 'exempt'

/**
 * Every top-level key of `CatalogFile`, and the digest that covers it.
 *
 * The `satisfies` is the guard, not documentation: a key added to `CatalogFile`
 * with no slot here fails `npm run typecheck` in this file and names the key,
 * and a slot for a key the schema no longer declares fails the same way.
 *
 * Declaration order is the digest's byte order — `{tags, records}` and
 * `{assets, sprite}`, the two literals X4 locked, which is why this refactor
 * moved neither digest. Reordering it re-hashes both; `lock.test.ts` pins the
 * projection against those literals so a reorder fails saying so, rather than
 * surfacing as a phantom derivation change.
 */
export const DIGEST_SLOTS = {
  /**
   * `built` is a clock, `fixtures` is a literal in the locked build, `manifest`
   * comes from `emptyManifest()`, and `schema`/`pipeline` are the lock's own
   * two fields. All five are either an input to the digest or a statement
   * *about* it, so none of them can be inside it. See the module note.
   */
  version: 'exempt',
  assets: 'config',
  sprite: 'config',
  tags: 'content',
  records: 'content',
} as const satisfies Record<keyof CatalogFile, DigestSlot>

/** The keys in one slot, in {@link DIGEST_SLOTS} order. */
export function keysIn(slot: DigestSlot): (keyof CatalogFile)[] {
  const keys = Object.keys(DIGEST_SLOTS) as (keyof CatalogFile)[]
  return keys.filter((key) => DIGEST_SLOTS[key] === slot)
}

/**
 * Top-level keys `CatalogFile` declares that {@link DIGEST_SLOTS} does not
 * classify — the runtime half of the `satisfies` above.
 *
 * `declared` is a parameter so that the failure is provable without editing the
 * schema: `lock.test.ts` passes the schema's real keys plus X8's `templates` and
 * asserts both this function and {@link checkLock} complain.
 */
export function unclassifiedKeys(declared: readonly string[] = Object.keys(CatalogFileSchema.shape)): string[] {
  return declared.filter((key) => !(key in DIGEST_SLOTS))
}

export interface DerivationDigests {
  content: string
  config: string
  records: number
  tags: number
}

/** The two digests over a built file, projected from {@link DIGEST_SLOTS}. */
export function derivationDigests(file: CatalogFile): DerivationDigests {
  return {
    content: sha256(project(file, 'content')),
    config: sha256(project(file, 'config')),
    records: file.records.length,
    tags: file.tags.length,
  }
}

/** One slot's keys, as the JSON string its digest is taken over. */
function project(file: CatalogFile, slot: DigestSlot): string {
  const subject: Record<string, unknown> = {}
  for (const key of keysIn(slot)) subject[key] = file[key]
  return JSON.stringify(subject)
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
    // Deliberately not `thumbBlobs(readThumbInventory())`. See the module note:
    // the bucket's contents are input, and a backfill is not a derivation.
    thumbs: new Set(),
    // The same argument, one artefact along: 16.34 GB of somebody else's meshes
    // is an input, and measuring them is not a derivation this tree performs.
    mounts: emptyMountInventory(),
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
export function checkLock(
  lock: DerivationLock,
  file: CatalogFile,
  fixturesRef: string,
  declared: readonly string[] = Object.keys(CatalogFileSchema.shape),
): LockCheck {
  const digests = derivationDigests(file)
  const violations: string[] = []

  // First, and before the corpus: this is a statement about the tree rather
  // than about the snapshot, and an unclassified key is the one fault that
  // makes every comparison below silently narrower than it reads.
  const unclassified = unclassifiedKeys(declared)
  if (unclassified.length > 0) {
    violations.push(
      `the emitted file has a top-level key no digest covers: ${unclassified.join(', ')}. ` +
        'Neither hash reads it, so its arrival — with however much content inside it — leaves both ' +
        'digests byte-identical and this gate reports the build as clean; row X8 measured exactly that ' +
        'with a 40-entry `templates` key. Give it a slot in DIGEST_SLOTS in tools/stamp/lock.ts: ' +
        "'content' if the pipeline derives it from the corpus, so a change to it has to be announced " +
        "by a version bump; 'config' if it is stamped-in configuration no derivation produced; " +
        `'exempt' only if it is an input or a clock, as version's five fields are. ${RELOCK}`,
    )
  }

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
