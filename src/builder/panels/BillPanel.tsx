/**
 * The builder's right column — design-contract.md §2.4's bill of tiles, and the
 * screen's warning surface.
 *
 * A mono eyebrow, `{n} tiles placed`, one row per unique file with its thumbnail,
 * name, size and count, then a footer with the unique-model count, the total and
 * the download action.
 *
 * ## It is a warning surface, not a footnote
 *
 * Two things this panel exists to say out loud, both measured rather than
 * defensive:
 *
 *   1. **The total carries its verdict.** An ordinary room is a gigabyte
 *      download — one median-filled template instance is 26.4 MB over about
 *      three files, so fifty of them are about 1.32 GB — and a bare figure in a
 *      footer would bury that. `verdictCopy` turns `buildBillOfTiles`' verdict
 *      into the sentence. **The two thresholds are stale by 2.58× and are
 *      deliberately not moved here**: row A3 states why, and row C4 restates
 *      them in parts rather than in placements.
 *   2. **Every warning note is on screen**, rendered in full, above the rows,
 *      with the detail visible — not behind a disclosure and not summarised as
 *      "some warnings". The loudest of them is now `slot-unfilled`: every slot
 *      of every recipe in the build is required, so an empty one is a hole in
 *      the print and it is the one thing that refuses the download.
 *
 * **Two more claims stood here and row A3 removed the facts behind both.** The
 * `base · added` mark read `BillLine.baseQuantity`, and nothing inserts a base —
 * a recipe declares one as an ordinary slot, so every copy in the bill is a copy
 * the scene asked for. The `Resolved for openlock` block and the per-row variant
 * marks read a `VariantResolution`, and a fill names an exact file, so nothing
 * chooses at resolution time and there is no decision left to disclose.
 * `billView.ts` carries the long form of both, and row **C4** owns what this
 * panel says about a fill instead.
 *
 * The `info` notes are quieter but still present, in a `<details>`: they are
 * true, and `build-unspecified` alone fires on a quarter of what the recipes
 * admit, so giving them the same weight as an empty slot would make the empty
 * slot unreadable. That is the one place this panel trades prominence for
 * legibility, and it does it in the direction that keeps the warnings loud.
 *
 * ## It is also the accessible inventory of the scene
 *
 * Row 17 was explicit that the canvas is one tab stop, has no move operation and
 * draws something that is not linearly readable. This panel closes the last of
 * that: every row expands into the placements behind it, each with its grid
 * position, its angle, and a Remove button. So a keyboard-only or screen-reader
 * user can enumerate a room and take a tile out of it without ever touching the
 * drawing. `billView.ts#billInventory` is the join that makes it possible, and
 * instances the bill cannot describe at all — a retired recipe, or a recipe whose
 * every fill has left the archive — get their own removable block rather than
 * being silently absent. An instance now expands under **every** file it
 * resolved to rather than under one, because a five-slot corner is five rows.
 */
import { useId, useState } from 'react'

import type { BillOfTiles } from '@/assembly'
import type { CatalogAssets, CatalogRecord, SpriteSheet } from '@/catalog'
import type { GeneratedBill } from '@/generator/placement/bill'
import type { MaterialId } from '@/materials'
import { describeCell, formatUnits } from '@/builder/canvas'
import { countLabel, fileSizeLabel, sizeLabel, totalBytesLabel } from '@/screens/catalog'
import type { TemplateInstance, WorkshopState } from '@/store'
import { removePlacement } from '@/store'
import { Eyebrow, VisuallyHidden } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { BillPlacement, BillRow } from './billView'
import { billInventory, noteCopy, verdictCopy } from './billView'
import { DownloadAction } from './DownloadAction'
import { GeneratedBillSection } from './GeneratedBillSection'
import type { ArchiveDownload } from './useArchiveDownload'

import './panels.css'

export interface BillPanelProps {
  readonly bill: BillOfTiles
  /**
   * The store's scene.
   *
   * Passed in rather than read from the store, so this panel stays a projection
   * of one map: the screen builds the bill from these instances and hands both
   * over, and the inventory below cannot describe a scene the bill was not built
   * from. `billInventory` joins them on the `PlacementId`.
   */
  readonly placements: Readonly<Record<string, TemplateInstance>>
  readonly assets: CatalogAssets
  readonly sheet: SpriteSheet
  /**
   * `CatalogIndex.materialOf`, for the row thumbnails. Row P3.
   *
   * A function rather than a resolved value per row, because {@link BillRow}s
   * are derived here by `billInventory` and the screen above does not have them
   * to map over. It is memoised on the index, so a bill that re-renders on every
   * placement resolves each mesh once.
   */
  readonly materialOf: (record: CatalogRecord) => MaterialId
  readonly download: ArchiveDownload
  /**
   * Row S5's generated bill, and the store map behind it. Absent means none.
   *
   * `billView.ts` needs nothing for this and gets nothing: a generated
   * placement never enters `buildBillOfTiles`, so the two halves are joined by
   * being rendered next to each other rather than by a merged model. See
   * `GeneratedBillSection.tsx`.
   */
  readonly generated?: { readonly bill: GeneratedBill; readonly placements: WorkshopState['generated'] }
}

export function BillPanel({ bill, placements, assets, sheet, materialOf, download, generated }: BillPanelProps) {
  const headingId = useId()
  const { rows, orphans } = billInventory(bill, placements)
  const verdict = verdictCopy(bill.download)
  // `unknown-tile` is deliberately dropped from this list: `OrphanBlock` below is
  // that note's rendering, and it is the better one — it names the retired ids and
  // offers to take them off the grid. Two paragraphs saying the same sentence, one
  // of them actionable, is worse than one.
  const warnings = bill.notes.filter((note) => note.severity === 'warn' && note.code !== 'unknown-tile')
  const infos = bill.notes.filter((note) => note.severity === 'info')

  return (
    <aside className="of-bill" aria-labelledby={headingId}>
      <header className="of-bill-head">
        <Eyebrow as="div">Bill of tiles</Eyebrow>
        <h2 className="of-bill-title" id={headingId}>
          {countLabel(bill.placements)} {bill.placements === 1 ? 'tile' : 'tiles'} placed
        </h2>
        {bill.parts > bill.placements ? (
          <p className="of-bill-sub">
            {/*
              Row A3. It read "a base is added under the pieces that need one",
              which was rule 1's disclosure and is now false of every scene:
              nothing is added. `parts` exceeds `placements` because a recipe is
              three to five slots — 128 parts over the 40 shipped templates — and
              this says that and nothing more.
            */}
            {countLabel(bill.parts)} parts to print across{' '}
            {bill.placements === 1 ? 'one recipe' : `${countLabel(bill.placements)} recipes`}.
          </p>
        ) : null}
      </header>

      <div className="of-bill-scroll">
        {verdict === null ? null : (
          <p className="of-bill-note" data-tone={verdict.verdict} role="status">
            <strong className="of-bill-note-head">{verdict.headline}.</strong> {verdict.detail}
          </p>
        )}

        {warnings.map((note) => {
          const copy = noteCopy(note)
          return (
            <p className="of-bill-note" data-tone="warn" key={note.code}>
              <strong className="of-bill-note-head">{copy.headline}.</strong> {copy.detail}
            </p>
          )
        })}

        {orphans.length > 0 ? <OrphanBlock orphans={orphans} /> : null}

        {rows.length === 0 ? (
          <p className="of-bill-empty">
            Nothing placed yet. Arm a tile in the palette and click the grid; the files you would
            have to print appear here as you go.
          </p>
        ) : (
          <ul className="of-bill-list" role="list">
            {rows.map((row) => (
              <BillRowView
                key={row.line.blob}
                row={row}
                assets={assets}
                sheet={sheet}
                material={materialOf(row.line.tile)}
              />
            ))}
          </ul>
        )}

        {generated === undefined ? null : (
          <GeneratedBillSection bill={generated.bill} placements={generated.placements} />
        )}

        {infos.length === 0 ? null : (
          <details className="of-bill-infos">
            <summary>
              {countLabel(infos.length)} {infos.length === 1 ? 'note' : 'notes'} about this scene
            </summary>
            {infos.map((note) => {
              const copy = noteCopy(note)
              return (
                <p className="of-bill-info" key={note.code}>
                  <strong className="of-bill-note-head">{copy.headline}.</strong> {copy.detail}
                </p>
              )
            })}
          </details>
        )}
      </div>

      <footer className="of-bill-foot">
        <p className="of-bill-total">
          <span>
            {countLabel(bill.files)} unique {bill.files === 1 ? 'model' : 'models'}
          </span>
          {/*
            `totalBytesLabel` and not `fileSizeLabel`, since row A0: this is the
            only byte figure in the app that crosses a gigabyte, and the bill
            warns at a 2 GB threshold — beside which `2100.0 MB` is a number the
            reader has to convert. `fileSizeLabel` stays right for the rows
            below, where a single STL never reaches one.
          */}
          <span className="of-bill-bytes" data-verdict={bill.download.verdict}>
            {totalBytesLabel(bill.download.bytes)}
          </span>
        </p>
        <DownloadAction
          download={download}
          files={bill.files}
          generated={generated?.bill.recipes ?? 0}
        />
      </footer>
    </aside>
  )
}

/* --------------------------------------------------------------------- rows */

/**
 * One file, its count, and the placements behind it.
 *
 * The size shown is the file's own, **once** — not multiplied by the count — for
 * the reason the whole bill is deduped by md5: the archive holds one copy of a
 * file whatever the quantity, so a row that showed `bytes × count` would not sum
 * to the footer's total and the panel would disagree with the download it is
 * offering. The count is the print count; the size is the download cost.
 */
function BillRowView({
  row,
  assets,
  sheet,
  material,
}: {
  row: BillRow
  assets: CatalogAssets
  sheet: SpriteSheet
  material: MaterialId
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const { line, placements } = row

  const body = (
    <>
      <TileThumb
        blob={line.tile.blob}
        sprite={line.tile.sprite}
        thumb={line.tile.thumb}
        assets={assets}
        sheet={sheet}
        material={material}
        className="of-bill-thumb"
      />
      <span className="of-bill-name">
        {line.tile.name}
        <span className="of-bill-spec">
          {sizeLabel(line.tile.foot, line.tile.sizeCode)}
          {line.filenameCollides ? ` · ${line.entryName}` : ''}
        </span>
      </span>
      <span className="of-bill-figures">
        <span className="of-bill-mb">{fileSizeLabel(line.bytes)}</span>
        <span className="of-bill-count">×{String(line.quantity)}</span>
      </span>
    </>
  )

  return (
    <li className="of-bill-row">
      {placements.length === 0 ? (
        <div className="of-bill-open">{body}</div>
      ) : (
        <button
          type="button"
          className="of-bill-open"
          aria-expanded={open}
          aria-controls={listId}
          onClick={() => {
            setOpen((current) => !current)
          }}
        >
          {body}{' '}
          <VisuallyHidden>
            {`— ${open ? 'hide' : 'show'} the ${countLabel(placements.length)} ${
              placements.length === 1 ? 'placement' : 'placements'
            } of this tile`}
          </VisuallyHidden>
          {/* A chevron rather than +/−: beside a "×4" count, a plus reads as
              "add another one of these". */}
          <span className="of-bill-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
        </button>
      )}

      {open && placements.length > 0 ? (
        <ul className="of-bill-places" id={listId} role="list">
          {placements.map((entry) => (
            <PlacementRow key={entry.id} entry={entry} name={line.tile.name} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * One placement: where it is, which way round, and a way to take it off.
 *
 * The position is `describeCell` — the canvas's own spelling of a grid
 * coordinate, so the panel and the canvas's live region say the same words about
 * the same tile.
 */
function PlacementRow({ entry, name }: { entry: BillPlacement; name: string }) {
  return (
    <li className="of-bill-place">
      <span className="of-bill-at">
        {describeCell(entry.instance.x, entry.instance.z)}
        {entry.instance.rotation === 0 ? '' : ` · ${formatUnits(entry.instance.rotation)}°`}
      </span>
      <button
        type="button"
        className="of-bill-remove"
        onClick={() => {
          removePlacement(entry.id)
        }}
      >
        Remove{' '}
        {/*
          Removing takes the **whole instance** off the grid, not this one part
          of it, and the clipped text says so: a recipe is placed and rotated as
          one unit (§1), so there is no store action that removes one slot's file
          and nothing on this row could be pointed at one. Row C3's slot editor
          is where a single fill is cleared.
        */}
        <VisuallyHidden>{`the piece holding ${name} at ${describeCell(entry.instance.x, entry.instance.z)}`}</VisuallyHidden>
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ orphans */

/**
 * Instances the bill could not describe at all.
 *
 * Two reachable causes since row A3, and the block covers both because the
 * consequence is identical — the instance resolves to **no parts**, appears in no
 * line, and would otherwise sit in the scene, count towards "tiles placed" and be
 * invisible in the inventory:
 *
 *   - **The recipe is not in this build.** A saved room or an old share link can
 *     name a family a later build dropped, and `store/migrations.ts` cannot catch
 *     it — it deliberately has no access to the template table.
 *   - **Every fill has left the archive.** An instance whose slots are all empty
 *     or all name retired files has nothing to print either.
 *
 * An instance with *some* resolved parts is not here: it is a row above with a
 * hole in it, and `slot-unfilled` is the note that says so.
 */
function OrphanBlock({ orphans }: { orphans: readonly BillPlacement[] }) {
  return (
    <div className="of-bill-note" data-tone="warn">
      <strong className="of-bill-note-head">
        {countLabel(orphans.length)} placed {orphans.length === 1 ? 'piece has' : 'pieces have'}{' '}
        nothing this build can print.
      </strong>{' '}
      Either the recipe is not in this build, or every file it names has left the archive.
      <ul className="of-bill-places" role="list">
        {orphans.map((entry) => (
          <li className="of-bill-place" key={entry.id}>
            {/* The template id, which is the only identity an orphan is
                guaranteed to have: the build may hold no recipe by that id, so
                there is no name, no part list and no thumbnail to show, and the
                fills may name nothing this catalog holds either. A slug, where
                the file path this once rendered was 39 to 183 characters in a
                302px column. */}
            <span className="of-bill-at">{entry.instance.template}</span>
            <button
              type="button"
              className="of-bill-remove"
              onClick={() => {
                removePlacement(entry.id)
              }}
            >
              Remove{' '}
              <VisuallyHidden>{`the unprintable piece at ${describeCell(entry.instance.x, entry.instance.z)}`}</VisuallyHidden>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
