/**
 * `/builder` — design-contract.md §2.4, and the screen that makes the builder
 * reachable at all.
 *
 * Three columns at `calc(100dvh - var(--of-header-h))` with no page scroll: a
 * 272px palette, a flexible stage, a 302px bill of tiles. This component owns
 * the layout, the URL, and the three derivations everything else reads from —
 * and nothing else. Every panel, the 3D surface, the bill and the download are
 * already-landed modules that are *called* here rather than reimplemented.
 *
 * ## The four things this screen actually decides
 *
 *   1. **`usePlanTools()` is called once.** Mode, snap, pending rotation and the
 *      palette selection are one object shared by the palette, the toolbar and
 *      the surface — all three write to it. Two hooks would be two builders.
 *   2. **The bill is a projection of the store, not a copy.** `usePlacements()`
 *      feeds `buildBillOfTiles`, and the surface reads the same map through the
 *      same scene. Neither holds state of its own, so the room and the parts list
 *      cannot disagree.
 *   3. **The three expensive indexes are memoised on the catalog file.** The
 *      search engine comes from `useCatalogIndex` (module-scope memo, 45 ms), and
 *      `buildAssemblyIndex` and `planCatalogFromFile` are memoised here on
 *      `index.file` — both are deterministic functions of a versioned build
 *      artefact, so that is the correct lifetime rather than a cache with an
 *      invalidation problem.
 *   4. **Where a generated base lands, and nothing else about one.** Row S4's
 *      drawer decides *what* — it holds the recipe and the resolution the strip is
 *      showing — and calls row S5's `placeRecipe` itself; this screen answers
 *      *where*, because that is a question about the whole plan. See
 *      `placeGenerated` and `freeCellFor`. There is now a **second bill** beside
 *      the first for the same reason there are two store maps: a catalog line is
 *      one per md5 and names a `CatalogRecord`, a generated line is one per recipe
 *      and names no published file at all.
 *
 * There were five. **`chrome={false}` was the fourth and row R4 removed the
 * decision by removing the alternative.** `PlanCanvas` could draw §2.4's two
 * corner plates itself, and this screen drew them instead because the canvas's
 * own armed plate carried the `snap {value}` readout that the contract puts in
 * the floating toolbar — two of them on screen would have been a designer's bug
 * report. With the plan view deleted there is one drawer of the plates and it is
 * this screen. The plates themselves are unchanged; the choice is gone.
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
 * this screen touches it. **A move operation.** Row R2 gave the surface one —
 * drag, `Shift`-drag and the arrow keys — and it is the surface's, not the
 * shell's: the drag is ephemeral renderer state and the store sees one
 * `movePlacement` write on the drop. The bill panel's remove-and-replace is still
 * there and is still the keyboard-only path to the same edit.
 *
 * **And the 3D surface is one element, not a fifth decision.** `<Builder3DPanel>`
 * (rows G2, R2 and R4) fills the stage and owns its own lazy chunk and its own
 * empty states, over the same `planCatalog`, the same `scene` and the same
 * `tools` this screen already holds. It is the work surface rather than a view of
 * a drawing made elsewhere, and this screen gains no state for it.
 *
 * **The lock preference is the same shape.** `<LockToggle>` (row L1) is in the
 * stage's top band beside the toolbar, and it takes no props at all: the
 * preference is global, it reads it from the store itself and its figures come
 * from the emitted index through `useLockBuild`. A prop here would be a second
 * copy of a value this screen already reads for the bill, and two copies of one
 * preference is how a control comes to disagree with what it controls. The
 * screen that used to hold it — `/settings` — is deleted; `LockToggle.tsx`
 * carries the argument, including the one it overrules.
 *
 * It renders a `<section>`, not a `<main>`: `AppFrame` owns the document's one
 * `<main>`. The `<h1>` is clipped — the contract opens this screen on the palette
 * and the room, not on a title, and a visible heading would cost the stage a
 * line of height it cannot spare.
 */
import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'

import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import { buildPlanScene, createStyleResolver, describeCell, freeCellFor, planCatalogFromFile, usePlanTools } from '@/builder/canvas'
import { BillPanel, PalettePanel, PlanToolbar, useArchiveDownload } from '@/builder/panels'
import { SlotsPanel } from '@/builder/panels/slots'
import { Builder3DPanel } from '@/builder/three'
import type { SurfaceStatus } from '@/builder/three'
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
import { LockNotice, LockToggle } from '@/ui/lock-picker'
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
  /**
   * The surface's readout — one state, one writer, since row **R4**.
   *
   * It was two, `status` from `PlanCanvas` and `surfaceStatus` from the 3D room,
   * with `surfaceStatus ?? status` deciding which the toolbar and the two corner
   * plates showed. Two renderers were mounted at once and both published on
   * every pointer move, so a single state would have thrashed on whichever
   * render fired last. R4 deleted the plan view, so there is one publisher and
   * the `??` had nothing left on its right-hand side.
   *
   * `null` until the surface has reported once, which is what the fallback
   * sentence in the hint plate below is for.
   */
  const [status, setStatus] = useState<SurfaceStatus | null>(null)

  // Once, and handed to three components. See the module note.
  const tools = usePlanTools()

  /**
   * The canvas's view of the catalog — **memoised on the lock as well as the
   * index**, since row V4.
   *
   * A placement names an item, so something has to turn one into the record a
   * renderer can draw, and `planCatalogFromFile` is where that happens: it
   * resolves each design through `selectVariantForLock`, the same function the
   * bill's rule 0 uses, so the mesh in the 3D room and the line in the bill are
   * the same file. That makes the lock an input, and a `PlanCatalog` held across
   * a change of preference would draw the previous one's variants.
   *
   * `index.engine.aggregates` is handed over rather than letting the default
   * build a second aggregate index over the same file — 3,822 groups of work
   * this screen has already paid for.
   */
  const planCatalog = useMemo(
    () => planCatalogFromFile(index.file, lock, index.engine.aggregates),
    [index, lock],
  )
  const assembly = useMemo(() => buildAssemblyIndex(index.file), [index])
  // Anchors only, and memoised rather than mapped inline: a fresh array on every
  // render would be a new dependency identity every render, so the bill below —
  // one pass over the scene — would rebuild on a hover or a status change.
  const generatedBaseAnchors = useMemo(
    () => Object.values(generatedPlacements).map((placement) => ({ x: placement.x, z: placement.z })),
    [generatedPlacements],
  )
  /**
   * `generatedBases` is the one thing the catalog bill needs from the generated
   * map, and it is positions only.
   *
   * Row X9 reported that `buildBillOfTiles` sees `placements` alone, so the
   * auto-insert rule cannot see a generated base and adds a catalog one beside
   * it. It still adds one — row X10 measured why suppressing would be worse than
   * disclosing, in `assembly/notes.ts#base-already-on-plan` — but the bill can
   * now *say* so, and this is the argument it needs to. Nothing else about a
   * generated base crosses into the catalog bill: the two remain the separate
   * derivations S5 made them, for the reasons in the note below.
   */
  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), assembly, { lock, generatedBases: generatedBaseAnchors }),
    [placements, assembly, lock, generatedBaseAnchors],
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
   * **One scene, and now two consumers of it** — the sixth derivation, promoted.
   *
   * It was `vacancyScene`, built for `freeCellFor` alone: the generator drawer
   * decides *what* to place and this screen decides *where*, because "is that
   * cell free" is a question about the whole plan and the drawer holds no scene.
   * `freeCellFor` uses the scene's own collision predicate, so a base it places
   * is never one `buildPlanScene` then marks in conflict.
   *
   * Row **R2** made it the 3D surface's scene as well, which is the better
   * architecture and not merely convenient: `BuilderRoom` used to project its
   * own, so a third projection of the same two store maps existed for no reason
   * other than that nobody had passed one down. **One scene, and since row R4
   * one renderer of it.** It also insulates the whole 3D row from row **V4**: a
   * placement's shape is changing, and a consumer that takes a `PlanScene` never
   * reads a `Placement` field.
   *
   * Memoised on the two store maps, so it costs one projection per placement
   * rather than one per render.
   *
   * `styleOf` is memoised beside it rather than constructed inline in the
   * projection, which it was: `createStyleResolver` is a *memoising* resolver
   * keyed on the tile id, and rebuilding it on every placement threw that cache
   * away every time — 200 material resolutions per placement instead of 200 once.
   */
  const styleOf = useMemo(() => createStyleResolver(planCatalog), [planCatalog])
  const scene = useMemo(
    () => buildPlanScene(placements, planCatalog, styleOf, generatedPlacements),
    [placements, planCatalog, styleOf, generatedPlacements],
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

  // The armed item, as the record this build would print — `planCatalog` is the
  // one place that hop lives, so the toolbar names the same file the bill will.
  const armed = tools.selectedDesign === null ? undefined : planCatalog.record(tools.selectedDesign)

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
        <div className="of-builder-toolbar-slot">
          <PlanToolbar
            tools={tools}
            status={status}
            armed={armed}
            placed={bill.placements}
            onClear={clearPlacements}
          />
          {/*
            Row L1. The lock preference used to be a screen at `/settings`; the
            owner asked for it in the work area, so it is here, beside the
            toolbar rather than inside it.

            **Beside, not inside, and that is the durable half of the decision.**
            Every control in `PlanToolbar` writes `PlanTools`, and row R4 deleted
            the plan view those tools were written for — they drive the 3D surface
            now. The lock system is neither a plan tool nor a thing R4 removed —
            it decides which base is matched under every topper in the bill and
            which STL the download resolves to — so it is a sibling in the slot
            and came through that row untouched.

            The slot is a wrapping flex row for this, and `builder.css` now
            reserves a gutter on both sides of the band so that neither this
            control nor the toolbar can be painted over by the generator or 3D
            plates. That collision was real and measured before this landed:
            `Place` was 100% unclickable at 1295px.
          */}
          <LockToggle />
        </div>

        {/* §2.4's two corner plates. Pointer-transparent, so a click near the
            bottom of the room still reaches the surface — which matters more now
            than it did on the plan, because the primary gesture *is* a click on
            the drawing. */}
        <p className="of-build-plate of-build-hint">{status?.hint ?? 'Pick a tile from the palette to start.'}</p>
        <p className="of-build-plate of-build-armed">
          {armed === undefined ? 'No tile armed' : armed.name}
          {status === null ? null : (
            <span className="of-build-at">{describeCell(status.cursor[0], status.cursor[1])}</span>
          )}
        </p>

        {/*
          Rows G2, R2 and R4. **The stage**, and no longer a panel: R2 opened it
          with the screen because the owner asked for the 3D view to *be* the
          builder rather than a view behind a gate, and R4 deleted the plan
          canvas it used to cover, so there is nothing left for an open/closed
          pair of states to mean.

          It sits *below* the toolbar band and the two corner plates in the
          stacking order — `builder3d.css` carries that arithmetic, and row L1's
          measurement of what happens when it does not. Every control in
          `PlanToolbar` writes `PlanTools`, and `PlanTools` is precisely what
          this surface reads, so the existing toolbar is its toolbar with no new
          UI at all.
        */}
        <Builder3DPanel
          catalog={planCatalog}
          scene={scene}
          tools={tools}
          assets={index.file.assets}
          onStatus={setStatus}
        />

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
            const [x, z] = freeCellFor(scene, foot.footprint)
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
        <SlotsPanel catalog={index.file} placements={placements} lock={lock} />
      </div>
    </section>
  )
}
