/**
 * `/builder` — design-contract.md §2.4, and the screen that makes the builder
 * reachable at all.
 *
 * Three columns at `calc(100dvh - var(--of-header-h))` with no page scroll: a
 * 272px palette, a flexible canvas, a 302px bill of tiles. This component owns
 * the layout, the URL, and the three derivations everything else reads from —
 * and nothing else. Every panel, the canvas, the bill and the download are
 * already-landed modules that are *called* here rather than reimplemented.
 *
 * ## The four things this screen actually decides
 *
 *   1. **`usePlanTools()` is called once.** Mode, snap, pending rotation and the
 *      palette selection are one object shared by the palette, the toolbar and
 *      the canvas — all three write to it. Two hooks would be two builders.
 *   2. **The bill is a projection of the store, not a copy.** `usePlacements()`
 *      feeds `buildBillOfTiles`, and the canvas reads the same map. Neither holds
 *      state of its own, so the drawing and the parts list cannot disagree.
 *   3. **The three expensive indexes are memoised on the catalog file.** The
 *      search engine comes from `useCatalogIndex` (module-scope memo, 45 ms), and
 *      `buildAssemblyIndex` and `planCatalogFromFile` are memoised here on
 *      `index.file` — both are deterministic functions of a versioned build
 *      artefact, so that is the correct lifetime rather than a cache with an
 *      invalidation problem.
 *   4. **`chrome={false}`.** The canvas can draw §2.4's two corner plates itself;
 *      this screen draws them, because the contract puts the `snap {value}`
 *      readout in the floating toolbar and the canvas's own plate carries it too —
 *      one of the two has to go, and the toolbar is the one the contract names.
 *
 * ## Why the bill is rebuilt on every placement rather than diffed
 *
 * `buildBillOfTiles` is one pass over the placements and one over the groups,
 * independent of catalog size because `AssemblyIndex` already paid that cost. A
 * fifty-tile room is fifty resolutions, each a lookup and at most a scan of a
 * pre-sorted candidate list. Memoised on the placements map, so it runs once per
 * placement and not once per render.
 *
 * ## What is not here
 *
 * **The share link.** PR 10 owns the codec and reads `location.hash`; nothing in
 * this screen touches it. **A move operation.** Row 17 is explicit that the canvas
 * has none, and adding one from the shell would mean owning drag state the canvas
 * does not publish; the bill panel's remove-and-replace is the honest interim,
 * and it is reachable from the keyboard, which a drag is not.
 *
 * It renders a `<section>`, not a `<main>`: `AppFrame` owns the document's one
 * `<main>`. The `<h1>` is clipped — the contract opens this screen on the palette
 * and the drawing, not on a title, and a visible heading would cost the canvas a
 * line of height it cannot spare.
 */
import { getRouteApi } from '@tanstack/react-router'
import { useMemo, useState } from 'react'

import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import { PlanCanvas, describeCell, planCatalogFromFile, usePlanTools } from '@/builder/canvas'
import type { PlanStatus } from '@/builder/canvas'
import { BillPanel, PalettePanel, PlanToolbar, useArchiveDownload } from '@/builder/panels'
import type { CatalogIndex } from '@/screens/catalog'
import { useCatalogIndex } from '@/screens/catalog'
import { clearPlacements, useLockSystem, usePlacements } from '@/store'
import { LockNotice } from '@/ui/lock-picker'
import { Button, Eyebrow } from '@/ui/primitives'

import './builder.css'

const builderApi = getRouteApi('/builder')

export function BuilderScreen() {
  const state = useCatalogIndex()

  if (state.status === 'error') {
    return (
      <section className="of-builder-wait" aria-label="Builder">
        <h1 className="of-sr-only">Builder</h1>
        <div className="of-builder-error" role="alert">
          <p className="of-empty-title">The catalog index could not be loaded.</p>
          <p className="of-empty-note">
            {state.error.message} Your build is safe — the builder needs the index to describe the
            tiles in it.
          </p>
          <Button tone="secondary" onClick={state.retry}>
            Try again
          </Button>
        </div>
      </section>
    )
  }

  if (state.status === 'loading') {
    return (
      <section className="of-builder-wait" aria-label="Builder">
        <h1 className="of-sr-only">Builder</h1>
        <p className="of-builder-loading" role="status">
          <Eyebrow as="span">Loading the archive index</Eyebrow>
        </p>
      </section>
    )
  }

  // Keyed on the version stamp, so the whole builder remounts if the index is
  // ever swapped under a running session rather than half of it holding indexes
  // built from the old file.
  return <Builder key={state.index.file.version.built} index={state.index} />
}

/* ------------------------------------------------------------------- builder */

function Builder({ index }: { index: CatalogIndex }) {
  const search = builderApi.useSearch()
  const navigate = builderApi.useNavigate()

  const placements = usePlacements()
  const lock = useLockSystem()
  const [status, setStatus] = useState<PlanStatus | null>(null)

  // Once, and handed to three components. See the module note.
  const tools = usePlanTools()

  const planCatalog = useMemo(() => planCatalogFromFile(index.file), [index])
  const assembly = useMemo(() => buildAssemblyIndex(index.file), [index])
  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), assembly, { lock }),
    [placements, assembly, lock],
  )

  const download = useArchiveDownload({ bill, assets: index.file.assets })

  const armed = tools.selectedTileId === null ? undefined : index.engine.record(tools.selectedTileId)

  return (
    <section className="of-builder" aria-label="Builder">
      <h1 className="of-sr-only">Builder</h1>

      <PalettePanel
        index={index}
        tools={tools}
        search={search}
        onQueryChange={(text) => {
          // The catalog screen's rule, for the catalog screen's reason: the first
          // character of a new search is worth a history entry so Back returns to
          // the unfiltered palette, and every later one replaces it so Back does
          // not walk the word backwards a letter at a time.
          const push = search.q === '' && text !== ''
          void navigate({ search: (prev) => ({ ...prev, q: text }), replace: !push })
        }}
      />

      <div className="of-builder-stage">
        <PlanCanvas
          catalog={planCatalog}
          tools={tools}
          onStatus={setStatus}
          chrome={false}
          className="of-builder-canvas"
        />

        <div className="of-builder-toolbar-slot">
          <PlanToolbar
            tools={tools}
            status={status}
            armed={armed}
            placed={bill.placements}
            onClear={clearPlacements}
          />
        </div>

        {/* §2.4's two corner plates. Pointer-transparent, so a click near the
            bottom of the drawing still reaches the canvas. */}
        <p className="of-build-plate of-build-hint">{status?.hint ?? 'Pick a tile from the palette to start.'}</p>
        <p className="of-build-plate of-build-armed">
          {armed === undefined ? 'No tile armed' : armed.name}
          {status === null ? null : (
            <span className="of-build-at">{describeCell(status.cursor[0], status.cursor[1])}</span>
          )}
        </p>
      </div>

      <div className="of-builder-bill">
        {/*
          The lock preference decides which base is matched under every openforge
          topper in the bill below, which makes this the one screen where the
          notice is load-bearing rather than noise. It renders `null` once the
          user has answered. See `@/ui/lock-picker/LockNotice.tsx`.
        */}
        <LockNotice className="of-builder-lock" />
        <BillPanel
          bill={bill}
          placements={placements}
          assets={index.file.assets}
          sheet={index.file.sprite}
          download={download}
        />
      </div>
    </section>
  )
}
