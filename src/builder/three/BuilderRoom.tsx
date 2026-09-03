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
 *     `BuilderScreen`'s and `PlanCanvas`'s. It now takes the {@link PlanScene}
 *     the screen already built — *one scene, two renderers, and after row R4 one
 *     renderer* — which is also what keeps this row clear of row **V4**: a
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
import { createStyleResolver } from '@/builder/canvas'
import { useAnnouncer } from '@/builder/canvas/hooks'
import type { CatalogAssets, CatalogRecord } from '@/catalog'
import type { Resolution } from '@/materials'
import { resolveMaterial } from '@/materials'
import { meshQueue, useMeshQueue } from '@/mesh'
import { VIEW_RADIUS } from '@/three/geometry'
import { AO_RADIUS, Stage } from '@/three/Stage'
import { Button, Eyebrow } from '@/ui/primitives'

import type { SurfaceStatus } from './edits'
import { describeSurface } from './edits'
import type { Room3D } from './instances'
import { buildRoom3D } from './instances'
import { LOD_ROOM_BUDGET_BYTES, lodObjectBudget } from './lod'
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
   * `models` as well as `lod`, and the second one is row R2's addition.
   *
   * `lod` is where a published preview mesh would come from. `models` is what
   * `@/mesh`'s conversion queue is keyed on, and this component subscribes to
   * that queue so a mesh that finishes converting *after* the surface has
   * mounted actually appears — see `converted` below. Every call site already
   * passes the whole `catalogFile.assets`, so nothing changed but the type.
   */
  readonly assets: Pick<CatalogAssets, 'lod' | 'models'>
  readonly onClose: () => void
  readonly onStatus?: (status: SurfaceStatus) => void
  /** Injected by tests so no request leaves the process. */
  readonly fetchImpl?: typeof fetch
}

export function BuilderRoom({ catalog, scene, tools, assets, onClose, onStatus, fetchImpl }: BuilderRoomProps) {
  const armed = tools.selectedDesign === null ? undefined : catalog.record(tools.selectedDesign)

  /**
   * The objects to load: every placed piece's, **plus the armed tile's**.
   *
   * The armed tile is not in the scene — that is what "armed" means — so a store
   * driven by the scene alone would give the ghost no geometry until after the
   * first placement, and the user would place their first tile blind. One extra
   * address, requested the moment a palette row is chosen.
   */
  const blobs = useMemo(() => {
    const wanted = new Set(scene.pieces.map((piece) => piece.record.blob))
    if (armed !== undefined) wanted.add(armed.blob)
    return [...wanted]
  }, [scene, armed])

  /*
     Every store object is `EXT_meshopt_compression`-encoded, so without the WASM
     decoder there is nothing to load — not one object partly, all of them not at
     all. Checked before fetching rather than after: 150 requests whose bodies
     cannot be decoded is a worse answer than one sentence.
  */
  const decodable = meshoptSupported()

  /**
   * How many conversions the queue has finished, as a nudge for the mesh store.
   *
   * **The surface being open on arrival made this necessary.** `useLodStore`
   * reads the converted cache once per blob and reports a miss as absent; it
   * does not subscribe, and its `epoch` docblock carries the measurement — with
   * the nudge removed, add-to-library then arm then place leaves the room
   * reporting three outlined tiles indefinitely in a real Chrome.
   *
   * The queue is `@/mesh`'s own singleton per `models` base — the same one an
   * add-to-library action reaches for — and `useMeshQueue` is its
   * `useSyncExternalStore` subscription, so this counts the real thing rather
   * than polling on a timer. Constructing it is free: `createMeshConverter`
   * spawns its worker on the first conversion, not here.
   *
   * `ready` and not "terminal": `missing`, `failed` and `uncached` are terminal
   * too, and re-reading the cache for one of those would find exactly what it
   * found before. Only a completed conversion changes the answer.
   */
  const queue = useMemo(() => meshQueue({ models: assets.models }), [assets.models])
  const meshes = useMeshQueue(queue)
  const converted = useMemo(
    () => [...meshes.tasks.values()].filter((task) => task.state === 'ready').length,
    [meshes.tasks],
  )

  const store = useLodStore({
    blobs,
    assets,
    enabled: decodable,
    epoch: converted,
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  })

  const styleOf = useMemo(() => createStyleResolver(catalog), [catalog])
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
  const publish = useCallback(
    (next: SurfaceStatus) => {
      setStatus(next)
      onStatus?.(next)
    },
    [onStatus],
  )

  const waiting = scene.pieces.filter((piece) => !store.geometries.has(piece.record.blob)).length + scene.generated.length
  const label = describeSurface(scene, waiting)

  return (
    <div className="of-b3d" data-status={roomStatus(room, store.settled)}>
      <div className="of-b3d-head">
        <Eyebrow as="span">Build in 3D</Eyebrow>
        <Button tone="secondary" size="sm" onClick={onClose}>
          Back to the plan
        </Button>
      </div>

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
            {...(occlusion === null ? {} : { occlusion })}
          >
            <RoomSurface
              scene={scene}
              room={room}
              geometries={store.geometries}
              fit={fit}
              tools={tools}
              armed={armed}
              styleOf={styleOf}
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
          converting={meshes.eagerPending + meshes.backgroundPending}
          waiting={waiting}
          total={scene.pieces.length + scene.generated.length}
        />
        <p className="of-b3d-plate of-b3d-hint">{status?.hint ?? 'Pick a tile from the palette to start.'}</p>
      </div>

      <RoomReadout room={room} store={store} waiting={waiting} />

      <p className="of-b3d-keys" id={KEY_HELP_ID}>
        Drag to orbit, drag with the middle button or with Ctrl to pan across the plan, and scroll to zoom. Click the
        plan to place the armed tile and click a tile to remove it in Erase mode. Arrow keys move the plan cursor by
        the snap step, Shift for four steps; Enter places the armed tile, Delete removes the one under the cursor and R
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
 * transient and says so; and a converted-cache miss is a statement about the
 * user's own library rather than about the app.
 */
function SurfaceNotice({
  room,
  store,
  converting,
  waiting,
  total,
}: {
  room: Room3D
  store: LodStoreState
  /** Meshes `@/mesh`'s queue is still fetching or decimating. */
  converting: number
  /** Placed pieces drawn as a plate because no mesh has arrived for them. */
  waiting: number
  /** Placed pieces altogether, both populations. */
  total: number
}) {
  if (room.refusal !== null) return null

  /*
     The conversion, ahead of the absence it causes.

     R1 measured an aggregate at a **16.7 MB median, 1.9 s at 9 MB/s**, and a p95
     of 92.8 MB. That is long enough that a plate with no explanation reads as a
     failure, and it is a different sentence from "no mesh in the store": one is
     a wait and the other is a state. Read off `@/mesh`'s own queue rather than
     inferred from the absences, so it says the true thing about work in progress
     instead of guessing from what is missing.
  */
  if (converting > 0) {
    return (
      <p className="of-b3d-plate of-b3d-loading" role="status">
        Converting {String(converting)} {converting === 1 ? 'mesh' : 'meshes'}… the tiles are drawn as outlines
        until {converting === 1 ? 'it lands' : 'they land'}.
      </p>
    )
  }

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
        {String(waiting)} of {String(total)} placed {total === 1 ? 'tile has' : 'tiles have'} no mesh in the store
        yet, so {waiting === 1 ? 'it is' : 'they are'} drawn as a marked outline. The outline is the tagged footprint
        and the tile is really there.
      </p>
    )
  }

  return null
}

/**
 * The counts, in the DOM rather than on the canvas.
 *
 * Five of them earn their place: `instances` against `groups` is the whole claim
 * of the instancing row (fifty placements, twenty draws), `triangles` is what
 * the frame actually costs, the mesh line is the one that explains an outlined
 * tile, the budget line puts resident geometry against its ceiling, and the
 * footprint disagreements are listed because this is the only place in the
 * project where the tagged footprint and the real mesh are both in memory at
 * once.
 */
function RoomReadout({ room, store, waiting }: { room: Room3D; store: LodStoreState; waiting: number }) {
  return (
    <dl className="of-b3d-readout">
      <div>
        <dt>Drawn</dt>
        <dd>
          {String(room.instances)} in {String(room.groups.length)}{' '}
          {room.groups.length === 1 ? 'instanced mesh' : 'instanced meshes'}
          {waiting === 0 ? '' : `, ${String(waiting)} outlined`}
        </dd>
      </div>
      <div>
        <dt>Triangles</dt>
        <dd>{room.triangles.toLocaleString('en-GB')}</dd>
      </div>
      <div>
        <dt>Meshes</dt>
        <dd>
          {/*
            `geometries.size` rather than arithmetic over the other counters: a
            failure is neither loaded nor absent, and subtracting one from the
            other would have quietly reported a failed object as loaded.
          */}
          {String(store.geometries.size)} of {String(store.requested)} loaded
          {store.absent.size === 0 ? '' : `, ${String(store.absent.size)} not in the store`}
          {store.failed.size === 0 ? '' : `, ${String(store.failed.size)} failed`}
        </dd>
      </div>
      <div>
        <dt>Budget</dt>
        <dd>
          {String(room.objects)} of {String(lodObjectBudget())} meshes
          {room.decodedBytes === 0
            ? ''
            : ` · ${megabytes(room.decodedBytes)} of ${megabytes(LOD_ROOM_BUDGET_BYTES)}`}
        </dd>
      </div>
      {room.disagreements.length === 0 ? null : (
        <div className="of-b3d-wide">
          <dt>Mesh differs from its tagged footprint</dt>
          <dd>
            {room.disagreements
              .slice(0, 3)
              .map((one) => `${one.name} by ${one.worst.toFixed(2)} units`)
              .join('; ')}
          </dd>
        </div>
      )}
    </dl>
  )
}

/* ------------------------------------------------------------------- helpers */

/**
 * `4.8 MB`. One decimal, decimal megabytes.
 *
 * The same spelling as `src/three/gate.ts`'s `formatMegabytes`, which is not
 * imported because that module's copy is about a *file* size and this one is
 * about resident geometry — two different quantities that happen to share a
 * unit, and one of them is quoted in a refusal the user may screenshot.
 */
function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
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
