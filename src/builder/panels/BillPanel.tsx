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
 * Four things this panel exists to say out loud, all of them measured rather
 * than defensive:
 *
 *   1. **The total carries its verdict.** Fifty placements at the corpus median
 *      of 10.36 MB is 518 MB *before* the auto-inserted bases, and half the
 *      corpus needs one. So a bare figure in a footer would bury the fact that an
 *      ordinary room is a gigabyte download. `verdictCopy` turns
 *      `buildBillOfTiles`' verdict into the sentence, at exactly the thresholds
 *      the library screen uses.
 *   2. **Every warning note is on screen.** 377 openforge toppers in the live
 *      corpus have no base the archive can supply, in three categories with three
 *      different remedies (86 absent base, 31 unsupportable shapes, 260 with
 *      nothing to match on). Somebody printing a wall with no base gets a wall
 *      that will not stand up. Those notes are rendered in full, above the rows,
 *      with the detail visible — not behind a disclosure, and not summarised as
 *      "some warnings".
 *   3. **Auto-inserted bases are marked.** A base is a line item the user did not
 *      place and often the larger print of the pair. A row they cannot account
 *      for reads as a bug in the bill.
 *   4. **The variant the lock preference chose is named.** Row A6 put a second
 *      invisible decision above the base: a placement resolves to a *different
 *      file of the same item* when the build's lock system has a better one, and
 *      for 1,419 of 3,822 items the three systems disagree about which. So the
 *      panel carries a `Resolved for openlock` block saying what the preference
 *      did to the scene, and marks the individual rows it moved. Without those
 *      the bill would be two decisions deep with nothing said about either — and
 *      the visible symptom would be a row naming a file the user never picked.
 *
 * The `info` notes are quieter but still present, in a `<details>`: they are
 * true, and `build-unspecified` alone fires on a third of the archive, so giving
 * them the same weight as a missing base would make the missing base unreadable.
 * That is the one place this panel trades prominence for legibility, and it does
 * it in the direction that keeps the warnings loud.
 *
 * ## It is also the accessible inventory of the scene
 *
 * Row 17 was explicit that the canvas is one tab stop, has no move operation and
 * draws something that is not linearly readable. This panel closes the last of
 * that: every row expands into the placements behind it, each with its grid
 * position, its angle, and a Remove button. So a keyboard-only or screen-reader
 * user can enumerate a room and take a tile out of it without ever touching the
 * drawing. `billView.ts#billInventory` is the join that makes it possible, and
 * placements the bill cannot describe at all — a retired tile id — get their own
 * removable block rather than being silently absent.
 */
import { useId, useState } from 'react'

import type { BillOfTiles } from '@/assembly'
import type { CatalogAssets, SpriteSheet } from '@/catalog'
import { describeCell, formatUnits } from '@/builder/canvas'
import { TileThumb, countLabel, fileSizeLabel, sizeLabel } from '@/screens/catalog'
import type { Placement } from '@/store'
import { removePlacement } from '@/store'
import { Chip, Eyebrow, VisuallyHidden } from '@/ui/primitives'

import type { BillPlacement, BillRow } from './billView'
import { billInventory, noteCopy, resolutionSummary, rowResolutionCopy, verdictCopy } from './billView'
import { DownloadAction } from './DownloadAction'
import type { ArchiveDownload } from './useArchiveDownload'

import './panels.css'

export interface BillPanelProps {
  readonly bill: BillOfTiles
  /** The store's scene, for the placement ids the bill does not carry. */
  readonly placements: Readonly<Record<string, Placement>>
  readonly assets: CatalogAssets
  readonly sheet: SpriteSheet
  readonly download: ArchiveDownload
}

export function BillPanel({ bill, placements, assets, sheet, download }: BillPanelProps) {
  const headingId = useId()
  const { rows, orphans } = billInventory(bill, placements)
  const verdict = verdictCopy(bill.download)
  // What the lock preference did to the whole scene, once. Below the download
  // verdict and the warnings deliberately: it is disclosure rather than a
  // problem, and it must not push a missing base off the top of the panel.
  const resolution = resolutionSummary(bill)
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
              "the pieces that need one" rather than "every OpenForge topper":
              row A6's rule 0 resolves 1,808 of the 4,363 topper files to a
              sibling that needs no base under openlock, so the old sentence
              over-claimed for exactly the placements this panel no longer
              expands.
            */}
            {countLabel(bill.parts)} parts to print — a base is added under the pieces that need one.
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

        {resolution === null ? null : (
          <p className="of-bill-note" data-tone="resolved">
            <strong className="of-bill-note-head">{resolution.headline}.</strong> {resolution.detail}
          </p>
        )}

        {orphans.length > 0 ? <OrphanBlock orphans={orphans} /> : null}

        {rows.length === 0 ? (
          <p className="of-bill-empty">
            Nothing placed yet. Arm a tile in the palette and click the grid; the files you would
            have to print appear here as you go.
          </p>
        ) : (
          <ul className="of-bill-list" role="list">
            {rows.map((row) => (
              <BillRowView key={row.line.blob} row={row} assets={assets} sheet={sheet} />
            ))}
          </ul>
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
          <span className="of-bill-bytes" data-verdict={bill.download.verdict}>
            {fileSizeLabel(bill.download.bytes)}
          </span>
        </p>
        <DownloadAction download={download} files={bill.files} />
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
}: {
  row: BillRow
  assets: CatalogAssets
  sheet: SpriteSheet
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const { line, placements, autoBaseOnly } = row
  const resolution = rowResolutionCopy(row)

  const body = (
    <>
      <TileThumb
        blob={line.tile.blob}
        sprite={line.tile.sprite}
        assets={assets}
        sheet={sheet}
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
    <li className="of-bill-row" data-auto={autoBaseOnly ? '' : undefined}>
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

      {autoBaseOnly ? (
        <p className="of-bill-auto">
          <Chip tone="tag">base · added</Chip>{' '}
          {line.baseQuantity === 1 ? 'Added under a topper you placed' : 'Added under toppers you placed'}
          , not placed by you.
        </p>
      ) : line.baseQuantity > 0 ? (
        <p className="of-bill-auto">
          <Chip tone="tag">base · added</Chip> {countLabel(line.baseQuantity)} of these{' '}
          {line.baseQuantity === 1 ? 'copy is' : 'copies are'} an added base.
        </p>
      ) : null}

      {resolution === null ? null : (
        <p className="of-bill-auto" data-tone={resolution.tone}>
          <Chip tone="tag">{resolution.chip}</Chip> {resolution.detail}
        </p>
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
        {describeCell(entry.placement.x, entry.placement.z)}
        {entry.placement.rotation === 0 ? '' : ` · ${formatUnits(entry.placement.rotation)}°`}
      </span>
      <button
        type="button"
        className="of-bill-remove"
        onClick={() => {
          removePlacement(entry.id)
        }}
      >
        Remove{' '}
        <VisuallyHidden>{`${name} at ${describeCell(entry.placement.x, entry.placement.z)}`}</VisuallyHidden>
      </button>
    </li>
  )
}

/* ------------------------------------------------------------------ orphans */

/**
 * Placements the catalog can no longer describe.
 *
 * §2's ordinal rule retires the id of a tile that leaves the corpus, so a saved
 * room or an old share link really can name one. It resolves to no parts, so it
 * appears in no bill line — and without this block it would sit in the scene,
 * count towards "tiles placed", and be invisible in the inventory.
 */
function OrphanBlock({ orphans }: { orphans: readonly BillPlacement[] }) {
  return (
    <div className="of-bill-note" data-tone="warn">
      <strong className="of-bill-note-head">
        {countLabel(orphans.length)} placed {orphans.length === 1 ? 'tile is' : 'tiles are'} not in
        this catalog build.
      </strong>{' '}
      They cannot be drawn, priced or downloaded.
      <ul className="of-bill-places" role="list">
        {orphans.map((entry) => (
          <li className="of-bill-place" key={entry.id}>
            <span className="of-bill-at">{entry.placement.tileId}</span>
            <button
              type="button"
              className="of-bill-remove"
              onClick={() => {
                removePlacement(entry.id)
              }}
            >
              Remove{' '}
              <VisuallyHidden>{`the retired tile at ${describeCell(entry.placement.x, entry.placement.z)}`}</VisuallyHidden>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
