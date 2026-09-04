/**
 * The builder's left column — design-contract.md §2.4's palette.
 *
 * A search box over the *whole* catalog and, under it, the matching items as a
 * selectable list with small thumbnails. Selecting a row arms the canvas.
 *
 * ## It was two blocks and row A0 left one
 *
 * §2.4 wrote this column as "the library as a selectable list", with the search
 * above it offering "+ add" rows for items not saved yet. Row **A0** deleted the
 * library, and the two blocks collapse into the one that never needed it: the
 * archive itself, listed by the same engine and the same ranking, armed directly.
 *
 * **The empty query is now a real state and it lists something.** It used to hide
 * the search block entirely and show the library instead; with nothing to show
 * instead, an empty query lists the first {@link MAX_SEARCH_ROWS} items the
 * engine returns for the unfiltered facet set. That is a browse rather than a
 * curated list, and the count beside the field says how much of the archive it is
 * a window onto.
 *
 * What is gone with the library, rather than moved:
 *
 *   - the **"+ add"** button on each row, which was the only store write in this
 *     file;
 *   - the **"Add a starter set"** empty state (`palette.ts#starterSet`), which
 *     put six floors and walls of one texture into the library;
 *   - the **note under the library block** counting the saved items the plan
 *     cannot hold. Unplaceable rows are still marked, individually, where the
 *     engine's ranking puts them — the note existed because the library's own
 *     ordering sank them into a block at the end, and a search must not reorder.
 *
 * **Row C1 replaces the whole of this with 52 generated template families**,
 * grouped by role with form and build as facets. This row's job was only to stop
 * the panel reading a field that is about to be deleted, and to leave the builder
 * usable in between: search, arm, place.
 *
 * ## A row is an item
 *
 * Row V3. The panel used to render `PaletteRow.record` — a concrete file, and for
 * the 931 items that carry both an `integral` and a `topper` variant it was
 * whichever file the library happened to hold. That is the defect the owner
 * reported as *"a tile with an integrated base"* in the sidebar: the catalog card
 * showed the topper and the palette showed the integral, for the same tile.
 *
 * Now a row is a {@link TileAggregate}: the name, the size and the placeability
 * come off the item, and the thumbnail renders `item.preview`, which since row V5
 * is a sprite-carrying **topper** wherever the item has one. `palette.ts` carries
 * the argument for each field.
 *
 * ## The unplaceable items are marked, and they are not buttons
 *
 * `isPlaceable` is false for the `none` footprint — **370 items, 9.7% of the
 * corpus** (726 files, 8.3% of them) — and the plan view refuses them visibly
 * rather than silently. Curves are **not** among them: row W6 made annular
 * sectors placeable, so the marker on a refused row names the missing footprint
 * and nothing else.
 *
 * Offering a row that arms an item the canvas will then refuse would make a
 * correct refusal look like a broken palette, so those rows render as static
 * text with the reason beside them instead of as a control. Not a `disabled`
 * button: a disabled button is out of the tab order, and a keyboard user would
 * then meet a row they cannot reach and cannot read the reason from. Static text
 * is read by every screen reader and skipped by Tab, which is exactly the intent.
 *
 * **Refusing at item level is not an approximation.** `foot` is a hoisted facet:
 * over the emitted index, the number of items whose variants disagree about
 * `isPlaceable` is **0**, and the 370 refused items hold exactly the 726 refused
 * files. So a refusal is a property of the tile rather than of the print, which
 * is also why a variant swap cannot rescue one — there is no sibling with a
 * footprint to swap to. `palette.corpus.test.ts` re-measures both figures.
 *
 * ## Arming is **reduced**, and row C1 is what restores it
 *
 * `usePlanTools` no longer holds a `selectedDesign`. Row A1 made templates the
 * only placement unit, so the tool state is a `selectedTemplate: TemplateId` and
 * the work surface turns that into a `placeTemplate` call (`three/edits.ts`).
 * **This panel lists the archive's 3,822 items, and not one of them is a
 * template family** — a `TemplateId` names one of the 40 recipes in
 * `screens/assemblies/templates.ts`, and a `DesignId` is a catalog identity that
 * happens to match the same slug pattern (`store/schema.ts` measures that and
 * says why it is not a licence to pass one for the other).
 *
 * So row **A8 declined to arm anything from here.** Selecting a row keeps its
 * own selection — the press, the `aria-pressed` state and the disarm-on-repress
 * are unchanged, because they are the interaction row C1 rebuilds over the
 * families — and it writes nothing to `PlanTools`. The panel says so on screen,
 * in one line under the heading, rather than offering a control that quietly does
 * nothing: an item selected here cannot be placed, and the toolbar's own
 * "No tile armed" plate would otherwise be the only clue.
 *
 * The alternative was to pass the `DesignId` to `setSelectedTemplate`. It
 * compiles after a cast and it is a lie: `resolveInstance` would report every
 * placement `unknown-template`, the surface would draw a one-cell marker for a
 * recipe that does not exist, and the bill would fill with orphans. **Row C1
 * replaces the whole of this list with the generated template families**, at
 * which point the write comes back and the note goes.
 *
 * The G5 handoff below is reduced the same way and for the same reason: it still
 * claims the channel exactly once, so a stale item cannot sit in the box waiting
 * to arm a later mount, and it selects the row rather than arming the surface.
 *
 * **Nothing in this file knows a file id**, and the one place a file appears is
 * the thumbnail's `row.preview`, which is a picture. That was row V4's doing and
 * it survives the reduction: the thumb answers *what is this* — `preview`, a
 * sprite-carrying topper since V5 — and *what would I print* is not a question
 * this panel has ever answered. Since row A3 nothing answers it by resolution
 * either: a fill names an exact file, so the file is chosen when a slot is
 * filled, which is row C2's.
 *
 * ## The handoff from "Use in builder"
 *
 * Row G5. The catalog drawer's third action posts an **item** into `@/store`'s
 * un-persisted selection channel and navigates here; this panel **claims** it
 * once, on mount, and arms it. That is the whole of the row's reader side, and it
 * is here rather than in the builder screen because this panel is already the one
 * component that writes the selection — a second writer would be two palettes.
 *
 * V1 renamed the channel's five functions when it changed the box's kind, so
 * {@link claimPendingDesign} is the name this reader claims through; a reader
 * still compiling against `claimPendingTile` would be treating a design as a
 * file.
 *
 * The claim is guarded, and the guard is the same doctrine as the paragraph
 * above: **an armed item the canvas will refuse is worse than no armed item.** So
 * the handoff arms an item only when this palette holds a *placeable* row for it,
 * and the two ways it can fail both resolve correctly without a word of new UI:
 *
 *   - **The design is not in the current catalog build.** There is no row and
 *     nothing is armed. The library screen used to be the surface that reported a
 *     retired id; row A0 deleted it, and what the user sees instead is a search
 *     for the item's name with no hit in it, which says the same thing in the
 *     place they are looking.
 *   - **The item has the `none` footprint** — 370 of 3,822. Nothing is armed, and
 *     the row itself is on screen, marked `no plan shape`, because the drawer
 *     seeded this panel's search with the item's name on its way here. A variant
 *     swap cannot rescue this case and must not be attempted, for the reason
 *     measured above: **no design in the corpus mixes placeable and unplaceable
 *     files.**
 *
 * What arrives is an item and never a resolution, and after V4 that is true all
 * the way to the store: nothing between the catalog drawer and
 * `WorkshopState.placements` picks a file. A6's rule 0 picks one when the bill is
 * built, and the three locks disagree for 37.1% of items, so a room shared under
 * openlock and reopened under magnetic is the same room and a different pack.
 *
 * ## Where the search comes from
 *
 * The whole `FacetSearch` from `/builder`, not just the text. `routeTree.tsx`
 * gives the builder route the facet schema precisely so this box is linkable, and
 * taking the whole object means a URL carrying `?kinds=wall` narrows the palette
 * for free rather than being validated and ignored.
 *
 * The input holds a **draft** and commits it after {@link COMMIT_DELAY_MS}, with
 * `committed` as the discriminator that tells this field's own echo from a real
 * external change (Back, a shared link). `../../screens/catalog/SearchField.tsx`
 * explains at length why the naive `useEffect(() => setDraft(q), [q])` silently
 * rewinds a fast typist mid-word. That component is not exported from the catalog
 * screen and its markup is a full-width 520px field with a result count beside
 * it, which is not this 272px column; the debounce logic is what is shared, and it
 * is thirty lines.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { placementRefusal } from '@/builder/canvas'
import type { PlanTools } from '@/builder/canvas'
import type { CatalogAssets, DesignId, SpriteSheet, TileAggregate } from '@/catalog'
import type { MaterialId } from '@/materials'
import type { FacetSearch } from '@/search'
import { MAX_QUERY_LENGTH } from '@/search'
import type { CatalogIndex } from '@/screens/catalog'
import { countLabel, sizeLabel } from '@/screens/catalog'
import { claimPendingDesign, usePendingDesign } from '@/store'
import { Chip, Eyebrow, VisuallyHidden } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { PaletteLookup, PaletteRow } from './palette'
import { MAX_SEARCH_ROWS, searchRows } from './palette'

import './panels.css'

/** How long a keystroke waits before it reaches the URL. See `SearchField.tsx`. */
export const COMMIT_DELAY_MS = 180

export interface PalettePanelProps {
  readonly index: CatalogIndex
  /**
   * Shared with the toolbar and the surface.
   *
   * **This panel no longer writes the selection** — see the module note on row
   * A8's reduction. All it writes is `setTool('place')`, so that a press is not
   * swallowed by the eraser. The prop stays because row C1 restores the write.
   */
  readonly tools: PlanTools
  /** `/builder`'s validated search. Only `q` is ever set by this screen. */
  readonly search: FacetSearch
  readonly onQueryChange: (text: string) => void
}

export function PalettePanel({ index, tools, search, onQueryChange }: PalettePanelProps) {
  const searchId = useId()

  const result = useMemo(() => index.engine.search(search), [index, search])

  /**
   * The row resolver, built over the one index this panel holds.
   *
   * The `undefined` on the preview record is folded into the same drop as a
   * retired design deliberately: `item.preview` is one of the item's own variant
   * ids and the aggregate layer is derived from the same `CatalogFile` the engine
   * indexes, so that half cannot miss. One drop rule, one reachable cause.
   */
  const lookup = useMemo<PaletteLookup>(() => {
    const { byDesign } = index.engine.aggregates
    return (design) => {
      const item = byDesign.get(design)
      if (item === undefined) return undefined
      const preview = index.engine.record(item.preview)
      return preview === undefined ? undefined : { item, preview }
    }
  }, [index])

  const rows = useMemo(() => searchRows(result.items, lookup), [result, lookup])

  /**
   * The selected item — **local to this panel since row A8**, where it used to be
   * `tools.selectedDesign`.
   *
   * A `DesignId` cannot arm the work surface any more: the surface places a
   * template family and this list holds no families. See the module note for why
   * casting one to the other was refused. Row **C1** takes this state back into
   * `PlanTools` as a `TemplateId` when it replaces the list.
   */
  const [armed, setArmed] = useState<DesignId | null>(null)

  const arm = useCallback(
    (item: TileAggregate) => {
      setArmed(item.design)
      // §3: selecting forces place mode. Selecting a tile while the eraser is up
      // otherwise looks like the palette ignored the click — still true of the
      // press, and the one thing here that still reaches `PlanTools`.
      tools.setTool('place')
    },
    [tools],
  )

  // Row G5's one call site. Claiming is read-and-clear, so this is a one-shot
  // handoff and not a piece of state two screens have to keep in step: a second
  // run of this effect — a re-mount, or React's development double-invoke —
  // claims `null` and does nothing, and an item the user has since disarmed is
  // not re-armed behind their back. See the module note for the guard.
  const pending = usePendingDesign()
  useEffect(() => {
    if (pending === null) return
    const claimed = claimPendingDesign()
    if (claimed === null) return
    const row = rows.find((candidate) => candidate.item.design === claimed)
    if (row === undefined || !row.placeable) return
    arm(row.item)
  }, [pending, rows, arm])

  return (
    <aside className="of-palette" aria-label="Palette">
      <PaletteSearch query={search.q} total={result.total} onQueryChange={onQueryChange} />

      <section className="of-pal-block" aria-labelledby={searchId}>
        <h2 className="of-pal-heading" id={searchId}>
          <Eyebrow>Archive</Eyebrow> <Chip tone="count">{countLabel(result.total)}</Chip>
        </h2>

        {/*
          **Row A8's reduction, said on screen.** The list is the archive and the
          surface places template families, so a press here selects and cannot
          arm — see the module note. Row C1 replaces the list with the families
          and this line goes with it. It is a plain note rather than a warning
          because nothing has gone wrong: the builder is mid-migration and this
          says which half is missing.
        */}
        <p className="of-pal-note">
          Placing is not wired to this list yet. The work surface places one of
          the 40 template recipes, and these are the archive&rsquo;s individual
          files — selecting one shows what you picked and arms nothing.
        </p>

        {result.total === 0 ? (
          <p className="of-pal-note">
            Nothing in the organised archive matches. Untagged tiles exist in storage and are not
            reachable from here yet.
          </p>
        ) : (
          <PaletteList
            rows={rows}
            index={index}
            armed={armed}
            disarm={() => {
              setArmed(null)
            }}
            arm={arm}
          />
        )}

        {result.total > rows.length ? (
          <p className="of-pal-note">
            The first {countLabel(MAX_SEARCH_ROWS)} of {countLabel(result.total)} — narrow the
            search to see the rest.
          </p>
        ) : null}
      </section>
    </aside>
  )
}

/* --------------------------------------------------------------------- rows */

function PaletteList({
  rows,
  index,
  armed,
  disarm,
  arm,
}: {
  rows: readonly PaletteRow[]
  index: CatalogIndex
  /** The selected item, threaded down so a row can read as pressed. */
  armed: DesignId | null
  disarm: () => void
  arm: (item: TileAggregate) => void
}) {
  return (
    <ul className="of-pal-list" role="list">
      {rows.map((row) => (
        <PaletteRowView
          key={row.item.design}
          row={row}
          assets={index.file.assets}
          sheet={index.file.sprite}
          material={index.materialOf(row.preview)}
          selected={armed === row.item.design}
          onSelect={() => {
            // Re-selecting the armed row disarms it, which is what `aria-pressed`
            // promises.
            if (armed === row.item.design) {
              disarm()
              return
            }
            arm(row.item)
          }}
        />
      ))}
    </ul>
  )
}

function PaletteRowView({
  row,
  assets,
  sheet,
  material,
  selected,
  onSelect,
}: {
  row: PaletteRow
  assets: CatalogAssets
  sheet: SpriteSheet
  /**
   * The tint, from `CatalogIndex.materialOf` over the **preview** record. Row P3.
   *
   * A palette row is a tile the user is about to place, and the material is what
   * distinguishes two rows whose names and sizes are identical — this panel is
   * 272px wide, so the name is usually truncated and the 40px well is often the
   * only thing telling two candidates apart.
   */
  material: MaterialId
  selected: boolean
  onSelect: () => void
}) {
  const { item, preview, placeable } = row

  const body = (
    <>
      <TileThumb
        blob={preview.blob}
        sprite={preview.sprite}
        thumb={preview.thumb}
        assets={assets}
        sheet={sheet}
        material={material}
        className="of-pal-thumb"
      />
      <span className="of-pal-name">{item.name}</span>
      <span className="of-pal-size">
        {placeable ? sizeLabel(item.foot, item.sizeCode) : REFUSAL_LABEL}
      </span>
    </>
  )

  return (
    <li className="of-pal-row" data-selected={selected ? '' : undefined} data-placeable={placeable ? '' : undefined}>
      {placeable ? (
        <button type="button" className="of-pal-pick" aria-pressed={selected} onClick={onSelect}>
          {body}
        </button>
      ) : (
        <div className="of-pal-pick">
          {body}
          {/* The short mono marker is what fits the column; the full sentence is
              the canvas's own refusal text, so the palette and the canvas cannot
              disagree about why. The canvas asks it of a record and this asks it
              of the item, and the answer is the same on all 3,822: `foot` and
              `name` are both hoisted facets. */}
          <VisuallyHidden>{placementRefusal(item)?.message ?? ''}</VisuallyHidden>
        </div>
      )}
    </li>
  )
}

/**
 * The one footprint that cannot be drawn on the plan, in a dozen characters.
 *
 * Was a two-case function while `arc` was refused; row W6 made all six drawable
 * cases placeable, so `none` is the whole of it. The label itself is unchanged by
 * row R4 and reads correctly without the 2D renderer: a tile with no plan shape
 * has nowhere to stand in the 3D room either, for the same arithmetic reason.
 */
const REFUSAL_LABEL = 'no plan shape'

/* ------------------------------------------------------------------- search */

function PaletteSearch({
  query,
  total,
  onQueryChange,
}: {
  query: string
  total: number
  onQueryChange: (text: string) => void
}) {
  const inputId = useId()
  const [draft, setDraft] = useState(query)
  const committed = useRef(query)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (query === committed.current) return
    // The URL moved on its own — Back, or a shared link. Drop any pending commit
    // or it would immediately undo the navigation that just happened.
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    committed.current = query
    setDraft(query)
  }, [query])

  // Only on unmount: a timer left running would navigate after the screen is
  // gone, which TanStack turns into a navigation to a route nothing is rendering.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <div className="of-pal-search">
      <label className="of-sr-only" htmlFor={inputId}>
        Search the catalog for tiles to add
      </label>
      <input
        id={inputId}
        className="of-search-input of-pal-input"
        type="search"
        autoComplete="off"
        spellCheck={false}
        maxLength={MAX_QUERY_LENGTH}
        placeholder="Search the whole archive…"
        value={draft}
        onChange={(event) => {
          const text = event.target.value
          setDraft(text)
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            timer.current = null
            committed.current = text
            onQueryChange(text)
          }, COMMIT_DELAY_MS)
        }}
      />
      {/* Polite, and only while a query is live: the number changes on every
          keystroke, and an assertive region would interrupt the typing that
          caused it. */}
      <p className="of-pal-count" role="status">
        {/* "tiles", not "items", and the count is a count of items either way:
            `../../screens/catalog/SearchField.tsx` renders the same figure with
            the same word, and two search fields over one engine disagreeing
            about the noun would read as two different result sets. */}
        {query.trim() === '' ? '' : `${countLabel(total)} ${total === 1 ? 'tile' : 'tiles'} match`}
      </p>
    </div>
  )
}
