/**
 * Append-only manifest ordinals.
 *
 * A share link encodes a room as a list of integers. If an import ever changes
 * which tile an integer means, every link already in the wild decodes to a
 * *different room*, with no error anywhere — §13 names this the worst silent
 * failure in the system, and it is the reason this file exists.
 *
 * **The representation is the enforcement.** The manifest is an array of tile
 * ids in which the index *is* the ordinal. There is no id→ordinal map to get out
 * of sync, no counter that could be reset, and no way to express "this tile now
 * has a different number" short of rewriting the array — which
 * {@link assignOrdinals} refuses to do, and which shows up in review as a
 * rewritten file rather than a one-line diff.
 *
 * The four rules from `ManifestOrdinal`, and where each is enforced:
 *
 *   1. *An assigned ordinal is kept for ever.* An id already in `ids` is never
 *      moved; new ids are pushed onto the end.
 *   2. *New ordinals are strictly above every ordinal issued so far.* They are
 *      array pushes.
 *   3. *A retired ordinal is never reissued.* A departed tile keeps its slot in
 *      `ids`. Ordinals are therefore **not dense** and nothing may assume
 *      `ord === index in records` — the emitted records are sorted by `id`, not
 *      by ordinal, so that assumption breaks immediately and visibly rather than
 *      after the first deletion. A tile that comes back gets its old number
 *      back, which is what a share link written before it left expects.
 *   4. *Deliberately breaking the above bumps `version.manifest`.* That field
 *      lives in this file and travels with the ordinals it describes, so it
 *      cannot be bumped in one place and forgotten in the other.
 *
 * {@link assertAppendOnly} re-checks 1–3 against the manifest on disk on every
 * import, so a corrupted or hand-edited manifest fails the build instead of
 * shipping.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

/** The checked-in manifest. Committed, and the only file in `pipeline/` that is data. */
export const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'ordinals', 'manifest.json')

export const OrdinalManifest = z.object({
  /**
   * `CatalogFile.version.manifest`. Bump **only** when the append-only invariant
   * is deliberately broken, so an old share link fails loudly instead of
   * decoding wrongly.
   */
  manifest: z.number().int().nonnegative(),
  /** Tile ids. The index is the ordinal. Never reordered, never spliced. */
  ids: z.array(z.string().min(1)),
})
export type OrdinalManifest = z.infer<typeof OrdinalManifest>

/** A manifest that has issued no ordinals yet. */
export function emptyManifest(): OrdinalManifest {
  return { manifest: 1, ids: [] }
}

export function loadManifest(path: string = MANIFEST_PATH): OrdinalManifest {
  if (!existsSync(path)) return emptyManifest()
  const parsed = OrdinalManifest.parse(JSON.parse(readFileSync(path, 'utf8')))
  assertUnique(parsed.ids)
  return parsed
}

export interface OrdinalAssignment {
  /** The manifest to write back: the old one plus any new ids appended. */
  manifest: OrdinalManifest
  /**
   * Ordinal for every id passed in — and only those. Retired ids keep their
   * slot in `manifest.ids` but are deliberately absent here, so a caller cannot
   * accidentally emit a record for a tile that is no longer in the corpus.
   */
  ordinalOf: ReadonlyMap<string, number>
  /** Ids seen for the first time this import, in the order they were appended. */
  added: string[]
  /** Ids that hold an ordinal but are no longer in the corpus. Their slots stay reserved. */
  retired: string[]
}

/**
 * Assign an ordinal to every live id, extending the manifest only at the end.
 *
 * New ids are sorted before they are appended, so the numbers a given corpus
 * produces do not depend on fixture file order or on iteration order anywhere
 * upstream. Without that, two builds of the same input could hand out different
 * ordinals — which is rule 1 broken by accident rather than by intent.
 */
export function assignOrdinals(previous: OrdinalManifest, liveIds: readonly string[]): OrdinalAssignment {
  assertUnique(previous.ids)
  assertUnique(liveIds)

  const issued = new Map<string, number>()
  previous.ids.forEach((id, ordinal) => issued.set(id, ordinal))

  const added = liveIds.filter((id) => !issued.has(id)).sort()
  const ids = [...previous.ids]
  for (const id of added) {
    issued.set(id, ids.length)
    ids.push(id)
  }

  const live = new Set(liveIds)
  const retired = previous.ids.filter((id) => !live.has(id))

  const ordinalOf = new Map<string, number>()
  for (const id of liveIds) {
    const ordinal = issued.get(id)
    if (ordinal === undefined) throw new Error(`no ordinal issued for ${id}`)
    ordinalOf.set(id, ordinal)
  }

  const manifest: OrdinalManifest = { manifest: previous.manifest, ids }
  assertAppendOnly(previous, manifest)
  return { manifest, ordinalOf, added, retired }
}

/**
 * The invariant, checked rather than trusted: the new manifest must extend the
 * old one, unchanged, in place.
 *
 * Throws with the first offending ordinal. A shrinking manifest is rejected too
 * — that is a retired ordinal being handed back, and the tile that used to own
 * it is exactly the one nobody would think to check.
 */
export function assertAppendOnly(previous: OrdinalManifest, next: OrdinalManifest): void {
  if (next.ids.length < previous.ids.length) {
    throw new Error(
      `manifest shrank from ${String(previous.ids.length)} to ${String(next.ids.length)} ordinals; ` +
        'ordinals are retired in place, never removed',
    )
  }
  for (let ordinal = 0; ordinal < previous.ids.length; ordinal += 1) {
    if (next.ids[ordinal] !== previous.ids[ordinal]) {
      throw new Error(
        `manifest ordinal ${String(ordinal)} changed from ${String(previous.ids[ordinal])} ` +
          `to ${String(next.ids[ordinal])}; every share link containing it would decode to a different tile`,
      )
    }
  }
}

/**
 * Serialise one id per line.
 *
 * The whole point of the file is that its diff is reviewable: an append-only
 * manifest should produce an append-only diff, and a single-line JSON array
 * would produce one enormous changed line that hides a reordering completely.
 */
export function serialiseManifest(manifest: OrdinalManifest): string {
  const ids = manifest.ids.map((id) => `    ${JSON.stringify(id)}`).join(',\n')
  return `{\n  "manifest": ${String(manifest.manifest)},\n  "ids": [\n${ids}${ids ? '\n' : ''}  ]\n}\n`
}

export function writeManifest(manifest: OrdinalManifest, path: string = MANIFEST_PATH): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serialiseManifest(manifest))
}

function assertUnique(ids: readonly string[]): void {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`duplicate tile id in manifest input: ${id}`)
    seen.add(id)
  }
}
