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

import type { GeneratedMeshHold } from '../placement/pack'
import type { PlaceAt, RecipePlacement } from '../placement/placement'

import type { BaseFootprint } from './footprint'

import './panel.css'

/** The lazy boundary. Every schema, table and engine import is past this line. */
const LazyDrawer = lazy(() => import('./GeneratorDrawer'))

/** Where a generated base goes. Row S5's `PlaceAt`, re-named for the seam. */
export type GeneratorPlaceAt = PlaceAt

/**
 * What the drawer hands over when the user presses "Place in build".
 *
 * Row S5 asked for two changes to this seam and this is both of them. The first
 * draft handed over a `BaseRecipe` alone, which is the *question* rather than the
 * answer: the screen would then have to build a `buildBaseResolver` of its own to
 * find out whether the archive publishes that base, and that resolver is 31 ms
 * over 8,702 records and lives behind this lazy boundary — so the screen would
 * have paid for the pinned schemas to re-derive something already on screen in
 * the drawer's resolution strip.
 *
 * So the drawer calls `placeRecipe` itself and hands over the
 * {@link RecipePlacement}, which is S5's union of the two outcomes:
 *
 *   - **`archived`** — an ordinary `Placement` addressed by the archived
 *     record's own `TileId`. It rides the store, the canvas, `resolvePlacement`,
 *     the bill and the pack that already exist. 682 of the archive's 709
 *     resolvable keys land here and need no new machinery at all.
 *   - **`generated`** — S5's `GeneratedPlacement`, for the second map.
 *
 * `mesh` is the bytes, and it is `null` for every archived placement and for a
 * generated one the engine has not finished. It is handed over *with* the
 * placement because this press is the only moment the identity and the bytes are
 * both in hand: the store persists the recipe and `src/store/meshes.ts` holds the
 * mesh, and they must not be written from two different presses.
 */
export type GeneratorPlaceHandler = (placed: RecipePlacement, mesh: GeneratedMeshHold | null) => void

export interface GeneratorPanelProps {
  readonly records: readonly CatalogRecord[]
  readonly assets: Pick<CatalogAssets, 'models'>
  /**
   * Row S5's seam, forwarded untouched — and now carrying the answer rather
   * than the question.
   *
   * **Every type in this signature is imported `type`-only**, here and in
   * `GeneratorDrawer.tsx`'s props, which is what keeps this file's eager cost the
   * 845 B its docblock measured. A type import is erased, so naming
   * `RecipePlacement` costs nothing even though the module that produces one
   * value-imports 25 KB of pinned schemas. If any of these ever has to be a
   * value here, that is the moment to check the entry chunk again.
   */
  readonly onPlace?: GeneratorPlaceHandler | undefined
  /**
   * Where on the grid the base should go, given its footprint.
   *
   * The screen answers this, not the drawer, because "is that cell free" is a
   * question about the whole plan and the drawer holds no scene. The drawer
   * answers the other half — which recipe, and which of S4's three resolutions
   * it got — and then calls `placeRecipe` itself, so the two halves meet once.
   *
   * Absent means the origin, which is a real answer rather than a stub: a
   * generated base at `0, 0` on a plan with nothing at the origin is placed
   * correctly, and on a plan with something there it is drawn hatched as a
   * conflict like any other overlap. What it is not is a *good* answer, which is
   * why the builder supplies one.
   */
  readonly placeAt?: ((foot: BaseFootprint) => GeneratorPlaceAt) | undefined
  readonly onOpenChange?: ((open: boolean) => void) | undefined
}

export function GeneratorPanel({
  records,
  assets,
  onPlace,
  placeAt,
  onOpenChange,
}: GeneratorPanelProps) {
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
          placeAt={placeAt}
          onClose={() => {
            toggle(false)
          }}
        />
      </Suspense>
    </div>
  )
}
