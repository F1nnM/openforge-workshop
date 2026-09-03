/**
 * The md5 join, and the mutations that prove each branch of it can fail.
 *
 * The series has shipped two vacuous guards — S1's inertness test grepped for a
 * literal the new code did not contain, and the NUL guard listed only tracked
 * files, so a new offender passed locally and failed in CI. Both were vacuous in
 * the same way: nothing in the test could distinguish the passing world from the
 * broken one. So every case here states the mutation that makes it fail, and
 * asserts on a value derived from the input rather than on a literal.
 */
import { describe, expect, it } from 'vitest'

import { corpusDigest, corpusDrift, isClean } from './corpus'

const A = 'a'.repeat(32)
const B = 'b'.repeat(32)
const C = 'c'.repeat(32)

describe('corpusDigest', () => {
  it('is a property of the set, not of the iteration order', () => {
    // Fails if the fold stops sorting: a manifest read in key order and a target
    // list read in ordinal order would then never agree.
    expect(corpusDigest([A, B, C]).digest).toBe(corpusDigest([C, A, B]).digest)
  })

  it('dedupes, because 349 records share a mesh with another', () => {
    // Fails if the fold hashes a list rather than a set: the index has 8,702
    // records over 8,353 distinct md5, so a record-order digest could never be
    // compared with a manifest of objects.
    expect(corpusDigest([A, A, B])).toEqual(corpusDigest([A, B]))
    expect(corpusDigest([A, A, B]).blobs).toBe(2)
  })

  it('moves when one blob changes, which is the whole point', () => {
    // The re-export case, at its smallest. Fails if the digest is taken over
    // anything coarser than the md5 set — a count, a length, a version.
    const before = corpusDigest([A, B])
    const after = corpusDigest([A, C])
    expect(after.digest).not.toBe(before.digest)
    expect(after.blobs).toBe(before.blobs)
  })

  it('separates the empty set from a set holding the empty string', () => {
    // Fails if the fold joins without a separator or without its recipe tag.
    expect(corpusDigest([]).digest).not.toBe(corpusDigest(['']).digest)
  })
})

describe('corpusDrift', () => {
  it('reports nothing when coverage is exactly the target set', () => {
    const drift = corpusDrift([A, B], [A, B], new Set([A, B, C]))
    expect(drift).toMatchObject({ expected: 2, covered: 2, missing: [], orphaned: [], stale: [] })
    expect(isClean(drift)).toBe(true)
  })

  it('calls a re-export one missing and one orphaned, never one net change', () => {
    // The churn signature, and the reason the two populations are not netted
    // off. `B` was re-exported as `C`: the index now names C, the artefact still
    // holds B. Fails if either population is dropped or if they are subtracted.
    const drift = corpusDrift([A, C], [A, B], new Set([A, C]))
    expect(drift.missing).toEqual([C])
    expect(drift.orphaned).toEqual([B])
    expect(drift.stale).toEqual([])
    expect(isClean(drift)).toBe(false)
  })

  it('distinguishes an orphan from a blob that is merely no longer needed', () => {
    // `B` is still in the index and no longer a target — a derivation narrowed,
    // which is harmless. `C` is gone from the index — which is not. Fails if
    // `live` is ignored, which would report both as the same thing.
    const drift = corpusDrift([A], [A, B, C], new Set([A, B]))
    expect(drift.stale).toEqual([B])
    expect(drift.orphaned).toEqual([C])
  })

  it('reports missing blobs for a run that has not finished', () => {
    // The thumbnail set today: 56 of 8,352 staged, nothing wrong with any of
    // them. Fails if partial coverage is conflated with drift.
    const drift = corpusDrift([A, B, C], [A], new Set([A, B, C]))
    expect(drift.missing).toEqual([B, C])
    expect(drift.orphaned).toEqual([])
    expect(drift.stale).toEqual([])
  })

  it('sorts every population, so a report diff is reviewable', () => {
    const drift = corpusDrift([C, B, A], [], new Set([A, B, C]))
    expect(drift.missing).toEqual([...drift.missing].sort())
    expect(drift.missing).toEqual([A, B, C])
  })
})
