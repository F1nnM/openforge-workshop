/**
 * `/builder` — design-contract.md §2.4, and the screen that makes the builder
 * reachable at all.
 *
 * Two columns at `100dvh` with no page scroll — a flexible stage and a 302px
 * bill of tiles — with the palette in the frame's rail beside them. This
 * component owns the layout, the URL, and the three derivations everything else
 * reads from — and nothing else. Every panel, the 3D surface, the bill and the
 * download are already-landed modules that are *called* here rather than
 * reimplemented.
 *
 * **It was three columns, and the palette was the first of them.** §2.4's 272px
 * palette is now the builder's contribution to the rail — it renders through
 * `<RailSlot>`, which is a portal, so this component still owns it, still hands
 * it `tools` and the search params, and `AppFrame` never sees it. Two things
 * follow that are worth stating rather than discovering: the rail is 265px where
 * the column was 272px, and the palette's scroll container is now the rail's
 * slot rather than the panel itself.
 *
 * The height lost its arithmetic with the header. It was `calc(100dvh -
 * var(--of-header-h))` because 60px of chrome sat above the screen; the chrome
 * is beside it now, so the work area is the viewport.
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
 *      invalidation problem. Since row **C6** the plan catalog is memoised on the
 *      **slot-layout rule** as well, because it caches that rule's answers: this
 *      screen is the one party that can compose `@/template`'s conventions with
 *      `@/builder/canvas`'s placement, and `slotLayout` below is where it does.
 *   4. **Where a generated base lands, and nothing else about one.** Row S4's
 *      drawer decides *what* — it holds the recipe and the resolution the strip is
 *      showing — and calls row S5's `placeRecipe` itself; this screen answers
 *      *where*, because that is a question about the whole plan. See
 *      `placeGenerated` and `freeCellFor`. There is now a **second bill** beside
 *      the first for the same reason there are two store maps: a catalog line is
 *      one per md5 and names a `CatalogRecord`, a generated line is one per recipe
 *      and names no published file at all.
 *
 *      **The archived half of that seam does not place, and row A8 left it that
 *      way on purpose.** `placeGenerated` carries the argument and the
 *      measurement: a bare base needs a one-slot family keyed on `shape|base`
 *      that row **B4** owes and nothing in the tree yet emits.
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
 * **And the backup is a panel, not a screen.** Row A0 deleted `/library`, which
 * was the only mount of `exportWorkshop` / `importWorkshop`; `<BackupPanel>` is
 * the foot of the bill column now, because what the JSON envelope carries is this
 * screen's room. It takes no props for the same reason `<LockToggle>` does not.
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { buildAssemblyIndex, buildBillOfTiles } from '@/assembly'
import {
  buildPlanScene,
  createStyleResolver,
  freeCellFor,
  planCatalogFromFile,
  templateSlotLayout,
  usePlanTools,
} from '@/builder/canvas'
import {
  BackupPanel,
  BillPanel,
  PLACEABLE_TEMPLATES,
  PalettePanel,
  PlanToolbar,
  useArchiveDownload,
} from '@/builder/panels'
import type { SlotEditTarget } from '@/builder/panels/slots'
import { SlotsPanel } from '@/builder/panels/slots'
import { Builder3DPanel } from '@/builder/three'
import type { SurfaceStatus } from '@/builder/three'
// Deep, and not through the barrel: `@/builder/three/index.ts` exports only
// `Builder3DPanel` and `lod.ts` as values, and its `boundary.test.ts` walks that
// entry's closure to keep the renderer out of it. `edits.ts` imports no renderer
// — `@/builder/canvas`, `@/catalog`, `@/store` — so reading one constant from it
// costs this screen nothing and leaves that rule intact.
import { ARMED_TURN_STEP_DEG } from '@/builder/three/edits'
import { GeneratorPanel } from '@/generator/panel'
import type { GeneratorPlaceHandler } from '@/generator/panel'
import { buildGeneratedBill } from '@/generator/placement/bill'
import type { RecipeTemplate } from '@/assembly'
import type { CatalogIndex } from '@/screens/catalog'
import { useCatalogIndex } from '@/screens/catalog'
import { BASE_SLOT, compositionIndexFor } from '@/screens/detail/slots'
import type { PlacementId } from '@/store'
import {
  SlotName,
  TemplateId,
  clearPlacements,
  holdGeneratedMesh,
  placeGeneratedBase,
  placeTemplate,
  useGeneratedHoldings,
  useGeneratedMeshes,
  useGeneratedPlacements,
  useLockSystem,
  usePlacements,
  useRoomDesign,
} from '@/store'
import { reSolveScene } from '@/template'
import { DesignToggle } from '@/ui/design-picker'
import { LockToggle } from '@/ui/lock-picker'
import { Button, Eyebrow } from '@/ui/primitives'
import { RailSlot } from '@/ui/shell'

import './builder.css'

const builderApi = getRouteApi('/builder')

/**
 * B4's one-slot bare-base family — `require: [{ tag: 'shape|base' }]`.
 *
 * A literal here rather than an export from the family table, because
 * `generator/placement/placement.ts` is explicit that this is the **caller's**
 * to name: *"whether an id names a template the build ships is a question for
 * the reader that has the table"*, and this screen is that reader. Parsed rather
 * than cast, so a rename in `templates.ts` fails here at the press instead of
 * arriving in the store as an `unknown-template` placement.
 *
 * `templates` below is the lookup that answers for it; `recipes` includes
 * `PLACEABLE_TEMPLATES`, which is what makes it resolvable at all.
 */
const BARE_BASE = TemplateId.parse('shape-base')

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
  /* Row **D6**. The room-wide design — a `texture` root or `undefined` — read
     here rather than in the control, because every one of its three consumers is
     in this component: the click's filler (through `<Builder3DPanel>`), the bill
     has no opinion about it, and the re-solve below is the write that makes a
     change visible at all. */
  const design = useRoomDesign()
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

  /**
   * Which placed instance's slot editor is open, and on which slot — row **C8**.
   *
   * **Held here because two surfaces open it and neither can hold the other's
   * state.** `SlotsPanel` owned it until this row, which was correct while a
   * piece's row in the bill column was the only way in; the owner asked for the
   * editor to *"come up with a right click"* on the piece, so the 3D surface now
   * opens it too, and a `useState` inside the panel is unreachable from inside
   * `<Builder3DPanel>`. This is the same lift the surface `status` above got for
   * the same reason, one row earlier.
   *
   * `slot` is what makes the drawing's route better than the panel's rather than
   * merely equivalent: a right click lands on a *part*, so `partAt` names the
   * slot the user pointed at and the editor opens on that row. The panel row
   * passes no slot, because a row names a piece and has no point to resolve.
   */
  const [editing, setEditing] = useState<SlotEditTarget | null>(null)

  /**
   * The surface's two primitives, as the panel's open state.
   *
   * `exactOptionalPropertyTypes` is why this is a conditional and not a spread
   * of `{ placement, slot }`: with no part resolved the field must be *absent*
   * rather than present-and-undefined, and that is a real distinction here —
   * absent is what the panel row passes and what makes the editor pick the first
   * slot needing a choice.
   */
  const editSlots = useCallback((placement: PlacementId, slot?: SlotName) => {
    setEditing(slot === undefined ? { placement } : { placement, slot })
  }, [])

  // Once, and handed to three components. See the module note.
  const tools = usePlanTools()

  const assembly = useMemo(() => buildAssemblyIndex(index.file), [index])

  /**
   * The two authorities `resolveInstance` requires beside the catalog index.
   *
   * **Both are required arguments rather than defaulted options**, which is row
   * A3's point: without the template there are no slots to walk, and without the
   * composition index a fill cannot be checked against the slot that holds it —
   * and a resolution that silently skipped the check would emit a plausible bill
   * for a scene full of misfitting parts.
   *
   * `templates` is a lookup over the 40 shipped recipes. `RecipeTemplate` is
   * assignable to {@link AssemblyTemplate} without an adapter — its
   * `TemplatePart` is `Pick<PartSlot, 'name' | 'tags'>` plus `fulfills`, and
   * extra properties are fine in a non-literal position — so this is a `Map`
   * over the table and nothing more. It is a `Map` rather than a `find` because
   * the lookup runs once per instance on every store write.
   *
   * `composition` comes from `compositionIndexFor`, which is the **shared**
   * index: a `WeakMap` keyed on the parsed file, so the drawer's picker, the
   * variants table, the slots panel below and this bill are four readers of one
   * 409,432-byte inverted index rather than four builds of it. The engine's own
   * aggregate index is handed over for the same reason `planCatalogFromFile`
   * used to take it — deriving a second one is 86.8 ms this screen has already
   * paid.
   */
  const recipes = useMemo(
    /* **All 91, and row C1's list rather than a second one.** It was the 40
       fixture recipes alone, because nothing could place anything else; B4's 51
       generated families are placeable now — C1's palette offers them and the
       generator's archived arm places `shape-base` below — and a family missing
       from this lookup is reported `unknown-template` by `resolveInstance`,
       which is a bill row and a refused download rather than a visible error.
       C1 measured that failure rather than predicting it: against the 40-recipe
       table all 51 families report `unknown-template` and 0 parts.

       `PLACEABLE_TEMPLATES` is that row's export and is documented as *"the list
       `BuilderScreen`'s recipe table must be built from"*, with its 91 members
       asserted in `palette.corpus.test.ts`. This row briefly held
       `[...RECIPE_TEMPLATES, ...GENERATED_FAMILIES]`, which is the same set —
       measured identical, 91 ids, 0 either way — and one copy of it is one too
       many: B5 takes the families to 52 and only one of the two would move. */
    () => new Map(PLACEABLE_TEMPLATES.map((recipe) => [recipe.id, recipe])),
    [],
  )
  /* Typed on the **narrower** return, not on `TemplateLookup`. `RecipeTemplate`
     is assignable to `AssemblyTemplate` structurally — that is row A3's stated
     layering, the resolver taking a shape rather than importing a screen's type
     — so this one lookup satisfies `buildBillOfTiles`, `reSolveScene` and the
     slots panel, and only the panel needs the recipe's `name` and `source`.
     Annotating it as `TemplateLookup` would throw those two away at the widest
     consumer and leave the panel unable to say which family a piece is. */
  const templates = useMemo(
    () => (id: TemplateId): RecipeTemplate | undefined => recipes.get(id),
    [recipes],
  )
  /* The same 91 as a **list**, for row D6's reach derivation, which walks every
     template and cannot enumerate a lookup. Read off `recipes` rather than off
     `PLACEABLE_TEMPLATES` a second time, so the figures the design control shows
     are about the templates this screen can actually place — if the two ever
     diverge, the control must follow the table the bill and the solver use. */
  const designRecipes = useMemo(() => [...recipes.values()], [recipes])
  /**
   * **Row B2's slot conventions, wired.** The one thing the canvas cannot see.
   *
   * `templateSlotLayout` composes `@/template`'s three authored conventions with
   * `@/builder/canvas`'s own placement, and the only input it needs from outside
   * both is the **part-name list** of a template — which is what keys a
   * convention (`rules.ts`: the part-name set classifies 40 of 40, where the
   * `shape|` tag is wrong on 2 of 40 because two `internal_corner` fixtures are
   * tagged `shape|corner`). That list lives in the family table beside
   * `src/screens/assemblies/`, which `catalog.ts` sets out at length that the
   * canvas must not reach, so this screen — which already holds `templates` for
   * the bill, `reSolveScene` and the slots panel — hands it over. Composing here
   * is also what keeps `@/builder/canvas` and `@/template` out of each other's
   * import closures.
   *
   * **Without it every part of a multi-part template drew at the instance
   * origin.** `originSlotLayout` is right for the 80 `base` and `floor` parts,
   * which are cell-anchored at yaw 0. What it cost on the other 48 is *not* one
   * thing, and row C6 measured it rather than repeating it:
   *
   *   - the 8 `column` and 8 left/right-wall parts of the corner recipes were
   *     wrong at **every** rotation — a corner's two walls carry the same
   *     footprint, so at yaw 0 they drew the *same box*, one on top of the other,
   *     and the column sat under both;
   *   - the 32 `wall` parts were right at rotation 0 and at 270 and wrong at 90
   *     and 180. A wall whose run equals the face it lies on is already flush
   *     along that face when it is anchored at the cell's own minimum corner, so
   *     its `dx`/`dz` do not move; what `originSlotLayout` could not do is *turn*
   *     it, because with no declared cell each part re-anchors to itself and the
   *     wall stayed at `(0, 0)` where it belongs at `(1.5, 0)` and `(0, 1.5)`.
   *
   * And on all 128 parts it cost the **elevation**: every `floor`, `wall` and
   * `column` standing on a filled `base` slot is one base thickness up
   * (`BASE_LIFT_MM`, 6 mm) and was on the ground.
   */
  const slotLayout = useMemo(
    () => templateSlotLayout((id) => templates(id)?.parts.map((part) => part.name)),
    [templates],
  )
  /**
   * The canvas's view of the catalog — **memoised on the index and the rule**.
   *
   * It was memoised on the lock, because a placement named an item and
   * `planCatalogFromFile` resolved each design through `selectVariantForLock`.
   * A fill names an exact **file** (decision D1), so there is no variant to
   * choose, the function no longer takes a lock or an aggregate index, and
   * nothing about this view goes stale when the preference changes. It memoises
   * the layout rule per `(fills, slot)`, so the rule belongs in the key: a
   * catalog view built with one rule must not survive into a render with
   * another.
   */
  const planCatalog = useMemo(() => planCatalogFromFile(index.file, slotLayout), [index, slotLayout])
  const composition = useMemo(
    () => compositionIndexFor(index.file, index.engine.aggregates),
    [index],
  )
  /**
   * The catalog bill. **`generatedBases` is gone from the context, and so is the
   * anchor list this screen built for it.**
   *
   * Row X9 added it because the auto-insert rule could not see a generated base
   * and added a catalog one beside it, which the bill then had to disclose
   * (`base-already-on-plan`). Row A3 deleted the auto-insert: a recipe declares
   * its base as an ordinary slot, so nothing is added, nothing can be added
   * twice, and there is nothing for the positions of the generated bases to
   * inform. The two bills remain the separate derivations S5 made them, for the
   * reasons in the note below.
   */
  const bill = useMemo(
    () => buildBillOfTiles(Object.values(placements), assembly, { templates, composition, lock }),
    [placements, assembly, templates, composition, lock],
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
   * The **lock re-solve** — contract C-k's other half, and the only caller of
   * `reSolveScene` in the app.
   *
   * Row C2 built the driver and wired nothing, and without this write **nothing
   * reconverts**: a fill names an exact file (decision D1), the three lock
   * systems disagree about which file to print for **1,419 of 3,822 items
   * (37.1%)**, and row A2 proved `planSceneMeshes` is lock-free — so a lock
   * change reaches the drawing, the bill and mesh conversion through the
   * placements this rewrites and through nothing else. The alternative is
   * C-k's named failure: the toggle stops working and *nothing fails*.
   *
   * **This row owns the call and not C1**, and the reason is which party holds
   * the arguments. `reSolveScene` needs the assembly index, the composition
   * index, the family lookup and every placement; this screen has all four
   * already, memoised, for the bill. C1's palette holds a search engine and a
   * family list and would have to derive two 400 kB indexes to make the same
   * call. `LockToggle` is closer to the gesture and holds none of them — it
   * takes no props at all by row L1's design — so the write belongs to the
   * screen that owns the room.
   *
   * ## It runs on a *change* of preference, never on mount
   *
   * The ref is not a lint workaround. A re-solve on mount would rewrite a
   * restored scene against whatever the current build's ranking says, which is
   * the one moment a user has not asked for anything; and `fillSlot` returns the
   * identical state object when nothing moves, so the only thing a mount-time
   * pass could produce is a silent rewrite of a room somebody saved. `lock` is
   * the sole dependency for the same reason: the placements are read through a
   * ref, so a re-solve cannot retrigger itself on the writes it makes.
   *
   * The cost is measured and is not the solver. `reSolveScene` memoises on
   * `(template, pins)`, so a 250-instance room is **40 solves, 288 queries,
   * 8–9 ms**. The **write** is the expensive half — `workshopStore` is
   * `persist`-wrapped over synchronous `localStorage`, so 750 fills measure
   * **80.5 ms** — which `relock.ts` reports as A1's surface and three named
   * options, none of which this row owns. A visible hitch on a rare gesture is
   * the trade taken, deliberately, and it is written down there rather than
   * worked around here.
   */
  /* Read from the effect below rather than listed as its dependencies, which is
     `RoomSurface`'s pattern for the same reason: the re-solve writes to the
     store, so a dependency on `placements` would make it retrigger on its own
     writes. Refreshed on every render, so the effect never sees a stale room. */
  const latest = useRef({ placements, assembly, templates, composition })
  latest.current = { placements, assembly, templates, composition }

  /**
   * **One effect for both preferences, and row D6 is why it is one.**
   *
   * A design change is the *same* driver, the same memo and the same pinned
   * guard as a lock change — `reSolveScene` re-solves every `auto` fill and
   * `fillSlot` refuses every `pinned` one — so a second effect would be the same
   * five lines with one word changed, and the two would drift the first time
   * either preference gained an argument. It also makes the *simultaneous* case
   * right by construction: a restored session that changes both in one commit
   * re-solves once against both, where two effects would re-solve twice and the
   * first pass would run against the other preference's stale value.
   *
   * A design change moves more of the room than a lock change does, which is the
   * measurement that makes the write worth doing: over the 40 shipped recipes,
   * setting `dungeon_stone` changes **108 of 128** slot fills, where a lock
   * change cannot move which *item* fills a slot at all (`relock.ts`: the
   * candidate set is lock-free). Its cost is *lower*, not higher — the family
   * ordering finds an acceptable candidate sooner, so the memoised 250-instance
   * re-solve measures **242 queries** against the lock's 288 — 8–9 ms against
   * 11–13 ms, both inside a 16.7 ms frame, and only the queries are asserted
   * (`relock.ts` records why a millisecond is not). The **write** is still the expensive
   * half at scene scale and it is still A1's surface rather than this row's: see
   * `relock.ts`, which names the three options and prices them.
   */
  const previous = useRef({ lock, design })
  useEffect(() => {
    if (previous.current.lock === lock && previous.current.design === design) return
    previous.current = { lock, design }
    reSolveScene(Object.values(latest.current.placements), latest.current.assembly, {
      templates: latest.current.templates,
      composition: latest.current.composition,
      lock,
      /* Spread, because `exactOptionalPropertyTypes` makes `family: undefined`
         and *no `family`* two different assignments — and `FillContext.family`
         documents absent as "no preference", which is exactly what
         `design === undefined` means. */
      ...(design === undefined ? {} : { family: design }),
    })
  }, [lock, design])

  /**
   * Take what the drawer resolved and write it to the store.
   *
   * The generated arm is unchanged and is two writes across two stores, which is
   * row S5's identity argument made concrete: the recipe goes to the second map,
   * which persists it, and the **mesh**, when the engine has produced one, goes
   * to the un-persisted holdings store. Two writes rather than one because the
   * recipe is durable and the bytes are not, and this is the only press where
   * both are in hand. A generated base with no mesh is placed anyway: the
   * footprint is arithmetic, so the outline is truthful before the engine has
   * been asked anything, and it becomes a `warn` bill row and a refused download
   * rather than a silent omission.
   *
   * ## The archived arm places now, and row B4 is why it can
   *
   * Row **A9** rewrote this arm to hand over a {@link SlotFill} plus a cell and
   * **deliberately named no template**, and row **A8** left the gap open rather
   * than filling it, because the family a bare base belongs to did not exist: a
   * base slot predicates on `shape|base`, which is exactly coextensive with
   * `layer === 'base'` — 1,963 records both ways, zero exceptions — and that
   * cannot come out of B4's `(role, form, build)` key, because `base` is not one
   * of B1's eight roles. B4 shipped the one-slot family on exactly that
   * predicate, so the honest template id now exists and this is the one line
   * `placement.ts`'s docblock says the caller owes:
   *
   * ```ts
   * placeTemplate({ template: BARE_BASE, ...placed.at, fills: { [BASE_SLOT]: placed.fill } })
   * ```
   *
   * The shortcut is untouched and is still the point: the drawer resolves the
   * recipe against the archive, which is what stops the 298 kB worker chunk and
   * the 10.5 MB WASM being fetched at all for **682 of the archive's 709
   * resolvable keys**. What was missing was one store write, and the notice that
   * stood in for it — `.of-build-declined` — is deleted with its test rather
   * than left beside a press that now works.
   *
   * The fill arrives `pinned: true` and that is A9's reading, not a default: the
   * recipe named the lock and the resolver matched on it, so the file is a fact
   * about the resolution and the lock re-solve below must not rewrite it.
   */
  const placeGenerated = useCallback<GeneratorPlaceHandler>((placed, mesh) => {
    if (placed.kind === 'archived') {
      placeTemplate({
        template: BARE_BASE,
        ...placed.at,
        fills: { [SlotName.parse(BASE_SLOT)]: placed.fill },
      })
      return
    }
    placeGeneratedBase(placed.placement)
    if (mesh !== null) holdGeneratedMesh(placed.placement.base, mesh)
  }, [])

  return (
    <section className="of-builder" aria-label="Builder">
      <h1 className="of-sr-only">Builder</h1>

      {/* Into the frame's rail, under the nav — §2.4's first column, moved by
          the sidebar row. Everything about it except where its DOM lands is
          unchanged, including that this screen owns `tools`. */}
      <RailSlot>
        <PalettePanel
          index={index}
          tools={tools}
          search={search}
          onQueryChange={(text) => {
            // The catalog screen's rule, for the catalog screen's reason: the
            // first character of a new search is worth a history entry so Back
            // returns to the unfiltered palette, and every later one replaces it
            // so Back does not walk the word backwards a letter at a time.
            const push = search.q === '' && text !== ''
            void navigate({ search: (prev) => ({ ...prev, q: text }), replace: !push })
          }}
        />
      </RailSlot>

      <div className="of-builder-stage">
        <div className="of-builder-toolbar-slot">
          <PlanToolbar
            tools={tools}
            status={status}
            /*
              The step, not the record — row A4b's answer, taken rather than
              re-derived. A family's rotation step is the least common multiple
              of its parts' own steps and row C2 has not chosen the parts, so
              `ARMED_TURN_STEP_DEG` is the corpus default and `planTurn` already
              turns an armed family by it. Passing the step keeps the toolbar and
              the surface turning by one number.
            */
            armedStep={tools.selectedTemplate === null ? undefined : ARMED_TURN_STEP_DEG}
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
          {/*
            Row **D6**, and the second room-wide preference in the band.

            The owner's decision about the lock — *"not a dedicated screen, but a
            toggle in the builder workarea, with an on-hover (i) or similar"* —
            was made about exactly this shape of setting, so this is the same
            trigger-plus-disclosure beside it rather than a new kind of control.
            Row C1 argued the design belongs in the palette, which is still a
            good argument and is not this row's to act on: `builder/panels/**`
            is another row's, and the band is where the app already keeps the one
            preference that rewrites a placed scene. Two of them side by side is
            the better answer anyway — they are the *two* settings a change to
            which re-solves the room, and a user who finds one finds the other.

            The three authorities are the same objects the bill, the lock
            re-solve and `<Builder3DPanel>`'s filler are built from, for row C5's
            reason: `buildAssemblyIndex` is 8,702 records and
            `compositionIndexFor` a 409,432-byte index this screen has already
            paid for, and the reach figures are 139 candidate resolutions over
            them — 12–15 ms, memoised inside the control on these three leaves.
            `placed` is passed rather than read from the store inside the control
            so a closed dialog does not wake on every placement.
          */}
          <DesignToggle
            authorities={{ recipes: designRecipes, index: assembly, composition }}
            placed={bill.placements}
          />
        </div>

        {/* §2.4's two corner plates are gone. The hint was drawn **twice** —
            `BuilderRoom` puts the same `status.hint` on its own plate over the
            canvas — and the armed plate restated the palette's own selection
            beside a cursor coordinate that changed on every pointer move. The
            room's plate is the one kept, so the surface owns its own readout and
            this screen owns none. `status` is still lifted here for
            `PlanToolbar`, which is what it was lifted for. */}

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
          /*
            Row **C5**: the three authorities the click's fill solve needs, and
            the same three objects the bill and the lock re-solve above are built
            from rather than second copies — `buildAssemblyIndex` is 8,702
            records and `compositionIndexFor` is a 409,432-byte inverted index
            this screen has already paid for. Passed as a literal because
            `BuilderRoom` memoises its filler on the three leaves, which are
            memos of this component; the lock it reads from the store itself.

            **This is the one edit row C5 made outside its own files**, and it
            had to be here: `Builder3DPanel` takes no catalog file, so nothing
            behind the `lazy` line can reach an index, and without these three
            props every placement would keep landing with `fills: {}`. The prop
            is required rather than optional for exactly that reason — a forgotten
            wiring is a compile error instead of a builder that silently draws
            nothing.
          */
          fill={{ index: assembly, templates, composition }}
          /*
            Row **C8**. The owner's right click, arriving from the piece on the
            plan: `RoomSurface` resolves the pick to a placement and to the slot
            whose part it hit, and this screen turns that into the open state
            `SlotsPanel` renders the editor from. The panel's own row keeps its
            gesture — it is the only pointer-free way in.
          */
          onEditSlots={editSlots}
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
          holds is the only copy of those: `resolve.ts` records why a shipped
          reverse index would only restate what the records already say.

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
            // The height as well as the footprint: `freeCellFor` tests the same
            // vertical interval the scene's own sweep does, so a riser and a
            // 6 mm base are free in different cells.
            const [x, z] = freeCellFor(scene, foot.footprint, foot.heightMm)
            return { x, z }
          }}
        />
      </div>

      <div className="of-builder-bill">
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
          Rows C2 and C3, and the third child of a two-row grid on purpose: the
          bill keeps the `1fr` and this lands in the implicit `auto` row beneath
          it. Two halves the bill cannot hold — **what is in each placed
          recipe's slots**, which is where the right-click editor opens from, and
          what the files in those slots themselves hold, which
          `buildBillOfTiles` neither counts nor can.

          It takes the same `assembly` index and the same `templates` lookup the
          bill above is built from, rather than deriving either: `buildAssemblyIndex`
          is 8,702 records and the table is this screen's, so passing them is
          what keeps the panel and the bill answering about one room.
        */}
        <SlotsPanel
          assembly={assembly}
          catalog={index.file}
          editing={editing}
          onEdit={setEditing}
          placements={placements}
          templates={templates}
        />
        {/*
          Row A0. The app's only backup path, and it was the library screen's
          until that screen was deleted — architecture-plan.md §13 (Safari evicts
          `localStorage` after seven days) is why it must exist somewhere, and
          `BackupPanel.tsx` carries the argument for why that somewhere is the
          foot of this column rather than the toolbar band or a settings screen
          that no longer exists.

          The fourth child of a two-row grid, for the reason the third is: the
          bill keeps the `1fr` and this lands in an implicit `auto` row beneath
          the slots.
        */}
        <BackupPanel />
      </div>
    </section>
  )
}
