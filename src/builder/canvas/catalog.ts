/**
 * What the canvas needs from the catalog, and nothing more.
 *
 * The store holds identities; the records they name are looked up by the caller
 * (`src/store/index.ts` is explicit about that split). So the canvas takes a
 * small injected view of the catalog rather than a `CatalogFile`, for three
 * reasons:
 *
 *   - **A test can supply six records.** The real index is 5.6 MB and 88 ms to
 *     parse; a component test has no business fetching it.
 *   - **De-interning is memoised where it is paid for.** `resolveMaterial` wants
 *     tag *strings* and a record holds tag *ids*; the catalog screen already
 *     memoises that per record and the builder should share the same shape of
 *     answer rather than invent a second cache.
 *   - **No dependency on a screen.** Row 13 owns `src/screens/catalog/`, which
 *     is where the app's memoised index lives today, and the 40-template family
 *     table lives beside it in `src/screens/assemblies/templates.ts`; the builder
 *     canvas importing from a sibling screen would couple two PRs that have no
 *     business knowing about each other. The builder screen passes one of these
 *     in.
 *
 * ## Row A4a: this interface is where an **instance** becomes N records
 *
 * Row V4 wrote *"this interface is where a design becomes a record"*, because a
 * placement named one `DesignId` and a renderer needs one {@link CatalogRecord}.
 * Row **A1** replaced the placement with a {@link TemplateInstance}: a family,
 * one rotation, and a fill per named slot, each fill naming an **exact file**. So
 * the hop is no longer one-to-one and the interface is widened rather than
 * repointed:
 *
 *   - {@link PlanCatalog.record} takes a {@link TileId}. A fill names a file, so
 *     this is a map lookup and nothing more.
 *   - {@link PlanCatalog.parts} takes a whole instance and returns **one entry
 *     per filled slot**, each carrying the slot it came from, the fill that
 *     filled it, the record that file resolves to, and the {@link SlotLayout}
 *     that says where inside the template it sits.
 *
 * Keeping both hops *here* is what keeps the change cheap above: `buildPlanScene`
 * still takes `(placements, catalog, style, generated)`, and `PlanScene` still
 * has `pieces`, `generated`, `conflicts` and `bounds`. What moved is one level
 * down — a `PlanPiece` now has `parts`, and a part has the `record`.
 *
 * ## The lock hop is gone, and that is decision D1 rather than a simplification
 *
 * V4 resolved a design through `selectVariantForLock` here, so that *"the mesh in
 * the room and the line in the bill are the same file"*, and memoised this view
 * on the lock because of it. A1's `SlotFill` names a `TileId` **and carries
 * `pinned`**: the file is chosen at fill time, and re-solving an `auto` fill after
 * a lock change is a store write (contract **C-k**) rather than a read-time
 * guess. `src/store/schema.ts` states the consequence — *"a saved room is
 * deterministic: a re-import cannot silently change what it contains"* — and a
 * canvas that still resolved a variant per render would contradict it, showing
 * one file and pricing another the moment the two disagreed.
 *
 * So `planCatalogFromFile` no longer takes a `lock`, and no longer takes the
 * `aggregates` index it needed to find a design's variants. Both are deleted
 * rather than accepted and ignored, so a caller still passing one is a compile
 * error instead of a preference silently doing nothing. Rule 0 of
 * `src/assembly/resolve.ts` dies for the same reason and by the same decision.
 *
 * ## What is still true of the plan view
 *
 * `foot`, `kinds` and `name` are hoisted facets — A1 measures **zero** aggregates
 * holding two distinct values of any of them — so every variant of an item draws
 * the same outline, and the outlines V4 could not have moved this row cannot
 * either. What changed is *how many* outlines an instance has.
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { resolveTags } from '@/catalog'
import type { ContourStyle, MaterialId } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { SlotFill, SlotName, TemplateId, TemplateInstance } from '@/store'
import { filledSlots } from '@/store'

import type { SlotLayout } from './geometry'
import { ORIGIN_LAYOUT } from './geometry'

/**
 * How one part of one template is laid out, given the file that fills it.
 *
 * **The seam row B2 lands in.** B2 owns `src/template/**` and the `SlotRule`
 * model; its offsets are computed at fill time *from the fill's own footprint*,
 * which is why the record is an argument and not just the slot name — §1.4
 * measured the `base` slot admitting 25 distinct footprints and `wall` 14, so
 * `('base', anything)` has no single answer.
 *
 * A function rather than an import, for this module's third reason: the family
 * table is beside a screen and B2's rule will need it, and the canvas must reach
 * neither. The builder screen composes them and passes the result here, exactly
 * as it already does for the catalog file itself.
 */
export type SlotLayoutRule = (template: TemplateId, slot: SlotName, record: CatalogRecord) => SlotLayout

/**
 * The rule in force until row B2's lands: every part at the instance origin.
 *
 * See {@link ORIGIN_LAYOUT} for what it is right about and what it is not. It is
 * the default so that a test with six records, and the landing hero, need no
 * template knowledge at all — neither has any.
 */
export function originSlotLayout(): SlotLayout {
  return ORIGIN_LAYOUT
}

/** What every part carries, resolved or not: which slot, and what filled it. */
export interface PlanSlotPartBase {
  readonly slot: SlotName
  /** The fill as the store holds it — the file, and whether the user chose it. */
  readonly fill: SlotFill
}

/** A part whose file this build holds. */
export interface ResolvedSlotPart extends PlanSlotPartBase {
  readonly kind: 'resolved'
  readonly record: CatalogRecord
  /** Where inside the template it sits, and how high it stands. */
  readonly layout: SlotLayout
}

/**
 * A part whose file this build does not hold.
 *
 * Reachable from a *valid* persisted scene — a share link or a room saved last
 * month can name a file this index has retired — so it is a value rather than an
 * exception, and it is a **separate member of a union** rather than a
 * `record: CatalogRecord | undefined` field. That is hazard 2 of this epic in
 * miniature: an optional record type-checks at every downstream property access
 * and draws nothing, where a discriminated union makes the reader say what it
 * does about the miss. `scene.ts` puts these in `PlanScene.unknown`.
 */
export interface StrandedSlotPart extends PlanSlotPartBase {
  readonly kind: 'stranded'
}

/** One filled slot of an instance, de-referenced. */
export type PlanSlotPart = ResolvedSlotPart | StrandedSlotPart

/** The catalog, as the canvas sees it. */
export interface PlanCatalog {
  /**
   * The record for one **file**, or `undefined` when this build does not hold it.
   *
   * A {@link TileId} since row A4a, because a {@link SlotFill} names a file
   * (decision **D1**). No lock preference is applied — see the module note.
   */
  record(tile: TileId): CatalogRecord | undefined
  /** That record's tags as strings, for the material registry. */
  tags(record: CatalogRecord): readonly string[]
  /**
   * Every **filled** slot of one instance, in a deterministic order.
   *
   * One entry per key of `instance.fills`, resolved or stranded. Slots the
   * template declares and this instance has *not* filled are deliberately absent
   * and are not this interface's business: an unfilled slot is an ordinary state
   * of an instance (contract **C-g**, §3.2 *"places anyway"*), the party that can
   * enumerate them is the party holding the family table, and that party is
   * `src/builder/panels/slots/` — the surface whose whole job is *needs a
   * choice*. The canvas draws what is there.
   */
  parts(instance: TemplateInstance): readonly PlanSlotPart[]
}

/**
 * A {@link PlanCatalog} over a validated index, with every lookup memoised.
 *
 * Cheap to call repeatedly — it builds its map once — but not free, so the
 * builder screen should build it beside its own memoised index rather than inside
 * a component body.
 *
 * **It is no longer memoised on the lock, because it no longer reads one.** See
 * the module note: a fill names an exact file, so there is no variant to choose
 * and nothing about this view goes stale when the preference changes.
 *
 * `layout` is the {@link SlotLayoutRule}, defaulting to
 * {@link originSlotLayout}. It is memoised per `(template, slot, file)` triple
 * rather than per call: the canvas re-projects the whole scene on every store
 * write, and a room of 40 instances at 5 parts each would otherwise evaluate 200
 * rules per frame.
 */
export function planCatalogFromFile(file: CatalogFile, layout: SlotLayoutRule = originSlotLayout): PlanCatalog {
  const byId = new Map<string, CatalogRecord>(file.records.map((record) => [record.id, record]))
  const tags = new Map<string, readonly string[]>()
  const layouts = new Map<string, SlotLayout>()

  const view: PlanCatalog = {
    record(tile) {
      return byId.get(tile)
    },
    tags(record) {
      let cached = tags.get(record.id)
      if (cached === undefined) {
        cached = resolveTags(file, record)
        tags.set(record.id, cached)
      }
      return cached
    },
    parts(instance) {
      // Sorted by slot name, and that is determinism and nothing more. The
      // template's *declared* order needs the family table, which this module
      // must not reach; and there is no paint order left for it to matter to —
      // row R4 deleted the 2D painter and a pick in 3D is a raycast, so the
      // nearest hit wins by geometry rather than by list position.
      const slots = filledSlots(instance.fills).sort((a, b) => a.localeCompare(b))
      const parts: PlanSlotPart[] = []
      for (const slot of slots) {
        const fill = instance.fills[slot]
        if (fill === undefined) continue
        const record = view.record(fill.tile)
        if (record === undefined) {
          parts.push({ kind: 'stranded', slot, fill })
          continue
        }
        // The key is the triple the rule is a function of, JSON-encoded rather
        // than joined on a separator: two of the six shipped part names contain a
        // space and a `TileId` is a path with slashes, dots and percent signs in
        // it, so there is no punctuation character left that is provably absent
        // from all three.
        const key = JSON.stringify([instance.template, slot, fill.tile])
        let resolved = layouts.get(key)
        if (resolved === undefined) {
          resolved = layout(instance.template, slot, record)
          layouts.set(key, resolved)
        }
        parts.push({ kind: 'resolved', slot, fill, record, layout: resolved })
      }
      return parts
    },
  }
  return view
}

/**
 * How a piece is drawn: a fill, a contour, and the contour's style.
 *
 * **Both halves are used, and that is a WCAG obligation rather than a
 * preference.** `src/materials/palette.ts`: meeting 1.4.11's 3:1 against the
 * parchment well with fills alone would force every material below L* 50, which
 * destroys plaster, sandstone and ice. So silhouette is carried by `edge` and
 * identity by `tint`, and a canvas that filled without stroking would be
 * inaccessible by construction.
 */
export interface PlanStyle {
  readonly material: MaterialId
  readonly tint: string
  readonly edge: string
  readonly contour: ContourStyle
  /** The material's own label, e.g. "Dungeon stone" — for announcements. */
  readonly label: string
}

/**
 * A memoised `record → style` resolver.
 *
 * Keyed on the tile id rather than on the material, because the input to
 * `resolveMaterial` is the whole tag list and the resolution walks an ordered
 * six-stage fallback. 8,702 tiles collapse to 16 families, so the cache is
 * small; the point of it is that the canvas re-renders on every store write and
 * a room of 200 placements would otherwise run 200 resolutions per frame — and
 * since row A1 a placement is up to five parts, so the same room is up to 1,000.
 */
export function createStyleResolver(catalog: PlanCatalog): (record: CatalogRecord) => PlanStyle {
  const cache = new Map<string, PlanStyle>()
  return (record) => {
    let style = cache.get(record.id)
    if (style === undefined) {
      const family = resolveMaterial(catalog.tags(record), record.file).family
      style = {
        material: family.id,
        tint: family.tint,
        edge: family.edge,
        contour: family.contour,
        label: family.label,
      }
      cache.set(record.id, style)
    }
    return style
  }
}
