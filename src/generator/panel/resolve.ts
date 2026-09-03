/**
 * Catalog-first resolution, and the gate that keeps it honest.
 *
 * The archive holds **1,963 bases** and they are output of the vendored
 * geometry, swept by upstream's `bases.py`. So the first question the panel
 * asks about a parameter set is not "how long will this take to render" but
 * "does Devon already publish this file" — and when the answer is yes the panel
 * paints a sprite immediately, offers the published STL, and never touches the
 * 10.5 MB engine.
 *
 * ## The map is derived in the browser and ships as zero bytes
 *
 * Row S4 was written expecting a build-time reverse index, *"~12 KB brotli
 * riding in the index"*. Measured at `PAYLOAD_EPOCH` the way rows C1 and A1
 * measured theirs, it is **3,650 B** — the plan's estimate is 3.4x high — and it
 * is not shipped at all, because the index already contains every input: each
 * base record carries its `file`, and the filename *is* the parameter tuple. The
 * 709 keys are 132,954 B raw and 3,639 B brotli on their own; adding them takes
 * the index from 365,603 B to 369,253 B, 72.1% of the 500 KB budget, to say
 * something a reader recomputes in **31 ms** over all 8,702 records, once,
 * memoised on the index file. That is the shape rows A1 and C1 settled on for
 * the aggregate and for `constrain`, for the same reason and on the same kind of
 * measurement. `resolve.test.ts` re-measures every number in this paragraph, so
 * none of them can go stale quietly.
 *
 * What *is* in the build is the gate. `pipeline/build.ts` classifies every base
 * filename through {@link classifyArchiveBase} and fails on one it cannot
 * account for, so a new archive file with an unreadable name stops the build
 * instead of quietly becoming unresolvable.
 *
 * ## What a hit claims, and what it does not
 *
 * A hit says: **the archive publishes the base these parameters name.** It does
 * not say the engine would produce those bytes, and the difference is not
 * hypothetical. The archived bases are **ASCII** STL — `solid OpenSCAD_Model`,
 * read off `objects.openforge.tools` — exported by an older revision of this
 * geometry. `corpus.test.ts` searched the entire connector space of a 1x1
 * square, 144 renders through `bases-square.scad` and 40 through the legacy
 * `bases.scad`, and matched the archived 1x1's md5 **zero times** and even its
 * facet count zero times: 760 facets published against 296 and 1,428 for the
 * two candidate tuples. So `expectedMd5` is **not** passed to the engine — S3's
 * `catalogued-mismatch` wording attributes a difference to the native/WASM gap,
 * which is not the cause here — and every generated mesh is `self-addressed`,
 * whose own sentence is the right one: it *"identifies these bytes rather than
 * vouching for them"*.
 *
 * ## Five classes, and every base is in exactly one
 *
 * The gate cannot be a parser with a fallback, because a fallback is what makes
 * an unparseable name look handled. Every one of the 1,963 falls into one of
 * five classes on evidence in the filename, cross-checked against a field the
 * pipeline derived independently:
 *
 *   - **`generated`** — the sweep replay produces this exact file.
 *   - **`sculpted`** — the style is a texture rather than `plain`. No OpenSCAD
 *     path exists: the generator bolts connectors onto a fixed sculpt, it does
 *     not make the sculpt.
 *   - **`size-code`** — the size token is an OpenLOCK letter code, and it equals
 *     the `sizeCode` the pipeline derived from the tags. No generator parameter
 *     names a letter code, so these are unreachable by construction.
 *   - **`unswept-coordinate`** — a shape the tables carry at a size they do not.
 *   - **`unswept-shape`** — a `plain` dimensioned base from a sweep these tables
 *     do not carry at all, named in {@link UNSWEPT_SHAPES} one by one.
 *
 * Anything else throws. That is the whole gate.
 */
import type { CatalogRecord } from '@/catalog'

import type { BaseRecipe } from './recipe'
import { canonicalise, recipeKey } from './recipe'
import type { SweptBase } from './sweep'
import { SWEEPS, replaySweeps } from './sweep'

/* -------------------------------------------------------------- the filename */

/** A base filename split into the four fields `bases.py` writes. */
export interface FilenameParts {
  /** `plain`, or a texture name like `dungeon_stone%eroded`. */
  readonly style: string
  /** Everything between `#` and the first `.` — `base+square`, `riser+low+square`. */
  readonly morphology: string
  /** The size token. May contain a `.`, as `4r22.5°` does. */
  readonly size: string
  /** The connector list, `,`-joined, each optionally `+suffix`. */
  readonly options: string
}

export class BaseFilenameError extends Error {
  override readonly name = 'BaseFilenameError'
}

/**
 * Split a base filename.
 *
 * Not `split('.')`: a radial size token carries a decimal point, so
 * `plain#base+curved+radial.4r22.5°.dragonlock.stl` has five dot-fields for four
 * parts. The morphology ends at the first `.` and the options begin after the
 * last, which holds for every filename in the archive because a connector token
 * is `[a-z_+,]` by construction.
 */
export function splitBaseFilename(file: string): FilenameParts {
  if (!file.endsWith('.stl')) throw new BaseFilenameError(`${file} is not an .stl`)
  const stem = file.slice(0, -'.stl'.length)
  const hash = stem.indexOf('#')
  const firstDot = stem.indexOf('.')
  const lastDot = stem.lastIndexOf('.')
  if (hash < 0 || firstDot < 0 || lastDot === firstDot) {
    throw new BaseFilenameError(`${file} is not <style>#<morphology>.<size>.<options>.stl`)
  }
  const options = stem.slice(lastDot + 1)
  if (!/^[a-z_]+(\+[a-z_]+)?(,[a-z_]+(\+[a-z_]+)?)*$/.test(options)) {
    throw new BaseFilenameError(`${file} has an unreadable connector list ${JSON.stringify(options)}`)
  }
  return {
    style: stem.slice(0, hash),
    morphology: stem.slice(hash + 1, firstDot),
    size: stem.slice(firstDot + 1, lastDot),
    options,
  }
}

/**
 * The join key: the morphology as an **unordered token set**, plus size and
 * options verbatim.
 *
 * The archive spells one shape two ways — `base+s2w+square+corner` (21 files)
 * and `base+square+s2w+corner` (8) — because the sweep was renamed between runs
 * and both outputs were kept. A key built by concatenating tokens in order
 * matches one and misses the other, silently. Sorting absorbs it, which is what
 * §5.2 meant by *"parsing into an unordered token set at build time"*.
 */
export function joinKey(parts: FilenameParts): string {
  const tokens = parts.morphology.split(/[+,]/).filter((token) => token !== '')
  return `${parts.style}|${[...tokens].sort().join(',')}|${parts.size}|${parts.options}`
}

/** Size tokens the sweep drivers write. Anything else is a code or a legacy form. */
const DIMENSION_GRAMMARS: readonly RegExp[] = [
  /^\d+x\d+(\+\d+r)?(\+notch)?(\+[abc])?$/, // squares, curves, inverted curves
  /^\d+r\d+(\.\d+)?°$/, // radial segments
  /^\d+(\.\d+)?°$/, // hex corners, by angle
]

export function isDimensionSize(size: string): boolean {
  return DIMENSION_GRAMMARS.some((grammar) => grammar.test(size))
}

/**
 * `plain` dimensioned shapes the archive holds and `bases.py`'s current tables
 * do not produce, each with the reason it is not a defect.
 *
 * Named one at a time on purpose. A prefix rule here — "anything with
 * `thick_wall`" — is what would let a genuinely new, genuinely broken filename
 * pass the gate.
 */
export const UNSWEPT_SHAPES: Readonly<Record<string, string>> = {
  'base,thick_wall': 'the thick-wall bases, swept before the shape was split out',
  'base+hex,thick_wall': 'hex corners under the pre-split name; the current table writes base+hex+corner',
  'base+s-system': 'the S-system connector, which no vendored entry point offers',
  'base+phone_portal': 'bases-portal.scad, driven by no table in bases.py',
  'base+phone_portal+left': 'bases-portal.scad, left half',
  'base+phone_portal+right': 'bases-portal.scad, right half',
  'base+hallway': 'bases-hallway.scad, driven by no table in bases.py',
  'base+electronics+hallway': 'bases-hallway.scad with ELECTRONICS, likewise undriven',
  'base+electronics+square': 'bases-square.scad with ELECTRONICS="true", a sweep since removed',
  'base+mirror+curved': 'a mirrored curve; no current table sets it',
  'base+curved+concave': 'concave curves, from the legacy bases.scad monolith',
  'base+curved+convex': 'convex curves, from the legacy bases.scad monolith',
  'base,floor+portal': 'a portal floor, from no current table',
  'base+angled': 'bases-diagonal.scad under the Nx+A° size grammar, since replaced by NxM',
}

/**
 * Suffixes a letter-code size token may carry, and what each means.
 *
 * `plain#base.BA+mirror` and `plain#base.IA+dual` are one archived piece each,
 * not a size grammar: the code is `BA`, the suffix is a variant of the same
 * piece. Enumerated rather than matched with `+\\w+`, so a suffix nobody has
 * seen before reaches the gate instead of being absorbed by it.
 */
export const SIZE_CODE_MODIFIERS: Readonly<Record<string, string>> = {
  mirror: 'the mirrored hand of the same piece',
  dual: 'the dual-connector variant of the same piece',
}

/** Size tokens that are neither a dimension nor the record's own letter code. */
export const LEGACY_SIZES: Readonly<Record<string, string>> = {
  '2r': 'a bare radius, from the legacy monolith',
  '2x+60°': 'the angled sweep at 2 squares, 60 degrees',
  '3x+60°': 'the angled sweep at 3 squares, 60 degrees',
  '4x+60°': 'the angled sweep at 4 squares, 60 degrees',
  'corner,60°': 'a hex corner under the pre-split name',
  'corner,120°': 'a hex corner under the pre-split name',
  'corner,240°': 'a hex corner under the pre-split name',
  'corner,300°': 'a hex corner under the pre-split name',
  'IL+corner,270°': 'a thick-wall internal corner at 270 degrees',
  'IL+corner,270': 'a thick-wall internal corner at 270 degrees, no degree sign',
}

/* ------------------------------------------------------------ classification */

export type ArchiveBaseClass =
  | { readonly kind: 'generated'; readonly swept: SweptBase }
  | { readonly kind: 'sculpted'; readonly texture: string }
  | { readonly kind: 'size-code'; readonly code: string }
  | { readonly kind: 'unswept-coordinate'; readonly size: string }
  | { readonly kind: 'unswept-shape'; readonly reason: string }

/** The token sets the sweep tables cover, whatever coordinate they cover them at. */
const SWEPT_SHAPES: ReadonlySet<string> = new Set(
  SWEEPS.flatMap((sweep) => {
    const prefix = sweep.kind === 'riser' ? 'riser' : 'base'
    const variants = sweep.kind === 'riser'
      ? Object.values({ 1: 'platform', 2: 'low', 3: 'medium', 4: 'high' }).map((name) => `${sweep.shape},${name}`)
      : [sweep.shape, `${sweep.shape},wall_locks`, `${sweep.shape},a`, `${sweep.shape},b`, `${sweep.shape},c`]
    return variants.map((shape) =>
      [prefix, ...shape.split(/[+,]/)].filter((token) => token !== '').sort().join(','),
    )
  }),
)

/**
 * Which class one archived base is in. Throws when it is in none.
 *
 * `replayed` is the map {@link buildBaseResolver} builds; passing it in keeps
 * this function pure and lets `pipeline/build.ts` reuse one replay across 1,963
 * records rather than rebuilding it per record.
 */
export function classifyArchiveBase(
  record: Pick<CatalogRecord, 'file' | 'sizeCode'>,
  replayed: ReadonlyMap<string, SweptBase>,
): ArchiveBaseClass {
  const parts = splitBaseFilename(record.file)
  const swept = replayed.get(joinKey(parts))
  if (swept !== undefined) return { kind: 'generated', swept }
  if (parts.style !== 'plain') return { kind: 'sculpted', texture: parts.style }

  const tokens = parts.morphology.split(/[+,]/).filter((token) => token !== '')
  const shapeKey = [...tokens].sort().join(',')

  if (!isDimensionSize(parts.size)) {
    // A letter code, checked against the code the pipeline derived from the tags
    // rather than against a regex of our own. Two independent readings of the
    // same file agreeing is the only reason to believe either.
    const [code = '', ...modifiers] = parts.size.split('+')
    if (record.sizeCode === code && modifiers.every((modifier) => modifier in SIZE_CODE_MODIFIERS)) {
      return { kind: 'size-code', code }
    }
    const legacy = LEGACY_SIZES[parts.size]
    if (legacy !== undefined) return { kind: 'unswept-shape', reason: legacy }
    throw new BaseFilenameError(
      `${record.file}: the size token ${JSON.stringify(parts.size)} is not a dimension, ` +
        `not this record's derived size code (${String(record.sizeCode)}), and not a known legacy form`,
    )
  }

  if (SWEPT_SHAPES.has(shapeKey)) return { kind: 'unswept-coordinate', size: parts.size }

  const reason = UNSWEPT_SHAPES[parts.morphology]
  if (reason !== undefined) return { kind: 'unswept-shape', reason }
  throw new BaseFilenameError(
    `${record.file}: ${JSON.stringify(parts.morphology)} is a dimensioned plain base from no sweep this ` +
      'table carries. Add it to UNSWEPT_SHAPES with the reason, or add the sweep to SWEEPS.',
  )
}

/* ------------------------------------------------------------------ resolver */

/** An archived base a recipe resolved to. */
export interface ArchiveBase {
  /** md5, and the object key under `assets.models`. Branded, so `shardedPath` takes it. */
  readonly blob: CatalogRecord['blob']
  readonly file: string
  readonly bytes: number
  readonly sprite: boolean
  readonly name: string
  readonly id: string
  /**
   * The item this file is one connection variant of.
   *
   * Carried since row V4 for one caller: `placement/placement.ts` mints an
   * ordinary `Placement` for an archived base, and a `Placement` names a
   * `DesignId`. Projected off the record here rather than looked up there,
   * because the record is in hand at this point and `placeRecipe` holds no
   * catalog — the alternative was a second index for one field.
   */
  readonly design: CatalogRecord['design']
  /** The `-D` set the sweep used, for the drawer's disclosure. */
  readonly swept: SweptBase
}

export interface ResolverCensus {
  readonly bases: number
  readonly generated: number
  readonly sculpted: number
  readonly sizeCode: number
  readonly unsweptCoordinate: number
  readonly unsweptShape: number
  /** Distinct recipe keys the map holds. */
  readonly keys: number
  /** Keys dropped because two different archived files claimed them. */
  readonly ambiguous: number
  /** Replayed files with no archived counterpart. */
  readonly unpublished: number
  /** ms spent building the map, measured with `performance.now()`. */
  readonly buildMs: number
}

/**
 * What the archive has to say about a recipe. Three answers, not two.
 *
 * `ambiguous` exists because 27 of the 709 keys are claimed by two different
 * archived blobs, and reporting those as `absent` would tell the user the
 * archive holds nothing when it holds two things. Three causes, all real: one
 * shape published under two spellings (`base+s2w+square+wall` and
 * `base+s2w+wall_locks+square+wall`, whose `WALL_LOCKS` is the file's default
 * either way), two radial coordinate rows that write one filename, and one
 * filename that appears in two directories. Picking either file would hand over
 * a base that is not the one the parameters describe.
 */
export type Resolution =
  | { readonly kind: 'archived'; readonly base: ArchiveBase }
  | { readonly kind: 'ambiguous'; readonly files: readonly string[] }
  | { readonly kind: 'absent' }

export interface BaseResolver {
  /** The archived base a recipe names, or `null` when absent or ambiguous. */
  resolve(recipe: BaseRecipe): ArchiveBase | null
  /** The same question, with the ambiguous answer distinguishable. */
  resolutionOf(recipe: BaseRecipe): Resolution
  /** Every class, counted. */
  readonly census: ResolverCensus
  /** Per-class detail, for the drawer's honesty line and for tests. */
  classOf(file: string): ArchiveBaseClass | undefined
}

/** The replay, indexed by join key. Module scope: deterministic and cheap. */
export function replayIndex(): ReadonlyMap<string, SweptBase> {
  const out = new Map<string, SweptBase>()
  for (const swept of replaySweeps()) out.set(joinKey(splitBaseFilename(swept.file)), swept)
  return out
}

/**
 * Build the recipe -> archived base map.
 *
 * One pass over the records. A key claimed by two different blobs is **removed**
 * rather than resolved to either: handing the user one of two files that both
 * claim to be what their parameters describe is the failure this whole row is
 * arranged against, and it would be invisible.
 */
export function buildBaseResolver(records: readonly CatalogRecord[]): BaseResolver {
  const started = performance.now()
  const replayed = replayIndex()
  const byKey = new Map<string, ArchiveBase>()
  const ambiguous = new Map<string, string[]>()
  const classes = new Map<string, ArchiveBaseClass>()
  const seen = new Set<string>()
  const counts = { generated: 0, sculpted: 0, sizeCode: 0, unsweptCoordinate: 0, unsweptShape: 0 }
  let bases = 0

  for (const record of records) {
    if (record.layer !== 'base') continue
    bases += 1
    const classified = classifyArchiveBase(record, replayed)
    classes.set(record.file, classified)
    switch (classified.kind) {
      case 'generated': {
        counts.generated += 1
        const key = recipeKey({ v: 1, entry: classified.swept.entry, parameters: classified.swept.parameters })
        seen.add(classified.swept.file)
        const held = byKey.get(key)
        if (held !== undefined && held.blob !== record.blob) {
          ambiguous.set(key, [held.file, record.file])
          byKey.delete(key)
        } else if (ambiguous.has(key)) {
          ambiguous.get(key)?.push(record.file)
        } else {
          byKey.set(key, {
            blob: record.blob,
            file: record.file,
            bytes: record.bytes,
            sprite: record.sprite,
            name: record.name,
            id: record.id,
            design: record.design,
            swept: classified.swept,
          })
        }
        break
      }
      case 'sculpted':
        counts.sculpted += 1
        break
      case 'size-code':
        counts.sizeCode += 1
        break
      case 'unswept-coordinate':
        counts.unsweptCoordinate += 1
        break
      case 'unswept-shape':
        counts.unsweptShape += 1
        break
    }
  }

  let unpublished = 0
  for (const swept of replayed.values()) if (!seen.has(swept.file)) unpublished += 1

  const census: ResolverCensus = {
    bases,
    ...counts,
    keys: byKey.size,
    ambiguous: ambiguous.size,
    unpublished,
    buildMs: performance.now() - started,
  }

  return {
    census,
    classOf: (file) => classes.get(file),
    resolve: (recipe) => byKey.get(recipeKey(recipe)) ?? null,
    resolutionOf: (recipe) => {
      const key = recipeKey(recipe)
      const base = byKey.get(key)
      if (base !== undefined) return { kind: 'archived', base }
      const clash = ambiguous.get(key)
      if (clash !== undefined) return { kind: 'ambiguous', files: [...new Set(clash)] }
      return { kind: 'absent' }
    },
  }
}

/**
 * The build's gate: throw on any base filename that cannot be accounted for.
 *
 * Returns the census so `pipeline/build.ts` can report it. Deliberately not a
 * boolean — a caller that has to remember to check a return value can forget,
 * and what forgetting costs here is an archive file that silently stops being
 * reachable from the generator.
 */
export function assertArchiveBases(records: readonly CatalogRecord[]): ResolverCensus {
  return buildBaseResolver(records).census
}

/** Canonical parameters for a swept base, for tests and for the drawer. */
export function sweptRecipe(swept: SweptBase): BaseRecipe {
  return { v: 1, entry: swept.entry, parameters: canonicalise(swept.entry, swept.parameters) }
}
