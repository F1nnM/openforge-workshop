/**
 * One catalog item per **design** — the base-integrated tile and the base-less
 * tile it pairs with, collapsed into a single thing a user browses, filters and
 * places.
 *
 * The requirement, in the owner's words: *"Are we able to aggregate tiles with
 * integrated bases and the corresponding tile without base all as one item? Then
 * in the builder one can just choose a lock system for the current build, and we
 * choose the correct file from the aggregated item, or add a base if there is no
 * tile of that system […] So in the catalog/library we only list the aggregated
 * item."*
 *
 * `docs/tile-aggregation.md` is the research; every figure below is re-measured
 * against the emitted index rather than inherited from it, and where the two
 * disagree the measurement is quoted with the drift named.
 *
 * ## The identity is `CatalogRecord.design`, unchanged
 *
 * `pipeline/design.ts` already hashes the tag set with the whole `connection|`
 * namespace removed, and base-integrated and base-less variants of one design
 * differ *only* in connection — so the key groups exactly the pairs asked for, by
 * construction. Measured on the live index: **3,822 aggregates over 8,702 files,
 * 2.28 files each**; 2,117 are singletons (55.4%) and the largest holds 20.
 *
 * Three looser keys were measured in the research and all three produce the
 * *same* 931 merges, so nothing is bought by widening it. Key A stays.
 *
 * ## Detection is the layer, and the intuitive rule is a disaster
 *
 * "This file needs a separately printed base" is `layer === 'topper'`, i.e.
 * `connection|openforge`. Scored against the filename's connection token — an
 * independently authored description no part of the rule reads —
 * `pipeline/aggregate.ts` measures **100.0% precision and 99.9% recall**: 4,363
 * flagged, zero false positives, four false negatives, all four corpus defects
 * (a file whose name says `openforge` and which carries no `connection|` tag at
 * all).
 *
 * The rule that looks right is `shape|base` **plus another kind**, and it is
 * **0.0% precise on 1,277 records**: `shape|base|wall` means *a base shaped to
 * receive a wall*, not a wall carrying a base. 0 of the 1,963 `shape|base`
 * records carry `connection|openforge` and every one carries a lock system. The
 * polarity is exactly inverted. Nothing in this module goes near it.
 *
 * ## Position, not the flattened `conn`
 *
 * `CatalogRecord.conn` throws the position segment away, and for this question
 * that is fatal: **not one of the 4,363 toppers carries a bottom lock**, while
 * 1,283 of them carry one on the *side*. `openforge,side+dragonlock` is openforge
 * underneath and dragonlock to the neighbour, so reading `conn` and offering
 * those 1,283 as "dragonlock" would advertise joinery the mesh does not have at
 * the bottom. Row D2 built {@link connectionsByPosition} for this and left the
 * decision of whether to emit positions onto the record to "the schema row …
 * when the aggregate substrate needs one".
 *
 * **It does not need one.** The record already carries its full interned tag
 * list, so the positional split is one pass over 84,023 tag references here, and
 * a `connBottom`/`connSide` pair on 8,702 records would be payload spent to say
 * something the reader can recompute. That is the same trade `CatalogAssets`
 * makes for the two URLs, and it is why nothing in `schema.ts` changed shape for
 * this row.
 *
 * ## Nothing here knows what a lock system is
 *
 * {@link TileVariant} publishes the systems on each face **unfiltered** —
 * `bottomConn`, `sideConn` — rather than a `LockSystem[]`. The lock vocabulary
 * has three owners already (`pipeline/facets.ts#LOCK_SYSTEMS`, the total
 * `Record<LockSystem, true>` in `src/assembly/resolve.ts`, and the same in
 * `src/ui/lock-picker/reach.ts`), and `LockSystem` itself lives in `@/store`,
 * which imports *this* module. A fourth copy here would be one more thing to
 * drift, and importing the store would invert the layering. So the positional
 * projection is this module's job and the vocabulary stays with its owners:
 * {@link selectVariant} takes a system as a plain string and asks whether a face
 * carries it, and a consumer that wants per-lock chips intersects
 * {@link TileAggregate.selfSufficientConn} with its own list.
 *
 * ## Which row reads what
 *
 * | row    | reads                                                                    |
 * | ------ | ------------------------------------------------------------------------ |
 * | **A2** | {@link AggregateIndex.aggregates} in address order, plus the hoisted facets — `name`, `kinds`, `texture`, `build`, `foot`, `sizeCode`. The array index is the dense document index its bitsets need; the *address* is not one, which is the whole reason both exist. |
 * | **A3** | {@link TileAggregate.variantClass}, {@link TileAggregate.needsBase}, `selfSufficientConn`, `sideConn`, `joineryUntagged`, `preview`, `bytesRange`. |
 * | **A4** | {@link AggregateIndex.byOrdinal} then {@link AggregateIndex.byDesign} — `?tile=<ord>` resolves ordinal → variant → design → aggregate, with that variant selected. |
 * | **A5** | {@link TileAggregate.variants} in full, and {@link TileAggregate.slots} for the per-variant composition difference. |
 * | **A6** | {@link selectVariant}, then `matchBase` for the `needs-base` verdict. |
 * | **A7** | {@link TileAggregate.selfSufficientConn} for the tier-1 count, and the same per-topper base probe A6 uses for tier 2. |
 */
import type {
  AggregateAddress,
  BlobId,
  CatalogFile,
  CatalogRecord,
  DesignId,
  Footprint,
  Layer,
  ManifestOrdinal,
  PartSlot,
  TileId,
} from './schema'

/* ------------------------------------------------------------------ identity */

/**
 * The one conversion from a manifest ordinal to an aggregate address.
 *
 * A function rather than a cast at each site, because {@link AggregateAddress}'s
 * docblock is the argument for why the two number spaces must not mix and a
 * scattered `as` would make that argument unenforceable. There is deliberately no
 * inverse: an address happens to *be* an ordinal today, and a consumer that
 * converted one back would be encoding a derived grouping's identity into a
 * space that promises append-only stability.
 */
export function aggregateAddress(ord: ManifestOrdinal): AggregateAddress {
  return ord as unknown as AggregateAddress
}

/* ------------------------------------------------------------------ variants */

/**
 * One resolvable way to print an aggregate — a concrete file, with the
 * connection axis restored to three dimensions.
 *
 * The research's variant tuple is `(needsBase, bottomLocks, sideLocks)` and
 * measuring it shows the axis is genuinely three-dimensional: over 3,822
 * aggregates that tuple takes 1 value on 2,237, 2 on 787, 3 on 147, 4 on 127 and
 * 5 on 524, and **566 aggregates (14.8%) hold a tie** — two files on one tuple,
 * separated only by a print option. `topless` (no top surface) and `unsupported`
 * (geometry reworked to print without supports) are different *products*, not
 * cheaper prints of one, so {@link options} is a field rather than a detail.
 */
export interface TileVariant {
  /** The concrete file. Still the primary key. */
  readonly id: TileId
  /** Its own manifest ordinal — a share link's number, not the aggregate's. */
  readonly ord: ManifestOrdinal
  /** The design it belongs to, so a lookup by ordinal reaches the aggregate in one hop. */
  readonly design: DesignId
  readonly blob: BlobId
  readonly bytes: number
  readonly file: string
  readonly family: string
  readonly layer: Layer
  readonly sprite: boolean
  /**
   * `CatalogRecord.thumb` — whether a `/thumbs/` object exists for this file's
   * mesh. Row P3.
   *
   * Carried on the variant and not left to a record lookup because
   * `screens/detail/slots/SlotFills.tsx` renders `@/ui/thumb` from a
   * {@link TileVariant} and nothing else, and the component needs it to pick a
   * source. `sprite` is here for exactly the same reason.
   */
  readonly thumb: boolean
  /**
   * `true` when a base must be printed alongside this file — exactly
   * `layer === 'topper'`.
   *
   * Named for what the user does, not for the tag: the UI says "needs a base" /
   * "no base needed" because that is what the data supports. "Integrated base"
   * over-claims for two thirds of the cases — for a wall or a column
   * self-sufficiency means the OpenLOCK footer is part of *this* mesh, and for a
   * roof panel that it clips to what is under it. One thing mechanically (print
   * this and nothing else), three things descriptively.
   */
  readonly needsBase: boolean
  /**
   * Connection systems on this file's **own underside** — the face that meets
   * the table or the base.
   *
   * **Unfiltered** — a lock system, or `pegs`, or `dual`, or `openforge`,
   * whatever the corpus put there. Which of those are locks is not this module's
   * vocabulary to hold.
   *
   * For all 4,363 toppers this is exactly `['openforge']`, and that is the
   * measurement the whole row rests on: **not one topper carries a lock system on
   * its underside**, by construction, because `connection|openforge` *is* the
   * declaration that the joinery lives on a separately printed base. 1,283 of
   * them do carry a lock — on the side. Read off the flattened `conn` those 1,283
   * look like tiles that offer dragonlock, and they do not offer it underneath.
   * 119 `integral` records publish no bottom system at all.
   */
  readonly bottomConn: readonly string[]
  /** Systems on `connection|side|*`. Neighbour joinery, never table joinery. */
  readonly sideConn: readonly string[]
  /**
   * Print options from the third connection segment onwards, sorted.
   *
   * Measured vocabulary, by layer: `base` — flex 1,141, topless 378, unsupported
   * 206; `integral` — unsupported 215, flex 18, topless 6; `topper` — split 1;
   * `insert` — none. See {@link PRINT_MODIFIERS} for the two words the research
   * lists here that do not belong.
   */
  readonly options: readonly string[]
  /** Indices into {@link TileAggregate.slots} this variant declares. See {@link AggregateSlot}. */
  readonly slots: readonly number[]
}

/* --------------------------------------------------------------- composition */

/**
 * One composition slot in an aggregate, **with the variants that declare it**.
 *
 * `config` is the one field the collapse is not lossless on. It varies within
 * **828 aggregates (21.7%)**, because only 56.1% of toppers declare a `base`
 * slot at all — so the aggregate's slots must be the **union with provenance**
 * rather than a pick off one variant. Measured, what a pick would cost:
 *
 *   - **828** aggregates hold two or more distinct slot sets.
 *   - **654** hold a variant that declares slots beside one that declares none,
 *     so picking the wrong one drops the composition entirely.
 *   - **12** have a union strictly larger than *every* variant's own set — no
 *     single file carries all the slots the aggregate offers.
 *
 * The 12 are why this is a union and not "the richest variant's list". The 654
 * are why it needs provenance: a slot that exists on one variant and not another
 * is a real difference, and a consumer must be able to say which is which. From
 * {@link declaredBy} and {@link universal} a consumer can answer all three
 * questions that matter — *is this slot on every way of printing the item*, *if I
 * choose openlock do I still get it*, and *which file do I have to print to get
 * it* — without reaching back into the records.
 */
export interface AggregateSlot {
  /** The slot exactly as the fixture declares it. Not merged, not rewritten. */
  readonly slot: PartSlot
  /**
   * The variants declaring this slot, in {@link TileAggregate.variants} order.
   * Never empty.
   */
  readonly declaredBy: readonly TileId[]
  /**
   * `true` when every variant declares it, so the slot survives any choice of
   * variant. `false` is the interesting case and the reason the field is not
   * derived at the call site: a consumer that only checks `declaredBy.length`
   * has to know the aggregate's variant count to interpret it.
   */
  readonly universal: boolean
}

/* ----------------------------------------------------------------- aggregate */

/**
 * Which of the five one-sided or two-sided shapes an aggregate has.
 *
 * Measured over 3,822: `topper-only` 2,137 (55.9%), `both` 931 (24.4%),
 * `base-only` 340 (8.9%), `integrated-only` 320 (8.4%), `insert-only` 94 (2.5%).
 *
 * Only 24.4% are the two-sided merge the owner asked for; the aggregate model
 * still describes the other three quarters, it just has one variant class to
 * offer. And **`base` never shares a group with anything else** — `shape|base` is
 * in the design key, so a base is always its own design. That is the right
 * answer: a base is a separately printed part with its own purchase decision, and
 * aggregation therefore does *not* merge a base into the tile it supports.
 * `pipeline/aggregate.ts` asserts the zero.
 *
 * `mixed` is measured at **0** and is still a case rather than a throw, because
 * the alternative to a name is an aggregate that quietly reports as something it
 * is not. `topper` + `insert` in one group would be the plausible way to reach it.
 */
export type AggregateClass =
  | 'topper-only'
  | 'both'
  | 'base-only'
  | 'integrated-only'
  | 'insert-only'
  | 'mixed'

/** Whether printing this item takes a separate base — the headline the card states. */
export type BaseRequirement = 'always' | 'never' | 'either'

/**
 * One catalog item. 3,822 of them over 8,702 files.
 *
 * Every facet below is **hoisted, not reconciled**, and that is the strongest
 * measured result behind this row: over all 3,822 aggregates, the number holding
 * two distinct values of `texture`, `build`, `kinds`, `sizeCode`, `rotStep`,
 * `foot` or `name` is **0**. Aggregation needs no new title logic, no facet
 * re-derivation and no footprint reconciliation. What varies is exactly the
 * connection axis and its per-file consequences: `layer` 931, `bottomConn` 1,290,
 * `conn` 1,563, `family` 1,589, `bytes` 1,669, `blob` 1,680, `config` 828 — and
 * `sprite`, on exactly **one** aggregate.
 *
 * `pipeline/aggregate.ts` asserts the seven zeroes on every build, because the
 * card, the facet sidebar and the placement palette all read them as if they were
 * properties of the item.
 */
export interface TileAggregate {
  /** The aggregation key: `CatalogRecord.design`. */
  readonly design: DesignId
  /**
   * The catalog URL's address — the lowest {@link ManifestOrdinal} in the group,
   * branded so it cannot be handed to anything expecting an ordinal. Unique
   * across all 3,822 by construction, since ordinals are unique.
   */
  readonly address: AggregateAddress
  readonly name: string
  readonly kinds: readonly string[]
  readonly texture: string | undefined
  readonly build: string | undefined
  readonly foot: Footprint
  readonly sizeCode: string | undefined
  readonly rotStep: number | undefined

  /**
   * Every file in the group, ordered by ordinal. `variants[0]` holds the address.
   *
   * Typed as a **non-empty** tuple, which is not decoration: an aggregate exists
   * because a record was put in it, so emptiness is unreachable — and typing it
   * this way is what lets {@link selectVariant} be total without a fabricated
   * fallback variant standing in for a case that cannot happen.
   */
  readonly variants: readonly [TileVariant, ...TileVariant[]]
  readonly variantClass: AggregateClass

  /**
   * Which variant a card should show — see {@link pickPreview} for the rule and
   * for the two things it declines to claim.
   *
   * A sprite-carrying **topper** first, then any sprite-carrying variant, then
   * the head. Row V5 made that an ordered rule; before it, the field read *"the
   * first variant carrying a sprite, else the first"* and landed on the topper
   * in 925 of the 931 mixed aggregates **by ordering luck**, because the lowest
   * ordinal in a group usually happens to be the `openforge` file.
   */
  readonly preview: TileId

  /**
   * `'never'` when no variant needs a base, `'always'` when every variant does,
   * `'either'` when both exist — the merged pair, 931 aggregates.
   *
   * Derived from the layer, not printed from a tag, which is the difference
   * between this and today's `conn` chips: `base required` answers a build
   * question.
   */
  readonly needsBase: BaseRequirement

  /**
   * Systems available on the underside of a variant that needs **no** base —
   * `integral` or `base`, never `topper` and never `insert`. Sorted, unfiltered.
   *
   * This is tier 1 of the coverage question: print one part and you are done.
   * Intersected with the three lock systems it measures **openlock 1,497 (39.2%),
   * dragonlock 359 (9.4%), magnetic 255 (6.7%)** — bases included, because a base
   * needs no base, which is why openlock's 1,497 exceeds the 1,251
   * integral-bearing aggregates.
   */
  readonly selfSufficientConn: readonly string[]

  /**
   * Systems any variant mounts on its side. Neighbour joinery.
   *
   * Measured against the lock systems: openlock 848 aggregates (22.2%),
   * dragonlock 468 (12.2%), magnetic **0** — magnets are never a side connector
   * in this corpus.
   */
  readonly sideConn: readonly string[]

  /**
   * No variant needs a base, none is an insert, and **no variant declares a
   * system on its underside at all**.
   *
   * 93 aggregates (2.4%), every one `integrated-only`, and they are §1.3's data
   * gap surfaced rather than hidden: 33 of the underlying records name a lock in
   * the *filename* only, 18 of those an `imperial`/`metric` magnet size that
   * exists nowhere in the tag vocabulary. The honest verdict for these is
   * "joinery untagged", not "incompatible" — see {@link selectVariant}.
   */
  readonly joineryUntagged: boolean

  /** The union of every variant's composition slots, with provenance. */
  readonly slots: readonly AggregateSlot[]
  /** The union of `config.fulfills` part names, sorted. 9 aggregates, never varying. */
  readonly fulfills: readonly string[]
  /** `true` when two variants declare different slot sets — 828 aggregates (21.7%). */
  readonly configVaries: boolean

  /**
   * `[min, max]` bytes across the variants.
   *
   * A **range and never a single figure**, because across the 1,705 multi-file
   * aggregates the max/min ratio is 1.13 at the median but **3.47 at p90**, with
   * 42.2% spreading more than 1.25× and 19.1% more than 2×. One number on a card
   * would be an assertion the data does not support — and note what `bytes` is:
   * mesh complexity, a download-size proxy. Print time and filament volume are
   * not in the corpus at any resolution, so nothing derived from this may claim
   * them.
   */
  readonly bytesRange: readonly [min: number, max: number]
}

/* --------------------------------------------------------------------- index */

/** What the derivation measured while building itself. Every figure a corpus fact. */
export interface AggregateStats {
  /** Records aggregated. 8,702. */
  readonly files: number
  /** Distinct designs. 3,822. */
  readonly aggregates: number
  /** Group size → how many aggregates have it. 2,117 singletons; largest 20. */
  readonly groupSizes: Readonly<Record<number, number>>
  readonly classes: Readonly<Record<AggregateClass, number>>
  readonly needsBase: Readonly<Record<BaseRequirement, number>>
  /** Aggregates with no bottom system anywhere and no topper. 93. */
  readonly joineryUntagged: number
  /**
   * Aggregates holding two distinct values of a field. The seven hoisted facets
   * must all read **0**; `pipeline/aggregate.ts` is what turns that into a build
   * failure.
   */
  readonly varies: Readonly<Record<string, number>>
  /** Aggregates whose slot union is strictly larger than every variant's own set. 12. */
  readonly configUnionExceedsEveryVariant: number
  /** Display names shared by two or more aggregates — 131 names over 323 aggregates. */
  readonly duplicateNames: { readonly names: number; readonly aggregates: number; readonly worst: number }
}

/**
 * The derived aggregate layer: one pass over a parsed catalog.
 *
 * A pure, deterministic function of `CatalogFile`, so a caller may memoise it on
 * the version stamp — the same contract `buildAssemblyIndex` offers, and for the
 * same reason. It ships nothing: see {@link SCHEMA_VERSION}'s note on why the
 * grouping is derived rather than emitted.
 */
export interface AggregateIndex {
  /**
   * Every aggregate, **ascending {@link TileAggregate.address}**.
   *
   * The order is total (addresses are unique) and it is the *document order* row
   * A2 needs: `src/search/facets.ts` indexes records positionally, and an
   * aggregate address is not a dense index — 3,822 addresses spread over
   * `0…8,701`. So the dense index is the position in this array and
   * {@link docOf} is the map, which keeps A2's bitsets from ever being built over
   * a sparse number.
   */
  readonly aggregates: readonly TileAggregate[]
  readonly byDesign: ReadonlyMap<DesignId, TileAggregate>
  readonly byAddress: ReadonlyMap<AggregateAddress, TileAggregate>
  /** Every file's variant, by its own ordinal. Row A4's first hop. */
  readonly byOrdinal: ReadonlyMap<ManifestOrdinal, TileVariant>
  /** Every file's variant, by catalog id. */
  readonly byTile: ReadonlyMap<TileId, TileVariant>
  /** Dense document index per design — the position in {@link aggregates}. */
  readonly docOf: ReadonlyMap<DesignId, number>
  readonly stats: AggregateStats
}

/* ------------------------------------------------------------- the derivation */

/** Positions that name a face rather than a system. Row D2's vocabulary, applied to a raw tag. */
const CONNECTION_POSITIONS: ReadonlySet<string> = new Set(['side', 'bottom', 'left', 'right'])

/**
 * Print-option modifiers, as the corpus spells them.
 *
 * A closed list rather than "every segment past the system", because a segment
 * there is not always a modifier: `connection|openforge|dragonlock` (5 records)
 * and `connection|openlock|side` (3) both put something else in that slot.
 *
 * **Two of the six the research lists are not modifiers, and reading them as
 * modifiers is a real error rather than a harmless extra.** `pegs` never occupies
 * a modifier position anywhere — it is a connection system on 147 records — and
 * `filament` occupies one only in `connection|side|filament` (114 records), where
 * `filament` **is** the side system and no parent system is named. Counting that
 * as a print option would invent an option on 114 toppers and lose their only
 * side connector. The four below are the whole vocabulary the corpus actually
 * uses in that slot: `connection|openlock|topless` (384),
 * `connection|openlock|unsupported` (413), `connection|dragonlock|unsupported`
 * (8), `connection|magnetic|flex` (1,159) and `connection|openforge|split` (1).
 */
const PRINT_MODIFIERS: ReadonlySet<string> = new Set(['topless', 'unsupported', 'flex', 'split'])

interface Projection {
  readonly bottom: readonly string[]
  readonly side: readonly string[]
  readonly options: readonly string[]
}

/**
 * Split one record's connection tags into systems per face, plus its print
 * options.
 *
 * A local port of `pipeline/facets.ts#connectionsByPosition` rather than an
 * import, and the reason is the module graph: `pipeline/` is build-time only and
 * is not in the app's tsconfig, so importing it from `src/` would make the
 * browser bundle depend on the importer. `pipeline/aggregate.ts` closes the loop
 * the other way — it cross-checks this projection against `connectionsByPosition`
 * on every record of every build, the way `tessellation.test.ts` cross-checks
 * `arcBandSideOfRadius`, so the two cannot drift in silence.
 *
 * Only `bottom` and `side` are kept. `left` and `right` occupy one tag each and
 * both buckets are empty of systems corpus-wide, so a face key for them would be
 * a field no consumer could ever read something out of; if a system ever lands
 * there, the cross-check in `pipeline/aggregate.ts` fails rather than silently
 * dropping it.
 */
function project(tags: readonly string[]): Projection {
  const bottom = new Set<string>()
  const side = new Set<string>()
  const options = new Set<string>()

  for (const tag of tags) {
    if (!tag.startsWith('connection|')) continue
    const segments = tag.split('|').slice(1)
    const head = segments[0]
    const positioned = head !== undefined && CONNECTION_POSITIONS.has(head)
    const system = positioned ? segments[1] : head
    if (system !== undefined) {
      if (positioned && head === 'side') side.add(system)
      else if (!positioned || head === 'bottom') bottom.add(system)
    }
    for (const segment of segments.slice(positioned ? 2 : 1)) {
      if (PRINT_MODIFIERS.has(segment)) options.add(segment)
    }
  }

  return { bottom: [...bottom].sort(), side: [...side].sort(), options: [...options].sort() }
}

/**
 * Canonical text for a composition slot, for grouping identical declarations
 * across variants.
 *
 * Field-by-field rather than `JSON.stringify` of the parsed object: two variants
 * can declare the same slot with its `require` refs written in a different order,
 * and a key that treated those as different slots would report a config
 * difference the fixture does not have. Sorted arrays are what make the key a
 * function of the slot's *meaning*.
 */
function slotKey(slot: PartSlot): string {
  const refs = (entries: readonly { tag?: string; filter?: string }[] | undefined): string =>
    entries === undefined
      ? ''
      : entries
          .map((entry) => `${entry.tag ?? ''}/${entry.filter ?? ''}`)
          .sort()
          .join(',')
  return [
    slot.name,
    slot.id ?? '',
    // Absence means required — `PartSlot.optional` is absent on 1,050 of 3,695
    // slots — so the key must not let `undefined` and `false` be two things.
    String(slot.optional ?? false),
    refs(slot.tags.require),
    refs(slot.tags.deny),
    refs(slot.tags.constrain),
  ].join('\u0000')
}

/** Deep equality over the discriminated union, so key order cannot fake a difference. */
function sameFootprint(a: Footprint, b: Footprint): boolean {
  if (a.shape !== b.shape) return false
  switch (a.shape) {
    case 'rect':
      return b.shape === 'rect' && a.w === b.w && a.d === b.d
    case 'wall':
      return b.shape === 'wall' && a.length === b.length
    case 'arc':
      return (
        b.shape === 'arc' &&
        a.rIn === b.rIn &&
        a.rOut === b.rOut &&
        a.sweep === b.sweep &&
        a.band === b.band &&
        a.bandBasis === b.bandBasis
      )
    case 'tri':
      return b.shape === 'tri' && a.leg === b.leg
    case 'diag':
      return b.shape === 'diag' && a.run === b.run
    case 'column':
    case 'none':
      return true
  }
}

/** The seven facets the aggregate hoists, each compared as its own kind of value. */
const HOISTED: readonly {
  readonly field: string
  readonly same: (a: CatalogRecord, b: CatalogRecord) => boolean
}[] = Object.freeze([
  { field: 'name', same: (a, b) => a.name === b.name },
  { field: 'kinds', same: (a, b) => a.kinds.join('\u0000') === b.kinds.join('\u0000') },
  { field: 'texture', same: (a, b) => a.texture === b.texture },
  { field: 'build', same: (a, b) => a.build === b.build },
  { field: 'sizeCode', same: (a, b) => a.sizeCode === b.sizeCode },
  { field: 'rotStep', same: (a, b) => a.rotStep === b.rotStep },
  { field: 'foot', same: (a, b) => sameFootprint(a.foot, b.foot) },
])

/** The fields that legitimately vary inside an aggregate, counted for the stats. */
const VARYING: readonly { readonly field: string; readonly of: (record: CatalogRecord) => string }[] =
  Object.freeze([
    { field: 'layer', of: (record) => record.layer },
    { field: 'conn', of: (record) => record.conn.join('\u0000') },
    { field: 'family', of: (record) => record.family },
    { field: 'bytes', of: (record) => String(record.bytes) },
    { field: 'blob', of: (record) => record.blob },
    { field: 'sprite', of: (record) => String(record.sprite) },
  ])

function classify(layers: ReadonlySet<Layer>): AggregateClass {
  if (layers.size === 1) {
    if (layers.has('topper')) return 'topper-only'
    if (layers.has('base')) return 'base-only'
    if (layers.has('integral')) return 'integrated-only'
    return 'insert-only'
  }
  if (layers.size === 2 && layers.has('topper') && layers.has('integral')) return 'both'
  return 'mixed'
}

function baseRequirement(layers: ReadonlySet<Layer>): BaseRequirement {
  if (!layers.has('topper')) return 'never'
  return layers.size === 1 ? 'always' : 'either'
}

/* -------------------------------------------------------------------- preview */

/**
 * Which variant's picture *is* the item, in three ordered tiers:
 *
 *   1. the first variant with `layer === 'topper'` **that carries a sprite**;
 *   2. else the first variant carrying a sprite;
 *   3. else the head — `variants[0]`, the address holder.
 *
 * ## Why the topper, stated in terms of `layer`
 *
 * The owner's rule is that *the aggregated tile is always the thing the user
 * sees* — the piece itself, not the way it is joined to the table. `layer` is
 * what the data carries for that, and `layer === 'topper'` is exactly
 * `connection|openforge`, which **is** the declaration that the joinery lives on
 * a separately printed base. So a topper's mesh is the tile and nothing else,
 * while every other layer folds something that is not the tile into the same
 * mesh: an `integral` carries its lock system underneath, a `base` is the
 * joinery with no tile on it at all, and an `insert` is a piece fitted into
 * another piece. Prefer the topper and the card shows the stairs; take the
 * ordering's word for it and 6 of 931 mixed aggregates show a `dragonlock`
 * underside instead. `pipeline/aggregate.test.ts` names those 6.
 *
 * ## What this deliberately does not claim
 *
 * **Not "the file to print".** That is {@link selectVariant}, and it answers the
 * *opposite* way on purpose — *prefer one part over two*, so a self-sufficient
 * variant beats a topper. Measured over the emitted index, `selectVariant()`
 * with no preference disagrees with this rule on **1,598 of 3,822** aggregates,
 * including all 931 mixed ones. The two do not conflict, because they are
 * not the same question: this one picks the *picture of the item*, that one picks
 * the *bill of materials*. See {@link variantsByPreference} for why the orders
 * stay separate rather than one being derived from the other.
 *
 * **Not "the one without an integrated base".** {@link TileVariant.needsBase}'s
 * docblock is careful here and this rule inherits the care: *"integrated base"
 * over-claims for two thirds of the cases* — for a wall or a column,
 * self-sufficiency means the OpenLOCK footer is part of *this* mesh, and for a
 * roof panel that it clips to what is under it. The claim is only the narrow
 * one `layer` supports: a topper's mesh is the tile alone.
 *
 * **Not a judgement about the render.** Nothing here reads geometry, triangle
 * count or sheet quality. A topper that happens to photograph worse than its
 * `integral` sibling still wins, because the rule is about *what the picture is
 * of*, not how good it is.
 *
 * **Not an address.** The catalog URL is `variants[0].ord`, which no tier moves
 * — `src/routes/tileAddress.test.ts` pins that a change to the preview rule
 * cannot move anybody's link.
 *
 * ## The sprite condition, and why the corpus cannot prove it
 *
 * Tier 1 requires the topper to carry a sprite so a spriteless topper cannot
 * blank a card that had a sibling with a picture — the failure tier 2 was
 * originally added for. **On today's corpus that condition never fires**: all
 * 3,068 topper-carrying aggregates hold at least one sprite-carrying topper, so
 * tier 1 collapses to "the first topper", and tier 3 is unreachable outright
 * because 0 of 3,822 aggregates lack a sprite everywhere. A corpus census
 * therefore agrees with several weaker rules than this one, which is why the
 * tiers are proved on hand-countable fixtures in `aggregate.test.ts` as well.
 *
 * Tier 2 is the one live case: `d4c2a57740b65`, an `aztlan col+T` column whose
 * openlock variant has a sprite sheet and whose dragonlock variant does not, and
 * whose dragonlock variant is the head. It has no topper, so tier 1 passes it
 * over and tier 2 keeps its card from rendering blank. 8,701 of 8,702 records
 * carry a sprite; that is the one.
 *
 * Total, and deterministic: `variants` is a non-empty tuple ordered by ordinal,
 * so tier 3 always yields and two runs cannot disagree.
 */
function pickPreview(variants: readonly [TileVariant, ...TileVariant[]]): TileId {
  const topper = variants.find((variant) => variant.layer === 'topper' && variant.sprite)
  if (topper !== undefined) return topper.id
  const sprited = variants.find((variant) => variant.sprite)
  if (sprited !== undefined) return sprited.id
  return variants[0].id
}

/**
 * Derive the aggregate layer from a parsed catalog.
 *
 * One pass to group, one pass per group to project. Deterministic throughout:
 * groups are emitted in ascending address, variants in ascending ordinal, and
 * every string array is sorted, so two runs over one index cannot disagree.
 */
export function buildAggregateIndex(file: CatalogFile): AggregateIndex {
  const groups = new Map<DesignId, CatalogRecord[]>()
  for (const record of file.records) {
    const existing = groups.get(record.design)
    if (existing === undefined) groups.set(record.design, [record])
    else existing.push(record)
  }

  const varies: Record<string, number> = {}
  for (const { field } of HOISTED) varies[field] = 0
  for (const { field } of VARYING) varies[field] = 0
  varies.config = 0

  const classes: Record<AggregateClass, number> = {
    'topper-only': 0,
    both: 0,
    'base-only': 0,
    'integrated-only': 0,
    'insert-only': 0,
    mixed: 0,
  }
  const needsBaseCounts: Record<BaseRequirement, number> = { always: 0, never: 0, either: 0 }
  const groupSizes: Record<number, number> = {}
  let joineryUntagged = 0
  let configUnionExceedsEveryVariant = 0

  const aggregates: TileAggregate[] = []

  for (const [design, members] of groups) {
    members.sort((a, b) => (a.ord as unknown as number) - (b.ord as unknown as number))
    const first = members[0]
    // `groups` is only ever written by pushing a record, so a group with no
    // members means the map itself is corrupt — and every count derived below
    // would then be wrong rather than merely incomplete. `pipeline/build.ts`
    // throws on the same class of impossibility for the same reason.
    if (first === undefined) throw new Error(`aggregate ${design} has no members`)

    groupSizes[members.length] = (groupSizes[members.length] ?? 0) + 1
    for (const { field, same } of HOISTED) {
      if (members.some((record) => !same(record, first))) varies[field] = (varies[field] ?? 0) + 1
    }
    for (const { field, of } of VARYING) {
      if (new Set(members.map(of)).size > 1) varies[field] = (varies[field] ?? 0) + 1
    }

    const layers = new Set<Layer>(members.map((record) => record.layer))
    const variantClass = classify(layers)
    const needsBase = baseRequirement(layers)
    classes[variantClass] += 1
    needsBaseCounts[needsBase] += 1

    // Slots are collected in variant order, so an aggregate's slot list is stable
    // and a variant's `slots` indices point into it.
    const slotIndex = new Map<string, number>()
    const slots: { slot: PartSlot; declaredBy: TileId[] }[] = []
    const fulfills = new Set<string>()

    const variants: TileVariant[] = []
    const byRecordId = new Map<string, TileVariant>()
    const selfSufficientConn = new Set<string>()
    const sideConn = new Set<string>()
    let anyBottom = false
    let minBytes = Number.POSITIVE_INFINITY
    let maxBytes = 0
    let maxOwnSlots = 0

    for (const record of members) {
      const tags = record.tags.map((tag) => file.tags[tag as unknown as number] ?? '')
      const { bottom, side, options } = project(tags)

      const own: number[] = []
      for (const slot of record.config?.parts ?? []) {
        const key = slotKey(slot)
        let at = slotIndex.get(key)
        if (at === undefined) {
          at = slots.length
          slotIndex.set(key, at)
          slots.push({ slot, declaredBy: [] })
        }
        const entry = slots[at]
        if (entry !== undefined && !entry.declaredBy.includes(record.id)) entry.declaredBy.push(record.id)
        if (!own.includes(at)) own.push(at)
      }
      maxOwnSlots = Math.max(maxOwnSlots, own.length)
      for (const entry of record.config?.fulfills ?? []) fulfills.add(entry.part)

      if (bottom.length > 0) anyBottom = true
      if (record.layer !== 'topper' && record.layer !== 'insert') {
        for (const system of bottom) selfSufficientConn.add(system)
      }
      for (const system of side) sideConn.add(system)
      minBytes = Math.min(minBytes, record.bytes)
      maxBytes = Math.max(maxBytes, record.bytes)

      const variant: TileVariant = {
        id: record.id,
        ord: record.ord,
        design,
        blob: record.blob,
        bytes: record.bytes,
        file: record.file,
        family: record.family,
        layer: record.layer,
        sprite: record.sprite,
        thumb: record.thumb,
        needsBase: record.layer === 'topper',
        bottomConn: bottom,
        sideConn: side,
        options,
        slots: own,
      }
      variants.push(variant)
      byRecordId.set(record.id, variant)
    }

    const [head, ...tail] = variants
    if (head === undefined) throw new Error(`aggregate ${design} produced no variants`)
    // One non-empty tuple, built once and used for both the emitted `variants`
    // and the preview rule, so the two cannot be reading different orders.
    const ordered: readonly [TileVariant, ...TileVariant[]] = [head, ...tail]

    // Sorted, because a slot list is a *set* — two variants that declare the
    // same two slots in opposite order have the same composition, and reporting
    // that as a difference would put an aggregate in the 828 for nothing.
    // `fulfills` is folded in for the same reason the field is called `config`:
    // it is the other half of the declaration. It never varies today (9
    // aggregates carry one), so the 828 is the slot difference alone — but a
    // field named for the whole config that only read half of it is the kind of
    // thing that goes wrong later rather than now.
    const configVaries =
      new Set(
        members.map((record) => {
          const variant = byRecordId.get(record.id)
          const slots = [...(variant?.slots ?? [])].sort((a, b) => a - b).join(',')
          return `${slots}|${(record.config?.fulfills ?? []).map((entry) => entry.part).sort().join(',')}`
        }),
      ).size > 1
    if (configVaries) varies.config = (varies.config ?? 0) + 1
    if (slots.length > maxOwnSlots) configUnionExceedsEveryVariant += 1

    const untagged = !anyBottom && !layers.has('topper') && variantClass !== 'insert-only'
    if (untagged) joineryUntagged += 1

    aggregates.push({
      design,
      address: aggregateAddress(first.ord),
      name: first.name,
      kinds: first.kinds,
      texture: first.texture,
      build: first.build,
      foot: first.foot,
      sizeCode: first.sizeCode,
      rotStep: first.rotStep,
      variants: ordered,
      variantClass,
      preview: pickPreview(ordered),
      needsBase,
      selfSufficientConn: [...selfSufficientConn].sort(),
      sideConn: [...sideConn].sort(),
      joineryUntagged: untagged,
      slots: slots.map((entry) => ({
        slot: entry.slot,
        declaredBy: entry.declaredBy,
        universal: entry.declaredBy.length === members.length,
      })),
      fulfills: [...fulfills].sort(),
      configVaries,
      bytesRange: [minBytes === Number.POSITIVE_INFINITY ? 0 : minBytes, maxBytes],
    })
  }

  aggregates.sort((a, b) => (a.address as unknown as number) - (b.address as unknown as number))

  const byDesign = new Map<DesignId, TileAggregate>()
  const byAddress = new Map<AggregateAddress, TileAggregate>()
  const byOrdinal = new Map<ManifestOrdinal, TileVariant>()
  const byTile = new Map<TileId, TileVariant>()
  const docOf = new Map<DesignId, number>()
  const nameCounts = new Map<string, number>()

  aggregates.forEach((aggregate, doc) => {
    byDesign.set(aggregate.design, aggregate)
    byAddress.set(aggregate.address, aggregate)
    docOf.set(aggregate.design, doc)
    nameCounts.set(aggregate.name, (nameCounts.get(aggregate.name) ?? 0) + 1)
    for (const variant of aggregate.variants) {
      byOrdinal.set(variant.ord, variant)
      byTile.set(variant.id, variant)
    }
  })

  const shared = [...nameCounts.values()].filter((count) => count > 1)
  return {
    aggregates,
    byDesign,
    byAddress,
    byOrdinal,
    byTile,
    docOf,
    stats: {
      files: file.records.length,
      aggregates: aggregates.length,
      groupSizes,
      classes,
      needsBase: needsBaseCounts,
      joineryUntagged,
      varies,
      configUnionExceedsEveryVariant,
      duplicateNames: {
        names: shared.length,
        aggregates: shared.reduce((total, count) => total + count, 0),
        worst: shared.reduce((worst, count) => Math.max(worst, count), 0),
      },
    },
  }
}

/* ------------------------------------------------------------------ selection */

/**
 * What {@link selectVariant} could decide **without the base index**.
 *
 * Deliberately four verdicts and not the research's six: `with-base`,
 * `mismatched` and `no-base` all require running `matchBase`, which lives in
 * `src/assembly/resolve.ts` and needs the base index this module cannot see —
 * `src/catalog` is below `src/assembly` in the graph, not above it. So this
 * function answers the half of §5.2 that is a property of the aggregate, and row
 * A6 composes it with the base match to reach the other three.
 */
export type VariantVerdict =
  /** A variant needs no base and offers the requested system on its own underside. Print one part. */
  | 'self-sufficient'
  /** Only a topper. Row A6 runs `matchBase` from here; the base decides the rest. */
  | 'needs-base'
  /** Self-sufficient variants exist, none in this system. Physically incompatible, and informs rather than refuses. */
  | 'wrong-system'
  /** Every variant is an insert: fitted into another piece, never on the grid. 94 aggregates. */
  | 'insert'
  /** No joinery information anywhere — {@link TileAggregate.joineryUntagged}. Unknown, not incompatible. */
  | 'unknown-joinery'

export interface VariantPreference {
  /**
   * The bottom system to prefer — the build's lock preference.
   *
   * Absent means "no preference", and the effect is the one the merge is *for*:
   * a self-sufficient variant is still preferred over a topper, so an item that
   * can be printed as one part is offered as one part.
   */
  readonly bottom?: string | undefined
  /**
   * Print options in preference order, best first — pass
   * `PRINT_OPTIONS` from `@/assembly`.
   *
   * **Optional, and what it costs to omit is measured.** Without it the rank
   * stops at "fewest options" and falls through to `bytes` ascending, which is
   * the tie-break row D1 removed from base matching for cause: the topless print
   * of a base is its smallest file. That residual tie is reached on **121 variant
   * tuples covering 297 records, every one of them a `base`** — 87 `flex+topless`
   * against `flex+unsupported`, 34 `topless` against `unsupported`. It is
   * therefore never reached for a tile that sits *on* a base, and for the 340
   * base-only aggregates it decides which print a card shows by default. The
   * choice is reported either way: {@link VariantSelection.optionTie}.
   *
   * An option **not** in this list is neutral rather than worst, which is what
   * lets `PRINT_OPTIONS`' deliberate omission of `flex` mean what D1 intends:
   * flex is on all 1,141 magnetic bases and none without, so it describes the
   * system and not a choice within it.
   */
  readonly options?: readonly string[] | undefined
}

export interface VariantSelection {
  readonly variant: TileVariant
  readonly verdict: VariantVerdict
  /**
   * `true` when another candidate tied with the winner on every stated criterion
   * and offered a **different** option set, so the pick came down to `bytes`.
   *
   * The disclosure {@link VariantPreference.options} exists to let a caller
   * avoid: an undisclosed choice between two different products is the failure
   * §5.3 documents, and a caller that cannot supply a preference can at least
   * decline to present the answer as settled.
   */
  readonly optionTie: boolean
}

/** How many stated criteria a variant satisfies, heaviest first. Not a score a UI may render. */
function rankOf(variant: TileVariant, preference: VariantPreference): readonly number[] {
  const bottom = preference.bottom
  const options = preference.options
  const optionRank =
    options === undefined
      ? variant.options.length
      : // The **worst** option a variant names decides it, mirroring
        // `assemblyIndex.ts#printOption`: a file tagged `openlock|topless` beside
        // a plain `magnetic` has no top whichever system you clip it with.
        //
        // An option the caller did not list is **neutral, not worst**, and that
        // is load-bearing rather than lenient. D1's `PRINT_OPTIONS` lists three
        // words and deliberately omits `flex`, because flex is on all 1,141
        // magnetic bases and none without — it describes the system, not a choice
        // within it. Ranking an unlisted word as the worst option would put every
        // magnetic base below every openlock one for a second time, on a
        // criterion that is not about print quality at all.
        variant.options.reduce((worst, option) => {
          const at = options.indexOf(option)
          return at === -1 ? worst : Math.max(worst, at)
        }, 0)
  return [
    bottom !== undefined && variant.bottomConn.includes(bottom) ? 0 : 1,
    bottom !== undefined && variant.sideConn.includes(bottom) ? 0 : 1,
    optionRank,
  ]
}

function compareRanks(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i] ?? 0
    const right = b[i] ?? 0
    if (left !== right) return left - right
  }
  return 0
}

/**
 * The variants of one aggregate, best first, under a stated preference.
 *
 * Total order: the stated criteria, then `bytes` ascending, then `id`. `id` is
 * unique by `CatalogFile`'s own parse check, so the order is a pure function of
 * the aggregate and the preference — two calls cannot disagree about which
 * variant a card shows.
 *
 * ## This is not where {@link TileAggregate.preview} comes from, and must not be
 *
 * Row V5 asked the question directly, because a second ordering that disagreed
 * with this one would be a trap and one that duplicated it would be debt. It is
 * **neither**: the two orders answer different questions and disagree by
 * construction rather than by accident.
 *
 * This order exists to pick *the file to print*, and its first criterion is
 * §5.2's — **prefer one part over two**, so a self-sufficient `integral` beats a
 * `topper`. {@link pickPreview} exists to pick *the picture of the item*, and its
 * first tier is the exact opposite — the `topper`, because that is the mesh that
 * is the tile and nothing else. Measured over the emitted index:
 *
 *   - `selectVariant()` with no preference names a different file from `preview`
 *     on **1,598 of 3,822** aggregates, including **all 931** that hold both an
 *     `integral` and a `topper`;
 *   - with `bottom` stated it is 1,612 (openlock), 697 (dragonlock), 1,056
 *     (magnetic);
 *   - `variantsByPreference()[0]` alone differs on **1,153**.
 *
 * Of those 1,598, the 931 are the deliberate inversion and the remaining 667
 * come from this order's `bytes`-ascending tie-break, which a preview must not
 * inherit at all: the smallest file in a group is routinely the `topless` print,
 * and a card that showed the topless variant of every tile would be answering a
 * print-option question nobody asked it.
 *
 * Expressing one through the other would therefore mean adding a "prefer the
 * topper" preference that reverses this function's headline criterion, and no
 * caller wants it — the only consumer is the card, which needs no ranking, no
 * option vocabulary and no tie disclosure, just one id. So the preview stays a
 * three-tier rule of its own, and the disagreement is a documented property of
 * the pair rather than a bug in either.
 */
export function variantsByPreference(
  aggregate: TileAggregate,
  preference: VariantPreference = {},
): readonly TileVariant[] {
  return [...aggregate.variants].sort((a, b) => {
    const ranked = compareRanks(rankOf(a, preference), rankOf(b, preference))
    if (ranked !== 0) return ranked
    if (a.bytes !== b.bytes) return a.bytes - b.bytes
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * Which file to print for this item under this preference, and how confident
 * that answer is.
 *
 * §5.2's algorithm, minus the base match. The order of the branches is the whole
 * argument for aggregating:
 *
 *   1. **Prefer one part over two.** A self-sufficient variant offering the
 *      requested system wins — 1,497 aggregates on openlock, 359 on dragonlock,
 *      255 on magnetic.
 *   2. **Otherwise fall back to topper + base**, which is what
 *      `resolvePlacement` already does for half the corpus. This is where the
 *      lock penalty collapses: measured over the emitted index, buildability
 *      reaches **88.3% / 81.6% / 78.7%** against a per-design reachability of
 *      99.9% / 74.7% / 59.7% — a 9.6-point spread in place of 40.2. (This
 *      docblock quoted 87.7 / 80.8 / 77.9 and 9.8 when it was written; row A7
 *      re-measured after the footprint rows landed, and row W7 now guards the
 *      figures in the verifier so the next move fails a build.) Magnetic
 *      *rises* because the auto-inserted base supplies magnetic where the tile
 *      has none, and openlock *falls* because tier 2 refuses to count a design it
 *      cannot actually resolve.
 *   3. **A self-sufficient variant exists but not in this system** — a
 *      dragonlock-only stair in an openlock build. It will not clip to its
 *      neighbours, and §7's rule is that this informs and never refuses the
 *      placement.
 *   4. **No joinery information anywhere.** Report unknown, not incompatible.
 *
 * Total: every aggregate yields a selection, because `variants` is never empty.
 */
export function selectVariant(aggregate: TileAggregate, preference: VariantPreference = {}): VariantSelection {
  const ranked = variantsByPreference(aggregate, preference)
  const bottom = preference.bottom

  const pick = (pool: readonly TileVariant[], verdict: VariantVerdict): VariantSelection | undefined => {
    const winner = pool[0]
    if (winner === undefined) return undefined
    const winnerRank = rankOf(winner, preference)
    const optionTie = pool.some(
      (other) =>
        other.id !== winner.id &&
        compareRanks(rankOf(other, preference), winnerRank) === 0 &&
        other.options.join('\u0000') !== winner.options.join('\u0000'),
    )
    return { variant: winner, verdict, optionTie }
  }

  if (aggregate.variantClass === 'insert-only') {
    const selection = pick(ranked, 'insert')
    if (selection !== undefined) return selection
  }

  const selfSufficient = ranked.filter((variant) => !variant.needsBase && variant.layer !== 'insert')
  const offering =
    bottom === undefined ? selfSufficient : selfSufficient.filter((variant) => variant.bottomConn.includes(bottom))
  const integrated = pick(offering, 'self-sufficient')
  if (integrated !== undefined) return integrated

  const toppers = ranked.filter((variant) => variant.needsBase)
  const withBase = pick(toppers, 'needs-base')
  if (withBase !== undefined) return withBase

  const joined = selfSufficient.filter((variant) => variant.bottomConn.length > 0)
  const wrongSystem = pick(joined, 'wrong-system')
  if (wrongSystem !== undefined) return wrongSystem

  // `ranked` holds every variant and {@link TileAggregate.variants} is a
  // non-empty tuple, so this branch always produces a selection. That is the
  // whole reason the tuple is typed the way it is: the alternative was a
  // fabricated variant standing in for an unreachable case.
  return pick(ranked, 'unknown-joinery') ?? { variant: aggregate.variants[0], verdict: 'unknown-joinery', optionTie: false }
}
