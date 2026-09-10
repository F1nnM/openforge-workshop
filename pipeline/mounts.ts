/**
 * Where accessories attach — the artefact `CatalogRecord.mounts` and
 * `CatalogRecord.anchor` come from.
 *
 * ## Why this is a file and not a measurement inside the build
 *
 * The same reason `pipeline/thumbs.ts` is a file, one order of magnitude
 * further along. The build has to be a pure function of the fixtures —
 * `tools/stamp/lock.ts` digests the emitted `{tags, records}` and asserts a
 * biconditional against `(SCHEMA_VERSION, PIPELINE_VERSION)` — and answering
 * "where does a torch go on this wall" means **downloading the mesh and
 * measuring it**: 16.34 GB of STL, a 0.5 mm depth map per face and a 31-angle
 * tilt sweep, ≈14 s per swept face on eight cores. A build that did that would
 * be a build nobody could run, and its output would be a function of somebody
 * else's bucket at the moment CI happened to run.
 *
 * So the question is answered out of band, by `npm run mounts -- --inventory`,
 * which writes this file. The build reads it and joins on md5.
 *
 * ## Keyed on md5, and that is not the same shape as the record
 *
 * A measurement is a property of the **mesh**, and 171 md5 values are shared by
 * 520 catalog rows. Keying on the blob is what makes a re-export invalidate the
 * measurement automatically: new bytes, new md5, no entry, no mount — rather
 * than a stale socket position on a wall that has been remodelled.
 *
 * ## What it says today
 *
 * The first full run, against fixtures `428289679a0c` on 2026-09-10: **995
 * hosts** carrying **1,298 mounts** (702 opening, 438 socket, 55 pocket, 75
 * surface, 28 hole), **139 inserts** each with an anchor, **0 failed**, 16.34 GB
 * read in ≈1.5 h. Joined, that is **969 records with a `mounts` key and 285 with
 * an `anchor`**, and 50 slots that resolved to nothing and say why — those print
 * as a fixture lint out of `pipeline/build.ts`, and the 15 `modelled-in` of them
 * also reach the record as `CatalogRecord.modelledIn`, because *the host already
 * holds one* is a fact a consumer has to act on rather than a person.
 *
 * `PIPELINE_VERSION` does not move for a re-measurement and
 * `tools/stamp/lock.ts` still builds its digest against
 * {@link emptyMountInventory}: a bucket full of meshes is an *input*, not a
 * derivation this tree performs, so the lock must not be a function of it.
 * `tools/mounts/corpus.test.ts` is what holds this file honest instead — it
 * asserts the four counts above and the conventions they proved.
 *
 * The sequence to repeat when the corpus changes is the one `thumbs.ts` sets:
 *
 *   1. `npm run import:catalog`, so `tools/mounts/` has an index to read;
 *   2. `npm run mounts`, which fetches and measures into `tools/mounts/.cache/`;
 *   3. `npm run mounts -- --inventory`, which rewrites this file from that log;
 *   4. `npm run import:catalog` again, which joins it.
 *
 * ## An unmeasured blob and an unmountable one are different, and both are here
 *
 * A host with no usable mount still gets an entry — its `unresolved` list says
 * which slot failed and why, and `pipeline/build.ts` prints those as a fixture
 * lint. A blob that could not be *read* gets no entry at all and is counted in
 * `counted.failed`, and {@link readMountInventory} refuses the whole file when
 * that count is non-zero: an inventory that could not ask about every mesh
 * cannot tell "this wall has no socket" from "we never saw this wall", and only
 * one of those is safe to emit as an absent `mounts`.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

import { InsertAnchor, Mount, Vec3 } from '../src/catalog'

/** Version of *this file's* shape, independent of the index and of the tool. */
export const MOUNT_INVENTORY_VERSION = 1

/** Names the producer in the artefact, so a file from another tool is traceable. */
export const MOUNT_TOOL = 'openforge-workshop-mounts'

/** Checked in, beside `thumbs/inventory.json`, and read by every build. */
export const MOUNT_INVENTORY_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'mounts',
  'inventory.json',
)

/**
 * What {@link emptyMountInventory}'s shell says about itself.
 *
 * Not what the committed file says — that one carries `tools/mounts/sidecar.ts`'s
 * own note and a real measurement. This string is only ever read by a caller
 * that has asked for "deliberately none", the lock among them.
 */
const EMPTY_NOTE =
  'Where accessories attach, measured from the host meshes by `npm run mounts -- --inventory`. ' +
  'Empty until the first run.'

/** An md5, lower-case hex — the key both tables are filed under. */
const Blob = z.string().regex(/^[0-9a-f]{32}$/)

/** An axis-aligned box in the mesh's own millimetres, before the bbox conversion. */
export const Bounds = z.object({ min: Vec3, max: Vec3 })
export type Bounds = z.infer<typeof Bounds>

/**
 * The circle a curved host was unrolled about — centre in the mesh frame, and
 * the **fraction** of mid-slice vertices that sat on a nominal radius. See
 * `tools/mounts/arcs.ts`, whose `ARC_FIT_MIN_ON_RADIUS` is the floor a host has
 * to clear to be unrolled at all: 0.35, against the 0.49–0.58 a clean sector
 * scores. Measured over the 206 arc hosts in the committed inventory the score
 * runs 0.16–0.77, and the 14 slots below the floor are recorded as
 * `arc-fit-refused` rather than measured off a circle the mesh is not struck
 * from — which is why the bound here is `[0, 1]` and not the floor itself.
 */
export const ArcFit = z.object({
  centre: z.tuple([z.number(), z.number()]).readonly(),
  onRadius: z.number().min(0).max(1),
})
export type ArcFit = z.infer<typeof ArcFit>

/**
 * Why a slot got no mount. Each is a different thing to do about it, and
 * `tools/mounts/classify.ts` carries the full account of the five.
 */
export const UnresolvedReason = z.enum([
  'no-opening',
  'no-socket',
  'no-hole',
  'no-pocket',
  'arc-fit-refused',
  'runs-off-end',
  'modelled-in',
])
export type UnresolvedReason = z.infer<typeof UnresolvedReason>

export const Unresolved = z.object({ slot: z.string().min(1), reason: UnresolvedReason })
export type Unresolved = z.infer<typeof Unresolved>

/**
 * One host mesh: its box, the mounts found in it, and the slots that failed.
 *
 * `mounts` empty with `unresolved` populated is the informative case — the tool
 * looked and the mesh does not carry the feature — and it is why a host with
 * nothing to offer still appears in the file.
 */
export const HostMeasurement = z.object({
  bbox: Bounds,
  arc: ArcFit.optional(),
  mounts: z.array(Mount).readonly(),
  unresolved: z.array(Unresolved).readonly(),
})
export type HostMeasurement = z.infer<typeof HostMeasurement>

/** One accessory mesh: its box, and how it plugs in. */
export const InsertMeasurement = z.object({ bbox: Bounds, anchor: InsertAnchor })
export type InsertMeasurement = z.infer<typeof InsertMeasurement>

/**
 * The committed artefact.
 *
 * Member order is the order it serialises in and the order the tool builds it
 * in, because the file is checked in and a reordering would be a diff of every
 * line of it. `tools/mounts/sidecar.ts` infers its own type from here rather
 * than declaring a parallel interface.
 */
export const MountInventory = z.object({
  note: z.string().min(1),
  version: z.number().int().nonnegative(),
  /** When the meshes were read. ISO-8601 with a `Z` offset. */
  measured: z.iso.datetime(),
  /** The index it was measured against — `CatalogFile.version.fixtures`. */
  catalog: z.object({ fixtures: z.string() }),
  tool: z.literal(MOUNT_TOOL),
  hosts: z.record(Blob, HostMeasurement),
  inserts: z.record(Blob, InsertMeasurement),
  /**
   * What the run holds. `failed` is blobs that were attempted and could not be
   * trusted — a 404, or bytes that hash to something else — and they appear
   * nowhere else in the file, which is exactly why the count has to be here.
   */
  counted: z.object({
    hosts: z.number().int().nonnegative(),
    inserts: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    mounts: z.number().int().nonnegative(),
  }),
})
export type MountInventory = z.infer<typeof MountInventory>

/**
 * The inventory on disk, or `undefined` when there is none.
 *
 * Absent is a legitimate state — a fresh clone that has never measured — and it
 * means what a run finding nothing means: no record gets a mount. It is
 * `undefined` rather than an empty inventory so a caller that wants to *report*
 * the difference can, and `scripts/import-catalog.ts` does.
 *
 * @throws when the file is present but does not parse, when its own version is
 *   not {@link MOUNT_INVENTORY_VERSION}, or when it records measurement
 *   failures. All three would otherwise emit an absent `mounts` that looks
 *   exactly like a corpus nobody has measured — the state this repository is in
 *   today, and therefore the state that looks correct.
 */
export function readMountInventory(path: string = MOUNT_INVENTORY_PATH): MountInventory | undefined {
  if (!existsSync(path)) return undefined
  const parsed = MountInventory.parse(JSON.parse(readFileSync(path, 'utf8')))
  if (parsed.version !== MOUNT_INVENTORY_VERSION) {
    throw new Error(
      `${path} declares mount inventory version ${String(parsed.version)}; this pipeline understands ` +
        `${String(MOUNT_INVENTORY_VERSION)}. Re-measure with \`npm run mounts -- --inventory\` — reading it ` +
        'under the old assumptions would place accessories from fields that have changed meaning.',
    )
  }
  if (parsed.counted.failed > 0) {
    throw new Error(
      `${path} records ${String(parsed.counted.failed)} blobs that could not be measured. An inventory ` +
        'that could not read every mesh cannot distinguish "no mount here" from "no answer"; re-measure ' +
        'with `npm run mounts -- --retry-failed` and rebuild it with `npm run mounts -- --inventory`.',
    )
  }
  return parsed
}

/**
 * The "nothing measured" inventory.
 *
 * It is **no longer the contents of the committed file** — that holds the
 * 2026-09-10 run — and the distinction is the point. `BuildOptions.mounts` is
 * required, so every caller states its intent, and this is how a caller says
 * *"deliberately none"*: `tools/stamp/lock.ts` passes it because a bucket full
 * of meshes is an input and not a derivation, so the lock digests a build that
 * has never seen a mount and a re-measurement changes the emitted index without
 * moving the lock or `PIPELINE_VERSION`. It is also the state of a fresh clone
 * that has not fetched the artefact.
 */
export function emptyMountInventory(): MountInventory {
  return {
    note: EMPTY_NOTE,
    version: MOUNT_INVENTORY_VERSION,
    measured: '1970-01-01T00:00:00.000Z',
    catalog: { fixtures: '' },
    tool: MOUNT_TOOL,
    hosts: {},
    inserts: {},
    counted: { hosts: 0, inserts: 0, failed: 0, mounts: 0 },
  }
}

/**
 * The committed form: a 2-space header, and **one line per host and insert**.
 *
 * `JSON.stringify(inventory, null, 2)` would render a measured corpus as roughly
 * a quarter of a million lines — every `at` triple three lines of its own — and
 * a reviewer reading a re-measurement wants to see *which meshes moved*, not
 * which numbers within them. One line per md5 makes the diff exactly that.
 * `tools/measure/sidecar.ts` takes the same shape for the same reason.
 */
export function serialiseMountInventory(inventory: MountInventory): string {
  const { note, version, measured, catalog, tool, hosts, inserts, counted } = inventory
  const members = [
    `"note": ${JSON.stringify(note)}`,
    `"version": ${JSON.stringify(version)}`,
    `"measured": ${JSON.stringify(measured)}`,
    `"catalog": ${indented(catalog)}`,
    `"tool": ${JSON.stringify(tool)}`,
    `"hosts": ${perLine(hosts)}`,
    `"inserts": ${perLine(inserts)}`,
    `"counted": ${indented(counted)}`,
  ]
  return `{\n  ${members.join(',\n  ')}\n}\n`
}

/** A nested value at the top level's own two-space indent. */
function indented(value: unknown): string {
  return JSON.stringify(value, null, 2).replaceAll('\n', '\n  ')
}

/** An md5-keyed table, one entry per line, in the order the tool sorted it. */
function perLine(table: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(table)
  if (keys.length === 0) return '{}'
  const rows = keys.map((key) => `    ${JSON.stringify(key)}: ${JSON.stringify(table[key])}`)
  return `{\n${rows.join(',\n')}\n  }`
}
