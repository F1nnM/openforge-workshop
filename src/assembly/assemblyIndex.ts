/**
 * The precomputed lookups assembly resolution needs, derived once per catalog.
 *
 * A pure function of `CatalogFile`, and the reason it exists rather than being
 * folded into the resolver is arithmetic: resolving a placement without an index
 * means scanning 8,702 records for a matching base, and a 50-placement room
 * would scan 435,100 records to draw one bill. Built once, it is four maps.
 *
 * Nothing here interprets. The four maps are the four *keys* the corpus supports
 * — catalog identity, base size code, base footprint, content address — plus the
 * filename multimap the download path needs. Which of them a match should use is
 * the resolver's decision, in `resolve.ts`.
 *
 * One derived *fact* rides alongside the keys — {@link PrintOption}, per base —
 * for the same reason `sizeCode` is hoisted onto `CatalogRecord`: it lives in the
 * interned tag list, only this module holds the intern table, and the resolver
 * compares it once per candidate. It is a fact, not a key: nothing is grouped by
 * it, and the ranking that consumes it is `resolve.ts`'s.
 */
import type { AggregateIndex, BlobId, CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { buildAggregateIndex } from '@/catalog'

import { footprintKey } from './footprint'

/* ------------------------------------------------------------- print options */

/**
 * The print options in **preference order, best first** — the third connection
 * segment §5 folds into its parent lock system, recovered.
 *
 * `connectionSystems` deliberately throws this away: `connection|openlock|topless`
 * *is* openlock, so `record.conn` says `openlock` and cannot say which of the
 * three products it is. That fold is right for a facet and wrong for a base
 * match, because these are **different products, not cheaper prints of one**:
 *
 *   - `plain` (1,379 bases) — a full base.
 *   - `unsupported` (206) — geometry reworked to print without supports. Same
 *     part, different slicing.
 *   - `topless` (378) — **no top surface.** Defensible under a solid tile and a
 *     different object from the one the user asked for.
 *
 * The order is the order `docs/tile-aggregation.md` §5.3 fixes, and it is the
 * whole reason this type exists: sorting base candidates on `bytes` made a
 * topless base win every tie, and 79.1% of auto-inserted openlock bases had no
 * top. Zero bases carry both modifiers, so the fold below never has to choose
 * between them on live data — it is total anyway, worst option winning, because a
 * future tag that carries both must not resolve to the flattering answer.
 *
 * **Two of §5's five modifiers are deliberately absent.** `flex` is on all 1,141
 * magnetic bases and none without, so it describes the magnetic system rather
 * than a choice within it and ranking on it would order bases by lock twice.
 * `filament` and `split` never appear on a base at all. A modifier earns a place
 * here by naming a base that is a *different object*, not by existing.
 */
export const PRINT_OPTIONS = ['plain', 'unsupported', 'topless'] as const
export type PrintOption = (typeof PRINT_OPTIONS)[number]

/**
 * The print option one tag names, or `plain` for the tags that name none.
 *
 * A modifier can only appear from **segment two onwards** (`connection|openlock|
 * topless`), and reading segment one instead is the `connection|side|openlock`
 * bug one namespace over: segment one is a position or the system itself. Neither
 * `topless` nor `unsupported` ever occupies it, so searching from index 2 needs
 * no position vocabulary and cannot mint an option from a position.
 */
function printOptionOfTag(tag: string): PrintOption {
  if (!tag.startsWith('connection|')) return 'plain'
  const segments = tag.split('|')
  if (segments.includes('topless', 2)) return 'topless'
  if (segments.includes('unsupported', 2)) return 'unsupported'
  return 'plain'
}

/** Rank of a print option; lower is better. `PRINT_OPTIONS` is the order. */
function optionRank(option: PrintOption): number {
  return PRINT_OPTIONS.indexOf(option)
}

/**
 * The print option a whole tag list amounts to — the **worst** its tags name.
 *
 * Worst rather than first, so a base tagged `openlock|topless` beside a plain
 * `magnetic` is topless: it has no top whichever system you clip it with.
 */
export function printOption(tags: readonly string[]): PrintOption {
  let worst: PrintOption = 'plain'
  for (const tag of tags) {
    const option = printOptionOfTag(tag)
    if (optionRank(option) > optionRank(worst)) worst = option
  }
  return worst
}

/** What the index measured while building itself. Every figure is a corpus fact a test asserts. */
export interface AssemblyIndexStats {
  /** Live records in this catalog build. 8,702 today. */
  records: number
  /** `layer === 'base'` — 1,963 (22.6%). */
  bases: number
  /** `layer === 'topper'`, i.e. `connection|openforge` — 4,363 (50.1%). */
  toppers: number
  /** Bases carrying a `size|openlock` code — 774 of 1,963. Not a key; see {@link AssemblyIndex}. */
  basesWithSizeCode: number
  /**
   * Bases per {@link PrintOption} — plain 1,379, unsupported 206, topless 378.
   *
   * 584 of 1,963 bases (29.7%) are a print variant rather than the base itself,
   * which is the size of the pool the old `bytes`-ascending tie-break was
   * drawing 79.1% of its openlock answers from.
   */
  basesByPrintOption: Readonly<Record<PrintOption, number>>
  /** Distinct footprint keys the bases cover — the join's reach. 44. */
  baseFootprints: number
  /** md5s carried by more than one record — 171, over 520 rows. */
  sharedBlobs: number
  /** Records sharing an md5 with another record — 520. */
  sharedBlobRecords: number
  /** Filenames mapping to two or more distinct meshes — 89, of which 7 map to three. */
  collidingFilenames: number
}

/**
 * The resolver's input, beside the placements.
 *
 * Every collection is `readonly` because the resolver must not be able to mutate
 * its own index: one accidental `push` into a candidate array would corrupt
 * every subsequent resolution in the session, and the symptom would be a bill
 * that changes depending on what the user placed first.
 */
export interface AssemblyIndex {
  /** Catalog identity → record. The lookup every placement starts from. */
  readonly byId: ReadonlyMap<TileId, CatalogRecord>

  /**
   * `size|openlock` code → the bases carrying it, in match-ranking order.
   *
   * 26 codes on the base side against 27 on the topper side; 129 toppers (6.5%
   * of the 1,999 that carry a code) name a code no base carries. **Not the join
   * key** — row D4 moved that to {@link basesByFootprint}, because a code
   * determines a width and not a shape and four of them span more than one
   * primitive. What this map is still for: the ranking's family tie-break, the
   * gate that keeps the one remaining code path honest, and naming the code in
   * the gap report. See `resolve.ts#candidatesFor` and `sizeCode.ts`.
   */
  readonly basesBySizeCode: ReadonlyMap<string, readonly CatalogRecord[]>

  /**
   * {@link footprintKey} → the bases congruent to it. **The join key**: 44
   * congruence classes over the 1,835 bases that have a derivable footprint, of
   * which the toppers reach 43.
   */
  readonly basesByFootprint: ReadonlyMap<string, readonly CatalogRecord[]>

  /**
   * md5 → every record carrying it.
   *
   * The bill deduplicates on this, and the reason it is a *multimap* rather than
   * a set is that both identities are needed at once: the line is one file, and
   * it still has to name the tiles that asked for it. 171 md5s are shared by 520
   * rows, and the largest group holds 9.
   */
  readonly byBlob: ReadonlyMap<BlobId, readonly CatalogRecord[]>

  /**
   * Filename → the distinct md5s published under it.
   *
   * 89 filenames map to two or three genuinely different meshes
   * (`tudor#door+narrow.stl` is three), so a zip entry named by filename
   * silently overwrites. This is what lets the download path see the collision
   * before it names anything.
   */
  readonly blobsByFilename: ReadonlyMap<string, readonly BlobId[]>

  /**
   * Base id → its {@link PrintOption}. **Total over every `layer === 'base'`
   * record**, including the 1,379 that are `plain`.
   *
   * Total rather than "the 584 interesting ones", because a sparse map makes the
   * absent key mean `plain` and there is no way for a caller to tell that from a
   * base the build forgot: a resolver reading `?? 'plain'` off a stale index
   * would hand out topless bases again and report them as full ones. Bases only,
   * because only a base is ever ranked: of the 384 records carrying
   * `connection|openlock|topless`, 378 are bases and 6 are `integral` pieces that
   * need no base and are never candidates — **no topper carries it at all**.
   */
  readonly basePrintOption: ReadonlyMap<TileId, PrintOption>

  /**
   * Row A1's aggregate layer over the same catalog — **one item per `design`**,
   * with every file in the group as a variant.
   *
   * It rides on this index rather than being a parameter of `resolvePlacement`
   * because of what the store says a placement *is*, and row V4 turned that
   * argument from strong into structural. It used to be that `Placement.tileId`
   * named a file and this layer was what re-resolved it, so a caller who forgot
   * to pass an aggregate index would silently get the pre-A6 behaviour — a real
   * answer to the wrong question, with no symptom. Now a placement names a
   * `DesignId` and **this layer is the only thing that can turn one into a
   * record at all**: without it `resolvePlacement` has no parts to return, so
   * forgetting it is not a silent regression but an empty bill.
   *
   * See `resolve.ts#resolveVariant` for what reads it, and
   * {@link buildAssemblyIndex} on why it is still a parameter of the *builder*.
   */
  readonly aggregates: AggregateIndex

  readonly stats: AssemblyIndexStats
}

/**
 * Derive the index from a parsed catalog.
 *
 * Pure and deterministic: candidate arrays are sorted here, once, so a match is
 * a scan of a pre-ordered list and two runs cannot disagree about which base
 * wins a tie. Sorting is `bytes` ascending then `id` — `id` is unique by
 * {@link CatalogFile}'s own parse check, so the order is total.
 *
 * **That sort is a cost tie-break, not the ranking.** It used to be both, by
 * omission: `matchBase` keeps the first candidate at the best score, so whatever
 * this function put first won every tie, and "smallest file" turned out to mean
 * "topless" for 79.1% of openlock toppers. Suitability now lives entirely in
 * `resolve.ts` — see `MATCH_WEIGHTS` — where it can see the topper and the lock
 * preference, which this function cannot. Bytes decide only what is left: two
 * bases equally suited to the same topper, where the cheaper print is the honest
 * answer. Keeping the two apart is also what lets the maps be rekeyed without
 * touching the ranking.
 *
 * **{@link AssemblyIndex.aggregates} is a parameter with a default**, the pattern
 * `ui/lock-picker/build.ts#deriveLockBuild` established and for its reason: the
 * aggregate index costs 62 ms against this function's 12 ms, and a caller that
 * already holds one — `SearchEngine` builds one for its facets — should pay for
 * it once. Defaulted rather than required so that no existing call site has to
 * change to keep working, and so that a test can build an index from a fixture
 * with one argument.
 */
export function buildAssemblyIndex(
  catalog: CatalogFile,
  aggregates: AggregateIndex = buildAggregateIndex(catalog),
): AssemblyIndex {
  const byId = new Map<TileId, CatalogRecord>()
  const basesBySizeCode = new Map<string, CatalogRecord[]>()
  const basesByFootprint = new Map<string, CatalogRecord[]>()
  const byBlob = new Map<BlobId, CatalogRecord[]>()
  const blobsByFilename = new Map<string, BlobId[]>()
  const basePrintOption = new Map<TileId, PrintOption>()

  // The intern table is 930 strings against 101,427 references, so classifying it
  // once and indexing by tag id is two orders of magnitude less work than
  // de-interning each base's tags — and it is the same rule either way, because
  // `printOption` is a fold of the classifier this array is built from.
  const optionByTagId = catalog.tags.map(printOptionOfTag)
  const basesByPrintOption: Record<PrintOption, number> = { plain: 0, unsupported: 0, topless: 0 }

  let bases = 0
  let toppers = 0
  let basesWithSizeCode = 0

  for (const record of catalog.records) {
    byId.set(record.id, record)
    push(byBlob, record.blob, record)

    const blobs = blobsByFilename.get(record.file)
    if (blobs === undefined) blobsByFilename.set(record.file, [record.blob])
    else if (!blobs.includes(record.blob)) blobs.push(record.blob)

    if (record.layer === 'topper') toppers += 1
    if (record.layer !== 'base') continue

    bases += 1
    const option = worstOption(record.tags, optionByTagId)
    basePrintOption.set(record.id, option)
    basesByPrintOption[option] += 1
    if (record.sizeCode !== undefined) {
      basesWithSizeCode += 1
      push(basesBySizeCode, record.sizeCode, record)
    }
    const foot = footprintKey(record.foot)
    if (foot !== undefined) push(basesByFootprint, foot, record)
  }

  for (const candidates of basesBySizeCode.values()) candidates.sort(byCost)
  for (const candidates of basesByFootprint.values()) candidates.sort(byCost)
  for (const blobs of blobsByFilename.values()) blobs.sort()

  const shared = [...byBlob.values()].filter((group) => group.length > 1)

  return {
    byId,
    basesBySizeCode,
    basesByFootprint,
    byBlob,
    blobsByFilename,
    basePrintOption,
    aggregates,
    stats: {
      records: catalog.records.length,
      bases,
      toppers,
      basesWithSizeCode,
      basesByPrintOption,
      baseFootprints: basesByFootprint.size,
      sharedBlobs: shared.length,
      sharedBlobRecords: shared.reduce((total, group) => total + group.length, 0),
      collidingFilenames: [...blobsByFilename.values()].filter((blobs) => blobs.length > 1).length,
    },
  }
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key)
  if (existing === undefined) map.set(key, [value])
  else existing.push(value)
}

/**
 * {@link printOption} over interned tag ids — the same fold, one indirection
 * cheaper, and the reason `printOption` exists as an exported string function is
 * that a test must be able to state the rule without an intern table.
 */
function worstOption(tags: readonly number[], optionByTagId: readonly PrintOption[]): PrintOption {
  let worst: PrintOption = 'plain'
  for (const tag of tags) {
    // `CatalogFile` rejects a dangling tag id at parse time, so the guard is for
    // an index built from an unparsed object, not for live data.
    const option = optionByTagId[tag] ?? 'plain'
    if (optionRank(option) > optionRank(worst)) worst = option
  }
  return worst
}

/**
 * The tie-break of last resort: smaller print first, then catalog path. Total,
 * because `id` is unique.
 *
 * Reached only when two candidates are equally suited to the topper — see
 * {@link buildAssemblyIndex} on why suitability is not decided here.
 */
function byCost(a: CatalogRecord, b: CatalogRecord): number {
  if (a.bytes !== b.bytes) return a.bytes - b.bytes
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}
