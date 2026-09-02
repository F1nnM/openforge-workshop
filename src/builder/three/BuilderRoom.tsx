/**
 * The room in 3D — the module that owns every heavy import in this row.
 *
 * `Builder3DPanel` reaches this file through `lazy(() => import('./BuilderRoom'))`
 * and that indirection is the whole eager-cost story: three.js, r3f, drei,
 * `postprocessing`, n8ao, `GLTFLoader` and the meshopt decoder are reachable only
 * from here, so a visitor who opens the builder and never presses the 3D button
 * downloads none of it. `boundary.test.ts` walks the static import graph from
 * `index.ts` and fails if anything on the panel's side of the line reaches a
 * renderer, because the failure is otherwise silent — the app keeps working and
 * the entry chunk simply grows by 400 kB gzipped.
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
 * Two of `Stage`'s decisions are tuned for **one model at a unit radius** and
 * have to be met rather than changed, since this row must not edit that file:
 *
 *   - **The camera and the orbit clamp.** Distance 3.0 at a 32° field of view,
 *     `far` 40, `OrbitControls` clamped to 1.5×–9× `VIEW_RADIUS`. A room in
 *     millimetres is 25 to 2,000 units across and would sit outside all three.
 *     So the room is normalised into that frame — `fitRoom` in `place.ts` — which
 *     is the identical argument `src/three/geometry.ts` makes for normalising a
 *     single mesh.
 *   - **The AO radius is in world units.** Under that normalisation a fixed
 *     `AO_RADIUS` would mean 9% of the *room's* radius, which is a crease on one
 *     tile and general grubbiness on forty. So it is passed as a fixed physical
 *     radius instead — {@link AO_RADIUS_MM}, calibrated so that a room of one
 *     median tile reproduces `Stage`'s own tuning exactly.
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
 * ## Nothing is uploaded, so the empty room is the designed state
 *
 * Blocker **B2** is open. Every object 404s today, `useLodStore` counts those as
 * `absent` rather than failing, and this component says so in a sentence and
 * leaves the plan view drawing underneath. G1's own handover note asks for
 * exactly that: *"the app must treat a 404 on /lod/ as expected and fall back to
 * the plan view, exactly as /thumbs/ falls back to the sprite sheet."*
 */
import { useMemo } from 'react'
import { Vector3 } from 'three'

import type { PlanCatalog } from '@/builder/canvas'
import { buildPlanScene, createStyleResolver } from '@/builder/canvas'
import type { CatalogAssets, CatalogRecord } from '@/catalog'
import type { Resolution } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { WorkshopState } from '@/store'
import { VIEW_RADIUS } from '@/three/geometry'
import { AO_RADIUS, Stage } from '@/three/Stage'
import { Button, Eyebrow } from '@/ui/primitives'

import { InstancedTiles } from './InstancedTiles'
import type { Room3D } from './instances'
import { buildRoom3D } from './instances'
import { LOD_ABSENT_IS_EXPECTED, LOD_ROOM_BUDGET_BYTES, lodObjectBudget } from './lod'
import { meshoptSupported } from './loadLod'
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
 * limits describe, and multiplying it by the room's normalisation scale keeps
 * that crease the same size whether the room holds one tile or forty.
 *
 * A room of exactly one median tile therefore lands back on `AO_RADIUS`, which
 * is what makes this a calibration rather than a second opinion.
 */
export const AO_RADIUS_MM = (AO_RADIUS / VIEW_RADIUS) * (Math.hypot(...MEDIAN_TILE_MM) / 2)

export interface BuilderRoomProps {
  readonly catalog: PlanCatalog
  readonly placements: WorkshopState['placements']
  readonly assets: Pick<CatalogAssets, 'lod'>
  readonly onClose: () => void
  /** Injected by tests so no request leaves the process. */
  readonly fetchImpl?: typeof fetch
}

export function BuilderRoom({ catalog, placements, assets, onClose, fetchImpl }: BuilderRoomProps) {
  // The plan view's own scene, not a second projection of the store. Every
  // refusal, every conflict and every piece of geometry in the 3D view is the
  // one the 2D view drew.
  const style = useMemo(() => createStyleResolver(catalog), [catalog])
  const scene = useMemo(() => buildPlanScene(placements, catalog, style), [placements, catalog, style])

  const blobs = useMemo(() => [...new Set(scene.pieces.map((piece) => piece.record.blob))], [scene])

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

  const occlusion = dominantEdge(room)
  const fit = room.fit
  const offset = new Vector3().copy(fit.centre).multiplyScalar(-fit.scale)

  return (
    <div className="of-b3d" data-status={roomStatus(room, store.settled)}>
      <div className="of-b3d-head">
        <Eyebrow as="span">Room in 3D</Eyebrow>
        <Button tone="secondary" size="sm" onClick={onClose}>
          Back to the plan
        </Button>
      </div>

      {room.groups.length === 0 ? (
        <RoomEmpty room={room} store={store} decodable={decodable} />
      ) : (
        <Stage
          className="of-b3d-canvas"
          label={`${String(room.instances)} placed tiles, orbit to look around`}
          aoRadius={AO_RADIUS_MM * fit.scale}
          {...(occlusion === null ? {} : { occlusion })}
        >
          <group scale={fit.scale} position={[offset.x, offset.y, offset.z]}>
            {room.groups.map((group) => (
              <InstancedTiles key={group.key} group={group} />
            ))}
          </group>
        </Stage>
      )}

      <RoomReadout room={room} store={store} />
    </div>
  )
}

export default BuilderRoom

/* -------------------------------------------------------------------- states */

function roomStatus(room: Room3D, settled: boolean): string {
  if (room.refusal !== null) return 'refused'
  if (room.groups.length > 0) return 'ready'
  return settled ? 'empty' : 'loading'
}

function RoomEmpty({ room, store, decodable }: { room: Room3D; store: LodStoreState; decodable: boolean }) {
  if (!decodable) {
    return (
      <div className="of-b3d-well" role="status">
        <p className="of-b3d-note">
          This browser cannot decode the compressed preview meshes, so the 3D view has nothing to
          draw. The plan view is the drawing of this room, and every piece in it is real.
        </p>
      </div>
    )
  }

  if (room.refusal !== null) {
    return (
      <div className="of-b3d-well" role="status">
        <p className="of-b3d-note">{room.refusal}</p>
      </div>
    )
  }

  if (!store.settled) {
    return (
      <div className="of-b3d-well of-shimmer" role="status">
        <p className="of-b3d-note">
          Loading {String(store.pending)} {store.pending === 1 ? 'mesh' : 'meshes'}…
        </p>
      </div>
    )
  }

  if (store.failed.size > 0 && store.absent.size === 0) {
    // A real failure, not an absence: a 500, a body that is not a glTF, a
    // corrupt object. Distinguished because this one is worth retrying and an
    // absence is not — B2 is a blocker, not a flake.
    return (
      <div className="of-b3d-well" role="alert">
        <p className="of-b3d-note">
          {String(store.failed.size)} of this room’s {store.failed.size === 1 ? 'mesh' : 'meshes'} could
          not be loaded. The plan view still draws every piece.
        </p>
        <p className="of-b3d-note of-b3d-detail">{[...store.failed.values()][0]}</p>
      </div>
    )
  }

  if (room.objects === 0) {
    return (
      <div className="of-b3d-well" role="status">
        <p className="of-b3d-note">Place a tile and it will appear here.</p>
      </div>
    )
  }

  return (
    <div className="of-b3d-well" role="status">
      <p className="of-b3d-note">
        {LOD_ABSENT_IS_EXPECTED
          ? 'The 3D mesh store has not been built yet, so there is nothing to draw here. The plan ' +
            'view is the drawing of this room, and every piece in it is real.'
          : 'None of this room’s meshes could be found in the 3D store.'}
      </p>
      {/*
        `store.absent` rather than `room.absent`: a blob missing from the
        geometry map is a gap whichever way it went missing, so `room.absent`
        counts failures too, and calling a failed object "missing" is the wrong
        word for the one state a retry would fix.
      */}
      <p className="of-b3d-note of-b3d-detail">
        {String(store.absent.size)} of {String(room.objects)}{' '}
        {room.objects === 1 ? 'mesh' : 'meshes'} missing
        {store.failed.size === 0 ? '' : `, ${String(store.failed.size)} failed to load`}.
      </p>
    </div>
  )
}

/**
 * The counts, in the DOM rather than on the canvas.
 *
 * Four of them earn their place: `instances` against `groups` is the whole claim
 * of this row (fifty placements, twenty draws), `triangles` is what the frame
 * actually costs, the mesh line is the one that explains an empty or half-drawn
 * room, and the budget line puts the resident geometry against the ceiling it is
 * measured against. The footprint disagreements are listed because this is the
 * first place in the project where the tagged footprint and the real mesh are
 * both in memory at once.
 */
function RoomReadout({ room, store }: { room: Room3D; store: LodStoreState }) {
  return (
    <dl className="of-b3d-readout">
      <div>
        <dt>Drawn</dt>
        <dd>
          {String(room.instances)} in {String(room.groups.length)}{' '}
          {room.groups.length === 1 ? 'instanced mesh' : 'instanced meshes'}
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
