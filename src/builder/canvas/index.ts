/**
 * The plan-view canvas, as one import.
 *
 * Import from `@/builder/canvas`, never from the modules beneath it, so this
 * directory can be reorganised without touching row 18.
 *
 * ## What row 18 needs from here
 *
 * ```tsx
 * const catalog = useMemo(() => planCatalogFromFile(file), [file])   // once
 * const tools = usePlanTools()                                       // shared
 * const [status, setStatus] = useState<PlanStatus | null>(null)
 *
 * <Palette selected={tools.selectedTileId} onSelect={tools.setSelectedTileId} />
 * <PlanCanvas catalog={catalog} tools={tools} onStatus={setStatus} chrome={false} />
 * <Toolbar tools={tools} status={status} onClear={clearPlacements} />
 * ```
 *
 *   - **`usePlanTools()`** is the shared tool state: mode, snap, pending
 *     rotation, palette selection. Call it once in the screen and pass it to the
 *     palette, the toolbar and the canvas — all three write to it.
 *   - **`PlanStatus`** carries §2.4's `snap {value}` readout, the contextual
 *     hint and the armed tile's name, so the floating toolbar can show them.
 *     Pass `chrome={false}` if row 18 renders its own corner plates instead of
 *     the canvas's.
 *   - **`isPlaceable(record)`** is what the palette should grey out on: `arc`
 *     and `none` footprints are 29.1% of the corpus and the canvas refuses them
 *     visibly rather than silently. Offering them without a mark would make the
 *     refusal look like a bug.
 *   - **`rotationStepFor(record)`** is the ⟳ Rotate button's step. Do not
 *     hardcode 90: 893 tiles carry an angle that is not a multiple of it.
 *   - **`SNAP_STEP`** is the only place the snap values are written down.
 *
 * Row 18 owns the bill of tiles and does **not** get it from here: it comes from
 * `buildBillOfTiles(Object.values(placements), assemblyIndex, { lock })` in
 * `@/assembly`, over the same store map this canvas writes. The two never
 * disagree because neither holds a copy — the store is the single source of
 * truth and both are projections of it.
 */
export { PlanCanvas } from './PlanCanvas'
export type { PlanCanvasProps, PlanStatus } from './PlanCanvas'

export { usePlanTools } from './usePlanTools'
export type { PlanTool, PlanToolDefaults, PlanTools } from './usePlanTools'

export { createStyleResolver, planCatalogFromFile } from './catalog'
export type { PlanCatalog, PlanStyle } from './catalog'

export {
  SNAP_MODES,
  SNAP_STEP,
  anchorFor,
  boxCentre,
  describeCell,
  describeExtent,
  footprintExtent,
  formatUnits,
  isAxisAligned,
  isPlaceable,
  isQuarterTurn,
  nextRotation,
  placementRefusal,
  planBox,
  planQuad,
  quadContains,
  rotatedExtent,
  rotationStepFor,
  snapTo,
  unitsToMm,
} from './geometry'
export type { Extent, PlanBox, PlanPoint, Refusal, RefusalCode, SnapMode } from './geometry'

export { findConflicts, planBand, quadsOverlap } from './overlap'
export type { OverlapCandidate, PlanBand } from './overlap'

export { buildPlanScene, navigationOrder, pieceAt } from './scene'
export type { PlanOmission, PlanPiece, PlanScene } from './scene'

export { computeGhost, ghostOverlaps } from './ghost'
export type { PlanGhost } from './ghost'

export {
  DEFAULT_SCALE,
  FALLBACK_SIZE,
  MAX_SCALE,
  MIN_SCALE,
  centreOn,
  clampScale,
  defaultViewport,
  ensureVisible,
  fitBoxes,
  panByPixels,
  toScreen,
  toWorld,
  usableSize,
  viewBox,
  wheelFactor,
  zoomAt,
} from './viewport'
export type { CanvasSize, Viewport } from './viewport'
