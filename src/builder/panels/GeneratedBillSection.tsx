/**
 * The bill's generated section — row S5's `GeneratedBill`, rendered.
 *
 * A separate file rather than more of `BillPanel.tsx`, for two reasons that both
 * turned out to matter. The panel is already 360 lines and four warning
 * surfaces; and the file is contested — row P3 is adding one prop to a
 * `<TileThumb>` in it while this row lands — so a section that is one import and
 * one element in that file is a diff a human can reconcile by eye.
 *
 * ## Why it is a section and not more rows in the list
 *
 * `buildBillOfTiles` and `buildGeneratedBill` answer different questions and
 * neither can answer the other's. A catalog row is keyed by **md5** and names a
 * `CatalogRecord`; a generated row is keyed by **recipe** and names no published
 * file at all. Interleaving them would need one of the two to pretend: either a
 * generated base gets a thumbnail and a catalog path it has not got, or a
 * catalogued tile grows a parameter list. Row S5 was explicit that
 * `billView.ts` needs nothing, because generated placements never enter it.
 *
 * So the section states its own terms once, at the top, and then reads like the
 * rest of the panel.
 *
 * ## Three things it must say, and they are all refusals waiting to happen
 *
 *   1. **An unrendered base is a warning, not a footnote.** The recipe persists
 *      and the mesh does not, so *every generated base comes back unrendered
 *      after a reload* — which means this is the ordinary state, not an edge one,
 *      and the download refuses over it. A user who did not know that would meet
 *      `GeneratedMeshMissingError` with no idea why.
 *   2. **A base whose basis is not the grid's will not tile.** A `wyloch` 2×2 is
 *      2.5 grid squares. Row S5 draws it at its real size rather than
 *      understating a physical object by 25%, and the disclosure is that it will
 *      not snap to the lattice.
 *   3. **Provenance, in full, never summarised.** A generated line cites the
 *      pinned Apache-2.0 geometry, its own digest with S3's caveat attached, and
 *      why it was generated — and it never names a published file as the thing
 *      you print. Those sentences are `provenance.ts`'s, rendered verbatim; this
 *      component composes none of them, which is the point of that module having
 *      no imports.
 *
 * The parameter list is behind a `<details>` and the provenance is not. Every
 * `-D` is disclosed rather than summarised — 8 to 15 of them per base — and a
 * fifteen-row table above the warnings would bury them; the provenance is three
 * sentences and is the claim itself.
 *
 * ## What is not here
 *
 * **No download-this-mesh link.** The bytes are in `src/store/meshes.ts` and a
 * per-row link would need an object URL per row with a lifetime to manage, for a
 * thing the generator drawer already offers on the base it is showing. The pack
 * is the answer for a plan.
 *
 * **No re-render button.** It would need the engine — 10.5 MB behind two lazy
 * boundaries — in the bill panel, and the panel is eager. Opening the generator
 * is one press and it is where the parameters are.
 */
import { useId, useState } from 'react'

import { describeCell, formatUnits } from '@/builder/canvas'
import type { GeneratedBill, GeneratedBillLine } from '@/generator/placement/bill'
import { countLabel, fileSizeLabel } from '@/screens/catalog'
import type { PlacementId, WorkshopState } from '@/store'
import { removeGeneratedPlacement } from '@/store'
import { Chip, Eyebrow, VisuallyHidden } from '@/ui/primitives'

export interface GeneratedBillSectionProps {
  readonly bill: GeneratedBill
  /** The store's generated map, for the position of each placement behind a row. */
  readonly placements: WorkshopState['generated']
}

export function GeneratedBillSection({ bill, placements }: GeneratedBillSectionProps) {
  const headingId = useId()
  if (bill.lines.length === 0) return null

  return (
    <section className="of-gbill" aria-labelledby={headingId}>
      <header className="of-gbill-head">
        <Eyebrow as="div">Generated bases</Eyebrow>
        <h3 className="of-gbill-title" id={headingId}>
          {countLabel(bill.copies)} {bill.copies === 1 ? 'base' : 'bases'} to print, from{' '}
          {countLabel(bill.recipes)} {bill.recipes === 1 ? 'recipe' : 'recipes'}
        </h3>
        <p className="of-gbill-sub">
          {/*
            Deliberately not folded into the bill's `DownloadSize` verdict, which
            is calibrated on *fetch* cost — 512 MB is fifty median corpus tiles
            over the network. These bytes are already in memory. What they do
            change is the size of the finished zip, which the download's own
            progress bar reports exactly.
          */}
          {fileSizeLabel(bill.bytes)} of mesh, held in this browser. Not fetched, so not counted in
          the download verdict above.
        </p>
      </header>

      {bill.unrendered === 0 ? null : (
        <p className="of-bill-note" data-tone="warn" role="status">
          <strong className="of-bill-note-head">
            {countLabel(bill.unrendered)}{' '}
            {bill.unrendered === 1 ? 'recipe has' : 'recipes have'} no mesh yet.
          </strong>{' '}
          {bill.unrendered === 1 ? 'It is' : 'They are'} on the plan and not in the download, and the
          download will refuse rather than save a pack {bill.unrendered === 1 ? 'a' : 'that many'}{' '}
          file{bill.unrendered === 1 ? '' : 's'} short. A saved build always starts here: the recipe
          is kept and the mesh is not, because a mesh is megabytes and is only valid for the engine
          build that produced it. Open the generator on each one to render it.
        </p>
      )}

      <ul className="of-bill-list" role="list">
        {bill.lines.map((line) => (
          <GeneratedRow key={line.base} line={line} placements={placements} />
        ))}
      </ul>
    </section>
  )
}

/* --------------------------------------------------------------------- rows */

function GeneratedRow({
  line,
  placements,
}: {
  line: GeneratedBillLine
  placements: WorkshopState['generated']
}) {
  const listId = useId()
  const [open, setOpen] = useState(false)

  return (
    <li className="of-bill-row of-gbill-row" data-severity={line.severity}>
      <button
        type="button"
        className="of-bill-open"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        {/*
          A mono handle where a catalog row has a thumbnail. There is no sprite
          for a base that does not exist in the archive, and a placeholder tile
          would be the panel implying one; row S4's own footer identifies a
          recipe by this same 8-character handle, so the two agree.
        */}
        <span className="of-gbill-handle" aria-hidden="true">
          {line.recipeId}
        </span>
        <span className="of-bill-name">
          {line.name}
          <span className="of-bill-spec">
            {line.size} squares · {line.material}
            {line.foot.tiles ? '' : ` · ${String(line.foot.basisMm)} mm/square`}
          </span>
        </span>
        <span className="of-bill-figures">
          <span className="of-bill-mb">
            {line.mesh === null ? 'no mesh' : fileSizeLabel(line.mesh.bytes)}
          </span>
          <span className="of-bill-count">×{String(line.quantity)}</span>
        </span>
        <VisuallyHidden>
          {`, recipe ${line.recipeId} — ${open ? 'hide' : 'show'} its parameters, provenance and the ${countLabel(
            line.placements.length,
          )} ${line.placements.length === 1 ? 'place it is' : 'places it is'} on the plan`}
        </VisuallyHidden>
        <span className="of-bill-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {line.mesh === null ? (
        <p className="of-bill-auto" data-tone="warn">
          <Chip tone="tag">not rendered</Chip> On the plan, not in the download.
        </p>
      ) : (
        <p className="of-bill-auto">
          <Chip tone="tag">rendered here</Chip>{' '}
          {line.mesh.triangles.toLocaleString('en-GB')} triangles · md5{' '}
          {line.mesh.md5.slice(0, 8)}
        </p>
      )}

      {open ? (
        <div className="of-gbill-detail" id={listId}>
          {/*
            Every sentence here is `provenance.ts`'s, unmodified. The claim this
            row is least allowed to get wrong is that a generated mesh is not the
            archive's file, and the way to not get it wrong is to have exactly
            one wording of it in the repository.
          */}
          {line.provenance.map((sentence) => (
            <p className="of-gbill-prov" key={sentence}>
              {sentence}
            </p>
          ))}

          <details className="of-gbill-params">
            <summary>
              {countLabel(line.parameters.length)} parameter
              {line.parameters.length === 1 ? '' : 's'}, as passed
            </summary>
            <dl className="of-gbill-plist">
              {line.parameters.map((parameter) => (
                <div className="of-gbill-param" key={parameter.name}>
                  <dt>{parameter.name}</dt>
                  <dd>{parameter.value}</dd>
                </div>
              ))}
            </dl>
          </details>

          <ul className="of-bill-places" role="list">
            {line.placements.map((id) => (
              <GeneratedPlacementRow key={id} id={id} name={line.name} placements={placements} />
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  )
}

/**
 * One placed copy: where it is, which way round, and a way to take it off.
 *
 * The position comes from the store rather than from the bill line, which
 * carries ids only — the same join `billView.ts#billInventory` makes for the
 * catalog half, and for the same reason: a bill row is one per *thing to print*
 * and a scene has many copies of it.
 *
 * Removing here releases the held mesh when it orphans it — see
 * `src/store/meshes.ts`. That is the only way a session gets its memory back, so
 * this button is not merely a convenience for a keyboard user; it is the release
 * path.
 */
function GeneratedPlacementRow({
  id,
  name,
  placements,
}: {
  id: PlacementId
  name: string
  placements: WorkshopState['generated']
}) {
  const placement = placements[id]
  if (placement === undefined) return null
  const at = describeCell(placement.x, placement.z)

  return (
    <li className="of-bill-place">
      <span className="of-bill-at">
        {at}
        {placement.rotation === 0 ? '' : ` · ${formatUnits(placement.rotation)}°`}
      </span>
      <button
        type="button"
        className="of-bill-remove"
        onClick={() => {
          removeGeneratedPlacement(id)
        }}
      >
        Remove <VisuallyHidden>{`${name} at ${at}`}</VisuallyHidden>
      </button>
    </li>
  )
}
