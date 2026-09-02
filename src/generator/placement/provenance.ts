/**
 * What may be said about a generated base, and what may not — one wording each.
 *
 * This module has no imports, which is the point: every place a generated base
 * is described — a bill row, a canvas label, a ZIP entry, the notice inside the
 * pack — reaches these strings, and none of them pays for the pinned schemas,
 * the sweep tables, or the 11 KB Apache licence text that `pack.ts` carries.
 *
 * ## The claim the archive cannot support
 *
 * S4 measured that **the archive is not reproducible from the vendored
 * geometry**. The archived bases are ASCII STL exported by an older revision;
 * the whole connector space of the archived 1×1 was searched — 144 renders
 * through `bases-square.scad` plus 40 through the legacy `bases.scad` — and
 * matched its md5 zero times and its facet count zero times: 760 published
 * facets against 296 and 1,428. So S4 never passes an `expectedMd5`, S3's
 * `catalogued-match` is unreachable on this corpus, and the honest verdict for a
 * generated mesh is `self-addressed`, whose own sentence says why: the digest
 * *"identifies these bytes rather than vouching for them"*, because both sides
 * of it come from the same run.
 *
 * Two consequences this module exists to enforce:
 *
 *   1. **A generated base is never described as the archive's file**, even when
 *      its parameters resolve. {@link GENERATED_PROVENANCE} names the `.scad`
 *      source and the commit, and claims nothing about any published mesh.
 *   2. **An archived resolution is never described as a render.** It is Devon's
 *      published file — the one that has been printed — and
 *      {@link ARCHIVE_PROVENANCE} says so in those terms.
 *
 * The bill line for a generated base therefore carries **no archive
 * provenance**. It cites the geometry it came from, at the commit it came from,
 * and its own digest with the caveat attached. That is the whole of what is true.
 */

/**
 * The vendored geometry's upstream, pinned.
 *
 * A generated STL is a derivative of these `.scad` sources, so a bill row and a
 * download pack both have to be able to name them exactly. This is the **third**
 * copy of the commit in the repository — `scripts/refresh-scad.ts` and
 * `src/generator/scad.test.ts` hold the other two, and `src/generator/scad/**`
 * is not this row's to edit — so `placement.test.ts` reads the refresh script off
 * disk and asserts the SHA matches. A refresh that moves the pin and forgets
 * this file fails the suite.
 */
export const SCAD_UPSTREAM = {
  repo: 'MasterworkTools/openforge-bases',
  url: 'https://github.com/MasterworkTools/openforge-bases',
  commit: 'e6dbbffc40e937fd5e7ddf13562c021c15b98034',
  spdx: 'Apache-2.0',
  author: 'Devon Jones',
} as const

/** The pin, short, for a caption that has no room for forty hex characters. */
export const SCAD_PIN = `${SCAD_UPSTREAM.repo}@${SCAD_UPSTREAM.commit.slice(0, 7)}`

/**
 * What an archived resolution's placement is, and is not.
 *
 * One constant rather than a sentence composed at each site, because this is the
 * claim this row is least allowed to get wrong.
 */
export const ARCHIVE_PROVENANCE =
  'the archive’s published file rather than a render of these parameters: the archived bases are ' +
  'ASCII STL exported by an earlier revision of this geometry, and 184 renders of the archived ' +
  '1×1’s whole connector space matched neither its md5 nor its facet count (760 published facets ' +
  'against 296 and 1,428).'

/** Where a generated mesh came from. Names the geometry; claims nothing about the archive. */
export function generatedProvenance(entry: string): string {
  return `Generated in this browser from ${entry}, ${SCAD_UPSTREAM.spdx} geometry at ${SCAD_PIN}.`
}

/**
 * What the digest of a generated mesh establishes — S3's wording, not a
 * paraphrase.
 *
 * `describeVerification`'s `self-addressed` branch is the honest case here and
 * its sentence is the substance of the claim, so it is reused rather than
 * rewritten. It is restated instead of imported because importing it means
 * `engine/index.ts`, whose dynamic imports emit the 298 kB worker chunk, and a
 * bill row must not drag that; `pack.test.ts` asserts the two strings still
 * agree on the phrase that carries the meaning.
 */
export function selfAddressedNote(md5: string): string {
  return (
    `md5 ${md5.slice(0, 8)} identifies these bytes rather than vouching for them — ` +
    'both sides of the digest come from this run.'
  )
}

/** The phrase {@link selfAddressedNote} shares with S3's own describer. */
export const SELF_ADDRESSED_PHRASE = 'identifies these bytes rather than vouching for them'

/** No published file names these parameters. The ordinary generated case. */
export const ABSENT_NOTE = 'No file this catalog build publishes names these parameters.'

/**
 * The archive answers twice, so neither answer was taken.
 *
 * 27 of the 709 resolvable keys are claimed by two different archived blobs.
 * Reporting those as absent would say the archive holds nothing when it holds
 * two things, and picking either would hand over a base that may not be the one
 * the parameters describe.
 */
export function ambiguousNote(files: readonly string[]): string {
  return (
    `The archive publishes ${String(files.length)} files for these parameters — ${files.join(', ')} — ` +
    'and they are different meshes, so neither was taken and this base was generated instead.'
  )
}

/** A base that has not been rendered has no bytes, and cannot enter a pack. */
export const UNRENDERED_NOTE =
  'Not rendered yet: this base has no bytes, so it is on the plan but not in the download.'
