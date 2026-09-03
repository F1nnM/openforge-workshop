/**
 * Every way to print one item — the drawer's variants table.
 *
 * Row A5. A1 made the catalog **3,822 aggregates over 8,702 files**, so the
 * drawer shows an item that is on average 2.28 files. This module turns those
 * files into rows a person can choose between, and it is the one place in the app
 * that states what a variant *costs to print*.
 *
 * ## The claim is part count. It is never filament.
 *
 * `bytes` is the only size the corpus carries, and it is **mesh complexity** — a
 * download-size proxy. Print time and filament volume are not in the corpus at
 * any resolution. A UI that put an integrated variant's bytes beside its topper's
 * and drew a conclusion would be inventing a material saving, so this module
 * publishes {@link VariantRow.download} as a download size, labels it as one, and
 * derives **no** ratio, percentage or saving from it anywhere.
 *
 * Two byte figures were in circulation when this row was written and both are
 * correct, because they measure different populations with different statistics.
 * Re-measured here against the emitted index:
 *
 *   - **Spread within an aggregate** — `max/min` over the 1,705 multi-variant
 *     aggregates: median **1.130**, p90 **3.46**, max **39,401**, with **719
 *     (42.2%)** over 1.25x and **325 (19.1%)** over 2x. This is A1's figure and
 *     it is the one {@link TileAggregate.bytesRange} exists for.
 *   - **Integrated against its topper** — over the 931 `both` aggregates,
 *     comparing the smallest self-sufficient variant with the smallest topper:
 *     median **1.024**, and the integrated file is byte-*smaller* on **254
 *     (27.3%)**. Comparing the mean of each side instead gives median **1.0285**
 *     and 251 (27.0%), which is where the row's draft figure of "median 1.027 and
 *     27.4% smaller" came from. Both readings of that comparison hold.
 *
 * So the draft and A1 were never in conflict: 1.13 is the whole-aggregate spread,
 * 1.02 is the integrated-versus-topper pairing, and neither is a filament ratio.
 * The max is the proof of the last clause — **`Aztlan Wall Column T`** holds two
 * `integral` variants at **84 bytes** and **3,309,684 bytes**. An 84-byte STL is
 * a degenerate mesh, not a cheaper print. Any UI reading that 39,401x as a
 * material saving would be reporting a broken file as a bargain.
 *
 * ## The row's identity is a path, because neither the facts nor the name work
 *
 * Measured over all 3,822 aggregates: on **171 (4.5%)** two variants agree on
 * part count, layer, every system {@link joinsOf} renders and every print
 * option — and in the worst case **18** variants of one aggregate share that
 * description. That aggregate is `Plain Wall Base 1x IA`, whose 20 files nearly
 * all read `base / magnetic / flex`, separated only by `blob` and `bytes`. A
 * table keyed on the derived description would render 18 identical rows.
 *
 * Comparing only the three lock systems, as row A3's card chips do, the figure is
 * **215 (5.6%)** — the unfiltered vocabulary this table shows separates 44 items
 * a card cannot, which is one of the reasons the drawer does not filter.
 *
 * The display name is no help either: **131 names are shared by 323 aggregates**,
 * and within an aggregate A1 measured `name` variance at **0** — every variant of
 * an item carries the *same* name.
 *
 * **And the filename alone is not enough**, which is the part that had to be
 * measured rather than assumed: `93 aggregates (2.4%)` hold two variants with the
 * same `basename` in different folders, worst case 16 of them. `family` varies
 * within 1,589 aggregates, so the folder is what separates those.
 *
 * So {@link VariantRow.label} is the **shortest suffix of the file's path that is
 * unique within its own aggregate** — measured depth, in segments: 1 on 3,729
 * aggregates, 2 on 47, 3 on 14, 4 on 6, 5 on 22 and 6 on 4. It is therefore the
 * bare filename on **97.6%** of items and grows only where it must. It is total
 * because `TileVariant.id` is unique within an aggregate by `CatalogFile`'s own
 * parse check, so the suffix search always terminates at the whole path.
 *
 * ## `openforge` underneath is the base declaration, not a join
 *
 * {@link joinsOf} drops `openforge` from the underside systems, and that costs
 * nothing measurable: `openforge` is on the underside of exactly the **4,363**
 * toppers and on **0** of the 4,339 self-sufficient variants. It *is* the
 * declaration that the joinery lives on a separately printed base, which is
 * precisely what the part count already says. Printing "OpenForge" as a join
 * system would advertise a connector on the face that has none.
 *
 * Everything else is passed through unfiltered, unlike row A3's card chips. A
 * card filters to the three locks the builder can be set to because its chip
 * answers "will this join my build"; the drawer is the place where the remaining
 * vocabulary is a fact worth stating — `pegs` on 147 files, `dual` on 74, and
 * `filament` as the side system on the 114 printed-in-place hinges.
 *
 * ## The `base` slot is not an accessory
 *
 * Of the 2,112 composition slots on the 1,776 aggregates that carry any,
 * **1,560 are named `base`** — and a `base` slot appears on **0** of the 4,339
 * variants that need no base, against 2,451 of the 4,363 toppers (56.2%). It is
 * the base *match*, restating `needsBase`, and rows D1 and A6 own it. Listing it
 * as an accessory would put the word "base" under a heading of optional extras
 * on 1,560 items and bury the **552** real accessory slots, which live on only
 * **445** aggregates. So {@link slotRows} separates them and the table's part
 * count carries the base.
 */
import type { AggregateSlot, TileAggregate, TileId, TileVariant } from '@/catalog'

import { formatFileSize } from './labels'

/* ------------------------------------------------------------------ vocabulary */

/**
 * The connection systems as the people who made them spell them.
 *
 * A local map rather than an import of `src/screens/catalog/format.ts`: that file
 * is row A3's, and `labels.ts` already records why this screen does not take a
 * dependency on a sibling screen for a label table. Anything missing falls
 * through to the raw tag word, which costs one row a lowercase label and never a
 * wrong fact.
 */
const SYSTEM_LABELS: Readonly<Record<string, string>> = {
  openlock: 'OpenLOCK',
  dragonlock: 'DragonLock',
  magnetic: 'Magnetic',
  dual: 'Dual',
  pegs: 'Pegs',
  filament: 'Filament hinge',
  openforge: 'OpenForge',
}

/** A connection system's label. */
export function systemLabel(system: string): string {
  return SYSTEM_LABELS[system] ?? system
}

/**
 * The print options, as the corpus spells them, with what each one means.
 *
 * The whole measured vocabulary is four words — `flex` 1,159, `unsupported` 421,
 * `topless` 384, `split` 1 — so this map is closed rather than a prefix rule. A1
 * is explicit that these are different *products* and not cheaper prints of one
 * another, which is why every one of them gets a row of its own in the table
 * instead of being folded into a "best" pick.
 */
const OPTION_NOTES: Readonly<Record<string, string>> = {
  flex: 'Printed in a flexible filament — the magnetic bases are all filed this way.',
  unsupported: 'Geometry reworked to print without supports.',
  topless: 'No top surface. A different product, not a cheaper print of the same one.',
  split: 'Split into separately printed sections.',
}

/** What a print option means, where the corpus's vocabulary is known. */
export function optionNote(option: string): string | undefined {
  return OPTION_NOTES[option]
}

/* ---------------------------------------------------------------------- joins */

/** Which face of the mesh carries a connection system. */
export type JoinFace = 'underside' | 'sides'

/** One connection system on one face of one variant. */
export interface VariantJoin {
  readonly system: string
  readonly label: string
  readonly face: JoinFace
}

/**
 * A variant's connection systems, underside first, `openforge` dropped.
 *
 * Unfiltered otherwise — see the module docblock. Underside before sides because
 * an underside system is the stronger claim: it decides whether the print meets
 * the table on its own.
 */
export function joinsOf(variant: TileVariant): readonly VariantJoin[] {
  const under: VariantJoin[] = variant.bottomConn
    .filter((system) => system !== 'openforge')
    .map((system) => ({ system, label: systemLabel(system), face: 'underside' as const }))
  const sides: VariantJoin[] = variant.sideConn.map((system) => ({
    system,
    label: systemLabel(system),
    face: 'sides' as const,
  }))
  return [...under, ...sides]
}

/* ----------------------------------------------------------------- part count */

/**
 * The minimum number of separate prints a variant takes to place on the grid.
 *
 * A **minimum**, and the word is load-bearing: a composition slot can add
 * another print, and 1,616 of the 2,112 slots in the corpus are `optional`. What
 * this number refuses to be is a material quantity — see the module docblock.
 *
 *   - `2` — the variant is a topper. Print it and a base. 4,363 files.
 *   - `1` — everything else. 4,339 files, of which 285 are inserts.
 */
export type MinParts = 1 | 2

/** One disclosed way to print an item. Never hidden, never collapsed. */
export interface VariantRow {
  /** The file. {@link TileVariant.id} is the React key and the row's identity. */
  readonly variant: TileVariant
  /** Prints needed, at minimum. See {@link MinParts}. */
  readonly minParts: MinParts
  /** `'1 part'` or `'2 parts'` — the table's leading claim. */
  readonly partsLabel: string
  /**
   * What the part count means for *this* variant, in a sentence.
   *
   * Three readings, because "1 part" is not one thing: a self-sufficient tile
   * stands on the grid, while an insert is a single print that is fitted into
   * another piece and never touches the grid at all.
   */
  readonly partsNote: string
  /** Connection systems by face. Empty on the variants that declare none. */
  readonly joins: readonly VariantJoin[]
  /** Print options, in the corpus's own words. Empty for a plain print. */
  readonly options: readonly string[]
  /** The original filename, exactly as the corpus carries it. */
  readonly file: string
  /**
   * The row's identity — the shortest path suffix unique within the aggregate.
   *
   * Equal to {@link file} on 97.6% of items and longer only where two variants
   * share a basename. See the module docblock for the measured depths and for why
   * neither the name nor the derived facts can play this part.
   */
  readonly label: string
  /** Download size, formatted. **Not** a filament or print-time figure. */
  readonly download: string
  /** Indices into {@link TileAggregate.slots} this variant declares. */
  readonly slots: readonly number[]
}

/**
 * The shortest unique path suffix for each variant of an aggregate.
 *
 * One pass per depth, deepening only while some pair still collides, so the
 * 97.6% of items whose basenames already differ cost exactly one pass. Bounded
 * by the longest path in the group and total because ids are unique — at full
 * depth the suffix *is* the id.
 */
function labelsOf(aggregate: TileAggregate): readonly string[] {
  const paths = aggregate.variants.map((variant) => variant.id.split('/'))
  const deepest = Math.max(...paths.map((segments) => segments.length))

  for (let depth = 1; depth < deepest; depth += 1) {
    const suffixes = paths.map((segments) => segments.slice(-depth).join('/'))
    if (new Set(suffixes).size === suffixes.length) return suffixes
  }
  return paths.map((segments) => segments.join('/'))
}

/** The part-count sentence for a variant. */
function partsNoteOf(variant: TileVariant): string {
  if (variant.needsBase) return 'Print this and a base — the joinery is on the base.'
  if (variant.layer === 'insert') return 'One print, fitted into another piece rather than placed on the grid.'
  return 'One print. It meets the table on its own.'
}

/**
 * Every variant of an aggregate, as rows, in `variants` order.
 *
 * **Every** one, and in the aggregate's own order — ascending ordinal, so
 * `rows[0]` holds the address. Nothing is filtered, ranked, deduplicated or
 * truncated here: the row's requirement is that all of them are disclosed, and
 * the largest group in the corpus is 20, which a scrolling drawer shows without
 * a control that hides any of them.
 *
 * Deliberately **not** `variantsByPreference`. That function ranks for a *pick* —
 * which file to print — and A1 measured its residual tie-break as `bytes`
 * ascending on 121 tuples. Ordering a disclosure table by a byte tie-break would
 * put "smallest file" at the top and re-import exactly the implication this
 * module refuses to make. Ordinal order carries no claim at all.
 */
export function variantRows(aggregate: TileAggregate): readonly VariantRow[] {
  const labels = labelsOf(aggregate)

  return aggregate.variants.map((variant, at) => ({
    variant,
    minParts: variant.needsBase ? 2 : 1,
    partsLabel: variant.needsBase ? '2 parts' : '1 part',
    partsNote: partsNoteOf(variant),
    joins: joinsOf(variant),
    options: variant.options,
    file: variant.file,
    label: labels[at] ?? variant.file,
    download: formatFileSize(variant.bytes),
    slots: variant.slots,
  }))
}

/* ----------------------------------------------------------------- slot rows */

/**
 * One accessory slot, with the prints that carry it.
 *
 * C1 reported that {@link AggregateSlot} has **no stable key** — identity today
 * is the position in `TileAggregate.slots`, stable within a build but not
 * append-only across builds. {@link SlotRow.at} carries that position because the
 * UI needs a React key and a cross-reference to the table, and it is never put in
 * a URL, in persisted state or in anything that outlives the build. That is the
 * whole of what this module does with it, and it is why a stable key is worth
 * asking A1 for rather than working around here.
 */
export interface SlotRow {
  /** Position in {@link TileAggregate.slots}. Stable per build only — see above. */
  readonly at: number
  readonly slot: AggregateSlot
  /** The slot's declared name, e.g. `torch`, `lintel`, `portcullis`. */
  readonly name: string
  /** `true` when the fixture marks the slot optional. 1,616 of 2,112 slots. */
  readonly optional: boolean
  /** `true` when every variant declares it, so no choice of print loses it. */
  readonly universal: boolean
  /**
   * The prints that carry this slot, when it is **not** universal, named by the
   * same {@link VariantRow.label} the table's rows carry.
   *
   * Empty for a universal slot, where naming the files would be noise. This is
   * A1's third provenance question — *which file must I print to get it* — and
   * the label is shared with the table on purpose: it is the only string in the
   * drawer that identifies a variant, so the cross-reference is exact rather than
   * approximate.
   */
  readonly onlyOn: readonly string[]
}

/**
 * The accessory slots of an aggregate, with provenance. The `base` slot is not
 * one of them.
 *
 * Measured: 1,560 of the 2,112 slots in the corpus are named `base`, they appear
 * on 0 of the 4,339 variants that need no base, and 824 of the 828
 * `configVaries` aggregates vary *because* of that slot. So the base slot is the
 * base match restating `needsBase` — rows D1 and A6 — and the table's part count
 * already discloses it per row, including which prints need it. What is left is
 * **552 slots over 445 aggregates**, which is the real accessory surface and what
 * row C2 builds a picker for.
 */
export function slotRows(aggregate: TileAggregate): readonly SlotRow[] {
  const labels = labelsOf(aggregate)
  const labelOf = new Map<TileId, string>(
    aggregate.variants.map((variant, at) => [variant.id, labels[at] ?? variant.file]),
  )

  return aggregate.slots
    .map((slot, at) => ({ slot, at }))
    .filter(({ slot }) => slot.slot.name !== 'base')
    .map(({ slot, at }) => ({
      at,
      slot,
      name: slot.slot.name,
      optional: slot.slot.optional === true,
      universal: slot.universal,
      onlyOn: slot.universal ? [] : slot.declaredBy.map((id) => labelOf.get(id) ?? id),
    }))
}
