/**
 * What the canvas needs from the catalog, and nothing more.
 *
 * The store holds identities; the records they name are looked up by the caller
 * (`src/store/index.ts` is explicit about that split). So the canvas takes a
 * two-method view of the catalog rather than a `CatalogFile`, for three reasons:
 *
 *   - **A test can supply six records.** The real index is 5.6 MB and 88 ms to
 *     parse; a component test has no business fetching it.
 *   - **De-interning is memoised where it is paid for.** `resolveMaterial` wants
 *     tag *strings* and a record holds tag *ids*; the catalog screen already
 *     memoises that per record and the builder should share the same shape of
 *     answer rather than invent a second cache.
 *   - **No dependency on a screen.** Row 13 owns `src/screens/catalog/`, which
 *     is where the app's memoised index lives today; the builder canvas importing
 *     from a sibling screen would couple two PRs that have no business knowing
 *     about each other. Row 18 passes one of these in.
 *
 * ## Row V4: this interface is where a design becomes a record
 *
 * A placement names a {@link DesignId} and a renderer needs a
 * {@link CatalogRecord} — a mesh has to come from somewhere. Putting that hop
 * *here*, behind a method whose name did not change, is what keeps the change
 * invisible above: `buildPlanScene`'s signature, `PlanScene`, `PlanPiece` and
 * every consumer of them — row R2's 3D interaction, the landing
 * hero — are untouched, and the one thing they all read, `piece.record`, is
 * still a record. The alternative was a `lock` parameter threaded through
 * `buildPlanScene` into three call sites, one of them in a directory this row
 * must not edit.
 *
 * **Which record.** The one this build would *print*: `selectVariantForLock`,
 * the same function `resolvePlacement` uses for rule 0, so the mesh in the room
 * and the line in the bill are the same file. Not `TileAggregate.preview`, which
 * answers *what does this item look like* and disagrees with the printed file on
 * 1,598 of 3,822 items — a 3D room drawn from `preview` would show a topper
 * standing on nothing where the bill lists a self-sufficient integral.
 *
 * For the **plan view** the choice provably does not matter, which is worth
 * knowing because it means V4 cannot have moved a single outline: `buildPlanScene`
 * reads `foot`, `kinds` and `name` off the record and hands the tag list to
 * `resolveMaterial`, and `foot`, `kinds` and `name` are hoisted facets — A1
 * measures **zero** aggregates holding two distinct values of any of them. For
 * the **3D room** it matters completely, because `record.blob` is the mesh.
 */
import { selectVariantForLock } from '@/assembly'
import type { AggregateIndex, CatalogFile, CatalogRecord, DesignId } from '@/catalog'
import { buildAggregateIndex, resolveTags } from '@/catalog'
import type { ContourStyle, MaterialId } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { LockSystem } from '@/store'

/** The catalog, as the canvas sees it. */
export interface PlanCatalog {
  /**
   * The record a placed **item** resolves to under this build's lock
   * preference, or `undefined` when this build does not hold the item.
   *
   * Takes a {@link DesignId} since row V4 — see the module note for why the hop
   * lives here and which variant it picks.
   */
  record(design: DesignId): CatalogRecord | undefined
  /** That record's tags as strings, for the material registry. */
  tags(record: CatalogRecord): readonly string[]
}

/**
 * A {@link PlanCatalog} over a validated index, with every lookup memoised.
 *
 * Cheap to call repeatedly — it builds its maps once — but not free, so row 18
 * should build it beside its own memoised index rather than inside a component
 * body. **It is memoised on the lock as well as on the file**, because the lock
 * decides which variant every design resolves to; a caller that holds one across
 * a change of preference would draw last preference's meshes.
 *
 * `lock` is optional and absent means *no preference*, which is
 * `AssemblyOptions.lock`'s own convention and not a defaulted `openlock`:
 * reading the store's default here would silently apply a preference to a caller
 * that had deliberately not stated one — the landing hero and the fixtures.
 *
 * `aggregates` is a parameter with a default for the reason `deriveLockBuild`
 * takes one: the builder screen already holds an aggregate index over this exact
 * file, and building a second is 3,822 groups of work for nothing.
 */
export function planCatalogFromFile(
  file: CatalogFile,
  lock?: LockSystem,
  aggregates: AggregateIndex = buildAggregateIndex(file),
): PlanCatalog {
  const byId = new Map<string, CatalogRecord>(file.records.map((record) => [record.id, record]))
  const resolved = new Map<DesignId, CatalogRecord | undefined>()
  const tags = new Map<string, readonly string[]>()
  return {
    record(design) {
      // `has` rather than `?? compute`, so a design this build does not hold is
      // cached as a miss too. A room full of retired items would otherwise run
      // the aggregate lookup once per placement per render.
      if (resolved.has(design)) return resolved.get(design)
      const aggregate = aggregates.byDesign.get(design)
      const record =
        aggregate === undefined ? undefined : byId.get(selectVariantForLock(aggregate, lock).variant.id)
      resolved.set(design, record)
      return record
    },
    tags(record) {
      let cached = tags.get(record.id)
      if (cached === undefined) {
        cached = resolveTags(file, record)
        tags.set(record.id, cached)
      }
      return cached
    },
  }
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
 * a room of 200 placements would otherwise run 200 resolutions per frame.
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
