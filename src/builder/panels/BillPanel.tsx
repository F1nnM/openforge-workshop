/**
 * The builder's right column — design-contract.md §2.4's bill of tiles, and the
 * screen's warning surface.
 *
 * A mono eyebrow, `{n} pieces placed` over the parts and files those pieces cost,
 * one row per unique file with its thumbnail, name, size and count, then a footer
 * with the unique-model count, the total, the download action and the backup
 * line.
 *
 * ## It is the whole column, and that is a recent change
 *
 * It had two siblings in `.of-builder-bill`'s grid: a panel listing every piece
 * on the plan with its slot counts, and the JSON backup section. Three sections
 * in a fixed-height column, each capping its own height, and the parts list — the
 * one thing a reader opens this column for — paid for both. The pieces list is
 * **deleted**: it was a second enumeration of the placements the rows below
 * already expand into. The other two are inside this panel's own three bands,
 * passed in as {@link BillPanelProps.accessories} and {@link
 * BillPanelProps.backup} so this file keeps one subject.
 *
 * **Two things only that list could do, and the rows below do both now**, each
 * through a `Slots` press ({@link SlotsButton}). The plan's own route to the slot
 * editor is the action bar over the selected piece:
 *
 *   1. **It is reachable by `Tab`.** The plan's route is keyboard-operable —
 *      `Enter` on the selection — but only *through the canvas*, which is a
 *      `role="application"` with its own key map. A user navigating the page by
 *      tab needs a real `<button>` per piece, and every placement row is one.
 *   2. **It reaches a piece the plan does not draw.** A gesture on the plan can
 *      only select what is drawn, and an instance whose every slot is empty or
 *      retired resolves to no parts — `RoomSurface` walks `scene.pieces`, not
 *      `PlanScene.unfilled` — so it occupies no pixels and cannot be selected at
 *      all. {@link OrphanBlock} is the only surface in the app that can open it.
 *
 * ## It is a warning surface, not a footnote
 *
 * Two things this panel exists to say out loud, both measured rather than
 * defensive:
 *
 *   1. **The total carries its verdict**, and at 512 MB the verdict is a
 *      forecast of a refusal rather than a grumble about a slow transfer: that
 *      figure is `download/save.ts#BLOB_FALLBACK_LIMIT_BYTES` to the byte, so
 *      every browser without a streaming save declines the archive above it.
 *      `verdictCopy` turns `buildBillOfTiles`' verdict into the sentence and now
 *      says which browsers stop. **Row C4 restated both thresholds in distinct
 *      files and moved neither**, because A3's "stale by 2.58×" was an artefact
 *      of leaving the md5 dedupe out: 200 solver-filled instances of the shipped
 *      recipes are the same 36 files and the same 366,230,378 B as 50.
 *      `assembly/bill.ts#DOWNLOAD_LARGE_BYTES` carries the measurements.
 *   2. **What refuses the download is on screen in full**, above the rows, with
 *      the detail visible — not behind a disclosure and not summarised as "some
 *      warnings". That is `slot-unfilled`: every slot of every recipe in the
 *      build is required, so an empty one is a hole in the print, and
 *      `BillOfTiles.complete` is exactly its population.
 *
 *      **Every warning used to be rendered that way**, and that was right about
 *      the note it was written for and wrong as a rule for nine. `fill-off-slot`,
 *      `lock-unavailable` and `mixed-build-systems` are each true, each
 *      advisory, and each two to four lines — and three of those above the
 *      refusal at the same weight is how the refusal stops being legible. So an
 *      advisory warning gives its headline and keeps its reason one press away;
 *      `billView.ts#noteBlocksDownload` is the split, and it reads the gate
 *      rather than a judgement about tone. {@link WarningNote} renders both.
 *
 * **Two claims stood here and row A3 removed the facts behind both**, and what
 * row C4 put in their place is not a replacement in kind. The `base · added`
 * mark read `BillLine.baseQuantity`, and nothing inserts a base — a recipe
 * declares one as an ordinary slot, so every copy in the bill is a copy the scene
 * asked for. The `Resolved for openlock` block and the per-row variant marks read
 * a `VariantResolution`, and a fill names an exact file, so nothing chooses at
 * resolution time and there is no decision left to disclose. Both disclosed a
 * choice the *app* made; the scene names the files now, so the question worth
 * answering is the inverse one — **is a fill wrong** — and rule 0 could not ask
 * it. {@link SlotFaultBlock} is that surface, over `ResolvedSlotFill.admissible`
 * and the `fill-off-slot` note, and it is where a user finds out that an
 * explicitly-filled instance will print and will not fit. The one thing the
 * deleted `base · added` mark is genuinely replaced by is provenance: a `×2` on a
 * row now names the two slots that asked, from `BillLine.slots`.
 *
 * The `info` notes are quieter still and rolled up behind one `<details>`
 * together: they are true, and `build-unspecified` alone fires on a quarter of
 * what the recipes admit, so giving them the same weight as an empty slot would
 * make the empty slot unreadable.
 *
 * ## It is also the accessible inventory of the scene
 *
 * Row 17 was explicit that the canvas is one tab stop, has no move operation and
 * draws something that is not linearly readable. This panel closes the last of
 * that: every row expands into the placements behind it, each with its grid
 * position, its angle, a `Slots` button and a Remove button. So a keyboard-only
 * or screen-reader user can enumerate a room, change what is in a piece's slots
 * and take a tile out of it without ever touching the drawing — and since the
 * pieces list went, this is the *only* surface that can do the middle one
 * without a pointer. `billView.ts#billInventory` is the join that makes it possible, and
 * instances the bill cannot describe at all — a retired recipe, or a recipe whose
 * every fill has left the archive — get their own removable block rather than
 * being silently absent. An instance now expands under **every** file it
 * resolved to rather than under one, because a five-slot corner is five rows.
 */
import type { ReactNode } from 'react'
import { useId, useState } from 'react'

import type { BillLine, BillOfTiles, TemplateLookup } from '@/assembly'
import type { CatalogAssets, CatalogRecord, SpriteSheet } from '@/catalog'
import type { GeneratedBill } from '@/generator/placement/bill'
import type { MaterialId } from '@/materials'
import { describeCell, formatUnits } from '@/builder/canvas'
import { countLabel, fileSizeLabel, sizeLabel, totalBytesLabel } from '@/screens/catalog'
import type { PlacementId, TemplateInstance, WorkshopState } from '@/store'
import { removePlacement } from '@/store'
import { Eyebrow, VisuallyHidden } from '@/ui/primitives'
import { TileThumb } from '@/ui/thumb'

import type { BillPlacement, BillRow, SlotFault } from './billView'
import {
  billInventory,
  noteBlocksDownload,
  noteCopy,
  slotFaultCopy,
  slotFaults,
  slotsAsking,
  verdictCopy,
} from './billView'
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
   * The template table this build ships — the same lookup the bill was built
   * from, passed for one question: **does this placement's recipe still exist**.
   *
   * Only {@link OrphanBlock} asks it, and only because that block covers two
   * causes with one consequence. A piece in a file row or a fault row resolved
   * to at least one part, so its recipe was found by definition; a piece that
   * resolved to nothing either names a recipe this build dropped — no slots, so
   * nothing to edit — or holds only files that have left the archive, which is
   * the one state in the app that is invisible on the plan and fixable only from
   * here.
   */
  readonly templates: TemplateLookup
  /**
   * Open the slot editor on a placement.
   *
   * The panel does not own that dialog: the same one opens from the action bar
   * over the selected piece on the plan, so `BuilderScreen` holds which piece is
   * open and this is the request. It replaces the deleted "Pieces on the plan"
   * list, which was a second enumeration of the placements the rows below
   * already expand into and whose two irreplaceable properties these rows now
   * carry — see the module note: a real `<button>` per piece for a user tabbing
   * the page, and a way to reach a piece the plan does not draw.
   */
  readonly onEditSlots: (placement: PlacementId) => void
  /**
   * The accessory inventory, rendered at the foot of the scrolling band.
   *
   * A node and not a set of props, because what it needs — the catalog file and
   * the placements — this panel has no other use for, and because it answers a
   * question one level below the bill's: an accessory is a slot of a *file*, so
   * nothing in `buildBillOfTiles` counts one. It is passed rather than mounted
   * here so this file keeps one subject; `slots/AccessorySection.tsx` is the
   * component and it renders `null` for the 88.5% of plans that open nothing.
   *
   * It was a sibling of this panel in the column's grid until the sidebar was
   * cut back, in an implicit `auto` row that took its height from the parts
   * list. Inside the scroll container it takes none: it is what a reader reaches
   * after the files, which is also the order the two questions come in.
   */
  readonly accessories: ReactNode
  /**
   * The JSON export/import line, rendered in the footer under the download.
   *
   * Here for the reason `BackupPanel.tsx` gives at length: what the envelope
   * carries *is* this room, so "take this room away as files" and "take this
   * room away as a save file" are one question a step apart. A node for
   * {@link accessories}' reason — it reads and writes the store itself and needs
   * nothing from this panel — and in the footer rather than below the column so
   * a fifty-row room cannot push the only backup path in the app off screen.
   */
  readonly backup: ReactNode
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

export function BillPanel({
  bill,
  placements,
  assets,
  sheet,
  materialOf,
  download,
  templates,
  onEditSlots,
  accessories,
  backup,
  generated,
}: BillPanelProps) {
  const headingId = useId()
  const { rows, orphans } = billInventory(bill, placements)
  const verdict = verdictCopy(bill.download)
  // **Two codes are dropped from this list, and both for one reason:
  // `OrphanBlock` below is their better rendering.** It names the pieces and
  // offers to take them off the grid, where the roll-up can only count them —
  // and `unknown-template`'s detail ("take it off the grid and place the recipe
  // you want in its place") is the block's own button written as a paragraph.
  // Two surfaces saying the same sentence, one of them actionable, is worse than
  // one.
  const warnings = bill.notes.filter(
    (note) =>
      note.severity === 'warn' && note.code !== 'unknown-tile' && note.code !== 'unknown-template',
  )
  const infos = bill.notes.filter((note) => note.severity === 'info')
  // Row C4's surface, minus the instances `OrphanBlock` below already owns —
  // which is every instance that resolved to no parts at all, whether because
  // this build ships no such recipe or because every fill has left the archive.
  // That block is the better rendering for those: the whole piece has to go, not
  // one slot of it, and two blocks for one instance would put two Remove buttons
  // for it in one 302px column. An instance with *some* parts is a row above with
  // a hole in it, and it belongs here.
  const orphaned = new Set(orphans.map((entry) => entry.id))
  const faults = slotFaults(bill).filter((fault) => !orphaned.has(fault.placement))

  return (
    <aside className="of-bill" aria-labelledby={headingId}>
      <header className="of-bill-head">
        <Eyebrow as="div">Bill of tiles</Eyebrow>
        <h2 className="of-bill-title" id={headingId}>
          {/*
            **`pieces`, not `tiles` — row C4.** The count is `bill.placements`,
            which is template *instances*, and an instance is three to five files:
            128 parts over the 40 shipped recipes. "4 tiles placed" for four
            instances understated the print by a factor of three and read as a
            count of files, which is the one thing it is not. `piece` is the noun
            the rest of this panel already uses for an instance — the orphan block
            and three of the note headlines — and row C4 moved the per-*fill* note
            copy off it in the same pass, so the two nouns no longer overlap.
          */}
          {countLabel(bill.placements)} {bill.placements === 1 ? 'piece' : 'pieces'} placed
        </h2>
        {bill.placements === 0 ? null : (
          <p className="of-bill-sub">
            {/*
              Unconditional wherever anything is placed, which is the other half
              of the noun fix: the heading counts instances and this counts what
              they cost, so a reader is never left to infer one from the other.
              It was rendered only when `parts > placements`, so a scene of
              one-part instances showed no part count at all — and `parts` can be
              *below* `placements` when instances have holes in them, which is
              exactly when a reader most needs to see both.
            */}
            {countLabel(bill.parts)} {bill.parts === 1 ? 'part' : 'parts'} to print, over{' '}
            {bill.files === 1 ? 'one file' : `${countLabel(bill.files)} files`}.
          </p>
        )}
      </header>

      <div className="of-bill-scroll">
        {verdict === null ? null : (
          <p className="of-bill-note" data-tone={verdict.verdict} role="status">
            <strong className="of-bill-note-head">{verdict.headline}.</strong> {verdict.detail}
          </p>
        )}

        {warnings.map((note) => (
          <WarningNote key={note.code} note={note} />
        ))}

        {faults.length > 0 ? <SlotFaultBlock faults={faults} onEditSlots={onEditSlots} /> : null}

        {orphans.length > 0 ? (
          <OrphanBlock onEditSlots={onEditSlots} orphans={orphans} templates={templates} />
        ) : null}

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
                onEditSlots={onEditSlots}
              />
            ))}
          </ul>
        )}

        {generated === undefined ? null : (
          <GeneratedBillSection bill={generated.bill} placements={generated.placements} />
        )}

        {accessories}

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
        {backup}
      </footer>
    </aside>
  )
}

/* ------------------------------------------------------------------- notes */

/**
 * One rolled-up warning: its headline always, its reason where it is worth the
 * column.
 *
 * {@link noteBlocksDownload} is the split and it is the download gate rather
 * than a judgement about tone — see that function for why the panel stopped
 * rendering all nine in full. A `<details>` and not a hover or a tooltip: the
 * reason is two to four lines of prose, which no popup at this width can hold,
 * and a disclosure is the one control that is the same press on a phone, a
 * mouse and a keyboard.
 */
function WarningNote({ note }: { note: BillOfTiles['notes'][number] }) {
  const copy = noteCopy(note)
  if (noteBlocksDownload(note.code)) {
    return (
      <p className="of-bill-note" data-tone="warn">
        <strong className="of-bill-note-head">{copy.headline}.</strong> {copy.detail}
      </p>
    )
  }
  return (
    <details className="of-bill-note" data-tone="warn">
      <summary className="of-bill-note-head">{copy.headline}</summary>
      <span className="of-bill-note-why">{copy.detail}</span>
    </details>
  )
}

/**
 * Open the slot editor on the piece this row names.
 *
 * The same control on all three row kinds — a placement under a file row, a
 * faulty slot, and a piece that resolved to nothing — because all three name one
 * instance and the editor takes one. `Slots` alone is the visible text, so it
 * sits beside `Remove` at the same weight in a 302px column; what it is the
 * slots *of* is the clipped half, exactly as `Remove` states what it removes.
 */
function SlotsButton({
  onEditSlots,
  placement,
  subject,
}: {
  onEditSlots: (placement: PlacementId) => void
  placement: PlacementId
  subject: string
}) {
  return (
    <button
      type="button"
      className="of-bill-remove"
      onClick={() => {
        onEditSlots(placement)
      }}
    >
      Slots <VisuallyHidden>{subject}</VisuallyHidden>
    </button>
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
  onEditSlots,
}: {
  row: BillRow
  assets: CatalogAssets
  sheet: SpriteSheet
  material: MaterialId
  onEditSlots: (placement: PlacementId) => void
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
            <PlacementRow
              key={entry.id}
              entry={entry}
              line={line}
              name={line.tile.name}
              onEditSlots={onEditSlots}
            />
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
function PlacementRow({
  entry,
  line,
  name,
  onEditSlots,
}: {
  entry: BillPlacement
  line: BillLine
  name: string
  onEditSlots: (placement: PlacementId) => void
}) {
  // **Row C4: `BillLine.slots`' first consumer.** A quantity above one is
  // legitimate under templates (contract C-c) — two slots of one instance can
  // resolve to the same md5 — and before this the row said `×2` with one
  // placement under it and no way to account for the second copy. Named only
  // when there is more than one, so the ordinary single-ask row stays quiet.
  const asking = slotsAsking(line, entry.id)
  return (
    <li className="of-bill-place">
      <span className="of-bill-at">
        {describeCell(entry.instance.x, entry.instance.z)}
        {entry.instance.rotation === 0 ? '' : ` · ${formatUnits(entry.instance.rotation)}°`}
        {asking.length > 1 ? ` · ${asking.join(' + ')}` : ''}
      </span>
      <span className="of-bill-acts">
        {/*
          Row-level and not one control per file, for `Remove`'s reason inverted:
          the editor takes a **piece** and offers every slot of it, and the row
          already names one. It is the deleted panel's keyboard route, which was
          that panel's one irreplaceable property — see {@link SlotsButton}.
        */}
        <SlotsButton
          onEditSlots={onEditSlots}
          placement={entry.id}
          subject={`of the piece holding ${name} at ${describeCell(entry.instance.x, entry.instance.z)}`}
        />
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
            of it, and the clipped text says so: a recipe is placed and rotated
            as one unit (§1), so there is no store action that removes one slot's
            file and nothing on this row could be pointed at one. The slot editor
            beside it is where a single fill is cleared.
          */}
          <VisuallyHidden>{`the piece holding ${name} at ${describeCell(entry.instance.x, entry.instance.z)}`}</VisuallyHidden>
        </button>
      </span>
    </li>
  )
}

/* --------------------------------------------------------------- slot faults */

/**
 * Every slot in the scene that is empty, retired, or holding a file it does not
 * admit — one line each, and a way to reach the piece.
 *
 * **This is the answer to the question row A3 left open and row A8 declined to
 * invent.** Three surfaces were deleted from this panel because the facts behind
 * them stopped being computed, and all three disclosed a *choice the app had
 * made*: the `Resolved for openlock` block, the per-row variant marks and the
 * `base · added` mark. Nothing is chosen and nothing is inserted, so there was
 * nothing to replace them with in kind. What replaced them is the inverse
 * question, which the pre-A3 resolver could not ask: **the scene names the files,
 * so the scene can be wrong**, and until this block a user's only trace of that
 * was a rolled-up note saying how many slots were wrong and nothing about which.
 *
 * Two tones, and the split is `SlotFault.blocksDownload` — which is §7's line
 * drawn where the user meets it. An empty or retired slot means the pack is one
 * file short of a printable model and the download is refused; a fill the slot
 * does not admit will print and will not fit, and the download goes ahead. A
 * reader is told which of the two they are looking at rather than being handed
 * one undifferentiated list of problems.
 *
 * **`countLabel(faults.length)` counts slots, not pieces**, and the copy says
 * "slots" for the same reason `noteCopy` now says "files": one instance can
 * contribute five entries here, so a count of entries is never a count of things
 * on the grid.
 */
function SlotFaultBlock({
  faults,
  onEditSlots,
}: {
  faults: readonly SlotFault[]
  onEditSlots: (placement: PlacementId) => void
}) {
  const blocking = faults.filter((fault) => fault.blocksDownload).length
  return (
    <div className="of-bill-note" data-tone="warn">
      <strong className="of-bill-note-head">
        {countLabel(faults.length)} {faults.length === 1 ? 'slot needs' : 'slots need'} attention.
      </strong>{' '}
      {blocking === 0
        ? 'These will print and will not fit. The download is not refused over them.'
        : blocking === faults.length
          ? 'The download is refused until each one holds a file.'
          : `${countLabel(blocking)} of them ${blocking === 1 ? 'refuses' : 'refuse'} the download; the rest will print and will not fit.`}
      <ul className="of-bill-faults" role="list">
        {faults.map((fault) => (
          <SlotFaultRow
            key={`${fault.placement}/${fault.slot ?? ''}`}
            fault={fault}
            onEditSlots={onEditSlots}
          />
        ))}
      </ul>
    </div>
  )
}

/**
 * One faulty slot: which recipe, which slot, where on the plan, and what is
 * wrong with it.
 *
 * The cell is `describeCell` — the canvas's own spelling — so this and the plan's
 * live region say the same words about the same piece. Remove takes the **whole
 * instance** off the grid rather than clearing the one fill, for the reason
 * `PlacementRow` gives: a recipe is placed and rotated as one unit and there is
 * no store action that empties a single slot. Row C3's slot editor is where a
 * fill is re-chosen in place, and the two surfaces are complementary — this one
 * says a slot is wrong from a panel that lists the whole scene, that one fixes it.
 */
function SlotFaultRow({
  fault,
  onEditSlots,
}: {
  fault: SlotFault
  onEditSlots: (placement: PlacementId) => void
}) {
  const copy = slotFaultCopy(fault)
  const at = describeCell(fault.instance.x, fault.instance.z)
  return (
    <li className="of-bill-fault" data-blocking={fault.blocksDownload ? '' : undefined}>
      <span className="of-bill-fault-head">
        <span className="of-bill-at">
          {copy.subject} · {at}
        </span>
        <span className="of-bill-acts">
          {/* The editor is the *fix* for every one of the three faults — an
              empty slot, a retired fill and a fill the slot does not admit are
              all answered by choosing a file — so this row is the one place in
              the panel where it is the obvious next press rather than an
              alternative to removing the piece. */}
          <SlotsButton
            onEditSlots={onEditSlots}
            placement={fault.placement}
            subject={`of the piece with the faulty ${fault.slot ?? 'recipe'} at ${at}`}
          />
          <button
            type="button"
            className="of-bill-remove"
            onClick={() => {
              removePlacement(fault.placement)
            }}
          >
            Remove{' '}
            <VisuallyHidden>{`the piece with the faulty ${fault.slot ?? 'recipe'} at ${at}`}</VisuallyHidden>
          </button>
        </span>
      </span>
      <span className="of-bill-fault-why">{copy.reason}</span>
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
function OrphanBlock({
  onEditSlots,
  orphans,
  templates,
}: {
  onEditSlots: (placement: PlacementId) => void
  orphans: readonly BillPlacement[]
  templates: TemplateLookup
}) {
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
            {/*
              **The one row in the panel where this control is conditional, and
              the condition is which of the block's two causes this piece is.**
              A recipe this build dropped has no slots, so there is nothing for
              an editor to open on and a disabled button would be one more thing
              to read and dismiss in a 302px column. A piece whose every fill has
              left the archive still has its recipe and all of its slots — and it
              is drawn nowhere on the plan, so before this there was no way to
              reach it at all once the pieces list went.
            */}
            <span className="of-bill-acts">
              {templates(entry.instance.template) === undefined ? null : (
                <SlotsButton
                  onEditSlots={onEditSlots}
                  placement={entry.id}
                  subject={`of the piece at ${describeCell(entry.instance.x, entry.instance.z)}`}
                />
              )}
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
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
