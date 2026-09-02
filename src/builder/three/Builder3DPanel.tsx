/**
 * The button, and the only part of this row that is in the entry bundle.
 *
 * ```tsx
 * <Builder3DPanel catalog={planCatalog} placements={placements} assets={index.file.assets} />
 * ```
 *
 * One line inside `BuilderScreen`'s `.of-builder-stage`. It needs nothing the
 * screen has not already computed.
 *
 * ## What is in this file, and what is deliberately not
 *
 * React, `./lod` and a stylesheet. It does **not** import three, r3f, drei,
 * `postprocessing`, n8ao, `GLTFLoader` or the meshopt decoder — all of that is
 * reachable only through `lazy(() => import('./BuilderRoom'))`, so a visitor who
 * opens the builder and never presses this button downloads none of it. The same
 * structural rule `src/three/index.ts` sets for the detail viewer, enforced the
 * same way, by `boundary.test.ts` parsing the static import graph. Adding one
 * convenience import from `BuilderRoom`'s side of the line would move ~400 kB
 * gzipped into the entry chunk with nothing failing.
 *
 * ## The chunk, the context and the fetches all start on the same press
 *
 * Closing the view unmounts the whole subtree, which aborts every in-flight GLB
 * request and disposes every geometry — so a misclick costs whatever had
 * arrived and nothing more.
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

import type { PlanCatalog } from '@/builder/canvas'
import type { CatalogAssets } from '@/catalog'
import type { WorkshopState } from '@/store'

import { LOD_ABSENT_IS_EXPECTED } from './lod'

import './builder3d.css'

/** The 3D chunk. Every heavy import in this row is behind this line. */
const LazyRoom = lazy(() => import('./BuilderRoom'))

export interface Builder3DPanelProps {
  readonly catalog: PlanCatalog
  readonly placements: WorkshopState['placements']
  readonly assets: Pick<CatalogAssets, 'lod'>
  /** Injected by tests so no request leaves the process. */
  readonly fetchImpl?: typeof fetch
  readonly onOpenChange?: (open: boolean) => void
}

export function Builder3DPanel({
  catalog,
  placements,
  assets,
  fetchImpl,
  onOpenChange,
}: Builder3DPanelProps) {
  const [open, setOpen] = useState(false)
  const placed = Object.keys(placements).length

  const toggle = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  if (!open) {
    return (
      <div className="of-b3d-launch" data-open="false">
        <button
          type="button"
          className="of-b3d-toggle"
          disabled={placed === 0}
          onClick={() => {
            toggle(true)
          }}
        >
          View in 3D
          <span className="of-b3d-toggle-note">
            {placed === 0
              ? 'place a tile first'
              : LOD_ABSENT_IS_EXPECTED
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
          placements={placements}
          assets={assets}
          {...(fetchImpl === undefined ? {} : { fetchImpl })}
          onClose={() => {
            toggle(false)
          }}
        />
      </Suspense>
    </div>
  )
}
