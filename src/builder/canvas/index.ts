/**
 * The plan — the lattice a room is built on — as one import.
 *
 * Import from `@/builder/canvas`, never from the modules beneath it, so this
 * directory can be reorganised without touching its consumers.
 *
 * ## What "plan" means here, and why this directory is still called `canvas`
 *
 * Row **R4** deleted the 2D SVG renderer this directory was built for
 * (`PlanCanvas.tsx`, `PlanPieces.tsx`, `surfaces.tsx`, `viewport.ts`,
 * `canvas.css`, `canvas.test.tsx` — 2,776 lines), and every module left is pure
 * geometry that the 3D surface in `@/builder/three` drives. So the vocabulary
 * has to be read one level up from where it was written:
 *
 *   - **`plan` is the plan of the room, not the plan *view*.** A `PlanScene` is
 *     the room projected onto a lattice; `planGeometry` is the outline a tile
 *     occupies on it; `PlanTools` is the mode, snap and armed item a *builder*
 *     holds, whichever renderer draws it. Every one of those sentences was true
 *     before R4 and is still true after it. Placement is a 2D lattice with an
 *     elevation — `three/place.ts` and `three/surface.ts` both say so and both
 *     call these functions rather than restating them — so the plan did not go
 *     anywhere when the view drawing it did.
 *   - **`canvas` is the directory name and is now the weaker of the two.** It
 *     named the SVG element. What survives is not a canvas.
 *
 * **The rename was considered and deliberately not done in R4.** Turning
 * `PlanScene`/`PlanPiece`/`planGeometry`/`PlanCatalog`/`buildPlanScene`/
 * `usePlanTools` into a `Room*`/`room*` vocabulary is roughly forty exported
 * symbols across nine surviving modules and every file in `@/builder/three`,
 * `@/builder/panels`, `@/generator/placement`, `@/assembly` and
 * `@/screens/builder` that reads them — and it would rewrite docblocks in every
 * row of this epic, which are the only record of why any of this is shaped the
 * way it is. Mixing that with a 2,776-line deletion makes both unreviewable, and
 * the deletion is the part with behaviour in it. **It is a follow-up row, and
 * `plan` is coherent in the meantime because of the reading above** — which is
 * the whole reason this note exists rather than a `TODO`.
 *
 * ## What the builder screen needs from here
 *
 * ```tsx
 * const catalog = useMemo(() => planCatalogFromFile(file, lock), [file, lock])  // once
 * const tools = usePlanTools()                                       // shared
 * const scene = useMemo(() => buildPlanScene(placements, catalog, styleOf, generated), [...])
 *
 * <Palette selected={tools.selectedDesign} onSelect={tools.setSelectedDesign} />
 * <Builder3DPanel catalog={catalog} scene={scene} tools={tools} onStatus={setStatus} />
 * <Toolbar tools={tools} status={status} onClear={clearPlacements} />
 * ```
 *
 *   - **`planCatalogFromFile(file, lock)`** is memoised on the **lock** as well
 *     as the file since row V4, because a placement names an item and this is
 *     where the item becomes the record this build would print. `catalog.ts` has
 *     the argument for putting the hop there rather than in `buildPlanScene`.
 *   - **`usePlanTools()`** is the shared tool state: mode, snap, pending
 *     rotation, palette selection (an item, not a file). Call it once in the
 *     screen and pass it to the palette, the toolbar and the surface — all three
 *     write to it.
 *   - **The readout is `SurfaceStatus`, and it is not declared here.** It lives
 *     in `@/builder/three/edits.ts`, which is the module that produces it. Until
 *     R4 there were two field-for-field identical types, `PlanStatus` in
 *     `PlanCanvas.tsx` and `SurfaceStatus` beside the renderer that outlived it;
 *     R4 deleted the first and `PlanToolbar` takes the second. One
 *     implementation, one type.
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
 *     drag they describe is *ephemeral renderer state* — the store sees one
 *     `movePlacement` write on the drop and nothing at all on a cancel. The
 *     toolbar's third mode is `PlanTool`'s `'move'`; the readout's `moving`
 *     field names the piece in the air, because a `Shift`-drag move shows no
 *     mode.
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
 * The builder screen owns the bill of tiles and does **not** get it from here:
 * it comes from `buildBillOfTiles(Object.values(placements), assemblyIndex,
 * { lock })` in `@/assembly`, over the same store map the surface writes. The
 * two never disagree because neither holds a copy — the store is the single
 * source of truth and both are projections of it.
 */
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
