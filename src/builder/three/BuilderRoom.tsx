/**
 * The room in 3D — the module that owns every heavy import in this row, and now
 * the surface the room is *built* on rather than a picture of it.
 *
 * `Builder3DPanel` reaches this file through `lazy(() => import('./BuilderRoom'))`
 * and that indirection is the whole eager-cost story: three.js, r3f, drei,
 * `postprocessing`, n8ao, `GLTFLoader` and the meshopt decoder are reachable only
 * from here, so nothing on the panel's side of the line carries a renderer.
 * `boundary.test.ts` walks the static import graph from `index.ts` and fails if
 * anything does, because the failure is otherwise silent — the app keeps working
 * and the entry chunk simply grows by 400 kB gzipped.
 *
 * ## What row R2 changed here, and why the canvas is now unconditional
 *
 * The owner's request is that the 2D view is *"an artefact of v1"* and that the
 * 3D view *"needs to support the tile placing etc in it"*. Two things in this
 * file were built on the opposite assumption and had to go:
 *
 *   - **The canvas was only mounted once geometry had arrived.** `groups.length
 *     === 0` rendered a well of prose instead of a `<Stage>`, on the reasoning
 *     that the plan view was drawing the room underneath. That is right for a
 *     preview and fatal for a work surface: with no canvas there is no ground
 *     plane, so there is nowhere to place the *first* tile. The canvas is now
 *     always mounted and every one of those states is an **overlay** on it.
 *   - **The scene was projected here.** `BuilderRoom` called `buildPlanScene`
 *     over the store's placements, which made a second projection beside
 *     `BuilderScreen`'s and the plan view's. It now takes the {@link PlanScene}
 *     the screen already built — *one scene, and since row R4 one renderer of
 *     it* — which is also what keeps this row clear of row **V4**: a
 *     placement's shape is changing under it, and nothing here reads a
 *     `Placement` field.
 *
 * ## The frame is fixed, which `fitRoom` deliberately is not
 *
 * `place.ts`'s `fitRoom` normalises the *room's own bounds* into `Stage`'s unit
 * frame, and that is the correct answer for looking at a finished room: it
 * frames whatever is there. It is the wrong answer for building one, because the
 * scale then changes on every placement — put a tile at the edge and the whole
 * plan rescales and recentres under the cursor, so the next tile does not land
 * where it was aimed. So the work surface uses `surface.ts`'s
 * {@link surfaceFit}, a constant, and reaches the rest of the plan through the
 * orbit's own pan and zoom. `room.fit` is still computed and still quoted in the
 * readout, which is the honest use for it.
 *
 * That constant scale is also what lets {@link AO_RADIUS_MM} become a fixed
 * `aoRadius` instead of one that changes with the room: the crease stays the
 * same physical size whatever is placed.
 *
 * ## `enablePan`, at last used by the component its docblock names
 *
 * `Stage`'s `enablePan` prop says it *"exists because `BuilderRoom.tsx` asked
 * for it"* — and until this row `BuilderRoom` did not actually pass it, so a
 * two-metre plan could be orbited and zoomed and never walked across. It is
 * passed now, which is the difference between looking at a room and working
 * across one.
 *
 * ## The renderer is `src/three/Stage.tsx`, not a second one
 *
 * Row **G3** owns the shared canvas, and its whole premise is that browsers cap
 * live WebGL contexts (~16 in Chrome) and drop the oldest, so a second renderer
 * here would be the exact mistake G3 exists to prevent. `Stage` brings the tuned
 * decisions with it: no tone-mapping curve in front of §9's annealed palette, a
 * transparent drawing buffer over the parchment well, `dpr` capped at 2,
 * `frameloop="demand"`, and `RenderPass → N8AO → SMAA` where the AO pass *is*
 * the contour that a fill alone cannot carry.
 *
 * ## One occlusion colour, and that is N8AO's constraint rather than Stage's
 *
 * `material.ts` gives each family a measured `edge` and `Stage` puts it into the
 * AO pass. N8AO is a **full-screen** pass with one colour, so a room of eight
 * families cannot have eight crease colours — not because `Stage` takes one
 * string, but because a screen-space occlusion pass has one uniform. The
 * dominant family by instance count wins, which is the choice that colours the
 * most creases correctly.
 *
 * ## Row D7: this file holds the hover cue, because the cue crosses the canvas
 *
 * The silhouette pass belongs to `Stage` — it is one composer per `<Canvas>` and
 * that canvas is shared with the catalog's tile previews — and the piece under
 * the pointer is known only to `RoomSurface`, *inside* the canvas. So the two
 * meet here, in the component that mounts both: the surface publishes an
 * {@link OutlineRequest} through `onOutline`, this holds it, and `Stage` draws
 * it. The same shape `onStatus` has had since R2, and for the same reason.
 *
 * One `useState` and no subscription, deliberately. A hover crossing is already
 * strictly cheaper than what the readout costs: `onStatus` fires on every
 * pointer *move* (the status carries the cursor), so this file re-renders per
 * move today, and a request published once per piece entered adds a fraction of
 * that. The alternative — a mutable handle the surface writes and the pass
 * subscribes to — buys nothing and hides the wiring.
 *
 * `Stage` gets the request on every render, empty when nothing is hovered, and
 * `StageProps.outline` says why that must not become `undefined` between
 * hovers: presence is what builds the pass.
 *
 * ## A placed tile with no mesh is drawn, always
 *
 * R1 measured **0.60 s to a first warm mesh and 1.37 s cold**, and its cache has
 * four terminal states in which a mesh never arrives at all. So this is a common
 * condition and not an edge case, and the one unacceptable answer is to draw
 * nothing: an occupied cell that looks empty invites a second tile on top of the
 * first, and nothing would say so until the bill listed two. Every piece without
 * geometry therefore gets a **footprint plate** — `markers.ts` — and the count
 * is in the hint line and the readout. Nothing in the gesture path consults the
 * mesh store, so a missing mesh cannot change what may be placed where.
 */
import { useCallback, useMemo, useState } from 'react'

import type { PlanCatalog, PlanScene, PlanTools } from '@/builder/canvas'
import { useAnnouncer } from '@/builder/canvas/hooks'
import type { ScenePiece } from '@/builder/canvas'
import type { UndoControls } from '@/builder/canvas/useHistory'
import type { CatalogAssets, CatalogRecord } from '@/catalog'
import type { Resolution } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { PlacementId, SlotName } from '@/store'
import { useLockSystem, useRoomDesign } from '@/store'
import { VIEW_RADIUS } from '@/three/geometry'
import type { OutlineRequest } from '@/three/outline'
import { NO_OUTLINE } from '@/three/outline'
import { AO_RADIUS, Stage } from '@/three/Stage'

import type { SurfaceStatus } from './edits'
import { describeSurface } from './edits'
import type { FillAuthorities } from './fills'
import { createPlacementFiller } from './fills'
import type { Room3D } from './instances'
import { buildRoom3D, roomBlobs } from './instances'
import { meshoptSupported } from './loadLod'
import { RoomSurface } from './RoomSurface'
import { surfaceFit } from './surface'
import type { LodStoreState } from './useLodStore'
import { useLodStore } from './useLodStore'

import './builder3d.css'

/**
 * The median tile's bounding-box extents in millimetres.
 *
 * `src/three/geometry.ts`'s measurement, not a new one: the median-sized file in
 * the archive (`cut-stone+ruined#floor+s2w+wall.4x1.openforge.stl`, 10.36 MB) is
 * **101.60 × 12.70 × 4.50**, where 101.60 is 4 × 25.4 to the hundredth and 12.70
 * is exactly `WALL_THICKNESS_MM`.
 */
export const MEDIAN_TILE_MM: readonly [number, number, number] = [101.6, 12.7, 4.5]

/**
 * The occlusion radius as a physical length: **4.612 mm**.
 *
 * Derived rather than picked. `Stage` tunes `AO_RADIUS` to `0.09 × VIEW_RADIUS`
 * against a single mesh normalised to a unit bounding radius, and states the
 * band it was tuned in: below ~0.05 the creases between dungeon-stone blocks
 * stop reading at 288 px, above ~0.15 the AO flattens the silhouette it exists
 * to define. Converting that ratio through the median tile's own bounding radius
 * (half of `|MEDIAN_TILE_MM|`, 51.246 mm) gives the physical crease size those
 * limits describe.
 *
 * Under row R2's **constant** work fit this is multiplied by one fixed scale, so
 * the crease is the same physical size for the whole session rather than
 * changing as the room grows — which is what a builder wants and what a
 * bounds-fitted room could not give.
 */
export const AO_RADIUS_MM = (AO_RADIUS / VIEW_RADIUS) * (Math.hypot(...MEDIAN_TILE_MM) / 2)

/** The id the canvas's `aria-describedby` points at. */
const KEY_HELP_ID = 'of-b3d-keys'

export interface BuilderRoomProps {
  readonly catalog: PlanCatalog
  /**
   * The scene, built once by the screen — see the module note.
   *
   * A `PlanScene` and not a placements map, which is both better architecture
   * and this row's whole insulation from row **V4**: every piece of geometry,
   * every conflict and every refusal arrives already resolved by
   * `buildPlanScene`, so no field of a `Placement` is read here.
   */
  readonly scene: PlanScene
  /** The shared tool state — `PlanToolbar` and the palette write the same object. */
  readonly tools: PlanTools
  /**
   * `lod` alone, which is the whole of what this surface fetches.
   *
   * It carried `models` too while the room had a second mesh source: `@/mesh`'s
   * in-browser conversion of the source STL was keyed on that base, and this
   * component subscribed to its queue so a mesh that finished converting after
   * the surface had mounted actually appeared. `/lod/` is backfilled, that
   * fallback is deleted, and the archive base is no longer this component's
   * business. Call sites pass the whole `catalogFile.assets`, so nothing changed
   * but the type.
   */
  readonly assets: Pick<CatalogAssets, 'lod'>
  /**
   * The three authorities row **C5**'s fill solve needs, and not one more.
   *
   * `BuilderScreen` already holds all three, memoised, for the bill and for the
   * lock re-solve: `buildAssemblyIndex` over 8,702 records, a `TemplateLookup`
   * over `PLACEABLE_TEMPLATES`' 91 families, and `compositionIndexFor`'s shared
   * 409,432-byte inverted index. Passing them is what keeps the room, the bill
   * and the slots panel answering about one archive; deriving them here would
   * build a second assembly index for an identical answer.
   *
   * **Required, so the wiring cannot be forgotten silently.** The lock
   * preference is deliberately *not* here — it is read from the store below, the
   * same store `BuilderScreen` reads it from, because it is a preference rather
   * than an index and a prop would let the two drift.
   */
  readonly fill: FillAuthorities
  /**
   * Row **C8**: the owner's right click, passed straight through to the surface.
   *
   * Nothing is done to it here and nothing can be — the dialog it opens is
   * `builder/panels/slots/`'s and lives outside this directory, which is
   * `builder/panels/boundary.test.ts`'s line and not an inconvenience. So the
   * room is a wire, and the state it would otherwise hold is `BuilderScreen`'s.
   */
  readonly onEditSlots?: (placement: PlacementId, slot?: SlotName) => void
  /**
   * Undo and redo, from the screen's single {@link useHistory} call.
   *
   * Threaded rather than taken here: the hook holds its ring in a ref, so a
   * component that called it would own a *second* history of the same room and
   * the toolbar's buttons would disagree with the canvas's keys.
   */
  readonly history: UndoControls
  /**
   * The slot editor for the selected piece, composed by the caller.
   *
   * Passed straight through to `RoomSurface`, which carries the argument for why
   * it is a render prop: `SlotEditor` is on the far side of
   * `builder/panels/boundary.test.ts`'s line, so nothing in `builder/three` may
   * build it — but the action bar over the selected piece is where it now
   * belongs. The screen composes it; the surface holds the space.
   */
  readonly renderSlots?: (piece: ScenePiece, close: () => void) => React.ReactNode
  readonly onStatus?: (status: SurfaceStatus) => void
  /** Injected by tests so no request leaves the process. */
  readonly fetchImpl?: typeof fetch
}

export function BuilderRoom({
  catalog,
  scene,
  tools,
  assets,
  fill,
  history,
  renderSlots,
  onEditSlots,
  onStatus,
  fetchImpl,
}: BuilderRoomProps) {
  /**
   * The armed **family**, straight off the shared tool state.
   *
   * No resolution left to do *here*, and that is row A1's doing rather than a
   * simplification: the palette arms a `TemplateId` (§2.5 — *"templates are the
   * only placement unit"*), and turning one into the files that fill its slots is
   * row **C2**'s solver, which {@link filler} below calls on the click. There is
   * no lock hop for the *drawing* — a `SlotFill` names an exact file (decision
   * **D1**), so `planCatalogFromFile` takes no `lock`.
   */
  const armed = tools.selectedTemplate

  /**
   * The click's fill solver, memoised on everything that can change its answer.
   *
   * The lock is read from the store rather than taken as a prop, and read
   * **unconditionally** rather than through `useLockChosen`: `buildBillOfTiles`
   * and `reSolveScene` both take `lock` as it stands, so a filler that declined
   * the default preference would place files the bill prices differently and the
   * next lock change would rewrite every one of them under the user.
   *
   * `family` — the room's design — is read the same way and from the same store,
   * and **this paragraph used to say the opposite**: *"deliberately absent. It is
   * a `FillContext` field with no control anywhere in the app yet, and passing a
   * guess would reorder every candidate list by a preference nobody expressed."*
   * That was right while it was true. Row **D6** shipped the control and
   * `WorkshopState.design` is no longer a guess, so leaving it out would place
   * pieces that ignore the room's design and then have them rewritten under the
   * user by the next re-solve — which is what the lock argument above says about
   * declining the lock, one field over.
   *
   * `undefined` still means *no preference* and is what the app ships with, so
   * the absent case is the ordinary one rather than a fallback.
   *
   * One `useMemo`, so the memo table inside the filler survives re-renders: a
   * room built by clicking the same palette row twenty times is **one** solve and
   * nineteen hits. Both preferences are in its dependency list, which is what
   * `fills.ts` means by *"a filler is created per `(lock, family, index)` … so
   * the preference is in the key by construction"*: a design change throws the
   * table away rather than serving twenty stale answers out of it.
   */
  const lock = useLockSystem()
  const design = useRoomDesign()
  const filler = useMemo(
    () =>
      createPlacementFiller({
        index: fill.index,
        context: {
          templates: fill.templates,
          composition: fill.composition,
          lock,
          /* Spread rather than assigned, because `exactOptionalPropertyTypes`
             makes `family: undefined` and *no `family`* two different
             assignments, and `FillContext.family` documents the absent one. */
          ...(design === undefined ? {} : { family: design }),
        },
      }),
    [fill.index, fill.templates, fill.composition, lock, design],
  )

  /**
   * The objects to load: every drawn part's, and nothing else.
   *
   * **{@link roomBlobs}, the same function `buildRoom3D` groups by**, so the set
   * fetched and the set drawn are one derivation and cannot disagree — a room
   * that fetched from a second one would report *"not in the store"* about a blob
   * it had never asked for, which is a sentence the app also shows legitimately
   * and so an invisible failure. `instances.ts` states the derivation as contract
   * **C-d**.
   *
   * **The armed item is no longer in it, and that follows from what "armed"
   * means now.** Row R2 added the armed tile's own blob here so the first ghost
   * had geometry before the first placement; since row A1 the armed thing is a
   * family, its files are the fill solver's to choose, and the marker
   * `edits.ts#templateGhost` draws needs no mesh at all.
   *
   * Row **C5** makes that a *choice* rather than a limit: {@link filler} can
   * answer for the armed family before the click, memoised, so its blobs could be
   * unioned in here and prefetched. They are not, deliberately — the marker draws
   * no mesh, so the fetch would warm a cache for a placement the user may never
   * make, and the placement's own blobs arrive through `scene` the instant it
   * lands. The union is one line the day the ghost draws geometry, which is
   * `RoomSurface`'s note on B2's layout rule.
   *
   * Templates make this cheaper rather than dearer: 40 of the 40 shipped families
   * carry both a `floor` and a `base`, so 80 of their 128 parts draw out of a
   * handful of files that instance together.
   */
  const blobs = useMemo(() => [...roomBlobs(scene)], [scene])

  /*
     Every store object is `EXT_meshopt_compression`-encoded, so without the WASM
     decoder there is nothing to load — not one object partly, all of them not at
     all. Checked before fetching rather than after: 150 requests whose bodies
     cannot be decoded is a worse answer than one sentence.
  */
  const decodable = meshoptSupported()

  const store = useLodStore({
    blobs,
    assets,
    enabled: decodable,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  })

  const resolve = useMemo(() => memoisedResolutions(catalog), [catalog])
  const room = useMemo(
    () => buildRoom3D(scene, { geometries: store.geometries, resolve, viewRadius: VIEW_RADIUS }),
    [scene, store.geometries, resolve],
  )

  // Constant for the life of the view. See the module note.
  const fit = useMemo(() => surfaceFit(VIEW_RADIUS), [])
  const occlusion = dominantEdge(room)

  const { message, announce } = useAnnouncer()
  const [status, setStatus] = useState<SurfaceStatus | null>(null)
  /** The piece under the pointer, as the outline pass wants it. Row D7. */
  const [outline, setOutline] = useState<OutlineRequest>(NO_OUTLINE)
  const publish = useCallback(
    (next: SurfaceStatus) => {
      setStatus(next)
      onStatus?.(next)
    },
    [onStatus],
  )

  /**
   * Drawn **parts** with no mesh, plus every generated base — what the plates
   * count.
   *
   * Parts and not placements since row A4b, for `RoomSurface`'s reason: a plate
   * is drawn per part, so a three-part template with one loaded file is two
   * plates, and a count of placements would say *"1 outlined"* about two
   * outlines. `RoomSurface` builds the same list to draw from; this is the number
   * the notice and the readout quote, so the two are computed the same way.
   */
  const waiting =
    scene.pieces.reduce(
      (sum, piece) => sum + piece.parts.filter((part) => !store.geometries.has(part.record.blob)).length,
      0,
    ) + scene.generated.length
  const label = describeSurface(scene, waiting)

  return (
    <div className="of-b3d" data-status={roomStatus(room, store.settled)}>
      {/*
        No band above the stage. Row R4 had already emptied it down to a label —
        it lost the "Back to the plan" button when there stopped being a plan to
        go back to — and a heading that names the thing filling the screen is
        the kind of chrome a work surface is better without. It was invisible in
        practice anyway: the toolbar band is drawn over the same 33 px.
      */}
      <div className="of-b3d-stage">
        {/*
          Unconditional. The ground plane *is* the place the first tile goes, so
          a room with nothing in it still needs a canvas — see the module note.
          `refusal` is the one state that suppresses it, because it is a refusal
          to draw this room at all.
        */}
        {room.refusal === null && decodable ? (
          <Stage
            className="of-b3d-canvas"
            label={label}
            aoRadius={AO_RADIUS_MM * fit.scale}
            enablePan
            outline={outline}
            {...(occlusion === null ? {} : { occlusion })}
          >
            <RoomSurface
              scene={scene}
              room={room}
              geometries={store.geometries}
              fit={fit}
              tools={tools}
              armed={armed}
              fill={filler}
              catalog={catalog}
              history={history}
              {...(renderSlots === undefined ? {} : { renderSlots })}
              {...(onEditSlots === undefined ? {} : { onEditSlots })}
              onOutline={setOutline}
              onStatus={publish}
              announce={announce}
              keyHelpId={KEY_HELP_ID}
              label={label}
            />
          </Stage>
        ) : (
          <div className="of-b3d-well" role="status">
            <p className="of-b3d-note">{room.refusal ?? NO_DECODER}</p>
          </div>
        )}

        <SurfaceNotice
          room={room}
          store={store}
          waiting={waiting}
          unfilled={scene.unfilled.length}
          total={partsDrawn(scene) + scene.generated.length}
        />
        <p className="of-b3d-plate of-b3d-hint">{status?.hint ?? 'Pick a tile from the palette to start.'}</p>
      </div>

      <p className="of-b3d-keys" id={KEY_HELP_ID}>
        Drag to orbit, drag with the right or middle button or with Ctrl to pan across the plan, and scroll to zoom.
        Click the plan to place the armed tile and click a tile to remove it in Erase mode. Right-click a piece to
        choose what goes in its slots, or use the Pieces on the plan list beside the drawing. Arrow keys move the plan
        cursor by the snap step, Shift for four steps; Enter places the armed tile, Delete removes the one under the cursor and R
        turns it. Shift and Enter together pick the tile under the cursor up to move it; the arrow keys then carry it,
        Enter drops it and Escape puts it back. Square brackets step through the placed tiles. G switches snap between
        half a unit and one unit, and P, E and M switch between place, erase and move.
      </p>

      <p className="of-b3d-live" aria-live="polite" aria-atomic="true">
        {message}
      </p>
    </div>
  )
}

export default BuilderRoom

const NO_DECODER =
  'This browser cannot decode the compressed preview meshes, so the 3D view has nothing to draw. Every tile you ' +
  'place is still real and still in the bill.'

/* -------------------------------------------------------------------- states */

function roomStatus(room: Room3D, settled: boolean): string {
  if (room.refusal !== null) return 'refused'
  if (room.groups.length > 0) return 'ready'
  return settled ? 'empty' : 'loading'
}

/**
 * What the canvas cannot say for itself, over the top of it rather than instead
 * of it.
 *
 * Every one of these used to *replace* the canvas, which is why the row before
 * this one could not place a tile into an empty room. They are now a plate in
 * the corner: the surface stays usable while a mesh is loading, missing or
 * broken, because none of those states changes what may be placed where —
 * `pieceAt` and `subjectsConflict` never look at a mesh.
 *
 * Ordered by what a user can act on. A failure is worth a retry and an absence
 * is not, so a failure is named first and separately; a load in flight is
 * transient and says so; and an object the store does not hold is last, because
 * it is the only one of the three that nothing here or in the browser can move.
 *
 * The two conversion plates that used to lead this list — *"converting N
 * meshes…"* and the three terminal states a conversion could reach other than
 * the cache — are gone with `src/mesh/`. They described work this app no longer
 * does.
 */
function SurfaceNotice({
  room,
  store,
  waiting,
  unfilled,
  total,
}: {
  room: Room3D
  store: LodStoreState
  /** Drawn parts plated because no mesh has arrived for them. Row A4b. */
  waiting: number
  /** Instances with no filled slot at all — `PlanScene.unfilled`. Row A4b. */
  unfilled: number
  /** Drawable parts altogether, both populations. */
  total: number
}) {
  if (room.refusal !== null) return null

  if (store.failed.size > 0) {
    return (
      <p className="of-b3d-plate of-b3d-alert" role="alert">
        {String(store.failed.size)} {store.failed.size === 1 ? 'mesh' : 'meshes'} could not be loaded, so{' '}
        {store.failed.size === 1 ? 'that tile is' : 'those tiles are'} drawn as an outline.{' '}
        {[...store.failed.values()][0]}
      </p>
    )
  }

  if (!store.settled && store.pending > 0) {
    return (
      <p className="of-b3d-plate of-b3d-loading" role="status">
        Loading {String(store.pending)} {store.pending === 1 ? 'mesh' : 'meshes'}…
      </p>
    )
  }

  if (waiting > 0) {
    return (
      <p className="of-b3d-plate" role="status">
        {String(waiting)} of {String(total)} placed {total === 1 ? 'part has' : 'parts have'} no mesh in the store,
        so {waiting === 1 ? 'it is' : 'they are'} drawn as a marked outline. The outline is the tagged footprint and
        the part is really there.
      </p>
    )
  }

  /*
     Row A4b's own line, re-worded by row **C5** and kept last for the same
     reason: it is the least alarming of the five and the only one the user can
     act on from here.

     **What changed is how often it is true.** A4b wrote it as *"the state every
     placement lands in until row C2's fill solver runs"*, and it was — the click
     wrote `fills: {}`. C5 solves the fills on the click, so an instance reaches
     `PlanScene.unfilled` only when the solver could fill **nothing**: a size
     nothing in the archive carries (C2's `no-candidate`, which no sibling change
     can reopen), a family this build ships no recipe for, or a room restored from
     before its parts were chosen. Still legitimate — contract C-g, §3.2 *"places
     anyway"* — and still worth a sentence rather than silence, because there is
     nothing on screen at all for it: no geometry, no plate and no marker
     (`PlanScene.unfilled` carries no coordinates to draw one at).
  */
  if (unfilled > 0) {
    return (
      <p className="of-b3d-plate" role="status">
        {unfilled === 1 ? 'One placed template has' : `${String(unfilled)} placed templates have`} no parts the
        archive could fill, so {unfilled === 1 ? 'it draws' : 'they draw'} nothing. Open{' '}
        {unfilled === 1 ? 'its slots' : 'their slots'} to choose parts, or try another size.
      </p>
    )
  }

  return null
}

/* ------------------------------------------------------------------- helpers */

/** Drawable parts across every catalog piece. The unit `room.instances` is in. */
function partsDrawn(scene: PlanScene): number {
  return scene.pieces.reduce((sum, piece) => sum + piece.parts.length, 0)
}

/** The `edge` of the family with the most instances, for the AO pass. */
function dominantEdge(room: Room3D): string | null {
  let best: { edge: string; count: number } | null = null
  const totals = new Map<string, { edge: string; count: number }>()
  for (const group of room.groups) {
    const key = group.resolution.family.id
    const entry = totals.get(key) ?? { edge: group.resolution.family.edge, count: 0 }
    entry.count += group.count
    totals.set(key, entry)
    if (best === null || entry.count > best.count) best = entry
  }
  return best?.edge ?? null
}

/**
 * `record → Resolution`, memoised on the tile id.
 *
 * The same shape and the same reasoning as `createStyleResolver`, which resolves
 * the 2D fill: the input is the whole tag list and the resolution walks an
 * ordered six-stage fallback, so a room of 200 placements would otherwise run
 * 200 resolutions per store write. It returns the full `Resolution` rather than
 * a `PlanStyle` because `acquireMaterial` keys on `variantKey` and needs the
 * finish's roughness, metalness and transmission.
 */
function memoisedResolutions(catalog: PlanCatalog): (record: CatalogRecord) => Resolution {
  const cache = new Map<string, Resolution>()
  return (record) => {
    let resolution = cache.get(record.id)
    if (resolution === undefined) {
      resolution = resolveMaterial(catalog.tags(record), record.file)
      cache.set(record.id, resolution)
    }
    return resolution
  }
}
