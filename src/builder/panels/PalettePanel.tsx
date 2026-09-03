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
 * ## Arming: an item is picked, and that is the whole of it
 *
 * Row V4. `usePlanTools.selectedDesign` is a `DesignId` because
 * `Placement.design` is one, so arming is `tools.setSelectedDesign(item.design)`
 * and the pressed row is `selected === item.design`. **Nothing in this file
 * knows a file id**, and the one place a file appears is the thumbnail's
 * `row.preview`, which is a picture.
 *
 * V3 had to do more than that, and what it did is worth recording because the
 * disappearance is the point. `selectedTileId` was a `TileId`, so V3 inserted a
 * resolve-to-arm hop — `palette.ts#armFile`, `selectVariant` under the build's
 * lock preference — plus its inverse `armedItem` to decide which row read as
 * pressed, and the inverse could not simply re-run the hop, because that
 * comparison is taken under *today's* lock and switching preference after arming
 * would silently un-press the row while leaving the canvas armed. Both
 * functions, that hazard and this section's four call sites are gone rather than
 * moved: a design cannot be resolved under the wrong preference because it is
 * not resolved at all.
 *
 * The two directions that remain still use different rules, and the pair is
 * measured: `selectVariant` names a file other than `preview` on **1,598 of
 * 3,822** items. The thumb answers *what is this* — `preview`, a sprite-carrying
 * topper since V5. What answers *what would I print* is no longer here at all:
 * it is `resolvePlacement`'s rule 0, run when the bill is built, which is where
 * it belonged. `variantsByPreference`' docblock is the long version.
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
  /** Shared with the toolbar and the canvas; this panel writes the selection. */
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

  // Which item is armed. Row V4: the store's own currency, so there is nothing
  // to look up and nothing that can go stale when the lock preference changes.
  const armed = tools.selectedDesign

  const arm = useCallback(
    (item: TileAggregate) => {
      tools.setSelectedDesign(item.design)
      // §3: arming forces place mode. Selecting a tile while the eraser is up
      // otherwise looks like the palette ignored the click.
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

        {result.total === 0 ? (
          <p className="of-pal-note">
            Nothing in the organised archive matches. Untagged tiles exist in storage and are not
            reachable from here yet.
          </p>
        ) : (
          <PaletteList rows={rows} index={index} armed={armed} tools={tools} arm={arm} />
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
  tools,
  arm,
}: {
  rows: readonly PaletteRow[]
  index: CatalogIndex
  /** The armed item — `tools.selectedDesign`, threaded down so a row can read as pressed. */
  armed: DesignId | null
  tools: PlanTools
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
              tools.setSelectedDesign(null)
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
