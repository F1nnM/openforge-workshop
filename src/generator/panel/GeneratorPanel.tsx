/**
 * The button, and the only part of this row in the entry bundle.
 *
 * ```tsx
 * <GeneratorPanel records={index.file.records} assets={index.file.assets} />
 * ```
 *
 * One line inside `BuilderScreen`'s `.of-builder-stage`, over data the screen
 * already holds. Row G2's `Builder3DPanel` is the same shape for the same
 * reason, and the reason is the size story: behind
 * `lazy(() => import('./GeneratorDrawer'))` sit 25 KB of pinned parameter
 * schemas, the sweep tables, the resolver, and — one dynamic import further on —
 * a 10.5 MB WebAssembly engine, 99 KB of Emscripten glue, 197 KB of `.scad`
 * sources and an 18 KB licence.
 *
 * **None of that is in the entry chunk, and it was measured rather than
 * asserted.** Two `vite build`s of the same tree, one with this component
 * mounted in `BuilderScreen` and one without, both emitting a single eager
 * chunk: **643,485 B** with, **642,640 B** without — **+845 B raw, +193 B
 * gzipped**, which is this file, its stylesheet and the `lazy()` call. The
 * drawer behind the boundary is 45,679 B (11,411 B gzipped) and the engine's
 * 10.5 MB is a second boundary past that. S3 measured **zero** eager cost for
 * the engine the same way and G2 measured 1.61 kB gzipped for the 3D panel.
 *
 * The failure this guards is silent — everything works, and every visitor to
 * `/builder` downloads the engine — and it very nearly happened: `index.ts`
 * originally re-exported the resolver and `usePreview` for row S5's benefit,
 * which pulled `engine/index.ts` into the entry chunk and took it to 664,608 B.
 * `boundary.test.ts` walks the static graph so that cannot come back.
 */
import { Suspense, lazy, useState } from 'react'

import type { CatalogAssets, CatalogRecord } from '@/catalog'

import type { BaseRecipe } from './recipe'

import './panel.css'

/** The lazy boundary. Every schema, table and engine import is past this line. */
const LazyDrawer = lazy(() => import('./GeneratorDrawer'))

export interface GeneratorPanelProps {
  readonly records: readonly CatalogRecord[]
  readonly assets: Pick<CatalogAssets, 'models'>
  /** Row S5's seam, forwarded untouched. */
  readonly onPlace?: ((recipe: BaseRecipe) => void) | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
}

export function GeneratorPanel({ records, assets, onPlace, onOpenChange }: GeneratorPanelProps) {
  const [open, setOpen] = useState(false)

  const toggle = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  if (!open) {
    return (
      <div className="of-gen-launch" data-open="false">
        <button
          type="button"
          className="of-gen-toggle"
          onClick={() => {
            toggle(true)
          }}
        >
          Generate a base
          <span className="of-gen-toggle-note">square, wall, corner, riser</span>
        </button>
      </div>
    )
  }

  return (
    <div className="of-gen-launch" data-open="true">
      <Suspense fallback={<div className="of-gen-pending of-shimmer" role="status" aria-label="Loading the generator" />}>
        <LazyDrawer
          records={records}
          assets={assets}
          onPlace={onPlace}
          onClose={() => {
            toggle(false)
          }}
        />
      </Suspense>
    </div>
  )
}
