/**
 * The work list: the sets the footprint chain cannot be honest without.
 *
 * ## The sets come from the built index, not from re-running the classifier
 *
 * Each set is *defined* by `pipeline/footprint.ts` — but it is read off
 * `record.foot.shape` in `public/catalog/catalog.json` rather than by importing
 * `footprintKind` and re-deriving it. That is deliberate. Rows **W3** and **W4**
 * own `footprint.ts` and are about to change exactly the predicate that decides
 * these buckets: W3 makes `hasCurveMarker` segment-exact (742 tiles leave
 * `none`) and W4 adds `COLUMN`/`DIAGONAL` and de-arcs the 84 `xG`. If this
 * module imported the classifier, the *meaning* of a measurement already taken
 * would change under it the moment either row merged, and the sidecar would
 * claim coverage of a set that no longer exists.
 *
 * So the index's `version` stamp is carried into the sidecar, and the counts
 * below are the counts of the corpus as classified at that stamp. They
 * reproduce the plan's figures exactly:
 *
 * | set | row W1's brief | at the index this ran against |
 * | --- | ---: | ---: |
 * | arc, no band modifier | 292 | **292** |
 * | arc, no `size|angle` | 165 | **165** |
 * | `AxG`/`BAxG`/`QxG` | 84 | **84** (28 each) |
 * | `none`, no tessellation code | 921 | **580** |
 * | rect, curve-marked | — | **403** |
 *
 * ## Why the fourth set moved, and why a fifth one exists
 *
 * Row **W3** merged while this row was running and rebuilt the index. Its change
 * moves **403 tiles out of NONE and into RECT** — NONE goes 1,144 → 741 — so the
 * brief's "921 `none` tiles carrying no tessellation code" is **580** against the
 * index this actually measured. The 921 was correct when the row was written and
 * is not correct now; neither figure is wrong, they are counts of two different
 * classifiers, which is exactly why the sidecar carries the index's
 * `VersionStamp`.
 *
 * The 341 rows that left would simply have gone unmeasured — and W3's own
 * docblock hands them straight back: it says the RECT pair it now trusts is *"an
 * axis-aligned over-approximation of an annular sector"*, that 26 of the movers
 * have pairs *"the mesh does not honour in either direction"*, and that
 * *"measuring the 26 is"* the fix. So `rectCurved` is added: every RECT tile
 * carrying a curve marker. Verified against a reconstruction of the pre-W3
 * classifier, `noneNoCode ∪ rectCurved` covers **all 800** md5 values of the
 * original 921-row set with none left out, and it additionally covers the tiles
 * W3 asked for. It costs 4.68 GB on top of 6.37 GB — still well inside the
 * 26.66 GB the row budgeted.
 *
 * ## Band modifiers are three tags, not five
 *
 * The five markers the classifier has ever vetoed on are `curved`, `radial`,
 * `concave`, `convex` and `hex` — but only three of them select a *band* in
 * `openlock-tessellation.md` §4 (`radial` → `[R−2, R]`, `convex` → `[R−0.5, R]`,
 * `concave` → `[R, R+0.5]`, plus `s2w` radial → `[R−1.5, R]`, which is still a
 * `radial` tile). `curved` and `hex` say a tile is not a rectangle without
 * saying where its material lies, which is precisely why the 292 are unresolved.
 *
 * The scan is a substring scan, matching the one the plan's 21.0% was computed
 * with. Measured on this corpus a segment-exact scan gives the **same 292**, so
 * the choice does not move this number at all — W3 has since confirmed the same
 * thing for the curve markers generally.
 *
 * ## Targets are blobs, not tiles
 *
 * Records across the sets collapse to markedly fewer md5 values: the same
 * physical STL is filed under more than one catalog path (171 md5 values are
 * shared by 520 catalog rows corpus-wide). A work list keyed on `id` would read
 * those objects twice for no new geometry. Md5 is also the sidecar's key, because
 * md5 churn — a re-export from Blender — is the creator's normal workflow and a
 * path is not stable across it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { BlobId, CatalogFile, CatalogRecord } from '../../src/catalog'
import { CatalogFile as CatalogFileSchema, resolveTags, shardedPath } from '../../src/catalog'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Repository root — `tools/measure` is two levels down. */
export const REPO_ROOT = join(HERE, '..', '..')

/** The importer's output. `npm run import:catalog` writes it; it is gitignored. */
export const CATALOG_PATH = join(REPO_ROOT, 'public', 'catalog', 'catalog.json')

/** Where the incremental result log lives between runs. Gitignored. */
export const DEFAULT_STATE_DIR = join(HERE, '.cache')

/** The committed sidecar. Small enough for git — see `sidecar.ts`. */
export const DEFAULT_SIDECAR_PATH = join(HERE, 'measurements.json')

/**
 * The three shape modifiers `openlock-tessellation.md` §4 gives a band for.
 *
 * A subset of `footprint.ts`'s `NON_RECT_MARKERS`; see the module docstring for
 * why the other two (`curved`, `hex`) are not band modifiers.
 */
export const BAND_MODIFIERS = ['radial', 'concave', 'convex'] as const

/** The `xG` interface codes whose tagged widths disagree with each other. */
export const XG_CODES = ['AxG', 'BAxG', 'QxG'] as const

/**
 * Tag segments that mean the outline is curved.
 *
 * The same four segments W3's `hasCurveMarker` matches — `hex` deliberately
 * excluded, because a hex is a different geometry family and calling it a curve
 * places hex corners as bogus arcs. Matched **segment-exact**, as W3 does.
 *
 * Stated here rather than imported from `pipeline/tessellation.ts`: W2 owns that
 * file and W3 owns the predicate, and this row's work list must not change
 * meaning under either of them after the reads have been paid for.
 */
export const CURVE_SEGMENTS = ['curved', 'radial', 'concave', 'convex'] as const

/** Which question a target answers. A target may answer several. */
export type TargetSet = 'arcNoBand' | 'arcNoAngle' | 'xg' | 'noneNoCode' | 'rectCurved'

/** Every set a target belongs to, in a stable order for the sidecar. */
export const TARGET_SETS: readonly TargetSet[] = [
  'arcNoBand',
  'arcNoAngle',
  'xg',
  'noneNoCode',
  'rectCurved',
]

/** One mesh to read, and every catalog row that depends on the answer. */
export interface MeasureTarget {
  blob: BlobId
  /** Lowest manifest ordinal among the rows sharing this blob — a stable sort key. */
  ord: number
  /** STL size in bytes. Equal for every row sharing the blob. */
  bytes: number
  /** Which questions this mesh answers. Non-empty, sorted by {@link TARGET_SETS}. */
  sets: TargetSet[]
  /** Every catalog id sharing this blob, ordinal-sorted. */
  ids: string[]
  /** `size|openlock` code of the lowest-ordinal row, when it carries one. */
  sizeCode?: string
  /** Footprint shape the shipped classifier gives the lowest-ordinal row. */
  shape: CatalogRecord['foot']['shape']
  /** Tags of the lowest-ordinal row — what the arc fit is checked against. */
  tags: string[]
}

/** Per-set record and blob counts, so a run can state what it is covering. */
export interface TargetCounts {
  /** Catalog rows in the set. */
  records: number
  /** Distinct md5 values in the set. */
  blobs: number
}

export interface TargetList {
  /** Blob-deduped, ordinal-sorted. */
  targets: MeasureTarget[]
  /** Per-set counts, before and after md5 dedupe. */
  counts: Record<TargetSet, TargetCounts>
  /** Rows in the union of the sets. */
  records: number
  /** Rows collapsed by md5 dedupe. */
  deduped: number
  /** Total bytes to read if every target is read whole. */
  bytes: number
}

/**
 * Load and validate the index.
 *
 * Parsed, not cast: this tool decides which 1,163 objects to pull out of
 * somebody else's production bucket from it, and a shape change should fail here
 * with the offending path rather than surface as a measurement of the wrong set.
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

/** `hasCurveMarker`'s scan, narrowed to the three modifiers that select a band. */
export function hasBandModifier(tags: readonly string[]): boolean {
  const joined = tags.join(' ')
  return BAND_MODIFIERS.some((marker) => joined.includes(marker))
}

/** Whether a `size|angle` tag is present at all — the sweep `DEFAULT_ARC_SWEEP_DEG` fabricates. */
export function hasAngleTag(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.startsWith('size|angle|'))
}

/** W3's segment-exact curve test, restated. See {@link CURVE_SEGMENTS}. */
export function hasCurveSegment(tags: readonly string[]): boolean {
  return tags.some((tag) =>
    tag.split('|').some((segment) => (CURVE_SEGMENTS as readonly string[]).includes(segment)),
  )
}

/** Which target sets a row falls into. Empty means it is not a target. */
export function setsFor(record: CatalogRecord, tags: readonly string[]): TargetSet[] {
  const sets: TargetSet[] = []
  const arc = record.foot.shape === 'arc'
  if (arc && !hasBandModifier(tags)) sets.push('arcNoBand')
  if (arc && !hasAngleTag(tags)) sets.push('arcNoAngle')
  if (record.sizeCode !== undefined && (XG_CODES as readonly string[]).includes(record.sizeCode)) {
    sets.push('xg')
  }
  if (record.foot.shape === 'none' && record.sizeCode === undefined) sets.push('noneNoCode')
  if (record.foot.shape === 'rect' && hasCurveSegment(tags)) sets.push('rectCurved')
  return sets
}

/** The five sets, md5-deduped and in display order. */
export function measureTargets(file: CatalogFile): TargetList {
  const byBlob = new Map<string, MeasureTarget>()
  const perSet = new Map<TargetSet, { records: number; blobs: Set<string> }>(
    TARGET_SETS.map((set) => [set, { records: 0, blobs: new Set<string>() }]),
  )
  let records = 0

  for (const record of [...file.records].sort((a, b) => a.ord - b.ord)) {
    const tags = resolveTags(file, record)
    const sets = setsFor(record, tags)
    if (sets.length === 0) continue
    records += 1

    for (const set of sets) {
      const bucket = perSet.get(set)
      if (bucket === undefined) continue
      bucket.records += 1
      bucket.blobs.add(record.blob)
    }

    const existing = byBlob.get(record.blob)
    if (existing) {
      existing.ids.push(record.id)
      for (const set of sets) if (!existing.sets.includes(set)) existing.sets.push(set)
      existing.sets.sort((a, b) => TARGET_SETS.indexOf(a) - TARGET_SETS.indexOf(b))
      continue
    }

    byBlob.set(record.blob, {
      blob: record.blob,
      ord: record.ord,
      bytes: record.bytes,
      sets,
      ids: [record.id],
      ...(record.sizeCode === undefined ? {} : { sizeCode: record.sizeCode }),
      shape: record.foot.shape,
      tags,
    })
  }

  const targets = [...byBlob.values()].sort((a, b) => a.ord - b.ord)
  const counts = Object.fromEntries(
    TARGET_SETS.map((set) => {
      const bucket = perSet.get(set)
      return [set, { records: bucket?.records ?? 0, blobs: bucket?.blobs.size ?? 0 }]
    }),
  ) as Record<TargetSet, TargetCounts>

  return {
    targets,
    counts,
    records,
    deduped: records - targets.length,
    bytes: targets.reduce((total, target) => total + target.bytes, 0),
  }
}

/** The STL's URL — `{models}/{md5[0:6]}/{md5}.stl`, verified across all 8,702 rows. */
export function modelUrl(file: CatalogFile, blob: BlobId): string {
  return `${file.assets.models}/${shardedPath(blob)}.stl`
}
