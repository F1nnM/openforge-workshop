/**
 * The mount point, and the only part of this row that is in the entry bundle.
 *
 * ```tsx
 * <Builder3DPanel catalog={planCatalog} scene={scene} tools={tools} assets={index.file.assets} />
 * ```
 *
 * One line inside `BuilderScreen`'s `.of-builder-stage`, filling it. It needs
 * nothing the screen has not already computed — and since row R2 that includes
 * the *scene*, which the screen was already building for `freeCellFor`.
 *
 * ## It is the stage, and there is no way back, because there is nowhere to go
 *
 * *"The 2d view of the builder is an artefact of v1. I want only the 3d viewer.
 * Which needs to support the tile placing etc in it."* Row R2 made the surface
 * open with the screen; row **R4** deleted the plan view underneath it and with
 * it the last thing an `open`/closed pair of states was good for.
 *
 * So this component has no state at all. What went, and why each piece was
 * load-bearing right up until it was not:
 *
 *   - **`open`, `initiallyOpen`, `onOpenChange` and `toggle`.** A user whose
 *     meshes had not arrived could drop back to the plan; there is no plan.
 *   - **The closed plate** — `.of-b3d-launch[data-open='false']`, the
 *     `.of-b3d-toggle` button and its note. Row X10 measured that plate covering
 *     14 px of the toolbar's `snap 0.5` button and row L1 fixed it with the
 *     stage gutter; the band's arithmetic is unchanged and `builder.css` records
 *     that it stays symmetric on purpose now that this element can never claim
 *     the right-hand gutter again.
 *   - **`onStatus?.(null)` on close.** The readout was retracted so the corner
 *     plates would not keep quoting a pointer that had gone. Nothing retracts it
 *     now because the surface is never unmounted; `BuilderScreen` holds one
 *     status state instead of the `surfaceStatus ?? status` pair it needed while
 *     two renderers were publishing.
 *   - **`BuilderRoom`'s `onClose` prop and its "Back to the plan" button**, which
 *     is the one change this row makes on the other side of the `lazy` line.
 *
 * `onStatus` and `fetchImpl` are all that is left beside the four data props, and
 * both are pass-throughs.
 *
 * ## The `lazy` boundary is not a gate and is still worth keeping
 *
 * Every `/builder` visitor downloads the 3D chunk — that is what "only the 3d
 * viewer" costs and there is no way to have it and not pay it. The boundary is
 * not therefore pointless: a static import would put three.js, r3f, drei,
 * `postprocessing`, n8ao, `GLTFLoader` and the meshopt decoder in the **entry**
 * chunk, which blocks first paint for every visitor to every screen, including
 * the catalog. Behind `lazy` the same bytes are a parallel request that resolves
 * while the catalog index — itself a 5.6 MB fetch this screen already waits on —
 * is in flight. Same bytes, off the critical path.
 *
 * **R4 re-measured the chunking with the gate gone and it did not move**, which
 * is worth stating because a surface that always mounts might plausibly belong in
 * a different chunk than one behind a press. It does not: `index.ts`'s A/B table
 * carries the numbers, and the shape of the answer is that the split is not about
 * *when* the bytes are wanted but about *which* entry point pays for them —
 * `/builder`'s route chunk rather than the entry chunk every screen loads.
 *
 * That is why this file still imports React, a stylesheet and two types and
 * nothing else, and why `boundary.test.ts` still parses the static import graph
 * from `index.ts`. Adding one convenience import from `BuilderRoom`'s side of
 * the line would move ~400 kB gzipped into the chunk every visitor downloads,
 * with nothing failing.
 *
 * ## There is no size gate here, and that is the point of the store
 *
 * `src/three/gate.ts` refuses the detail viewer's 3D for **978 of 8,702 live
 * records (11.24%)**, collapsing to **957 distinct md5s**, because a 24 MiB STL
 * decodes to 36 MB of typed array. A LOD object is 5,000–20,000 triangles
 * whatever its source was, so those tiles get their first 3D path here and the
 * gate has nothing to say about them. What replaces it is a budget on the number
 * of *distinct* meshes a room may hold — `lod.ts`'s `lodObjectBudget` — which is
 * the axis instancing makes correct.
 */
import { Suspense, lazy } from 'react'

import type { PlanCatalog, PlanScene, PlanTools } from '@/builder/canvas'
import type { CatalogAssets } from '@/catalog'

import type { SurfaceStatus } from './edits'

import './builder3d.css'

/** The 3D chunk. Every heavy import in this row is behind this line. */
const LazyRoom = lazy(() => import('./BuilderRoom'))

export interface Builder3DPanelProps {
  readonly catalog: PlanCatalog
  /**
   * The scene, built once by the screen.
   *
   * A `PlanScene` and not a `placements` map, which is the whole of this row's
   * insulation from row **V4**: a placement's shape is changing, and every piece
   * of geometry here arrives already resolved by `buildPlanScene`.
   */
  readonly scene: PlanScene
  /** The shared tool state — the palette and `PlanToolbar` write the same object. */
  readonly tools: PlanTools
  /**
   * `lod` and `models`. The room subscribes to `@/mesh`'s conversion queue,
   * which is keyed on the `models` base — see `BuilderRoom`'s note. A type
   * change only: every call site already passes the whole `catalogFile.assets`.
   */
  readonly assets: Pick<CatalogAssets, 'lod' | 'models'>
  /** The surface's readout, for the toolbar and the corner plates. */
  readonly onStatus?: (status: SurfaceStatus) => void
  /** Injected by tests so no request leaves the process. */
  readonly fetchImpl?: typeof fetch
}

export function Builder3DPanel({ catalog, scene, tools, assets, onStatus, fetchImpl }: Builder3DPanelProps) {
  return (
    <div className="of-b3d-launch">
      <Suspense fallback={<div className="of-b3d-well of-shimmer" data-status="chunk" />}>
        <LazyRoom
          catalog={catalog}
          scene={scene}
          tools={tools}
          assets={assets}
          {...(onStatus === undefined ? {} : { onStatus })}
          {...(fetchImpl === undefined ? {} : { fetchImpl })}
        />
      </Suspense>
    </div>
  )
}
