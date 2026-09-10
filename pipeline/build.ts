/**
 * Fixtures → one validated `CatalogFile`.
 *
 * This is the whole pipeline of §5 in one function, in the order the plan draws
 * it: collapse tag drift, resolve the footprint primitive, classify the layer,
 * normalise the connection vocabulary, synthesise a display name, take the
 * family from the path, intern the tags, assign append-only ordinals.
 *
 * Tag drift is collapsed **first**, on the way in, because everything after it
 * derives from a tag list: the design index, the intern table, `textureRoot`,
 * the facet vocabulary and the search tokens. One seam, so no consumer has to
 * know a second spelling ever existed. See `pipeline/normalise.ts`.
 *
 * Row W4 widened one step of it without changing its shape: `resolveFootprint`
 * now returns one of **seven** cases rather than four, and the two it reads
 * beyond the tag list — a column's measured square and a diagonal's measured run
 * — come from `pipeline/tessellation.ts` rather than from a constant here. The
 * pipeline stays a pure function of the tag list plus that table.
 *
 * Row A1 added one step after the parse rather than inside it. Aggregation emits
 * nothing — one catalog item per `design` is derived in the browser by
 * `src/catalog/aggregate.ts` — so the build's job is to check the properties six
 * downstream rows read the grouping for, and to report what it measured.
 * `pipeline/aggregate.ts` owns both, and {@link buildCatalog} fails on a broken
 * invariant rather than shipping an index whose cards would hoist a field that
 * is not constant.
 *
 * Row B1 added one step *inside* the pipeline rather than beside it, and the
 * position is the whole of what is interesting about it. `role|<x>` and
 * `form|<x>` are emitted as **ordinary interned tags**, so the ladder in
 * `pipeline/role.ts` has to run before the intern table is built — which makes
 * it the one derivation whose output another derivation (the table's
 * frequency ordering) depends on. Everything else still reads the row's own
 * tags, so the augmented list reaches `record.tags` and nothing else.
 *
 * Row C1 added the same shape of thing for compositions, and for the same
 * reason: `src/composition/` resolves `constrain` in the browser and emits
 * nothing, so the one property it cannot check for itself is checked here.
 * {@link assertConfigRefs} holds every config ref against the tag table — see
 * its docblock for the silent failure it exists to catch, which is a real seam
 * between this file and `normalise.ts` and not a hypothetical one.
 *
 * Two properties are deliberate and tested:
 *
 *   - **Records are sorted by `id`, not by ordinal.** Catalog paths share long
 *     prefixes, so id order puts near-identical records next to each other and
 *     is worth a large fraction of the brotli saving. It also makes the ordinals
 *     visibly non-dense, so nothing downstream can quietly start assuming
 *     `ord === index`.
 *   - **The return value is `CatalogFile.parse`'s output, not the draft.** What
 *     gets written is what validated — including the file-level checks for
 *     dangling tag ids and duplicate ids and ordinals — rather than something
 *     that merely passed a check on the way past.
 */
import { basename, dirname } from 'node:path'

import type { AggregateClass } from '../src/catalog/aggregate'
import type { Footprint } from '../src/catalog'
import type { CatalogRecord } from '../src/catalog'
import { CatalogFile, MEASURED_SPRITE_SHEET, SCHEMA_VERSION } from '../src/catalog'

import { assertAggregation, measureAggregation } from './aggregate'
import { buildDesignIndex } from './design'
import {
  buildSystem,
  classifyLayer,
  connectionSystems,
  kindBuckets,
  openlockSizeCode,
  rotationStep,
  textureRoot,
} from './facets'
import { resolveFootprint } from './footprint'
import type { FixtureRow } from './fixtures'
import { liveRows } from './fixtures'
import type { MountInventory } from './mounts'
import { displayName } from './naming'
import { normaliseTag, normaliseTags } from './normalise'
import type { OrdinalManifest } from './ordinals'
import { assignOrdinals } from './ordinals'
import type { Confidence } from './role'
import { FORMS, ROLES, inferRole, roleTags } from './role'
import { buildTagTable } from './tags'
import { ASSET_BASES, PIPELINE_VERSION, buildTimestamp } from './version'

export interface BuildOptions {
  /** Every fixture row, deprecated included; the live filter is applied here. */
  rows: readonly FixtureRow[]
  /** The manifest as it stands on disk. Extended, never rewritten. */
  manifest: OrdinalManifest
  /** `version.fixtures` — the snapshot these rows came from. */
  fixturesRef: string
  /**
   * The md5s a `/thumbs/` object exists for — `thumbBlobs(readThumbInventory())`.
   *
   * **Required, and it used to be optional.** The default was "none", which was
   * the state of the bucket and therefore looked free: a caller that forgot it
   * emitted `thumb: false`, the grid cropped sprite sheets, and that is exactly
   * what an un-backfilled bucket looks like — so nothing failed. `tools/stamp/run.ts`
   * forgot it, and since `npm run stamp` is the only build `deploy.yml` and
   * `pr-preview.yml` run *and it overwrites the index*, `thumb` was false in
   * every deployed build for as long as there was nothing in the bucket to
   * notice. The moment the backfill landed, 8,352 objects sat there unused.
   *
   * So the safe default stopped being safe, and the argument that justified it
   * is retired. This field is now required for the same reason
   * {@link CatalogRecord.thumb} is required one level down — *"so that 'no
   * thumbnail' and 'nobody asked' cannot be confused"* — and the reasoning
   * simply had not been carried up.
   *
   * Every caller now states its intent, and the two intents are both legitimate:
   *
   *   - `scripts/import-catalog.ts` and `tools/stamp/run.ts` pass the real set,
   *     because they write the index the app reads.
   *   - `tools/stamp/lock.ts` passes an empty set, because its digest must be a
   *     function of the derivation code, the schema and the corpus and of
   *     nothing else — a bucket's contents are input, and a backfill is not a
   *     derivation. Tests that are about derivation rather than about a bucket
   *     pass an empty set for the same reason.
   *
   * The point is not which value a caller picks; it is that omitting the choice
   * no longer compiles. See `pipeline/thumbs.ts`.
   */
  thumbs: ReadonlySet<string>
  /**
   * Where accessories attach, per blob — `readMountInventory() ?? emptyMountInventory()`.
   *
   * **Required, and for the reason {@link BuildOptions.thumbs} had to become
   * required rather than for a new one.** An absent measurement emits no
   * `mounts` and no `anchor`, which is precisely what an unmeasured corpus
   * looks like — so a caller that forgot this argument would produce an index
   * that is indistinguishable from a correct one until somebody wonders why no
   * torch ever places. `thumbs`' own docblock records that exact failure
   * happening in `tools/stamp/run.ts` and going unnoticed through every
   * deployed build; the argument was carried up here on the first day rather
   * than after.
   *
   * The two intents are the same two:
   *
   *   - `scripts/import-catalog.ts` and `tools/stamp/run.ts` pass the committed
   *     inventory, because they write the index the app reads.
   *   - `tools/stamp/lock.ts` passes `emptyMountInventory()`, because its digest
   *     must be a function of the derivation code, the schema and the corpus,
   *     and 16 GB of somebody else's meshes is input rather than derivation.
   *
   * See `pipeline/mounts.ts`.
   */
  mounts: MountInventory
  /** `version.built`. Defaults to {@link buildTimestamp}. */
  builtAt?: string
}

export interface BuildStats {
  fixtureRows: number
  deprecated: number
  records: number
  tags: number
  tagReferences: number
  designs: number
  families: number
  footprints: Record<string, number>
  layers: Record<string, number>
  /**
   * The derived slot kind — **wall 5,381 · floor 2,162 · riser 319 · insert 285
   * · column 223 · stair 206 · roof 100 · decor 26**, summing to all 8,702.
   *
   * Seeded from {@link ROLES}, so a role that empties out reads as `0` rather
   * than vanishing, and a ninth key means the ladder produced `unknown` — which
   * is 0 of 8,702 today and is the one outcome that would silently change what
   * every generated template admits. `pipeline/catalog.test.ts` asserts the
   * distribution exactly and asserts the key set is exactly these eight.
   */
  roles: Record<string, number>
  /**
   * The derived slot geometry — **straight 5,707 · curve 1,989 · corner 720 ·
   * diagonal 163 · hex 56 · internal_corner 39 · octagon 28**.
   */
  forms: Record<string, number>
  /**
   * Which rung the role came from, folded to its trust level — **high 7,413
   * (85.2%) · medium 1,246 · low 43 · none 0**.
   *
   * Reported rather than asserted as a floor, because the two directions read
   * differently. `none` rising above 0 is a classification failure. `low` rising
   * is a corpus that has grown a shape the ladder cannot read, which is
   * information rather than an error — the 43 today are 40 bare thick-wall
   * bases, 2 yawning-portal bases and 1 facade wall, all named in
   * `pipeline/role.ts`'s residual table.
   */
  roleConfidence: Record<string, number>
  withConfig: number
  distinctNames: number
  newOrdinals: number
  retiredOrdinals: number
  /**
   * The catalog after the collapse — one item per `design`, by shape.
   *
   * `designs` above counts the groups; this says what is *in* them, which is the
   * figure the aggregation rows are scoped against: 2,137 topper-only, 931
   * `both` — the pair the owner asked to merge — 340 base-only, 320
   * integrated-only, 94 insert-only, and 0 `mixed`.
   */
  aggregateClasses: Record<AggregateClass, number>
  /**
   * Records emitting `thumb: true` — **0 of 8,702 today**.
   *
   * Reported rather than asserted, and the two directions read differently. A
   * drop to 0 after a backfill means the inventory went missing or stale and the
   * grid has quietly gone back to decoding 529 KB sheets, which is the whole
   * cost this derivative exists to remove. A rise from 0 before one means an
   * inventory is claiming objects that are not in the bucket. Neither is a
   * build error, and both are invisible without a line in the import's report.
   */
  withThumb: number
  /**
   * Records emitting `mounts` and `anchor` — **0 and 0 today**, because the
   * committed inventory is still the empty shell.
   *
   * Reported rather than asserted, and the two directions read the way
   * {@link BuildStats.withThumb}'s do. A drop to 0 after a measuring run means
   * the inventory went missing, went stale against a re-export, or is keyed on
   * blobs this corpus no longer carries — and the symptom is an app that simply
   * never offers to place a torch, which nothing else would report.
   */
  withMounts: number
  withAnchor: number
  /**
   * One line per measured slot that produced no mount, on a blob some live
   * record carries — `mounts: <file> — slot <name> <reason>`.
   *
   * A **fixture lint rather than a build error**, because every entry is a fact
   * about a mesh and not about this code: `modelled-in` is a door sculpted into
   * the wall (the corpus has one), `runs-off-end` a doorway with no jamb to
   * hinge against, `arc-fit-refused` a sector whose mesh is not struck from the
   * radii its tags claim. `scripts/import-catalog.ts` prints them to stderr, so
   * they arrive next to the person who just re-measured.
   *
   * Deduplicated by blob, not by record: 171 meshes are shared by 520 rows, and
   * five identical lines would read as five defects.
   */
  mountLint: string[]
  /**
   * How well `layer === 'topper'` predicts "needs a separately printed base",
   * scored against the filename's connection token. Measured 1.0 / 0.999 with 4
   * misses, all four corpus defects. `pipeline/aggregate.ts` holds precision at
   * exactly 1 and recall above 99%.
   */
  baseDetection: { precision: number; recall: number; missed: number }
  /**
   * Aggregates holding two distinct composition-slot sets — **828 (21.7%)**.
   *
   * The one field the collapse is not lossless on, which is why the aggregate's
   * slots are the union with provenance rather than a pick. Tracked here because
   * a drop to 0 would mean the union machinery had quietly stopped doing
   * anything.
   */
  aggregatesWithVaryingConfig: number
  /**
   * Distinct refs across every slot's `require`, `deny` and `constrain` — **99**,
   * and every one of them checked by {@link assertConfigRefs}.
   */
  configRefs: number
  /**
   * The `constrain` refs that are **namespace roots and not tags** — `shape`,
   * `size|depth`, `size|width`, `texture`.
   *
   * Row C1's decisive corpus evidence, returned on every build because it is what
   * the ported `constrain` reading rests on: all 91 `require` refs exist as exact
   * tags and none of the 4 `constrain` tag refs does. A grammar with one matching
   * rule for both could not produce that split, so `require` is exact equality
   * and `constrain` is a prefix join. `src/composition/measure.ts` carries the
   * measurement; this is the line that would go quiet if the fixtures changed.
   */
  constrainRoots: string[]
  /**
   * `constrain` filters that are a prefix of no tag, so they remove nothing.
   * **0 today.** Reported rather than asserted: a dead filter is harmless, which
   * is exactly why it would otherwise never be noticed.
   */
  deadConfigFilters: number
}

export interface BuildResult {
  file: CatalogFile
  /** The manifest to write back. */
  manifest: OrdinalManifest
  added: string[]
  retired: string[]
  stats: BuildStats
}

export function buildCatalog(options: BuildOptions): BuildResult {
  const live = liveRows(options.rows)
    .sort((a, b) =>
      a.file_metadata.full_name < b.file_metadata.full_name
        ? -1
        : a.file_metadata.full_name > b.file_metadata.full_name
          ? 1
          : 0,
    )
    .map((row) => ({ ...row, tags: normaliseTags(row.tags) }))

  const ids = live.map((row) => row.file_metadata.full_name)
  const { manifest, ordinalOf, added, retired } = assignOrdinals(options.manifest, ids)
  const { designOf, designs } = buildDesignIndex(
    live.map((row) => ({ id: row.file_metadata.full_name, tags: row.tags })),
  )
  /**
   * Row B1's one new step, and it has to sit **here** rather than inside the
   * record map: `role|x` and `form|x` are emitted as ordinary interned tags, so
   * the ladder has to run before {@link buildTagTable} sees a tag list.
   *
   * Everything else still derives from the row's **own** tags, not from these.
   * The design index, `kindBuckets`, `textureRoot`, `displayName` and the
   * footprint all read `row.tags`; only `record.tags` carries the augmented
   * list. That asymmetry is deliberate — a derived tag that fed a second
   * derivation would make the pipeline's order of operations load-bearing in a
   * way no test could see — and `catalog.test.ts` pins it by de-interning every
   * record and comparing against `[...normaliseTags(raw), role, form]` exactly.
   *
   * `pipeline/role.ts` carries the taxonomy, the measurements behind every rung
   * and the price of the encoding.
   */
  const derived = live.map((row) => {
    const id = row.file_metadata.full_name
    const foot = resolveFootprint(row.tags)
    const build = buildSystem(row.tags)
    const inferred = inferRole({
      tags: row.tags,
      foot,
      family: dirname(id),
      file: basename(id),
      ...(build === undefined ? {} : { build }),
    })
    return { row, id, foot, build, inferred, tags: [...row.tags, ...roleTags(inferred)] }
  })

  const { table, idOf } = buildTagTable(derived.map((entry) => entry.tags))

  const records = derived.map(({ row, id, foot, build, tags }) => {
    const ord = ordinalOf.get(id)
    const design = designOf.get(id)
    if (ord === undefined || design === undefined) throw new Error(`no ordinal or design for ${id}`)

    const texture = textureRoot(row.tags)
    const rotStep = rotationStep(row.tags)
    const sizeCode = openlockSizeCode(row.tags)
    /* Keyed on the md5 for the reason `thumb` is: a measurement is a property of
       the mesh, so the rows sharing one all read the same answer. An empty
       `mounts` array is dropped rather than emitted — see `CatalogRecord.mounts`
       on why absence and emptiness are deliberately the same thing here. */
    const measured = options.mounts.hosts[row.file_metadata.md5]
    const mounts = measured === undefined || measured.mounts.length === 0 ? undefined : measured.mounts
    const anchor = options.mounts.inserts[row.file_metadata.md5]?.anchor

    return {
      id,
      ord,
      blob: row.file_metadata.md5,
      file: basename(id),
      bytes: row.file_metadata.size,
      sprite: (row.images ?? []).some((image) => Boolean(image.image_url)),
      // Keyed on the md5 and not on the id, because the object is
      // content-addressed: the 520 rows sharing 171 meshes all read the same
      // answer, which is the point. `pipeline/thumbs.ts` says why the set comes
      // from a file rather than from a probe inside the build.
      thumb: options.thumbs.has(row.file_metadata.md5),
      family: dirname(id),
      design,
      name: displayName(row.tags, foot, row.file_metadata.file),
      kinds: kindBuckets(row.tags),
      conn: connectionSystems(row.tags),
      ...(build === undefined ? {} : { build }),
      layer: classifyLayer(row.tags),
      ...(texture === undefined ? {} : { texture }),
      tags: tags.map((tag) => {
        const tagId = idOf.get(tag)
        if (tagId === undefined) throw new Error(`tag ${tag} missing from the intern table`)
        return tagId
      }),
      foot,
      ...(rotStep === undefined ? {} : { rotStep }),
      ...(sizeCode === undefined ? {} : { sizeCode }),
      ...(row.config === undefined ? {} : { config: row.config }),
      ...(mounts === undefined ? {} : { mounts }),
      ...(anchor === undefined ? {} : { anchor }),
    }
  })

  const file = CatalogFile.parse({
    version: {
      schema: SCHEMA_VERSION,
      pipeline: PIPELINE_VERSION,
      fixtures: options.fixturesRef,
      manifest: manifest.manifest,
      built: options.builtAt ?? buildTimestamp(),
    },
    assets: ASSET_BASES,
    sprite: MEASURED_SPRITE_SHEET,
    tags: table,
    records,
  })

  const aggregation = measureAggregation(file)
  assertAggregation(aggregation)

  const configRefs = assertConfigRefs(file.records, file.tags)

  return {
    file,
    manifest,
    added,
    retired,
    stats: {
      fixtureRows: options.rows.length,
      deprecated: options.rows.length - live.length,
      records: records.length,
      tags: table.length,
      tagReferences: records.reduce((total, record) => total + record.tags.length, 0),
      designs,
      families: new Set(records.map((record) => record.family)).size,
      footprints: tally(
        records.map((record) => record.foot.shape),
        FOOTPRINT_ORDER,
      ),
      layers: tally(records.map((record) => record.layer)),
      roles: tally(
        derived.map((entry) => entry.inferred.role),
        ROLES,
      ),
      forms: tally(
        derived.map((entry) => entry.inferred.form),
        FORMS,
      ),
      roleConfidence: tally(
        derived.map((entry) => entry.inferred.confidence),
        CONFIDENCE_ORDER,
      ),
      withConfig: records.filter((record) => record.config !== undefined).length,
      withThumb: records.filter((record) => record.thumb).length,
      withMounts: records.filter((record) => record.mounts !== undefined).length,
      withAnchor: records.filter((record) => record.anchor !== undefined).length,
      mountLint: mountLint(live, options.mounts),
      distinctNames: new Set(records.map((record) => record.name)).size,
      newOrdinals: added.length,
      retiredOrdinals: retired.length,
      aggregateClasses: aggregation.stats.classes,
      baseDetection: {
        precision: aggregation.detection.precision,
        recall: aggregation.detection.recall,
        missed: aggregation.detection.falseNegatives,
      },
      aggregatesWithVaryingConfig: aggregation.stats.varies.config ?? 0,
      configRefs: configRefs.refs,
      constrainRoots: configRefs.roots,
      deadConfigFilters: configRefs.deadFilters,
    },
  }
}

/* ------------------------------------------------------------- the mount lint */

/**
 * Every measured-but-unresolved slot on a mesh some live row carries.
 *
 * Scoped to **live rows** deliberately: the inventory is measured against an
 * index that may be a corpus older or newer than this build's, so it can hold
 * hosts that are now deprecated or gone, and complaining about those would send
 * a reader to a fixture that is not there. One line per blob per slot, in
 * `full_name` order, so two runs produce the same report.
 *
 * @see BuildStats.mountLint for why this is a lint rather than a failure.
 */
function mountLint(live: readonly FixtureRow[], inventory: MountInventory): string[] {
  const lines: string[] = []
  const seen = new Set<string>()
  for (const row of live) {
    const blob = row.file_metadata.md5
    if (seen.has(blob)) continue
    seen.add(blob)
    for (const { slot, reason } of inventory.hosts[blob]?.unresolved ?? []) {
      lines.push(`mounts: ${basename(row.file_metadata.full_name)} — slot ${slot} ${reason}`)
    }
  }
  return lines
}

/* ------------------------------------------------------ composition config refs */

/**
 * Hold every composition ref against the tag table it will be resolved through.
 *
 * Row C1's build check, and the seam it guards is specific. A slot's `require`
 * and `deny` refs are **exact tag strings**, verified against the catalog
 * backend's own SQL (`tags.tag = ARRAY[…]`), while a `constrain` ref is a tag
 * *prefix*. Both are carried through from the fixture **verbatim** — and
 * `normaliseTags` rewrites the *records*' tags on the way in. So the two halves
 * of every candidate set are canonicalised by different rules, and the failure
 * mode is silent in the worst way: a ref naming a spelling that no longer exists
 * intersects to nothing, the slot offers no candidate, and the index still
 * validates, still ships and still looks right.
 *
 * `pipeline/normalise.ts` was already aware of this — its `NOT_COLLAPSED` entry
 * for the towne stucco mirror says the tag strings stay "and with them the config
 * refs that name them" — so this makes that argument enforceable rather than
 * advisory. Measured today: **99 distinct refs, 91 exact `require`, 7 `deny`, 4
 * `constrain` roots, 2 filters, and not one of them dangling or aliased.**
 *
 * Three rules, and the asymmetry is deliberate:
 *
 *   - an exact ref must **be** a tag in the table;
 *   - a `constrain` ref must be a **prefix of at least one** tag, or its join can
 *     never fire and the slot silently widens to the whole corpus;
 *   - a `filter` that matches nothing removes nothing, which is harmless, so it
 *     is **counted and reported** rather than fatal.
 *
 * @throws when a ref cannot be resolved through the emitted tag table, or when
 *   `normaliseTag` would rewrite it — naming the ref, the rule it broke and the
 *   first tile that carries it, because the fix is always in the fixture or in
 *   `TAG_ALIASES` and never here.
 */
function assertConfigRefs(
  records: readonly CatalogRecord[],
  tags: readonly string[],
): { refs: number; roots: string[]; deadFilters: number } {
  const exact = new Set(tags)
  const prefixes = new Map<string, boolean>()
  const hasPrefix = (ref: string): boolean => {
    const known = prefixes.get(ref)
    if (known !== undefined) return known
    const found = tags.some((tag) => tag === ref || tag.startsWith(`${ref}|`))
    prefixes.set(ref, found)
    return found
  }

  const seen = new Set<string>()
  const roots = new Set<string>()
  const problems: string[] = []
  let deadFilters = 0

  for (const record of records) {
    for (const slot of record.config?.parts ?? []) {
      const refs: { ref: string; kind: 'require' | 'deny' | 'constrain' | 'filter' }[] = [
        ...(slot.tags.require ?? []).map((entry) => ({ ref: entry.tag, kind: 'require' as const })),
        ...(slot.tags.deny ?? []).map((entry) => ({ ref: entry.tag, kind: 'deny' as const })),
        ...(slot.tags.constrain ?? []).map((entry) =>
          'tag' in entry
            ? { ref: entry.tag, kind: 'constrain' as const }
            : { ref: entry.filter, kind: 'filter' as const },
        ),
      ]

      for (const { ref, kind } of refs) {
        const key = `${kind}\u0000${ref}`
        if (seen.has(key)) continue
        seen.add(key)

        const canonical = normaliseTag(ref)
        if (canonical !== ref) {
          problems.push(
            `${record.id} slot "${slot.name}": \`${kind}\` ref \`${ref}\` is a retired spelling — ` +
              `\`normaliseTag\` rewrites it to \`${canonical}\`, so no record carries it any more`,
          )
          continue
        }

        if (kind === 'require' || kind === 'deny') {
          if (!exact.has(ref)) {
            problems.push(
              `${record.id} slot "${slot.name}": \`${kind}\` ref \`${ref}\` is not a tag in the table, and ` +
                `\`${kind}\` is exact equality — this slot can never match anything`,
            )
          }
          continue
        }

        if (kind === 'constrain') {
          if (!exact.has(ref)) roots.add(ref)
          if (!hasPrefix(ref)) {
            problems.push(
              `${record.id} slot "${slot.name}": \`constrain\` ref \`${ref}\` is a prefix of no tag, so its ` +
                `inheritance can never fire and the slot widens instead of narrowing`,
            )
          }
          continue
        }

        if (!hasPrefix(ref)) deadFilters += 1
      }
    }
  }

  if (problems.length > 0) {
    const lines = problems.slice(0, 10).map((problem) => `  ${problem}`)
    const more = problems.length > lines.length ? `\n  … and ${String(problems.length - lines.length)} more` : ''
    throw new Error(
      `composition config refs do not resolve through the emitted tag table:\n${lines.join('\n')}${more}`,
    )
  }

  return { refs: new Set([...seen].map((key) => key.split('\u0000')[1] ?? '')).size, roots: [...roots].sort(), deadFilters }
}

/**
 * The seven {@link Footprint} cases, enumerated so the tally is a fixed shape.
 *
 * Two things this buys, and neither is cosmetic. **A case that empties out reads
 * as `0` instead of vanishing** — without the seed, `stats.footprints.column`
 * would be `undefined` both when the classifier stops producing columns and when
 * nobody ever modelled them, and every consumer would paper over the difference
 * with `?? 0`. And **the closed set is written down on the pipeline side**, so a
 * `footprintKind` result the schema has no union member for shows up as an
 * eighth key in the stats rather than only later, as a `CatalogFile.parse`
 * failure after the tally has already been taken.
 * `catalog.test.ts` asserts the key set is exactly these seven.
 */
const FOOTPRINT_ORDER: readonly Footprint['shape'][] = [
  'rect',
  'wall',
  'arc',
  'diag',
  'column',
  'tri',
  'none',
]

/**
 * The four trust levels, seeded for the same reason {@link FOOTPRINT_ORDER} is.
 *
 * `none` is deliberately in the list even though it is `0` on every corpus this
 * has run against: it is the key that means *the ladder ran out of rungs*, and a
 * seeded `0` is the difference between "nothing failed to classify" and "nobody
 * looked".
 */
const CONFIDENCE_ORDER: readonly Confidence[] = ['high', 'medium', 'low', 'none']

/**
 * Count occurrences, seeding the keys from `order` where one is given.
 *
 * A seeded key with no occurrences stays `0` rather than being absent, so a case
 * that empties out reads as empty instead of as unmodelled. A value outside
 * `order` is still counted, at the end — losing it silently would be worse than
 * reporting it out of place.
 */
function tally(values: readonly string[], order: readonly string[] = []): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of order) counts[key] = 0
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}
