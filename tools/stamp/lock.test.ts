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
import { existsSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { SCHEMA_VERSION } from '../../src/catalog'
import type { CatalogFile } from '../../src/catalog'
import { PIPELINE_VERSION, fixturesDir, loadFixtureRows, resolveFixturesRef } from '../../pipeline'
import { blobOf, testCatalog } from '../measure/fixtures/catalog'

import type { DerivationLock } from './lock'
import { LOCK_FIXTURES_REF, checkLock, derivationDigests, lockFor, lockedBuild, pinnedFixturesRef, readLock } from './lock'

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
