/**
 * What the canvas needs from the catalog, and nothing more.
 *
 * The store holds `TileId`s; the records they name are looked up by the caller
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
 */
import type { CatalogFile, CatalogRecord, TileId } from '@/catalog'
import { resolveTags } from '@/catalog'
import type { ContourStyle, MaterialId } from '@/materials'
import { resolveMaterial } from '@/materials'

/** The catalog, as the canvas sees it. */
export interface PlanCatalog {
  /** The record for a placed tile, or `undefined` when this build does not hold it. */
  record(id: TileId): CatalogRecord | undefined
  /** That record's tags as strings, for the material registry. */
  tags(record: CatalogRecord): readonly string[]
}

/**
 * A {@link PlanCatalog} over a validated index, with both lookups memoised.
 *
 * Cheap to call repeatedly — it builds the id map once — but not free, so row 18
 * should build it beside its own memoised index rather than inside a component
 * body.
 */
export function planCatalogFromFile(file: CatalogFile): PlanCatalog {
  const byId = new Map<string, CatalogRecord>(file.records.map((record) => [record.id, record]))
  const tags = new Map<string, readonly string[]>()
  return {
    record: (id) => byId.get(id),
    tags(record) {
      let resolved = tags.get(record.id)
      if (resolved === undefined) {
        resolved = resolveTags(file, record)
        tags.set(record.id, resolved)
      }
      return resolved
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
