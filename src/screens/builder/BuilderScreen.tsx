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
 * ## The five things this screen actually decides
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
 *   5. **Where a generated base lands, and nothing else about one.** Row S4's
 *      drawer decides *what* — it holds the recipe and the resolution the strip is
 *      showing — and calls row S5's `placeRecipe` itself; this screen answers
 *      *where*, because that is a question about the whole plan. See
 *      `placeGenerated` and `freeCellFor`. There is now a **second bill** beside
 *      the first for the same reason there are two store maps: a catalog line is
 *      one per md5 and names a `CatalogRecord`, a generated line is one per recipe
 *      and names no published file at all.
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
 * **And the 3D view is one element, not a fifth decision.** `<Builder3DPanel>`
 * (row G2) is mounted inside the stage and owns its own open state, its own
 * lazy chunk and its own empty states, over the same `planCatalog` and the same
 * `placements` map this screen already holds. So the 2D drawing and the 3D room
 * are two projections of one store rather than two scenes to keep in step, and
 * this screen gains no state for it.
 *
 * It renders a `<section>`, not a `<main>`: `AppFrame` owns the document's one
 * `<main>`. The `<h1>` is clipped — the contract opens this screen on the palette
 * and the drawing, not on a title, and a visible heading would cost the canvas a
 * line of height it cannot spare.
 */
import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import { PlanCanvas, buildPlanScene, createStyleResolver, describeCell, freeCellFor, planCatalogFromFile, usePlanTools } from '@/builder/canvas'
import type { PlanStatus } from '@/builder/canvas'
import { BillPanel, PalettePanel, PlanToolbar, useArchiveDownload } from '@/builder/panels'
import { SlotsPanel } from '@/builder/panels/slots'
import { Builder3DPanel } from '@/builder/three'
import { GeneratorPanel } from '@/generator/panel'
import type { GeneratorPlaceHandler } from '@/generator/panel'
import { buildGeneratedBill } from '@/generator/placement/bill'
import type { CatalogIndex } from '@/screens/catalog'
import { useCatalogIndex } from '@/screens/catalog'
import {
  clearPlacements,
  holdGeneratedMesh,
  placeGeneratedBase,
  placeTile,
  useGeneratedHoldings,
  useGeneratedMeshes,
  useGeneratedPlacements,
  useLockSystem,
  usePlacements,
} from '@/store'
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
  const generatedPlacements = useGeneratedPlacements()
  const generatedMeshes = useGeneratedMeshes()
  const generatedHoldings = useGeneratedHoldings()
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

  /**
   * Row S5's generated bill — the fifth derivation, and the second bill.
   *
   * Not folded into `buildBillOfTiles`, because the two answer different
   * questions with different keys: a catalog line is one per **md5** and names a
   * `CatalogRecord`, a generated line is one per **recipe** and names no
   * published file at all. S5 was explicit that `billView.ts` needs nothing for
   * this, because a generated placement never enters it.
   *
   * `ambiguous` is deliberately not passed. It is a fact about the current
   * catalog build — 27 of the archive's 709 resolvable keys are claimed by two
   * different blobs — and answering it needs `buildBaseResolver`, which is 31 ms
   * over 8,702 records and lives behind the generator drawer's lazy boundary.
   * Building one here would put the pinned parameter schemas in this screen's
   * chunk to add one sentence to a bill row, and the row without it still says
   * the true thing: that no published file names these parameters, which is also
   * true of an ambiguous recipe, since neither of the two candidates was taken.
   */
  const generatedBill = useMemo(
    () => buildGeneratedBill(generatedPlacements, { meshes: generatedMeshes }),
    [generatedPlacements, generatedMeshes],
  )

  const download = useArchiveDownload({
    bill,
    assets: index.file.assets,
    generated: { bill: generatedBill, holdings: generatedHoldings },
  })

  /**
   * Where a generated base goes, and the one thing this screen has to decide
   * about it.
   *
   * The drawer decides *what* — it holds the recipe and the resolution — and this
   * decides *where*, because "is that cell free" is a question about the whole
   * plan and the drawer holds no scene. `freeCellFor` uses the scene's own
   * collision predicate, so a base it places is never one `buildPlanScene` then
   * marks in conflict.
   *
   * The scene is rebuilt here rather than shared with `PlanCanvas`, which holds
   * its own: the canvas subscribes to the store directly and publishes no scene,
   * and a scene lifted into this screen to be passed down would make the canvas's
   * viewport and this screen's render cycle the same thing. Both projections are
   * pure functions of the same two store maps, so they cannot disagree — which is
   * the property the module docblock's point 2 is about. It is memoised on those
   * maps, so it costs one projection per placement rather than one per render.
   */
  const vacancyScene = useMemo(
    () => buildPlanScene(placements, planCatalog, createStyleResolver(planCatalog), generatedPlacements),
    [placements, planCatalog, generatedPlacements],
  )

  /**
   * Take what the drawer resolved and write it to the store.
   *
   * Three writes across two stores, and the split is row S5's identity argument
   * made concrete:
   *
   *   - an **archived** resolution is an ordinary `Placement` addressed by the
   *     archived record's own `TileId`, so it goes through `placeTile` and rides
   *     the canvas, `resolvePlacement`, the bill and the pack that already exist.
   *     682 of the archive's 709 resolvable keys land here and cost nothing new.
   *   - a **generated** one goes to the second map, which persists the recipe;
   *   - and its **mesh**, when the engine has produced one, goes to the
   *     un-persisted holdings store. Two writes rather than one because the
   *     recipe is durable and the bytes are not, and this is the only press where
   *     both are in hand.
   *
   * A generated base with no mesh is placed anyway. The footprint is arithmetic,
   * so the outline is truthful before the engine has been asked anything — it
   * becomes a `warn` bill row and a refused download rather than a silent
   * omission.
   */
  const placeGenerated = useCallback<GeneratorPlaceHandler>((placed, mesh) => {
    if (placed.kind === 'archived') {
      placeTile(placed.placement)
      return
    }
    placeGeneratedBase(placed.placement)
    if (mesh !== null) holdGeneratedMesh(placed.placement.base, mesh)
  }, [])

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

        {/*
          Row G2. Closed it is a plate in the stage's top-right and costs 1.17 kB
          gzipped; opened it covers the stage, and three.js, r3f and the glTF
          loader arrive in their own chunk on that press. It covers rather than
          replaces the canvas because `PlanCanvas` holds its viewport — zoom, pan,
          cursor — outside the store, and swapping it out would reset the drawing
          every time somebody glanced at the room.
        */}
        <Builder3DPanel catalog={planCatalog} placements={placements} assets={index.file.assets} />

        {/*
          Row S4. Closed it is a plate in the stage's top-left and costs 656 B
          gzipped, A/B measured; opened it is a non-modal 442px drawer down the
          stage's right edge, and the parameter schemas, the sweep tables and the
          resolver arrive in their own chunk on that press. The OpenSCAD engine
          is a second boundary further on and loads only when a parameter set
          resolves to no archived file. Each shape opens on one that does, so
          the first paint of the drawer compiles nothing.

          It takes `records` because catalog-first resolution is a join against
          the archive's own base filenames, and the index this screen already
          holds is the only copy of those: `resolve.ts` measures the alternative,
          a shipped reverse index, at 3,650 B brotli to say what the records
          already say.

          `onPlace` is row S5's seam, wired by row X9. The drawer resolves the
          recipe and hands over a `RecipePlacement` plus the bytes when the
          engine has produced any; `placeGenerated` above writes them. `placeAt`
          is the other half — the drawer has no scene, so it cannot know which
          cell is free.
        */}
        <GeneratorPanel
          records={index.file.records}
          assets={index.file.assets}
          onPlace={placeGenerated}
          placeAt={(foot) => {
            const [x, z] = freeCellFor(vacancyScene, foot.footprint)
            return { x, z }
          }}
        />
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
          materialOf={index.materialOf}
          download={download}
          generated={{ bill: generatedBill, placements: generatedPlacements }}
        />
        {/*
          Row C2, and the third child of a two-row grid on purpose: the bill
          keeps the `1fr` and this lands in the implicit `auto` row beneath it.
          It is the half of the inventory the bill cannot hold — a composition
          slot is not a placement, so `buildBillOfTiles` neither counts a torch
          in a wall's `torch` slot nor can.
        */}
        <SlotsPanel catalog={index.file} placements={placements} />
      </div>
    </section>
  )
}
