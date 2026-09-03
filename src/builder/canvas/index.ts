/**
 * The plan-view canvas, as one import.
 *
 * Import from `@/builder/canvas`, never from the modules beneath it, so this
 * directory can be reorganised without touching row 18.
 *
 * ## What row 18 needs from here
 *
 * ```tsx
 * const catalog = useMemo(() => planCatalogFromFile(file, lock), [file, lock])  // once
 * const tools = usePlanTools()                                       // shared
 * const [status, setStatus] = useState<PlanStatus | null>(null)
 *
 * <Palette selected={tools.selectedDesign} onSelect={tools.setSelectedDesign} />
 * <PlanCanvas catalog={catalog} tools={tools} onStatus={setStatus} chrome={false} />
 * <Toolbar tools={tools} status={status} onClear={clearPlacements} />
 * ```
 *
 *   - **`planCatalogFromFile(file, lock)`** is memoised on the **lock** as well
 *     as the file since row V4, because a placement names an item and this is
 *     where the item becomes the record this build would print. `catalog.ts` has
 *     the argument for putting the hop there rather than in `buildPlanScene`.
 *   - **`usePlanTools()`** is the shared tool state: mode, snap, pending
 *     rotation, palette selection (an item, not a file). Call it once in the screen and pass it to the
 *     palette, the toolbar and the canvas — all three write to it.
 *   - **`PlanStatus`** carries §2.4's `snap {value}` readout, the contextual
 *     hint and the armed tile's name, so the floating toolbar can show them.
 *     Pass `chrome={false}` if row 18 renders its own corner plates instead of
 *     the canvas's.
 *   - **`isPlaceable(record)`** is what the palette should grey out on. Six of
 *     the seven footprint cases now draw, so this is the `none` case alone —
 *     **8.3% of the corpus, down from 29.1%** — and `placementRefusal(record)`
 *     always returns a reason when it is false. The two read the same gate, which
 *     they did not before: `column`, `tri` and `diag` spent one row greyed out
 *     with no message at all because two switches over the same union disagreed
 *     about which cases existed.
 *   - **`placementCaveat(record)`** is the other half of that answer, and a
 *     palette or a bill that reports on provenance wants it: 462 of the 1,199
 *     curves are drawn from a band rule with no accepted mesh fit behind it. They
 *     *are* placeable; the caveat is what says the outline may sit up to half a
 *     unit in or out.
 *   - **`rotationStepFor(record)`** is the ⟳ Rotate button's step. Do not
 *     hardcode 90: 893 tiles carry an angle that is not a multiple of it, 823 of
 *     them now placeable, and on all 1,199 curves the step *equals the sweep* —
 *     which is what makes one press land a curve beside its predecessor.
 *   - **`SNAP_STEP`** is the only place the snap values are written down.
 *   - **`move.ts`** is the move operation PR #29 refused: `beginMove`,
 *     `dragMoveTo` / `nudgeMove` and `previewMove` are the whole of it, and the
 *     drag they describe is *ephemeral canvas state* — the store sees one
 *     `movePlacement` write on the drop and nothing at all on a cancel. The
 *     toolbar's third mode is `PlanTool`'s `'move'`; `PlanStatus.moving` names
 *     the piece in the air, because a `Shift`-drag move shows no mode.
 *
 * ## Row X9: the second population
 *
 * `buildPlanScene` takes an optional fourth argument — the store's `generated`
 * map — and puts the resulting {@link GeneratedPlanPiece}s in
 * `scene.generated`, a list of its own beside `scene.pieces`. It is a second
 * list rather than a widened one because a `PlanPiece` carries a
 * `CatalogRecord` and a generated base has none; `scene.ts` sets out the three
 * things the two populations nevertheless share (one conflict sweep, one bounds
 * box, one `PlacementId` space). Everything that does not need a record —
 * `pieceAt`, `navigationOrder`, the whole of `move.ts` — takes
 * {@link ScenePiece} and works on either, with `pieceName` and
 * `pieceRotationStep` as the two accessors that differ.
 *
 * Callers with no generated map pass nothing and get an empty second list.
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
  DIAGONAL_ANGLE_DEG,
  SNAP_MODES,
  SNAP_STEP,
  anchorFor,
  anchorForShape,
  boxCentre,
  describeCell,
  describeExtent,
  describeFootprint,
  footprintExtent,
  footprintRefusal,
  footprintShape,
  formatUnits,
  isAxisAligned,
  isPlaceable,
  isQuarterTurn,
  nextRotation,
  partsContain,
  placementCaveat,
  placementRefusal,
  planBox,
  planGeometry,
  planParts,
  planQuad,
  quadContains,
  rotatedExtent,
  rotationStepFor,
  snapTo,
  unitsToMm,
} from './geometry'
export type {
  CaveatCode,
  Extent,
  PlanBox,
  PlanCaveat,
  PlanCover,
  PlanGeometry,
  PlanPart,
  PlanPoint,
  PlanShape,
  Refusal,
  RefusalCode,
  SnapMode,
} from './geometry'

export {
  SECTOR_TOLERANCE_UNITS,
  arcSectorExtent,
  sectorCentre,
  sectorParts,
  sectorPath,
  sectorSlack,
  sectorSubdivisions,
} from './sector'

export { findConflicts, partsOverlap, planBand, quadsOverlap } from './overlap'
export type { OverlapCandidate, OverlapSubject, PlanBand } from './overlap'

export { buildPlanScene, navigationOrder, pieceAt, pieceName, pieceRotationStep, scenePaintOrder } from './scene'
export type { GeneratedPlanPiece, PlanOmission, PlanPiece, PlanScene, ScenePiece } from './scene'

export { VACANCY_SEARCH_UNITS, VACANCY_STEP, freeCellFor } from './vacancy'

export { computeGhost, ghostOverlaps } from './ghost'
export type { PlanGhost } from './ghost'

export {
  beginMove,
  concentricNote,
  concentricOffset,
  describeCancel,
  describeDrop,
  describeGrab,
  describeMoveHint,
  describeNudge,
  dragMoveTo,
  isConcentricOnLattice,
  nudgeMove,
  previewMove,
} from './move'
export type { MoveDrag, MoveNote, MoveNoteCode, MovePreview, MoveRefusal, MoveRefusalCode } from './move'

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
