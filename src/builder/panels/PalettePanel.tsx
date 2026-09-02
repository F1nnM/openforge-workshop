/**
 * The builder's left column — design-contract.md §2.4's palette.
 *
 * A search box over the *whole* catalog offering "+ add" rows for tiles that are
 * not saved yet, and under it the library as a selectable list with small
 * thumbnails. Selecting a row arms the canvas.
 *
 * ## The unplaceable tiles are marked, and they are not buttons
 *
 * `isPlaceable` is false for the `none` footprint — 726 tiles, 8.3% of the
 * corpus — and the plan view refuses them visibly rather than silently. Curves
 * are **not** among them: row W6 made annular sectors placeable, so the copy
 * beside the library block names the missing footprint and nothing else.
 *
 * Offering a row that arms a tile the canvas will then refuse would make a
 * correct refusal look like a broken palette, so those rows render as static
 * text with the reason beside them instead of as a control. Not a `disabled` button: a disabled button
 * is out of the tab order, and a keyboard user would then meet a row they cannot
 * reach and cannot read the reason from. Static text is read by every screen
 * reader and skipped by Tab, which is exactly the intent.
 *
 * They keep their "+ add" action, though. Saving one to the library is a
 * perfectly good thing to do — it just cannot be laid out in plan view yet.
 *
 * ## The handoff from "Use in builder"
 *
 * Row G5. The catalog drawer's third action posts a file into `@/store`'s
 * un-persisted selection channel and navigates here; this panel **claims** it
 * once, on mount, and arms it. That is the whole of the row's reader side, and it
 * is here rather than in the builder screen because this panel is already the one
 * component that writes the selection — a second writer would be two palettes.
 *
 * The claim is guarded, and the guard is the same doctrine as the paragraph above:
 * **an armed tile the canvas will refuse is worse than no armed tile.** So the
 * handoff arms a file only when this palette holds a *placeable* row for it, and
 * the two ways it can fail both resolve correctly without a word of new UI:
 *
 *   - **The file is not in the current catalog build.** There is no row, nothing
 *     is armed, and the library screen is the surface that reports a retired id.
 *   - **The file has the `none` footprint** — 726 of 8,702 records, 8.3%. Nothing
 *     is armed, and the note under the library block is already on screen saying
 *     why, because the drawer put the tile in the library on its way here. A
 *     variant swap cannot rescue this case and must not be attempted: **no design
 *     in the corpus mixes placeable and unplaceable files**, so if the file the
 *     user chose has no plan shape, neither does any sibling.
 *
 * What arrives is a file and never a resolution. A6's rule 0 re-picks the variant
 * when the bill is built, and the three locks disagree for 37.1% of items, so the
 * armed row is "the print the user was looking at" while the bill's line may be a
 * sibling — marked as substituted there, by the module that made the choice.
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
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { placementRefusal } from '@/builder/canvas'
import type { PlanTools } from '@/builder/canvas'
import type { CatalogAssets, SpriteSheet, TileId } from '@/catalog'
import type { FacetSearch } from '@/search'
import { MAX_QUERY_LENGTH } from '@/search'
import type { CatalogIndex } from '@/screens/catalog'
import { countLabel, sizeLabel } from '@/screens/catalog'
import { addToLibrary, claimPendingTile, useLibrary, usePendingTile } from '@/store'
import { Button, Chip, Eyebrow, VisuallyHidden } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { PaletteRow } from './palette'
import { MAX_SEARCH_ROWS, paletteRows, searchRows, starterSet } from './palette'

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
  const library = useLibrary()
  const searchId = useId()
  const libraryId = useId()

  const result = useMemo(() => index.engine.search(search), [index, search])

  const rows = useMemo(
    () => paletteRows(Object.keys(library) as TileId[], (id) => index.engine.record(id)),
    [index, library],
  )

  const hits = useMemo(
    () =>
      searchRows(
        result.ids,
        (id) => index.engine.record(id),
        (id) => library[id] === true,
      ),
    [result, index, library],
  )

  // Row G5's one call site. Claiming is read-and-clear, so this is a one-shot
  // handoff and not a piece of state two screens have to keep in step: a second
  // run of this effect — a re-mount, or React's development double-invoke —
  // claims `null` and does nothing, and a tile the user has since disarmed is not
  // re-armed behind their back. See the module note for the guard.
  const pending = usePendingTile()
  useEffect(() => {
    if (pending === null) return
    const claimed = claimPendingTile()
    if (claimed === null) return
    if (!rows.some((row) => row.record.id === claimed && row.placeable)) return
    tools.setSelectedTileId(claimed)
    tools.setTool('place')
  }, [pending, rows, tools])

  const searching = search.q.trim() !== ''
  const unplaceable = rows.filter((row) => !row.placeable).length

  return (
    <aside className="of-palette" aria-label="Palette">
      <PaletteSearch query={search.q} total={result.total} onQueryChange={onQueryChange} />

      {searching ? (
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
            <PaletteList rows={hits} index={index} tools={tools} />
          )}

          {result.total > hits.length ? (
            <p className="of-pal-note">
              The first {countLabel(MAX_SEARCH_ROWS)} of {countLabel(result.total)} — narrow the
              search to see the rest.
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="of-pal-block" aria-labelledby={libraryId}>
        <h2 className="of-pal-heading" id={libraryId}>
          <Eyebrow>Library</Eyebrow> <Chip tone="count">{countLabel(rows.length)}</Chip>
        </h2>

        {rows.length === 0 ? (
          <PaletteEmpty index={index} />
        ) : (
          <>
            <PaletteList rows={rows} index={index} tools={tools} />
            {unplaceable > 0 ? (
              <p className="of-pal-note">
                {countLabel(unplaceable)} saved {unplaceable === 1 ? 'tile' : 'tiles'} at the end of
                the list cannot be laid out in plan view: the archive does not state a footprint for{' '}
                {unplaceable === 1 ? 'it' : 'them'}. {unplaceable === 1 ? 'It is' : 'They are'} still
                in your library, and still printable.
              </p>
            ) : null}
          </>
        )}
      </section>
    </aside>
  )
}

/* --------------------------------------------------------------------- rows */

function PaletteList({
  rows,
  index,
  tools,
}: {
  rows: readonly PaletteRow[]
  index: CatalogIndex
  tools: PlanTools
}) {
  return (
    <ul className="of-pal-list" role="list">
      {rows.map((row) => (
        <PaletteRowView
          key={row.record.id}
          row={row}
          assets={index.file.assets}
          sheet={index.file.sprite}
          selected={tools.selectedTileId === row.record.id}
          onSelect={() => {
            // Re-selecting the armed row disarms it, which is what `aria-pressed`
            // promises. Arming also forces place mode (§3): selecting a tile
            // while the eraser is up otherwise looks like the palette ignored the
            // click.
            if (tools.selectedTileId === row.record.id) {
              tools.setSelectedTileId(null)
              return
            }
            tools.setSelectedTileId(row.record.id)
            tools.setTool('place')
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
  selected,
  onSelect,
}: {
  row: PaletteRow
  assets: CatalogAssets
  sheet: SpriteSheet
  selected: boolean
  onSelect: () => void
}) {
  const { record, placeable, inLibrary } = row

  const body = (
    <>
      <TileThumb
        blob={record.blob}
        sprite={record.sprite}
        assets={assets}
        sheet={sheet}
        className="of-pal-thumb"
      />
      <span className="of-pal-name">{record.name}</span>
      <span className="of-pal-size">
        {placeable ? sizeLabel(record.foot, record.sizeCode) : REFUSAL_LABEL}
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
              disagree about why. */}
          <VisuallyHidden>{placementRefusal(record)?.message ?? ''}</VisuallyHidden>
        </div>
      )}

      {inLibrary ? null : (
        <Button
          size="sm"
          className="of-pal-add"
          onClick={() => {
            addToLibrary(record.id)
          }}
        >
          <span aria-hidden="true">+</span>
          <span>add</span>{' '}
          {/*
            The space is load-bearing, not formatting. `dom-accessibility-api`
            trims each text node before joining, so without a text node between
            the two spans the accessible name is "addDungeon Stone Floor 2x2".
            `../../screens/library/LibraryScreen.tsx` spaces its count chips for
            the same reason.
          */}
          <VisuallyHidden>{record.name} to the library</VisuallyHidden>
        </Button>
      )}
    </li>
  )
}

/**
 * The one footprint the plan view cannot draw, in a dozen characters.
 *
 * Was a two-case function while `arc` was refused; row W6 made all six drawable
 * cases placeable, so `none` is the whole of it.
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
        {query.trim() === '' ? '' : `${countLabel(total)} ${total === 1 ? 'tile' : 'tiles'} match`}
      </p>
    </div>
  )
}

/* -------------------------------------------------------------- empty state */

/**
 * design-contract.md §2.4's "Add a starter set".
 *
 * The set is derived from the live index rather than hard-coded — see
 * `palette.ts#starterSet` — so it cannot rot when the corpus renames a file, and
 * it is one texture set so the first room looks like a room.
 */
function PaletteEmpty({ index }: { index: CatalogIndex }) {
  const starter = useMemo(() => starterSet(index.file.records), [index])

  return (
    <div className="of-pal-empty">
      <p className="of-pal-note">
        Your library is the palette. Search the archive above, or start from a set of floors and
        walls in one texture.
      </p>
      <Button
        tone="primary"
        size="sm"
        disabled={starter.length === 0}
        onClick={() => {
          for (const id of starter) addToLibrary(id)
        }}
      >
        Add a starter set{' '}
        <VisuallyHidden>of {countLabel(starter.length)} tiles</VisuallyHidden>
      </Button>
    </div>
  )
}
