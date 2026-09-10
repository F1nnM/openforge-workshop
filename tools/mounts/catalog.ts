/**
 * The work list: which meshes have somewhere for an accessory to go.
 *
 * ## Two questions, read off the index rather than guessed
 *
 * A tile is a **host** when it declares a composition slot that is not `base`.
 * That is the corpus's own statement that something gets fitted into it — a
 * door, a window, a grate, a torch — and it is the only statement there is; no
 * geometric heuristic decides it, because the slot's *name* is what
 * `classify.ts` switches on to know what to look for. A `base` slot is excluded
 * because it is joinery, not an accessory: 2,451 of the 3,695 live slots are
 * `base`, and they say "this topper needs a base printed under it", which is a
 * placement fact the assembly resolver already owns.
 *
 * A tile is an **insert** when `layer === 'insert'` — a component reached
 * through somebody else's slot rather than placed on the grid. Those are the
 * meshes that get an anchor: the point and axis by which the app seats them into
 * a host's mount.
 *
 * ## A blob can be both, and is then read once
 *
 * **4** blobs are filed both as an insert and as a tile carrying a non-base
 * slot. Reading such an object twice to answer two questions about the same
 * bytes would double the transfer for nothing, so it is one target of
 * `kind: 'host'` carrying {@link MountTarget.alsoInsert}, and `run.ts` asks the
 * worker for both measurements from the single parse. That is also why
 * {@link MountTargetList} counts `inserts` and `alsoInserts` separately: 135
 * insert-kind targets plus those 4 is the 139 anchors the work list yields, and
 * `hosts + inserts` stays equal to the number of objects read.
 *
 * ## Targets are blobs, not tiles
 *
 * The same argument `tools/measure/catalog.ts` makes: a work list keyed on `id`
 * reads shared objects twice for no new geometry, and md5 — not a path — is what
 * survives the re-export that `CLAUDE.md` calls the creator's normal workflow.
 * Measured on the index this was written against: **1,276 rows collapse to
 * 1,130 blobs** — 995 hosts carrying 1,230 accessory slots, 135 inserts, 16.34
 * GB to read.
 *
 * Where rows sharing a blob disagree, the **slots are unioned** and the
 * footprint comes from the lowest-ordinal row. Both follow from the measurement
 * being a property of the bytes: two rows filed under one md5 *are* one mesh, so
 * a slot name either of them declares is a name some consumer will look up, and
 * the union is what makes that lookup resolve. Measured: **0** blobs have rows
 * declaring different slot sets, so the union is a guard rather than a fix, and
 * **2** have rows declaring different footprints — the `grate.doorway` mesh
 * filed as both an `SA` (length 2) and a `D` (length 3) wall, and its `SB`/`Q`
 * sibling. Both disagreements are a `wall` length, which nothing in
 * `classify.ts` reads: only `foot.shape` reaches a measurement, through the arc
 * unroll and the floor test, and no blob's rows disagree about shape.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BlobId, CatalogFile, CatalogRecord, Footprint, TileId } from '../../src/catalog'
import { CatalogFile as CatalogFileSchema, shardedPath } from '../../src/catalog'

import { MOUNT_INVENTORY_PATH } from '../../pipeline'

import type { HostSlot } from './classify'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Repository root — `tools/mounts` is two levels down. */
export const REPO_ROOT = join(HERE, '..', '..')

/** The importer's output. `npm run import:catalog` writes it; it is gitignored. */
export const CATALOG_PATH = join(REPO_ROOT, 'public', 'catalog', 'catalog.json')

/** Where the incremental result log lives between runs. Gitignored. */
export const DEFAULT_LOG_PATH = join(HERE, '.cache', 'mounts.jsonl')

/** The committed inventory the build reads. `pipeline/mounts.ts` owns the path. */
export const DEFAULT_INVENTORY_PATH = MOUNT_INVENTORY_PATH

/** The one slot name that is joinery rather than an accessory. See the docblock. */
const JOINERY_SLOT = 'base'

/** Which question a target answers. */
export type TargetKind = 'host' | 'insert'

/** One mesh to read, and everything needed to measure it without the index. */
export interface MountTarget {
  readonly kind: TargetKind
  readonly blob: BlobId
  /** Lowest manifest ordinal among the rows sharing this blob — a stable sort key. */
  readonly ord: number
  /** STL size in bytes. Equal for every row sharing the blob. */
  readonly bytes: number
  /** Every catalog id sharing this blob, ordinal-sorted. */
  readonly ids: readonly TileId[]
  /** `family` of the lowest-ordinal row — the Dropbox folder. A sampling stratum. */
  readonly family: string
  /** Footprint of the lowest-ordinal row; decides how the mesh is framed. */
  readonly foot: Footprint
  /** Non-base slots, unioned across the rows sharing the blob. Empty for an insert. */
  readonly slots: readonly HostSlot[]
  /**
   * `true` when any row sharing this blob is filed as a floor.
   *
   * Unioned like the slots, and for the same reason: the rows sharing a mesh are
   * describing one object, so a disagreement is an argument for taking the claim
   * rather than dropping it. `classify.ts#HostInput` says what reads it.
   */
  readonly floor: boolean
  /** Set on a host that is also filed as an insert: measure its anchor too. */
  readonly alsoInsert?: true
}

export interface MountTargetList {
  /** Blob-deduped, ordinal-sorted. */
  readonly targets: readonly MountTarget[]
  /** Targets of `kind: 'host'`. */
  readonly hosts: number
  /** Targets of `kind: 'insert'` — so `hosts + inserts === targets.length`. */
  readonly inserts: number
  /** Hosts that also yield an anchor. Anchors measured is `inserts + alsoInserts`. */
  readonly alsoInserts: number
  /** Total bytes to read. */
  readonly bytes: number
}

/**
 * Load and validate the index.
 *
 * Parsed, not cast, for the reason `tools/measure/catalog.ts` gives: this decides
 * which objects to pull out of somebody else's production bucket, and a shape
 * change should fail here with the offending path rather than surface as a
 * measurement of the wrong mesh.
 *
 * @throws with the path it looked in when the index has not been built.
 */
export function loadCatalog(path: string = CATALOG_PATH): CatalogFile {
  if (!existsSync(path)) {
    throw new Error(`no catalog index at ${path} — run \`npm run import:catalog\` first`)
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  return CatalogFileSchema.parse(parsed)
}

/** A record's accessory slots — every declared part that is not joinery. */
function hostSlots(record: CatalogRecord): HostSlot[] {
  const parts = record.config?.parts ?? []
  return parts
    .filter((part) => part.name !== JOINERY_SLOT)
    .map((part) => ({ name: part.name, require: (part.tags.require ?? []).map((ref) => ref.tag) }))
}

/** Whether a record is a component fitted into somebody else's slot. */
function isInsert(record: CatalogRecord): boolean {
  return record.layer === 'insert'
}

/** Every blob worth reading, md5-deduped and in manifest order. */
export function mountTargets(file: CatalogFile): MountTargetList {
  const byBlob = new Map<string, Draft>()

  for (const record of [...file.records].sort((a, b) => a.ord - b.ord)) {
    const slots = hostSlots(record)
    const insert = isInsert(record)
    if (slots.length === 0 && !insert) continue

    const draft = byBlob.get(record.blob) ?? seed(record)
    byBlob.set(record.blob, draft)
    draft.ids.push(record.id)
    draft.insert = draft.insert || insert
    draft.floor = draft.floor || record.kinds.includes('floor')
    for (const slot of slots) {
      if (!draft.slots.some((seen) => seen.name === slot.name)) draft.slots.push(slot)
    }
  }

  const targets = [...byBlob.values()].sort((a, b) => a.ord - b.ord).map(finish)
  return {
    targets,
    hosts: targets.filter((target) => target.kind === 'host').length,
    inserts: targets.filter((target) => target.kind === 'insert').length,
    alsoInserts: targets.filter((target) => target.alsoInsert === true).length,
    bytes: targets.reduce((total, target) => total + target.bytes, 0),
  }
}

/** The STL's URL — `{models}/{md5[0:6]}/{md5}.stl`. */
export function modelUrl(file: CatalogFile, blob: BlobId): string {
  return `${file.assets.models}/${shardedPath(blob)}.stl`
}

/* --------------------------------------------------------------- accumulation */

/** A target under construction: `slots` and `insert` accrue across rows. */
interface Draft {
  readonly blob: BlobId
  readonly ord: number
  readonly bytes: number
  readonly family: string
  readonly foot: Footprint
  readonly ids: TileId[]
  readonly slots: HostSlot[]
  insert: boolean
  floor: boolean
}

function seed(record: CatalogRecord): Draft {
  return {
    blob: record.blob,
    ord: record.ord,
    bytes: record.bytes,
    family: record.family,
    foot: record.foot,
    ids: [],
    slots: [],
    insert: false,
    floor: false,
  }
}

/**
 * A draft becomes a target. A blob with any accessory slot is a host — the
 * mounts are the answer nothing else can supply — and carries `alsoInsert` when
 * it is filed as an insert as well.
 */
function finish(draft: Draft): MountTarget {
  const host = draft.slots.length > 0
  return {
    kind: host ? 'host' : 'insert',
    blob: draft.blob,
    ord: draft.ord,
    bytes: draft.bytes,
    ids: draft.ids,
    family: draft.family,
    foot: draft.foot,
    slots: draft.slots,
    floor: draft.floor,
    ...(host && draft.insert ? { alsoInsert: true as const } : {}),
  }
}
