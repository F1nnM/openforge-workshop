/**
 * OpenForge Workshop — the catalog record, and the `catalog.json` contract.
 *
 * This module is the shared type vocabulary for the whole app. It is inert: it
 * adds Zod schemas and the types inferred from them, and nothing reads it yet.
 * It exists because five workstreams — importer, store, facet engine, assembly
 * resolver, share codec — each need a catalog record, and without one file
 * owning the shape they would each invent their own and diverge.
 *
 * **Zod is the source of truth.** Every exported type is `z.infer`'d from the
 * schema beside it, never hand-written in parallel, so a schema edit cannot
 * leave a stale type behind.
 *
 * **Every non-obvious field carries the measured fact that justifies it, with
 * the number.** The numbers come from `docs/verify-catalog-facts.py`, which
 * re-derives them from `openforge/db/fixtures/blueprints/*.json` and fails CI
 * when they drift; figures it does not derive are re-derived here and labelled
 * as such. Denominator throughout: **8,702 live tiles** (8,721 fixture rows
 * less 19 `deprecated`). Deprecated rows never reach a `CatalogRecord`.
 *
 * **Where validation runs.** `CatalogFile` carries cross-record integrity
 * checks, and they are meant for the importer and CI — parse the artefact once
 * at build time, ship the validated asset, and let the app `fetch` it without
 * re-parsing 8,702 records on every cold load. The store's `persist` rehydrate
 * path (PR 5) is the other place a `parse` genuinely earns its cost, because
 * that data comes back from `localStorage`, not from the build.
 */
import { z } from 'zod'

/* ------------------------------------------------------------------ constants */

/**
 * Millimetres per catalog grid unit.
 *
 * **Measured from the meshes, not assumed.** Bit-exact across 1,042 measured
 * extents, with zero values below 2.0 mm — which is what rules out an inch
 * authoring unit. architecture-plan.md §2, "Units and constants".
 */
export const GRID_UNIT_MM = 25.4

/**
 * Wall thickness in millimetres.
 *
 * **Measured from the meshes, not assumed.** §2. This is the load-bearing
 * constant behind the `wall` footprint: 3,116 tiles (35.8%) carry a numeric
 * `size|width` and no `size|depth` at all, so their depth is not in the data —
 * it is this number.
 */
export const WALL_THICKNESS_MM = 12.7

/**
 * Wall thickness in catalog units — exactly **0.5**.
 *
 * Two independent measurements agree here, which is the reason to trust both:
 * the measured wall thickness is exactly half the measured grid unit, and §7
 * separately records that every dimension in the catalog is a multiple of 0.5
 * units (which is why the builder's 0.25 snap was dropped — a quarter-unit grid
 * can only produce unbuildable placements). `schema.test.ts` asserts the
 * division comes out exact.
 */
export const WALL_THICKNESS_UNITS = WALL_THICKNESS_MM / GRID_UNIT_MM

/**
 * Rotation step in degrees for a tile that carries no `size|angle` tag.
 *
 * §7. The default is 90°, but it is only a default: **893 live tiles carry an
 * angle that is not a multiple of 90** (45°, 22.5°, 11.25°, 60°, 120°, 240°,
 * 300°) and would never tile on a 90° step, so `CatalogRecord.rotStep` overrides
 * it per tile.
 */
export const DEFAULT_ROTATION_STEP_DEG = 90

/**
 * Version of *this contract* — the record shape, not the data.
 *
 * Bump it in the same commit that changes a field's meaning, so a `catalog.json`
 * built against an older shape is rejected rather than silently half-read.
 * The importer stamps it from here rather than choosing its own number.
 */
export const SCHEMA_VERSION = 1

/* ---------------------------------------------------------------- identities */

/**
 * Catalog identity: the fixture's `full_name`, e.g.
 * `tiles/cave/thick_wall/wall/corner/openlock/cave%aggregate+2#corner.IL+corner,90.openlock.stl`.
 *
 * This — not the md5 — is the primary key. React keys, placements and share
 * links all address a tile by `id`. All 8,702 live `full_name` values start
 * `tiles/`.
 */
export const TileId = z.string().min(1).brand<'TileId'>()
export type TileId = z.infer<typeof TileId>

/**
 * Content address: the file's md5, 32 lowercase hex characters (verified: all
 * 8,702 live rows).
 *
 * **`blob` is deliberately not the primary key, and the type system is what
 * stops it becoming one.** 171 md5 values are shared by 520 rows — the same
 * physical STL filed under two catalog paths, which is correct data modelling
 * and fatal to md5-as-id. Keying on it would silently collapse those 520 rows
 * to 171. It is still the right key for the two jobs that are about *bytes*
 * rather than about catalog entries: deduping the bill of tiles, and deduping
 * the download pack.
 *
 * `TileId` and `BlobId` are branded, so neither is assignable to the other and
 * a mixed-up argument is a compile error rather than a hash lookup that misses.
 * (89 filenames map to 2–3 genuinely different meshes, so the *filename* is not
 * a key either — see `CatalogRecord.file`.)
 */
export const BlobId = z
  .string()
  .regex(/^[0-9a-f]{32}$/, 'md5 must be 32 lowercase hex characters')
  .brand<'BlobId'>()
export type BlobId = z.infer<typeof BlobId>

/**
 * A design: one tile collapsed across its connection variants.
 *
 * §7, "Place designs, not files". There are **3,822 distinct designs** at 2.28
 * files per design; the user places a design and the concrete STL resolves at
 * download time from their lock preference. Opaque and branded on purpose — the
 * importer picks the encoding (a short stable key is worth it, since 2.28
 * records share each one).
 *
 * The design→(texture, lock) resolution table §7 calls for is **specified but
 * not yet measured**, and collapsing texture as well (2,428 designs, 3.58 files
 * each) can leave a chosen pair with no file at all. That table is deliberately
 * not modelled here.
 */
export const DesignId = z.string().min(1).brand<'DesignId'>()
export type DesignId = z.infer<typeof DesignId>

/**
 * An index into `CatalogFile.tags`.
 *
 * The live corpus holds **84,023 tag references over 916 distinct tag strings**
 * (9.7 tags per tile), so the intern table replaces ~92 repetitions of each
 * string with one. Branding keeps a tag id from being passed where a manifest
 * ordinal is expected — both are small non-negative integers over the same
 * records, and confusing them would be silent.
 */
export const TagId = z.number().int().nonnegative().brand<'TagId'>()
export type TagId = z.infer<typeof TagId>

/**
 * The integer a share link encodes in place of a `TileId`.
 *
 * **Append-only, and this is the invariant the whole share-link system rests
 * on.** §13 names manifest index drift as the worst silent failure in the
 * system: a link encodes ordinals, so if an import reorders them every existing
 * link decodes to a *different room*, with no error anywhere.
 *
 * The invariant, stated so the importer (PR 4) and CI can assert it:
 *
 *   1. A `TileId` that has ever been assigned an ordinal keeps that ordinal
 *      **for ever**, across every subsequent import.
 *   2. New tiles take ordinals strictly above every ordinal issued so far.
 *   3. A tile that leaves the corpus **retires** its ordinal — the number is
 *      never reissued to a different tile. Ordinals are therefore not dense,
 *      and nothing may assume `ord === index in records`.
 *   4. If any of the above is ever broken deliberately,
 *      `CatalogFile.version.manifest` must be bumped in the same commit, which
 *      is what lets an old link fail loudly instead of decoding wrongly.
 *
 * Rule 3 is why md5 churn is called out as a live risk (§16): a re-exported
 * mesh is a new blob under the same path, and the ordinal must follow the path.
 */
export const ManifestOrdinal = z.number().int().nonnegative().brand<'ManifestOrdinal'>()
export type ManifestOrdinal = z.infer<typeof ManifestOrdinal>

/* ----------------------------------------------------------------- footprint */

/** A length along a catalog axis, in grid units (multiply by `GRID_UNIT_MM` for mm). */
const unitLength = z.number().positive().finite()

/** An angle in degrees. Not constrained to 0–360: `size|angle|270` is a real corner sweep. */
const degrees = z.number().finite()

/**
 * The single primitive the builder places a tile with.
 *
 * Four cases, and the shares are the reason the builder is scoped the way it is
 * (definitions are `verify-catalog-facts.py`'s, which is why they reproduce):
 *
 * | case   | definition                                              | live tiles     |
 * | ------ | ------------------------------------------------------- | -------------- |
 * | `rect` | numeric `size|width` **and** `size|depth`, no curve mark | 3,051 (35.1%)  |
 * | `wall` | numeric `size|width` only — depth is `WALL_THICKNESS_MM` | 3,116 (35.8%)  |
 * | `arc`  | carries `size|radius`                                    | 1,391 (16.0%)  |
 * | `none` | no derivable footprint                                   | 1,144 (13.1%)  |
 *
 * `rect` + `wall` is **70.9%** and is v1's builder scope; adding `arc` reaches
 * **86.9%** in v1.1.
 *
 * Two things this shape encodes on purpose:
 *
 *   - **`wall` has no depth field.** The depth is not in the data for any of
 *     those 3,116 tiles; it is the measured 12.7 mm constant. Giving the case a
 *     `d` field would invite an importer to write a guess into it.
 *   - **`arc` is parameterised on radius and angle, not on the tagged width and
 *     depth.** The size tags are design-family labels, not measurements: they
 *     agree exactly for 81% of plain rectangles but diverge badly on curves,
 *     where the tag names the curve family while the mesh is a fragment of it
 *     (median error 96 mm, max 163 mm).
 *
 * `none` is a first-class case, not a null. 1,144 tiles are hex, concave or
 * convex without a radius: no primitive describes them, and placing one as a
 * rectangle would be *wrong* rather than approximate. They appear in the
 * catalog and in the bill of materials, never in the placement palette — a
 * distinction the union makes checkable.
 *
 * The search layer's synthesised size token (`"4x4"`, `"2r90"` — §6) is
 * derivable from this union, so it is not duplicated as a record field.
 */
export const Footprint = z.discriminatedUnion('shape', [
  z.object({ shape: z.literal('rect'), w: unitLength, d: unitLength }),
  z.object({ shape: z.literal('wall'), length: unitLength }),
  z.object({ shape: z.literal('arc'), radius: unitLength, angle: degrees }),
  z.object({ shape: z.literal('none') }),
])
export type Footprint = z.infer<typeof Footprint>

/* --------------------------------------------------------------------- layer */

/**
 * Where a tile sits in an assembly.
 *
 * §2, "the catalog is a parts list": 4,363 tiles (50.1%) carry
 * `connection|openforge`, which delegates joinery to a separately printed base,
 * and 1,963 (22.6%) are themselves `shape|base`. So a placement is an assembly —
 * a base plus a topper — not a single file.
 *
 *   - `base`    — a `shape|base` piece; carries the joinery for what sits on it.
 *   - `topper`  — sits on a base; this is what `connection|openforge` means.
 *   - `integral` — carries its own joinery and needs no base.
 *   - `insert`  — a component fitted into another piece (door, grate, torch),
 *     reached through a composition slot rather than placed on the grid.
 *
 * **Never match a base to a topper on the `build|` tag.** Zero bases carry
 * `build|wall on tile` while 863 toppers use that system, so joining on it
 * matches nothing — silently. Matching is on shape plus `sizeCode` (§7).
 */
export const Layer = z.enum(['base', 'topper', 'integral', 'insert'])
export type Layer = z.infer<typeof Layer>

/* ------------------------------------------------------- composition configs */

/**
 * A reference to a tag prefix, e.g. `{ tag: 'shape|base' }`.
 *
 * Verified shape: every one of the 5,431 `require` and 1,107 `deny` entries in
 * the live corpus is exactly this — a single-key object whose key is `tag`.
 */
export const TagRef = z.object({ tag: z.string().min(1) })
export type TagRef = z.infer<typeof TagRef>

/**
 * One `constrain` entry. Two forms, both present in the fixtures:
 * `{ tag: 'size|width' }` (7,344 occurrences) and `{ filter: 'shape|floor' }`
 * (1,812).
 *
 * **`constrain` is not a filter, and its exact semantics are an open question.**
 * §5: it means "inherit this from the parent or a named sibling" — a *join*.
 * Under one reading the median slot has thousands of candidates, under another
 * twelve, and precomputed candidate sets range from 29 KB to 9.4 MB accordingly.
 * That is the largest single unknown in the plan and it is a research task.
 *
 * So this module models the **raw grammar faithfully and resolves nothing**. No
 * candidate sets, no resolved slots, no interpretation of `filter` versus `tag`.
 * When the semantics are pinned down, §5's instruction is to port the catalog
 * frontend's existing `src/utils/config-processing.ts` (~140 lines, 69 tests)
 * rather than derive them afresh — and that port owns the resolved shape.
 */
export const ConstrainRef = z.union([TagRef, z.object({ filter: z.string().min(1) })])
export type ConstrainRef = z.infer<typeof ConstrainRef>

/**
 * One accessory slot on a composition.
 *
 * Measured over the 3,695 live slots: `require` is present on all 3,695,
 * `constrain` on 2,448 and `deny` on 1,105 — so only `require` is universal, and
 * all three are optional here anyway, because a schema that rejects a future
 * deny-only slot would fail the build for a fixture change that is not a bug.
 *
 * `optional` is absent on 1,050 of 3,695 slots and **absence means required**.
 * 2,645 (71.6%) are optional; of the 2,451 `base` slots, 2,448 are optional and
 * the three that are not are the infinite-hallway pieces, which genuinely need a
 * `shape|base|hallway`. Only 879 tiles (10.1%) have any required slot at all, so
 * **7,823 tiles (89.9%) are self-sufficient** — compositions are an accessory
 * layer, not the main event.
 *
 * `id` groups sibling slots that must resolve together (the left/right halves of
 * a grate). Six occurrences corpus-wide; rare, but dropping it would silently
 * decouple those pairs.
 */
export const PartSlot = z.object({
  name: z.string().min(1),
  id: z.string().min(1).optional(),
  optional: z.boolean().optional(),
  tags: z.object({
    require: z.array(TagRef).optional(),
    deny: z.array(TagRef).optional(),
    constrain: z.array(ConstrainRef).optional(),
  }),
})
export type PartSlot = z.infer<typeof PartSlot>

/**
 * A tile's composition declaration, carried through from the fixture unchanged.
 *
 * 3,036 live tiles (34.9%) declare one; 2,501 of those (82.4%) have exactly one
 * slot. `fulfills` — 21 tiles, every entry a `{ part: string }` — is the inverse
 * relation, naming the slot this tile can fill.
 */
export const CompositionConfig = z.object({
  parts: z.array(PartSlot).optional(),
  fulfills: z.array(z.object({ part: z.string().min(1) })).optional(),
})
export type CompositionConfig = z.infer<typeof CompositionConfig>

/* -------------------------------------------------------------------- record */

/**
 * One live tile.
 *
 * Field order follows identity → provenance → facets → geometry → composition.
 * Keys are short because there are 8,702 of these and §5 budgets 500 KB brotli
 * for the whole index against a measured 261 KB floor.
 */
export const CatalogRecord = z.object({
  /** Catalog identity — the fixture `full_name`. See {@link TileId}. */
  id: TileId,

  /** Share-link ordinal. Append-only for ever; see {@link ManifestOrdinal}. */
  ord: ManifestOrdinal,

  /** Content address — the md5. Not an identity; see {@link BlobId}. */
  blob: BlobId,

  /**
   * The original filename, `basename(full_name)`.
   *
   * Kept because a zip needs a human-readable entry name, and flagged because
   * **89 filenames map to 2–3 genuinely different meshes**. Naming zip entries
   * by this field silently overwrites; §11 requires disambiguating from `id`.
   */
  file: z.string().min(1),

  /**
   * File size in bytes.
   *
   * Feeds `client-zip`'s `predictLength` (§11) — the reason it is in the index
   * rather than fetched with a HEAD per file. Corpus: 108.0 GB total, median
   * 10.36 MB, p95 32.89 MB, largest 108.9 MB, which is also why room size is a
   * warning surface and why the 3D viewer is gated on it.
   */
  bytes: z.number().int().nonnegative(),

  /**
   * Whether a sprite sheet exists for this tile.
   *
   * 8,701 of the 8,702 live tiles have exactly one; one has none. Modelled
   * explicitly rather than assumed, so the single exception renders a fallback
   * instead of a broken image. The URL itself is derived — see
   * {@link CatalogAssets}.
   */
  sprite: z.boolean(),

  /**
   * `dirname(full_name)` — 1,130 distinct values. §5.
   *
   * This is the **catalog** family (a Dropbox folder), which drives "other
   * variants of this tile" in the detail drawer. It is *not* the material
   * family: plan-view fills and 3D tints resolve from `texture` through the
   * material registry (§9, PR 8). Two different notions, one word — hence the
   * note.
   */
  family: z.string().min(1),

  /** The design this file is one connection variant of. See {@link DesignId}. */
  design: DesignId,

  /** Display name synthesised from tags at import (§5); `file` stays as metadata. */
  name: z.string().min(1),

  /**
   * Kind buckets — **an array, never a single value**.
   *
   * §6 quotes 19.6% of tiles in 2+ buckets and 11.6% in none; those two figures
   * are the plan's, not `verify-catalog-facts.py`'s. Re-deriving them here from
   * `shape|` roots, the closest reproduction is the vocabulary {floor, wall,
   * base, stairs, column, riser, angled}, giving **19.5% in 2+ and 11.9% in
   * none** — same conclusion, and the conclusion is what the type encodes: a
   * tile is not in exactly one bucket, so kind is a multi-select facet over an
   * array and an empty array is a legitimate value.
   *
   * The bucket vocabulary is the importer's (PR 4) to fix, which is why this is
   * `string[]` and not an enum. One trap worth carrying forward: `shape|door`
   * has **zero** occurrences — a door is a `component|door` mounted on a wall,
   * so a "doors" kind built from shape tags silently yields nothing.
   */
  kinds: z.array(z.string().min(1)),

  /**
   * Connection systems, normalised — also multi-valued.
   *
   * 3,091 tiles (35.5%) carry 2–3 distinct systems, 4,363 (50.1%) carry
   * `connection|openforge`, 3,935 (45.2%) carry a lock system, and 349 (4.0%)
   * carry no `connection|` tag at all.
   *
   * §5 folds the third-segment modifiers (`topless`, `unsupported`, `flex`,
   * `filament`, `split`) into their systems. Note for the importer: the raw tags
   * do **not** yield a system by taking the segment after `connection|` blindly —
   * `connection|side|openlock` (1,495 tags) and `connection|side|dragonlock`
   * (470) put a *position* there, so `side` would become a phantom system on
   * the 2,081 tiles carrying any `connection|side` tag. Build and connection
   * stay separate fields throughout (§6): fusing
   * them makes `openforge`, the project's own flagship connector, unreachable.
   */
  conn: z.array(z.string().min(1)),

  /**
   * Build system — optional, and **absence is a real state, not a gap**.
   *
   * 2,978 tiles (34.2%) carry no `build|` tag, so the facet needs a first-class
   * "unspecified" rather than treating a third of the corpus as missing data.
   * Five values occur: `separate wall` (3,351), `wall on tile` (863), `s2w`
   * (633), `thick wall` (591), `s-system` (286).
   */
  build: z.string().min(1).optional(),

  /** Where this sits in an assembly. See {@link Layer}. */
  layer: Layer,

  /**
   * Texture root — the first segment after `texture|`, e.g. `dungeon_stone`.
   *
   * 38 distinct roots, all of which the material registry must cover (§9).
   * Optional because 89 tiles (1.0%) carry no texture tag and fall back to the
   * unknown material. Beware tag drift (§16): `texture|towne|stone-stucco` and
   * `texture|towne|stucco-stone` are one material tagged twice with the words
   * reversed, so the importer normalises before this field is written.
   */
  texture: z.string().min(1).optional(),

  /**
   * The tile's full tag list, interned. Indices into `CatalogFile.tags`.
   *
   * The facets above are projections of these; the full list is kept because the
   * detail drawer shows every tag and the composition matcher needs them all.
   */
  tags: z.array(TagId),

  /** The placement primitive. See {@link Footprint}. */
  foot: Footprint,

  /**
   * Rotation step in degrees, from `size|angle`. Absent means
   * {@link DEFAULT_ROTATION_STEP_DEG}.
   *
   * Present on 1,548 tiles; **893 carry a value that is not a multiple of 90**
   * and would never tile on a 90° step. Observed values: 90, 45, 22.5, 60, 270,
   * 11.25, 120, 240, 300.
   */
  rotStep: degrees.positive().optional(),

  /**
   * The `size|openlock` code — `A`, `BA`, `IA`, `D`, `Q`, `IL`, … (36 distinct
   * codes on 4,030 tiles).
   *
   * Hoisted out of `tags` because it is the base↔topper matching key (§7:
   * A→2, BA→1.5, IA→1, D→3, Q→4) and the assembly resolver compares it across
   * candidate pairs, where de-interning per comparison would be wasteful.
   */
  sizeCode: z.string().min(1).optional(),

  /** Composition slots, carried through unresolved. See {@link CompositionConfig}. */
  config: CompositionConfig.optional(),
})
export type CatalogRecord = z.infer<typeof CatalogRecord>

/* ------------------------------------------------------------- file contract */

/**
 * Where derived files live, so the record does not carry URLs.
 *
 * Verified across all 8,702 live rows with **zero exceptions**: every
 * `storage_address` is exactly
 * `https://objects.openforge.tools/models/{md5[0:6]}/{md5}.stl`, and every one
 * of the 8,701 sprite URLs is the same shape under `/sprites/` with `.png`.
 * Every live file is a `.stl`.
 *
 * That regularity is worth exploiting rather than restating: storing both URLs
 * per record would add roughly 600 KB of raw JSON to an index budgeted at 500 KB
 * brotli, to say the same thing 8,702 times. Bases live here, paths come from
 * {@link shardedPath}, and `thumbs` is the new 256 px WebP derivative (§8).
 */
export const CatalogAssets = z.object({
  models: z.url(),
  sprites: z.url(),
  thumbs: z.url(),
})
export type CatalogAssets = z.infer<typeof CatalogAssets>

/**
 * Sprite sheet geometry.
 *
 * Verified uniform across every one of the 8,701 live sheets: 2 rows × 5
 * columns of 512 px frames, 10 named camera angles, frame 0 the default. Held
 * as data rather than as a constant so a future sheet layout is expressible
 * without a schema change — but held **once** for the whole file, not per
 * record, because it does not vary today.
 */
export const SpriteSheet = z.object({
  rows: z.number().int().positive(),
  cols: z.number().int().positive(),
  /** Edge length of one frame, in pixels. */
  tile: z.number().int().positive(),
  /** Total frames; equals `rows * cols` today. */
  frames: z.number().int().positive(),
  /** Frame shown first, and the one the thumbnail derivative is cropped from. */
  defaultFrame: z.number().int().nonnegative(),
})
export type SpriteSheet = z.infer<typeof SpriteSheet>

/** The measured sprite layout, for the importer to stamp and tests to compare against. */
export const MEASURED_SPRITE_SHEET: SpriteSheet = {
  rows: 2,
  cols: 5,
  tile: 512,
  frames: 10,
  defaultFrame: 0,
}

/**
 * The stamp every derived artefact embeds.
 *
 * §16 names import drift as risk 1: three artefacts derive from the same pinned
 * fixture snapshot — this index, the LOD store and the share-link manifest — and
 * a mismatch between them has no symptom until a share link opens the wrong
 * room. Five fields because they move independently:
 */
export const VersionStamp = z.object({
  /** {@link SCHEMA_VERSION} — the record shape. Owned by this module. */
  schema: z.number().int().nonnegative(),
  /** The importer's derivation rules. Bumped when a field's *derivation* changes. */
  pipeline: z.number().int().nonnegative(),
  /** The pinned `openforge-catalog` commit the fixtures were read from (§5). */
  fixtures: z.string().min(1),
  /**
   * Manifest version. Share links carry it so a mismatch is **detectable**
   * rather than decoding silently to a different room (§13). Bump it only when
   * the append-only ordinal invariant is deliberately broken.
   */
  manifest: z.number().int().nonnegative(),
  /** Build timestamp, ISO-8601 with a `Z` offset. */
  built: z.iso.datetime(),
})
export type VersionStamp = z.infer<typeof VersionStamp>

/**
 * The whole of `catalog.json`.
 *
 * Three integrity checks ride on the parse, because each of them fails silently
 * otherwise:
 *
 *   1. **No dangling tag id.** An out-of-range `TagId` de-interns to
 *      `undefined` and surfaces as a tile that simply never matches a facet.
 *   2. **`id` is unique.** Duplicates are what md5-as-key would produce, and
 *      React would render the collision as a disappearing card.
 *   3. **`ord` is unique.** Two tiles sharing an ordinal makes every share link
 *      containing it ambiguous. Uniqueness is checkable inside one file;
 *      *stability across imports* is not, and is asserted by the importer's own
 *      test against the previous manifest — see {@link ManifestOrdinal}.
 */
export const CatalogFile = z
  .object({
    version: VersionStamp,
    assets: CatalogAssets,
    sprite: SpriteSheet,
    /** The tag intern table. A {@link TagId} is an index into this array. */
    tags: z.array(z.string().min(1)),
    /** Live tiles only — the 19 `deprecated` fixture rows never appear. */
    records: z.array(CatalogRecord),
  })
  .superRefine((file, ctx) => {
    const seenIds = new Set<string>()
    const seenOrds = new Set<number>()
    file.records.forEach((record, i) => {
      for (const tag of record.tags) {
        if (tag >= file.tags.length) {
          ctx.addIssue({
            code: 'custom',
            message: `tag id ${String(tag)} is out of range (intern table holds ${String(file.tags.length)})`,
            path: ['records', i, 'tags'],
          })
        }
      }
      if (seenIds.has(record.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate id ${record.id}`, path: ['records', i, 'id'] })
      }
      seenIds.add(record.id)
      if (seenOrds.has(record.ord)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate manifest ordinal ${String(record.ord)}`,
          path: ['records', i, 'ord'],
        })
      }
      seenOrds.add(record.ord)
    })
  })
export type CatalogFile = z.infer<typeof CatalogFile>

/* ------------------------------------------------------------------- helpers */

/**
 * The two-level path a blob is stored under: `{md5[0:6]}/{md5}`.
 *
 * One function rather than four copies of `slice(0, 6)` — the download pack,
 * the detail drawer, the thumbnail pipeline and the 3D viewer all need it, and
 * an off-by-one in any of them is a 404 the app cannot distinguish from a
 * missing file.
 */
export function shardedPath(blob: BlobId): string {
  return `${blob.slice(0, 6)}/${blob}`
}

/**
 * De-intern a record's tags against its file's intern table.
 *
 * Throws on a dangling id rather than returning `undefined` holes.
 * {@link CatalogFile} rejects those at parse time, so reaching the throw means
 * the record and the table came from different builds.
 */
export function resolveTags(file: CatalogFile, record: CatalogRecord): string[] {
  return record.tags.map((tag) => {
    const value = file.tags[tag]
    if (value === undefined) {
      throw new Error(`tag id ${String(tag)} is not in the intern table`)
    }
    return value
  })
}
