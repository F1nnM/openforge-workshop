/**
 * Export and import the workshop as a JSON file — the app's only backup path.
 *
 * ## Why this exists
 *
 * architecture-plan.md §13: **Safari evicts `localStorage` after seven days
 * without a visit.** For a tool opened between game sessions that is not an edge
 * case, it is the ordinary case — a fortnight between two evenings of prep is a
 * normal gap — so the persisted store is a cache, not storage. `src/store/
 * transfer.ts` shipped the two total functions in the first commit for that
 * reason; this component is the surface they were written for. Without it the
 * feature exists and no user can reach it.
 *
 * ## Why it is here, at the foot of the builder's right-hand column
 *
 * It was `screens/library/LibraryTransfer.tsx`, and row **A0** deleted that
 * screen. Deleting the route without moving this first would have removed the
 * only way to get a room off the machine, which is why the templates plan makes
 * the move a hard sequencing constraint (§3.4.1) rather than a tidy-up.
 *
 * Three homes were possible and this is the one the panels actually support:
 *
 *   - **`/settings` is gone** — row L1 deleted the route and put the lock
 *     preference in the builder's work area, so there is no preferences screen to
 *     be the natural drawer of a preferences-shaped control.
 *   - **`PlanToolbar` is a floating plate** over the 3D stage, and row L1
 *     measured a real collision in that band: `Place` was 100% unclickable at
 *     1295px before the gutter was reserved. Two more controls in a horizontal
 *     strip that tight would re-create that.
 *   - **The bill column is what a backup is *of*.** What the JSON carries is the
 *     room — `WorkshopState.placements`, the generated bases and the lock
 *     preference — and this column is already everything about the room that is
 *     not the surface: the lock notice, the parts list, the download, the
 *     accessory slots. "Take this room away as files" and "take this room away as
 *     a save file" are the same question one step apart, so they are one column
 *     apart and not one screen apart.
 *
 * It is the column's last child and it is deliberately compact — a heading, one
 * sentence, two controls — because `.of-builder-bill` is a fixed-height grid
 * whose `1fr` row is the bill, and every pixel this takes is a pixel of parts
 * list. The import report is the one thing that can grow, and it only exists
 * after a press.
 *
 * Both controls render whether or not anything is placed, because the visit where
 * import matters most is precisely the one that opens on an empty room after an
 * eviction.
 *
 * ## Import reports; it never silently succeeds
 *
 * {@link importWorkshop} returns a result rather than throwing, and salvages
 * per-entry: a file with one bad placement imports the other thirty and names the
 * one it dropped. All three outcomes are surfaced:
 *
 *   - **not ours / not JSON** — the reason, in an `alert`. Nothing changed.
 *   - **imported, nothing dropped** — the new count, in a `status`.
 *   - **imported, something dropped** — the count *and* every discarded entry,
 *     listed. A recovery that quietly returns a room one tile short is
 *     indistinguishable, to the person who built it, from having mis-remembered
 *     placing it.
 *
 * Import **replaces** rather than merges (see `src/store/transfer.ts` for why),
 * which is stated on the screen rather than left for the user to discover after
 * losing a scene.
 */
import type { ChangeEvent } from 'react'
import { useId, useState } from 'react'

import { exportWorkshop, importWorkshop, useWorkshopStore } from '@/store'
import { Button, Eyebrow, buttonProps } from '@/ui/primitives'

import './panels.css'

/** What the last import did. `null` until the user runs one. */
type ImportReport =
  | { readonly ok: true; readonly placements: number; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/** Discarded entries listed in full before the tail is summarised. */
const DROPPED_SHOWN = 6

export function BackupPanel() {
  const headingId = useId()
  const [report, setReport] = useState<ImportReport | null>(null)

  function onExport(): void {
    const stamp = new Date().toISOString().slice(0, 10)
    saveJsonFile(`openforge-workshop-${stamp}.json`, exportWorkshop())
    // A previous import's report describes state this export has just written
    // out; leaving it up would attach that message to the wrong action.
    setReport(null)
  }

  async function onImport(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    // Cleared before anything else, so picking the *same* file again still fires
    // `change`. Without this, a user who fixes their file by hand and re-picks it
    // gets no response at all.
    event.target.value = ''
    if (file === undefined) return

    let text: string
    try {
      text = await file.text()
    } catch {
      setReport({ ok: false, reason: 'That file could not be read.' })
      return
    }

    const result = importWorkshop(text)
    if (!result.ok) {
      setReport({ ok: false, reason: result.reason })
      return
    }

    // Counted from the store rather than from the file: what the user needs
    // confirmed is what they now have, and salvage means the two can differ.
    //
    // One count, not two. It read the saved-tile count beside it until row A0
    // deleted the library the count came from; the room is what the envelope is
    // for and it is now the whole of what it can report.
    const state = useWorkshopStore.getState()
    setReport({
      ok: true,
      placements: Object.keys(state.placements).length,
      dropped: result.dropped,
    })
  }

  return (
    <section className="of-backup" aria-labelledby={headingId}>
      <h3 className="of-backup-heading" id={headingId}>
        <Eyebrow>Backup</Eyebrow>
      </h3>

      <p className="of-backup-note">
        Your build lives in this browser, and browsers do clear that storage — Safari after a week
        without a visit. Keep a JSON copy between sessions. Importing <strong>replaces</strong> what
        is here.
      </p>

      <div className="of-backup-actions">
        <Button size="sm" tone="secondary" onClick={onExport}>
          Export JSON
        </Button>

        {/*
          A real file input inside its label, not a button that clicks a hidden
          one: the native control is the only thing that can open a file picker,
          and driving it from JavaScript costs the keyboard path and the
          accessible name. It is clipped by `.of-sr-only` rather than
          `display: none`, which would take it out of the tab order — and it is
          nested, so the CSS can put the focus ring on the label the user can
          actually see.
        */}
        <label {...buttonProps({ tone: 'secondary', size: 'sm' })}>
          <span>Import JSON</span>
          <input
            className="of-sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              void onImport(event)
            }}
          />
        </label>
      </div>

      {report === null ? null : <ImportOutcome report={report} />}
    </section>
  )
}

/* -------------------------------------------------------------- the outcome */

function ImportOutcome({ report }: { report: ImportReport }) {
  if (!report.ok) {
    return (
      <p className="of-backup-report" data-tone="error" role="alert">
        {report.reason} Nothing was changed.
      </p>
    )
  }

  const shown = report.dropped.slice(0, DROPPED_SHOWN)
  const hidden = report.dropped.length - shown.length

  return (
    <div className="of-backup-report" data-tone={report.dropped.length > 0 ? 'warn' : 'ok'} role="status">
      <p className="of-backup-report-line">
        Imported {report.placements} {report.placements === 1 ? 'placement' : 'placements'}.
      </p>

      {report.dropped.length > 0 ? (
        <>
          <p className="of-backup-report-line">
            {report.dropped.length} {report.dropped.length === 1 ? 'entry' : 'entries'} could not be
            read and {report.dropped.length === 1 ? 'was' : 'were'} discarded:
          </p>
          <ul className="of-backup-dropped">
            {shown.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
            {hidden > 0 ? <li data-tone="more">and {hidden} more</li> : null}
          </ul>
        </>
      ) : null}
    </div>
  )
}

/* --------------------------------------------------------------- the download */

/**
 * Hand the user a file.
 *
 * An object URL on a synthesised anchor, which is the only download route a
 * static page has: `showSaveFilePicker` is Chromium-only, and PR 11 rejected
 * `native-file-system-adapter` because its service-worker fallback truncates
 * unobservably. The anchor is attached before it is clicked — a detached one is
 * ignored by Firefox — and the URL is revoked on the next task rather than
 * immediately, because Safari fetches the blob asynchronously after `click()`
 * and a synchronous revoke gives it a zero-byte file.
 */
function saveJsonFile(name: string, json: string): void {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
