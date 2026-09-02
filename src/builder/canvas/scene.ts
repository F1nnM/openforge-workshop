/**
 * The scene: the store's placements plus the catalog, turned into things to draw.
 *
 * **The store is the single source of truth.** This module holds no state; it is
 * a pure projection of `WorkshopState.placements`, recomputed when that map
 * changes. Nothing here caches a placement, and there is no parallel scene graph
 * to fall out of step — which is what makes "reload the page and the room is
 * still there" true by construction rather than by a synchronisation routine.
 *
 * Three failure modes are first-class outputs rather than exceptions, because
 * all three are reachable from a *valid* persisted scene:
 *
 *   - **`unknown`** — the placement names a tile this catalog build does not
 *     hold. `src/catalog/schema.ts` rule 3 retires the ordinal of a tile that
 *     leaves the corpus, so a scene saved last month or a share link can name
 *     one. `src/assembly/resolve.ts` treats this the same way: a note and an
 *     empty part list, never a throw. One dead tile must not take a room down.
 *   - **`undrawable`** — the tile is in the catalog but its footprint is `none`,
 *     the one case of seven with nothing to draw. Unreachable through this
 *     canvas, which refuses it, and reachable through a share link written by a
 *     build whose classifier resolved a footprint this one does not: 742 tiles
 *     left `none` in row W3 and 249 more became placeable in W4, so the
 *     population is a moving target by design. It is listed rather than dropped
 *     so the count can be surfaced instead of the room silently losing pieces.
 *   - **`conflicts`** — see `overlap.ts`.
 *
 * ## Paint order
 *
 * Areas first, then edges, then insertion order within each band. That is the
 * order the landing hero paints in (floors, then walls, then what stands on
 * them) and the order the physical build happens in, and it means a wall drawn
 * over a floor tile reads as standing on it rather than as a hole in it.
 */
import type { CatalogRecord, TileId } from '@/catalog'
import type { Placement, PlacementId, WorkshopState } from '@/store'

import type { PlanCatalog, PlanStyle } from './catalog'
import type { Extent, PlanBox, PlanCaveat, PlanPart, PlanPoint, PlanShape } from './geometry'
import {
  boxCentre,
  describeCell,
  describeFootprint,
  footprintShape,
  partsContain,
  placementCaveat,
  planGeometry,
} from './geometry'
import type { PlanBand } from './overlap'
import { findConflicts, planBand } from './overlap'

/** One drawable placement. */
export interface PlanPiece {
  readonly id: PlacementId
  readonly placement: Placement
  readonly record: CatalogRecord
  /** The footprint resolved: extent, intrinsic angle, convex parts and the outline path. */
  readonly shape: PlanShape
  /** The un-rotated footprint extent — what the piece *is*, before it was turned. */
  readonly extent: Extent
  /** The axis-aligned box it occupies, anchored at `placement.x`/`placement.z`. */
  readonly box: PlanBox
  /**
   * The angle actually drawn: `placement.rotation + shape.angle`. Differs from
   * the placement's rotation on the 121 `diag` tiles and nowhere else.
   */
  readonly angle: number
  /** The piece as convex polygons. Equal to the box's corners for an axis-aligned rect. */
  readonly parts: readonly PlanPart[]
  readonly band: PlanBand
  /** Whether the drawn box is the shape. Read by the corner-junction exemption. */
  readonly axisAligned: boolean
  readonly style: PlanStyle
  readonly conflict: boolean
  /** Set when the outline rests on an unmeasured band rule. See `placementCaveat`. */
  readonly caveat: PlanCaveat | null
  /** The accessible name — material, name, size, angle, position, and any caveat. */
  readonly label: string
}

/** A placement that could not be drawn, and why. */
export interface PlanOmission {
  readonly id: PlacementId
  readonly tileId: TileId
  readonly reason: string
}

export interface PlanScene {
  /** In paint order: areas, then edges, insertion order within each. */
  readonly pieces: readonly PlanPiece[]
  readonly conflicts: ReadonlySet<PlacementId>
  readonly unknown: readonly PlanOmission[]
  readonly undrawable: readonly PlanOmission[]
  /** The bounding box of everything drawn, or `null` for an empty scene. */
  readonly bounds: PlanBox | null
}

/**
 * The accessible name of one piece. Read out when the cursor lands on it.
 *
 * The shape is described per footprint case rather than as its bounding box, and
 * an unmeasured band is *named* here rather than left to the drawing: a hatch
 * over a curve is invisible to a screen reader, and the whole point of carrying
 * `bandBasis` through to the builder is that the user can tell a measured
 * outline from a defaulted one.
 */
function describePiece(
  record: CatalogRecord,
  extent: Extent,
  placement: Placement,
  style: PlanStyle,
  caveat: PlanCaveat | null,
): string {
  const angle = placement.rotation === 0 ? '' : `, turned ${String(Math.round(placement.rotation * 100) / 100)} degrees`
  const shape = describeFootprint(record.foot, extent)
  const note = caveat === null ? '' : ', unmeasured outline'
  return `${record.name}, ${style.label}, ${shape}${angle}, at ${describeCell(placement.x, placement.z)}${note}`
}

const BAND_ORDER: Readonly<Record<PlanBand, number>> = { area: 0, edge: 1 }

/**
 * Build the scene.
 *
 * `style` is passed in rather than resolved here so the memoised resolver
 * outlives a single projection — see `createStyleResolver`.
 */
export function buildPlanScene(
  placements: WorkshopState['placements'],
  catalog: PlanCatalog,
  style: (record: CatalogRecord) => PlanStyle,
): PlanScene {
  const drawable: PlanPiece[] = []
  const unknown: PlanOmission[] = []
  const undrawable: PlanOmission[] = []

  for (const [key, placement] of Object.entries(placements)) {
    const id = key as PlacementId
    const record = catalog.record(placement.tileId)
    if (record === undefined) {
      unknown.push({
        id,
        tileId: placement.tileId,
        reason: `${placement.tileId} is not in this catalog build; it may have been retired.`,
      })
      continue
    }
    const shape = footprintShape(record.foot)
    if (shape === undefined) {
      undrawable.push({
        id,
        tileId: placement.tileId,
        reason: `${record.name} has a ${record.foot.shape} footprint, which the plan view cannot draw.`,
      })
      continue
    }
    const resolved = style(record)
    const caveat = placementCaveat(record) ?? null
    const geometry = planGeometry(shape, placement.rotation, placement.x, placement.z)
    drawable.push({
      id,
      placement,
      record,
      shape,
      extent: shape.extent,
      box: geometry.box,
      angle: geometry.angle,
      parts: geometry.parts,
      band: planBand(record),
      axisAligned: geometry.axisAligned,
      style: resolved,
      conflict: false,
      caveat,
      label: describePiece(record, shape.extent, placement, resolved, caveat),
    })
  }

  const conflicts = findConflicts(drawable)
  const pieces = drawable
    .map((piece) => (conflicts.has(piece.id) ? { ...piece, conflict: true } : piece))
    .sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band])

  return { pieces, conflicts, unknown, undrawable, bounds: sceneBounds(pieces) }
}

function sceneBounds(pieces: readonly PlanPiece[]): PlanBox | null {
  if (pieces.length === 0) return null
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const { box } of pieces) {
    left = Math.min(left, box.x)
    top = Math.min(top, box.z)
    right = Math.max(right, box.x + box.w)
    bottom = Math.max(bottom, box.z + box.d)
  }
  return { x: left, z: top, w: right - left, d: bottom - top }
}

/**
 * The topmost piece under a point, or `undefined`.
 *
 * Last in paint order wins, which is the piece drawn on top — so clicking where
 * a wall crosses a floor erases the wall, which is the one the user can see.
 */
export function pieceAt(scene: PlanScene, point: PlanPoint): PlanPiece | undefined {
  for (let i = scene.pieces.length - 1; i >= 0; i -= 1) {
    const piece = scene.pieces[i] as PlanPiece
    if (partsContain(piece.parts, point)) return piece
  }
  return undefined
}

/**
 * Scene order for cursor navigation: reading order down the plan, then across.
 *
 * Not paint order, and not insertion order. A keyboard user stepping through the
 * room with `[` and `]` needs a spatial sequence — the tile *next to* this one —
 * and insertion order is the order things happened to be placed in, which after
 * ten minutes of editing is no order at all.
 */
export function navigationOrder(scene: PlanScene): readonly PlanPiece[] {
  return [...scene.pieces].sort((a, b) => {
    const ac = boxCentre(a.box)
    const bc = boxCentre(b.box)
    return ac.z - bc.z || ac.x - bc.x
  })
}
