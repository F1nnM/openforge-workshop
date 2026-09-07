/**
 * How far a room-wide design can actually be honoured — measured over the
 * templates this build can place, and never carried as a constant.
 *
 * ## The question this file exists to answer
 *
 * `@/store`'s `WorkshopState.design` is one `texture` root for the whole scene
 * and `@/template`'s `FillContext.family` prefers it on **every** slot of
 * **every** template. So the control that sets it has to answer one question
 * before it offers anything: *which designs can this archive actually build a
 * room out of?* A picker that offered all 36 reachable roots would offer 8 that
 * provably change nothing and 24 more that move a handful of parts, and the
 * failure would be silent — the user picks `Sandstone`, every slot fills, and
 * the room comes out exactly as it was.
 *
 * Measured over the 91 placeable families and their 179 slots (all of it
 * recomputed in `corpus.test.ts` rather than quoted):
 *
 * | design | parts reached, of 139 |
 * | --- | ---: |
 * | `dungeon_stone` | **120** |
 * | `cut-stone` | **109** |
 * | `towne` | 85 |
 * | `aztlan` | 59 |
 * | 24 more roots | 1 to 25 |
 * | 8 roots | **0** |
 *
 * So {@link deriveDesignReach} returns the 28 with a non-zero reach, ordered by
 * it, each carrying the figure — and the 8 with none are **not offered**,
 * because the only thing choosing one could do is look like it did something.
 *
 * ## Why 139 parts and not 179 slots
 *
 * The **base** slot is excluded from every figure here, and that is this
 * derivation's one editorial decision. Row A3's `rankBases` decides a base by a
 * five-criterion ladder in which the room's design is only the tie-break under
 * all five, and the reason it wins so rarely is not the ladder: **38 of the 40
 * base slots have only `plain` candidates**, so on 38 of them there is no
 * design in the pool to prefer at all. Counting those 40 slots as "not reached"
 * would price the design control for a gap that belongs to the archive, and
 * counting them as reached would be a claim about a slot the design never
 * touches. `basesInDesign` states the 2 that *can* move, once, in words.
 *
 * ## Why cold candidate sets rather than solved fills
 *
 * A reach figure could be measured two ways: resolve each slot's candidates
 * cold and ask whether the design is in the pool, or run C2's solver once per
 * candidate design and count `SlotDecision.familyHonoured`. The second is the
 * literal question and it is **not affordable in a control**: 36 designs × the
 * 40 recipes is 36 whole walks, measured at 10–30 ms each — over a second of
 * synchronous work to render a picker.
 *
 * The first is 139 candidate resolutions, measured at **12–15 ms** over the live
 * archive, and it is a *tight* upper bound rather than a loose one. Both were
 * run over the 40 shipped recipes and compared per design: **11 of the 14
 * designs with any reach there are exact**, and the worst gap is **2 slots**
 * (`foundation`). Every slot of the gap is the greying rule refusing a candidate
 * that would close a sibling — C2's policy working, not a design failing to
 * apply. `corpus.test.ts` asserts the bound in both directions, so it cannot
 * become an under-count and cannot quietly loosen.
 */
import type { AssemblyIndex, AssemblyTemplate } from '@/assembly'
import type { CompositionIndex } from '@/composition'
import { resolveSlotTags } from '@/composition'
import { layoutFor } from '@/template'

/* -------------------------------------------------------------------- labels */

/**
 * `'dungeon_stone'` → `'Dungeon stone'`, `'cut-stone'` → `'Cut stone'`.
 *
 * Derived from the tag rather than looked up in a table, and unlike
 * `lock-picker/reach.ts#lockLabel` that is the right call here: there are three
 * lock systems and they are proper nouns with fixed capitalisation
 * (`OpenLOCK`), where there are 36 texture roots that move with the archive —
 * `pipeline/normalise.ts` has already renamed one (`foundations` →
 * `foundation`) and B5's rescan can add more. A frozen table would render a raw
 * tag for anything it had not been updated for, which is the failure that looks
 * like a bug rather than like a new material.
 *
 * Sentence case, not title case: `mortar_and_stone` would become *"Mortar And
 * Stone"*, and the `and` is the tag's own word rather than a name.
 */
export function designLabel(family: string): string {
  const spaced = family.replace(/[_-]+/g, ' ').trim()
  if (spaced === '') return family
  return `${spaced.slice(0, 1).toUpperCase()}${spaced.slice(1)}`
}

/** `1963` → `1,963`. The same formatter the lock picker uses, for one house style. */
const NUMBER = new Intl.NumberFormat('en-US')

/** A count, grouped. */
export function countLabel(value: number): string {
  return NUMBER.format(value)
}

/** `0.8633` → `86.3%`. One decimal, matching `lock-picker/reach.ts#shareLabel`. */
export function shareLabel(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}

/* ------------------------------------------------------------- the derivation */

/** One design, and how much of what this build can place it reaches. */
export interface DesignReachEntry {
  /** The `texture` root, exactly as `CatalogRecord.texture` carries it. */
  readonly family: string
  /** {@link designLabel}'s reading of it, for a surface. */
  readonly label: string
  /**
   * Non-base parts whose **cold** candidate pool holds at least one item in this
   * design — a tight upper bound on the slots a solve will honour. See the
   * module docblock for the comparison against the solver's own count.
   */
  readonly parts: number
  /** {@link parts} over {@link DesignReach.totalParts}. */
  readonly share: number
  /** Distinct items in the archive carrying this design. Not slot-related — scale. */
  readonly items: number
}

/** The whole comparison: what to offer, and what the archive costs it. */
export interface DesignReach {
  /**
   * The designs worth offering — non-zero {@link DesignReachEntry.parts},
   * descending.
   *
   * Ordering is the derivation's, not the component's, so a rescan that moved
   * which design reaches furthest reorders the list rather than leaving a stale
   * first row.
   */
  readonly entries: readonly DesignReachEntry[]
  /** Non-base parts over every placeable template — the denominator, 139 today. */
  readonly totalParts: number
  /** Base slots, excluded from every figure above. 40 today. */
  readonly baseSlots: number
  /**
   * Base slots whose cold pool holds anything but `plain` — **2 of 40**.
   *
   * The one figure that justifies excluding the base from the reach count, and
   * it is derived rather than asserted so the exclusion stops being right the
   * day the archive gains textured bases.
   */
  readonly basesInDesign: number
  /** `texture` roots reachable as `CatalogRecord.texture` at all. 36 today. */
  readonly roots: number
  /** Roots that reach no placeable part, and are therefore not offered. 8 today. */
  readonly unreached: number
  /**
   * Items carrying no `texture` tag at all — **44 of 3,822**, which is the 89
   * untextured *records* (1.0% of 8,702) collapsed to designs.
   *
   * Counted in items rather than files because that is the level
   * `FillContext.family` compares at, and named rather than dropped for the
   * reason `builder/panels/slots/slotEditor.ts` gives about its own buckets: a
   * tile with no design is a real population, and a design preference can never
   * reach it.
   */
  readonly untextured: number
}

/**
 * The design a base is `plain` in — the value 62.9% of the archive's bases carry.
 *
 * A literal, and the only tag string in this file. It is not a material choice
 * dressed as a constant: `plain` is `materials/mapping.ts`' own reading of it,
 * *"bases; no surface sculpt, not a material"*, and what
 * {@link DesignReach.basesInDesign} counts is base slots offering something
 * other than *no sculpt at all*. Spelled here rather than imported because
 * `@/materials` maps roots to render materials and this is a question about the
 * tag.
 */
const PLAIN = 'plain'

/**
 * The parts something else rests on — the base slots of one template.
 *
 * Read off row B2's layout exactly as `template/fill.ts#isRestedOn` does, and
 * for its reason: the resting relation is authored in the layout, and a test on
 * the name `base` would be a second, weaker copy of it. A template with no
 * layout — all 51 of B4's one-slot families — has **no** base slot, which is
 * correct rather than a fallback: nothing rests on anything.
 *
 * Resolved once per template rather than once per part, because `layoutFor`
 * classifies a part-name *set* and asking it five times for one template is
 * five identical classifications.
 */
function baseSlotsOf(template: AssemblyTemplate): ReadonlySet<string> {
  const layout = layoutFor(template.parts.map((one) => one.name))
  if (layout === undefined) return new Set()
  const out = new Set<string>()
  /* `null` rather than `undefined`: `rules.ts#SlotRule.restsOn` is nullable,
     because a base rests on nothing and the convention says so explicitly. */
  for (const rule of layout.slots) if (rule.restsOn !== null) out.add(rule.restsOn)
  return out
}

/** The designs one slot's cold candidate pool holds, as items rather than files. */
function designsOf(
  template: AssemblyTemplate,
  part: AssemblyTemplate['parts'][number],
  index: AssemblyIndex,
  composition: CompositionIndex,
): ReadonlySet<string> {
  const resolved = resolveSlotTags(part.tags, template.tags, [])
  const out = new Set<string>()
  for (const tile of composition.candidatesFor(resolved).tiles) {
    const texture = index.byId.get(tile)?.texture
    if (texture !== undefined) out.add(texture)
  }
  return out
}

/**
 * The comparison, over the templates a caller can actually place.
 *
 * Pure, and takes the two indexes rather than a `CatalogFile`: `BuilderScreen`
 * already holds an `AssemblyIndex` over 8,702 records and a 409,432-byte
 * `CompositionIndex`, memoised, for the bill and the lock re-solve, and
 * deriving second copies here to answer a picker would be 20 ms and 400 kB of
 * duplicate index for a figure the screen's own objects already contain.
 *
 * `templates` is a **list** and not `@/assembly`'s `TemplateLookup`, because
 * this walks every one of them and a lookup cannot be enumerated. The caller
 * owns which list: today it is C1's `PLACEABLE_TEMPLATES` (91), and passing the
 * 40 recipes alone answers a narrower question honestly rather than wrongly.
 */
export function deriveDesignReach(
  templates: readonly AssemblyTemplate[],
  index: AssemblyIndex,
  composition: CompositionIndex,
): DesignReach {
  const parts = new Map<string, number>()
  let totalParts = 0
  let baseSlots = 0
  let basesInDesign = 0

  for (const template of templates) {
    const bases = baseSlotsOf(template)
    for (const part of template.parts) {
      if (bases.has(part.name)) {
        baseSlots += 1
        const designs = designsOf(template, part, index, composition)
        if ([...designs].some((design) => design !== PLAIN)) basesInDesign += 1
        continue
      }
      totalParts += 1
      for (const design of designsOf(template, part, index, composition)) {
        parts.set(design, (parts.get(design) ?? 0) + 1)
      }
    }
  }

  const items = new Map<string, number>()
  let untextured = 0
  for (const aggregate of composition.aggregates.aggregates) {
    const texture = aggregate.texture
    if (texture === undefined) {
      untextured += 1
      continue
    }
    items.set(texture, (items.get(texture) ?? 0) + 1)
  }

  const entries = [...parts.entries()]
    .map(([family, reached]) => ({
      family,
      label: designLabel(family),
      parts: reached,
      share: totalParts === 0 ? 0 : reached / totalParts,
      items: items.get(family) ?? 0,
    }))
    // Reach descending, then the label, so two designs reaching the same number
    // of parts are in a stable order rather than in `Map` insertion order —
    // which is the order the templates happen to be declared in.
    .sort((a, b) => (b.parts === a.parts ? a.label.localeCompare(b.label) : b.parts - a.parts))

  return {
    entries,
    totalParts,
    baseSlots,
    basesInDesign,
    roots: items.size,
    unreached: items.size - entries.length,
    untextured,
  }
}

/**
 * The entry for one design, or `undefined` when it reaches nothing this build
 * places — or when there are no figures yet.
 *
 * Takes the `null` state as well as the loaded one, so every caller writes one
 * lookup instead of a null check and a lookup. Both answers are *no figures for
 * this design*, and a surface renders them the same way.
 */
export function designOf(reach: DesignReach | null, family: string | undefined): DesignReachEntry | undefined {
  if (reach === null || family === undefined) return undefined
  return reach.entries.find((entry) => entry.family === family)
}
