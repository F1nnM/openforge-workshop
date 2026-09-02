/**
 * The derivation lock, both directions, plus the two pins that must agree.
 *
 * `PIPELINE_VERSION`'s docblock has been decided three times by argument — W4
 * bumped `SCHEMA_VERSION` and not the pipeline, W5 bumped the schema again, A1
 * and C1 each declined to bump and wrote down why. This file is that reasoning
 * as a biconditional with two named failures, and every branch of it is proved
 * by mutating a real built file rather than by trusting the message.
 *
 * The mutations run over the synthetic fixture, not the corpus, so they run on
 * every machine and in CI. One corpus-gated test at the end checks the committed
 * lock against the real tree.
 */
import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { CatalogFile as CatalogFileSchema, SCHEMA_VERSION } from '../../src/catalog'
import type { CatalogFile } from '../../src/catalog'
import { PIPELINE_VERSION, fixturesDir, loadFixtureRows, resolveFixturesRef } from '../../pipeline'
import { blobOf, testCatalog } from '../measure/fixtures/catalog'

import type { DerivationLock } from './lock'
import {
  DIGEST_SLOTS,
  LOCK_FIXTURES_REF,
  checkLock,
  derivationDigests,
  keysIn,
  lockFor,
  lockedBuild,
  pinnedFixturesRef,
  readLock,
  unclassifiedKeys,
} from './lock'

/** The schema's own top-level key list, which the classification must exhaust. */
const DECLARED = Object.keys(CatalogFileSchema.shape)

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * The locked build plus a 40-entry `templates` key — row X8's experiment,
 * reproduced rather than quoted.
 *
 * A cast, because the whole point is that this key is not in the schema: an
 * excess-property error here would mean the situation could not arise, and it
 * can — X8 was one design decision away from putting the 40 templates in
 * `catalog.json`.
 */
function withTemplates(file: CatalogFile): CatalogFile {
  return {
    ...file,
    templates: Array.from({ length: 40 }, (_, at) => ({ id: `template-${String(at)}`, parts: [] })),
  } as CatalogFile
}

const FIXTURES_DIR = fixturesDir()
const hasFixtures = existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))

/** A two-record index, enough to have a `{tags, records}` digest and an `assets` digest. */
function fixture(): CatalogFile {
  return testCatalog([
    { id: 'tiles/test/a.stl', ord: 1, blob: blobOf('aa'), tags: ['texture|test', 'shape|floor'] },
    { id: 'tiles/test/b.stl', ord: 2, blob: blobOf('bb'), tags: ['texture|test'] },
  ])
}

/** The lock the fixture is consistent with. */
function lockOf(file: CatalogFile, overrides: Partial<DerivationLock> = {}): DerivationLock {
  return { ...lockFor(derivationDigests(file), LOCK_FIXTURES_REF), ...overrides }
}

describe('the two pins cannot diverge', () => {
  it('locks the fixture snapshot CI clones', () => {
    // No corpus needed, so this can never skip. Fails the moment
    // .github/fixtures.env is bumped without re-locking — which is correct: the
    // digest is not comparable across snapshots, and the bump procedure has to
    // include the re-lock or the whole gate goes quiet.
    expect(readLock().fixtures).toBe(pinnedFixturesRef())
  })

  it('records the version pair the tree currently declares', () => {
    // Fails if either version constant moves without `--relock`, which is the
    // same failure `checkLock` reports, asserted here without needing the corpus.
    const lock = readLock()
    expect(lock.schema).toBe(SCHEMA_VERSION)
    expect(lock.pipeline).toBe(PIPELINE_VERSION)
  })
})

describe('every top-level key is classified', () => {
  it('exhausts what CatalogFile declares, so nothing falls outside both digests', () => {
    // Fails the moment the schema gains a top-level key, which is the point: a
    // new key is invisible to both digests, so it has to be classified before it
    // can be emitted. `satisfies Record<keyof CatalogFile, DigestSlot>` fails
    // `npm run typecheck` on the same event; this is the runtime half, because
    // `npx tsx tools/stamp/cli.ts` does not typecheck and the CI step has to fail
    // on its own.
    expect(unclassifiedKeys()).toEqual([])
    expect([...keysIn('content'), ...keysIn('config'), ...keysIn('exempt')].sort()).toEqual([...DECLARED].sort())
    // And the classification is the one X4's two digests actually implement.
    expect(keysIn('content')).toEqual(['tags', 'records'])
    expect(keysIn('config')).toEqual(['assets', 'sprite'])
    expect(keysIn('exempt')).toEqual(['version'])
  })

  it('names an unclassified key instead of hashing around it', () => {
    expect(unclassifiedKeys([...DECLARED, 'templates'])).toEqual(['templates'])
  })

  it('fails the lock when a declared key has no slot, before anything else is compared', () => {
    // The mutation: the schema declares `templates` and DIGEST_SLOTS does not.
    // Injected rather than done by editing schema.ts, so the failure is provable
    // in this file; the live demonstration is in the row's report.
    const file = fixture()
    const check = checkLock(lockOf(file), file, LOCK_FIXTURES_REF, [...DECLARED, 'templates'])

    expect(check.ok).toBe(false)
    expect(check.violations.join('\n')).toContain('top-level key no digest covers: templates')
    // Reported even though the digests themselves are in perfect agreement —
    // which is exactly the state that made the gap invisible.
    expect(check.violations.join('\n')).not.toContain('a derivation changed and nothing announced it')
  })

  it('reports it ahead of a moved corpus, since it is a fault in the tree and not the snapshot', () => {
    const file = fixture()
    const check = checkLock(lockOf(file), file, 'some-other-commit', [...DECLARED, 'templates'])

    expect(check.violations).toHaveLength(2)
    expect(check.violations[0]).toContain('top-level key no digest covers')
    expect(check.violations[1]).toContain('the corpus moved')
  })

  it('records what the digests cannot see, which is why the classification is the guard', () => {
    // X8's measurement, kept as an assertion: a new top-level key moves neither
    // digest. This is not a bug being pinned — it is the digests' declared scope,
    // quoted by pipeline/version.ts, src/catalog/schema.ts and
    // pipeline/thumbs.ts — so the classification above is what makes a new key
    // impossible to add in silence. If someone later widens `content` to hash
    // the whole file, this fails and sends them to those three docblocks.
    const file = fixture()
    expect(derivationDigests(withTemplates(file))).toEqual(derivationDigests(file))
  })

  it('projects the two literals X4 locked, in that order', () => {
    // DIGEST_SLOTS is declaration-ordered and the digests are built from it, so
    // a reorder would silently re-hash both. It fails here with that reason
    // rather than as "a derivation changed and nothing announced it".
    const file = fixture()
    const digests = derivationDigests(file)
    expect(digests.content).toBe(sha256(JSON.stringify({ tags: file.tags, records: file.records })))
    expect(digests.config).toBe(sha256(JSON.stringify({ assets: file.assets, sprite: file.sprite })))
    expect(Object.keys(DIGEST_SLOTS)).toEqual(DECLARED)
  })
})

describe('checkLock', () => {
  it('holds when nothing moved', () => {
    const file = fixture()
    expect(checkLock(lockOf(file), file, LOCK_FIXTURES_REF).violations).toEqual([])
  })

  it('fails when a derivation changed and no version announced it', () => {
    // The mutation: one record's derived name changes, as a footprint tie-break
    // or a kind vocabulary change would change it, with both versions left alone.
    const file = fixture()
    const lock = lockOf(file)
    const moved: CatalogFile = {
      ...file,
      records: [{ ...file.records[0]!, name: 'Renamed By A Derivation' }, ...file.records.slice(1)],
    }

    const check = checkLock(lock, moved, LOCK_FIXTURES_REF)
    expect(check.ok).toBe(false)
    expect(check.violations.join('\n')).toContain('a derivation changed and nothing announced it')
    // Derived, not asserted from a literal: the message must carry the digest
    // this tree actually produces, or a reader cannot re-lock from it.
    expect(check.violations.join('\n')).toContain(check.digests.content.slice(0, 16))
  })

  it('fails when a version moved and the emitted records did not', () => {
    // The mutation: the lock says an older version pair, the file is identical.
    // This is A1's and C1's decision inverted — a bump announcing a check.
    const file = fixture()
    const check = checkLock(lockOf(file, { schema: SCHEMA_VERSION - 1 }), file, LOCK_FIXTURES_REF)

    expect(check.ok).toBe(false)
    expect(check.violations.join('\n')).toContain('a check is not a derivation')
    expect(check.violations.join('\n')).toContain('byte-identical')
  })

  it('fails when a deliberate derivation change was announced but not re-locked', () => {
    const file = fixture()
    const moved: CatalogFile = { ...file, records: file.records.slice(0, 1) }
    const check = checkLock(lockOf(file, { pipeline: PIPELINE_VERSION - 1 }), moved, LOCK_FIXTURES_REF)

    expect(check.ok).toBe(false)
    expect(check.violations.join('\n')).toContain('still holds the old digest')
  })

  it('attributes an asset-base change as configuration, demanding no version bump', () => {
    // The mutation: `ASSET_BASES` gains or changes a URL, as W4's `assets.lod`
    // did. It is a real change and it is not a derivation, so the message says
    // so — and it still has to be re-locked rather than slipping through.
    const file = fixture()
    const reconfigured: CatalogFile = {
      ...file,
      assets: { ...file.assets, lod: 'https://objects.example.test/lod-v2' },
    }
    const check = checkLock(lockOf(file), reconfigured, LOCK_FIXTURES_REF)

    expect(check.ok).toBe(false)
    const message = check.violations.join('\n')
    expect(message).toContain('assets or the sprite sheet changed')
    expect(message).toContain('demands no version bump')
    // And it is not misreported as a derivation change.
    expect(message).not.toContain('a derivation changed and nothing announced it')
  })

  it('reports a moved corpus as a moved corpus, and checks nothing else', () => {
    // Order matters: a fixture bump changes the digest with no derivation
    // change, so checking the digest first would blame the wrong event. Fails if
    // the corpus check is moved after the digest check.
    const file = fixture()
    const moved: CatalogFile = { ...file, records: file.records.slice(0, 1) }
    const check = checkLock(lockOf(file), moved, 'some-other-commit')

    expect(check.violations).toHaveLength(1)
    expect(check.violations[0]).toContain('the corpus moved')
  })
})

const title = hasFixtures ? 'the committed lock, against the real corpus' : `SKIPPED — no fixtures at ${FIXTURES_DIR}`
const describeCorpus = hasFixtures ? describe : describe.skip

describeCorpus(title, () => {
  it('holds, and the digests are reproducible', () => {
    const rows = loadFixtureRows(FIXTURES_DIR)
    const built = lockedBuild(rows)
    const check = checkLock(readLock(), built, resolveFixturesRef(FIXTURES_DIR))

    expect(check.violations).toEqual([])
    // A second build of the same input must produce the same digest, or the lock
    // would be a coin flip. `pipeline/catalog.test.ts` asserts byte-identity of
    // the serialised file; this asserts it of the hash the gate compares.
    expect(derivationDigests(lockedBuild(rows)).content).toBe(check.digests.content)
  }, 240_000)
})
