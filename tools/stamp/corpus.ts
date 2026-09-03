/**
 * The md5 join. This is the part of row X4 that detects the failure the row
 * exists for.
 *
 * ## Why a version stamp alone cannot detect md5 churn
 *
 * `CLAUDE.md`'s creator-workflow section is explicit that re-exporting a mesh is
 * normal: files move, get renamed and get re-exported mid-design, and md5 is how
 * the scanner copes. Every derived artefact in this project is content-addressed
 * on that md5 — `thumbs/{md5[0:6]}/{md5}.webp`, `lod/{md5[0:6]}/{md5}.glb`, and
 * the sidecar's keys. So a re-export does not corrupt anything; it makes the
 * derivative **unreachable**, silently, one tile at a time.
 *
 * The `VersionStamp` every artefact already carries cannot see that. `fixtures`
 * moves on any upstream commit, most of which change no md5 at all, and it moves
 * by exactly as much for one re-exported tile as for a thousand. It answers
 * "which index was this derived from", which is provenance, and not "is it still
 * valid", which is what a launch gate needs.
 *
 * ## So the join is per-blob, in three directions
 *
 * Each of the four file-backed artefacts has a function that already says which
 * blobs it *must* cover — `measureTargets`, `spriteTargets`, `meshTargets` — and
 * a manifest that says which it *does*. Comparing the two sets gives three
 * populations, and they are not the same failure:
 *
 *   - **missing** — must be covered, is not. Either the derivation moved the
 *     target set (W3 moved 742 tiles out of `none`) or a mesh was re-exported to
 *     a new md5. Work to do.
 *   - **orphaned** — covered, and the md5 is not in the index at all. This is the
 *     churn signature: a re-export leaves the old md5 orphaned and the new one
 *     missing, in the same diff, which is why the two counts are reported
 *     separately rather than netted off.
 *   - **stale** — covered, still a live md5, no longer needed. Harmless bytes,
 *     but the number that says a derivation narrowed.
 *
 * ## And one scalar, so "no drift" is a single comparison
 *
 * {@link corpusDigest} folds a blob set into one hash. Two artefacts with equal
 * digests cover exactly the same meshes; that is cheap to record in a stamp file
 * and cheap to compare across builds, where enumerating three set differences is
 * not.
 */
import { createHash } from 'node:crypto'

/**
 * Recipe tag. It is inside the hash, so a future change to how a blob set is
 * folded produces visibly different digests rather than silently comparable
 * ones.
 */
const DIGEST_RECIPE = 'openforge-corpus-1'

export interface CorpusDigest {
  /** Distinct md5 values folded in. */
  blobs: number
  /** sha256, hex. */
  digest: string
}

/**
 * Fold a blob set into one digest.
 *
 * Deduplicated and sorted first, so the digest is a property of the *set* and
 * not of the order a caller happened to iterate a manifest in. 8,353 of the
 * corpus's 8,702 records have a distinct md5 — 349 records share a mesh with
 * another — so a digest over a record list rather than a blob set would differ
 * from a digest over the objects it addresses.
 */
export function corpusDigest(blobs: Iterable<string>): CorpusDigest {
  const unique = [...new Set(blobs)].sort()
  const hash = createHash('sha256').update(DIGEST_RECIPE)
  for (const blob of unique) hash.update(`\n${blob}`)
  return { blobs: unique.length, digest: hash.digest('hex') }
}

export interface CorpusDrift {
  /** Blobs the artefact must cover, per the tool's own target function. */
  expected: number
  /** Blobs it does cover. */
  covered: number
  /** Expected, not covered. Ascending. */
  missing: string[]
  /** Covered, and no longer an md5 the index carries at all. Ascending. */
  orphaned: string[]
  /** Covered, still live, no longer expected. Ascending. */
  stale: string[]
}

/** True when all three populations are empty. */
export function isClean(drift: CorpusDrift): boolean {
  return drift.missing.length === 0 && drift.orphaned.length === 0 && drift.stale.length === 0
}

/**
 * The three-way difference.
 *
 * `live` is every md5 in the index, which is what separates *orphaned* from
 * *stale*: both are covered-but-not-expected, and only one of them means the
 * mesh is gone. Netting them together would report a re-export as "one extra
 * object", which is the reading that lets churn through.
 */
export function corpusDrift(
  expected: Iterable<string>,
  covered: Iterable<string>,
  live: ReadonlySet<string>,
): CorpusDrift {
  const want = new Set(expected)
  const have = new Set(covered)

  const missing: string[] = []
  for (const blob of want) if (!have.has(blob)) missing.push(blob)

  const orphaned: string[] = []
  const stale: string[] = []
  for (const blob of have) {
    if (!live.has(blob)) orphaned.push(blob)
    else if (!want.has(blob)) stale.push(blob)
  }

  return {
    expected: want.size,
    covered: have.size,
    missing: missing.sort(),
    orphaned: orphaned.sort(),
    stale: stale.sort(),
  }
}
