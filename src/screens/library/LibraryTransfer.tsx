/**
 * Export and import the workshop as a JSON file.
 *
 * ## Why this exists, and why it is on this screen
 *
 * architecture-plan.md §13: **Safari evicts `localStorage` after seven days
 * without a visit.** For a tool opened between game sessions that is not an edge
 * case, it is the ordinary case — a fortnight between two evenings of prep is a
 * normal gap — so the persisted store is a cache, not storage. `src/store/
 * transfer.ts` shipped the two total functions in the first commit for that
 * reason; this component is the surface they were written for. Without it the
 * feature exists and no user can reach it.
 *
 * The library is its natural home: it is the screen that shows what the saved
 * state *is*, so it is where "keep a copy of this" and "put a copy back" belong.
 * Both controls are rendered whether or not the library holds anything, because
 * the visit where import matters most is precisely the one that opens on an empty
 * library after an eviction.
 *
 * ## Import reports; it never silently succeeds
 *
 * {@link importWorkshop} returns a result rather than throwing, and salvages
 * per-entry: a file with one bad placement imports the other thirty and names the
 * one it dropped. All three outcomes are surfaced:
 *
 *   - **not ours / not JSON** — the reason, in an `alert`. Nothing changed.
 *   - **imported, nothing dropped** — the new counts, in a `status`.
 *   - **imported, something dropped** — the counts *and* every discarded entry,
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
import { Eyebrow } from '@/ui/primitives'

/** What the last import did. `null` until the user runs one. */
type ImportReport =
  | { readonly ok: true; readonly tiles: number; readonly placements: number; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly reason: string }

/** Discarded entries listed in full before the tail is summarised. */
const DROPPED_SHOWN = 6

export function LibraryTransfer() {
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
    const state = useWorkshopStore.getState()
    setReport({
      ok: true,
      tiles: Object.keys(state.library).length,
      placements: Object.keys(state.placements).length,
      dropped: result.dropped,
    })
  }

  return (
    <section className="of-lib-transfer" aria-labelledby={headingId}>
      <h2 className="of-lib-transfer-heading" id={headingId}>
        <Eyebrow>Backup</Eyebrow>
      </h2>

      <p className="of-lib-transfer-note">
        Your library and your build live in this browser, and browsers do clear
        that storage — Safari after a week without a visit. Keep a JSON copy
        between sessions. Importing <strong>replaces</strong> what is here.
      </p>

      <div className="of-lib-transfer-actions">
        <button type="button" className="of-lib-action" data-tone="secondary" onClick={onExport}>
          Export JSON
        </button>

        {/*
          A real file input inside its label, not a button that clicks a hidden
          one: the native control is the only thing that can open a file picker,
          and driving it from JavaScript costs the keyboard path and the
          accessible name. It is clipped by `.of-sr-only` rather than
          `display: none`, which would take it out of the tab order — and it is
          nested, so the CSS can put the focus ring on the label the user can
          actually see.
        */}
        <label className="of-lib-action" data-tone="secondary">
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
      <p className="of-lib-transfer-report" data-tone="error" role="alert">
        {report.reason} Nothing was changed.
      </p>
    )
  }

  const shown = report.dropped.slice(0, DROPPED_SHOWN)
  const hidden = report.dropped.length - shown.length

  return (
    <div className="of-lib-transfer-report" data-tone={report.dropped.length > 0 ? 'warn' : 'ok'} role="status">
      <p className="of-lib-transfer-report-line">
        Imported {report.tiles} {report.tiles === 1 ? 'tile' : 'tiles'} and {report.placements}{' '}
        {report.placements === 1 ? 'placement' : 'placements'}.
      </p>

      {report.dropped.length > 0 ? (
        <>
          <p className="of-lib-transfer-report-line">
            {report.dropped.length} {report.dropped.length === 1 ? 'entry' : 'entries'} could not be read and{' '}
            {report.dropped.length === 1 ? 'was' : 'were'} discarded:
          </p>
          <ul className="of-lib-dropped">
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
