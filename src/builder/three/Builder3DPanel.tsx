/**
 * The mount point, and the only part of this row that is in the entry bundle.
 *
 * ```tsx
 * <Builder3DPanel catalog={planCatalog} scene={scene} tools={tools} assets={index.file.assets} />
 * ```
 *
 * One line inside `BuilderScreen`'s `.of-builder-stage`. It needs nothing the
 * screen has not already computed — and after row R2 that includes the *scene*,
 * which the screen was already building for the plan canvas and for
 * `freeCellFor`.
 *
 * ## It is open on arrival, and that is the owner's request rather than a tweak
 *
 * *"The 2d view of the builder is an artefact of v1. I want only the 3d viewer.
 * Which needs to support the tile placing etc in it."* Two things about the old
 * gate contradicted that outright:
 *
 *   - the button was **disabled until a tile had been placed**, so the 3D view
 *     could not be reached until the 2D view had been used first; and
 *   - it was a *view* of a plan drawn elsewhere, which is what "artefact of v1"
 *     names.
 *
 * So the surface opens with the screen. `open` survives as one piece of state
 * for the one thing it is still good for: the plan view is still mounted
 * underneath until row **R4** deletes it, and a user whose meshes have not
 * arrived can drop back to it. R4 removes the toggle with the renderer.
 *
 * ## The `lazy` boundary is not a gate and is still worth keeping
 *
 * With the surface open on arrival, every `/builder` visitor now downloads the
 * 3D chunk — that is what "only the 3d viewer" costs and there is no way to have
 * it and not pay it. The boundary is not therefore pointless: a static import
 * would put three.js, r3f, drei, `postprocessing`, n8ao, `GLTFLoader` and the
 * meshopt decoder in the **entry** chunk, which blocks first paint for every
 * visitor to every screen, including the catalog. Behind `lazy` the same bytes
 * are a parallel request that resolves while the catalog index — itself a
 * 5.6 MB fetch this screen already waits on — is in flight. Same bytes, off the
 * critical path.
 *
 * That is why this file still imports React, `./lod` and a stylesheet and
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
import { Suspense, lazy, useState } from 'react'

import type { PlanCatalog, PlanScene, PlanTools } from '@/builder/canvas'
import type { CatalogAssets } from '@/catalog'

import type { SurfaceStatus } from './edits'
import { LOD_ABSENT_IS_EXPECTED } from './lod'

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
  readonly onStatus?: (status: SurfaceStatus | null) => void
  /** Injected by tests so no request leaves the process. */
  readonly fetchImpl?: typeof fetch
  readonly onOpenChange?: (open: boolean) => void
  /** Start closed. Only a test that wants the plate rather than the chunk does. */
  readonly initiallyOpen?: boolean
}

export function Builder3DPanel({
  catalog,
  scene,
  tools,
  assets,
  onStatus,
  fetchImpl,
  onOpenChange,
  initiallyOpen = true,
}: Builder3DPanelProps) {
  const [open, setOpen] = useState(initiallyOpen)
  const placed = scene.pieces.length + scene.generated.length

  const toggle = (next: boolean) => {
    setOpen(next)
    // The surface's readout goes with it, so the toolbar and the corner plates
    // fall back to the plan view's rather than holding the last thing the 3D
    // surface said about a pointer that is no longer over it.
    if (!next) onStatus?.(null)
    onOpenChange?.(next)
  }

  if (!open) {
    return (
      <div className="of-b3d-launch" data-open="false">
        <button
          type="button"
          className="of-b3d-toggle"
          onClick={() => {
            toggle(true)
          }}
        >
          Build in 3D
          <span className="of-b3d-toggle-note">
            {LOD_ABSENT_IS_EXPECTED
              ? 'preview meshes, not yet published'
              : `${String(placed)} ${placed === 1 ? 'tile' : 'tiles'}`}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div className="of-b3d-launch" data-open="true">
      <Suspense fallback={<div className="of-b3d-well of-shimmer" data-status="chunk" />}>
        <LazyRoom
          catalog={catalog}
          scene={scene}
          tools={tools}
          assets={assets}
          {...(onStatus === undefined ? {} : { onStatus })}
          {...(fetchImpl === undefined ? {} : { fetchImpl })}
          onClose={() => {
            toggle(false)
          }}
        />
      </Suspense>
    </div>
  )
}
