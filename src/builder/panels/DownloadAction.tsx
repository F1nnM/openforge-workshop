/**
 * design-contract.md §2.4's "⬇ Download tile pack", wired to the real thing.
 *
 * The contract's caption said the mock emits a JSON manifest and that production
 * must emit a zip. This is production: `@/download` streams a real archive with
 * `LICENSE.txt` and `ATTRIBUTION.csv` as its first two entries and one copy of
 * each distinct md5, so the caption now says what is actually in the file.
 *
 * ## Every state is on screen, and a failure names itself
 *
 * The button has five: idle, preparing (a plan exists, the file picker may be
 * open), running (bytes and entries, from the stream's own progress), saved, and
 * failed. `useArchiveDownload` classifies each typed error into a headline and a
 * detail; this component renders them and adds the affordances that depend on
 * which failure it was — a retry where retrying could work, and for an archive
 * too large for the browser to buffer, the room as several smaller zips plus
 * §11's URL-list degradation path behind it.
 *
 * ## The split parts are a sequence of presses, and the panel is what sequences it
 *
 * A split download is N saves, and each needs its own user gesture or the
 * second file picker is popup-blocked. So the panel offers one button at a
 * time: "save as N smaller files" on the failure, then "save part k+1 of N"
 * beside each part that lands, then "saved all N parts". It reads
 * `download.splitPlans` rather than the failure, because the failure is gone
 * once the first part saves — `useArchiveDownload`'s note argues that placement.
 *
 * ## Why the progress bar is a `<progress>`
 *
 * `plan.predictedLength` is exact to the byte — nothing in the archive is
 * compressed — so the ratio is honest and a determinate bar is the correct
 * element. A div with a width would have to reinvent `aria-valuenow`,
 * `aria-valuemax` and the announcement, all of which the element already has.
 */
import { fileSizeLabel } from '@/screens/catalog'
import { Button, VisuallyHidden } from '@/ui/primitives'

import type { ArchiveDownload } from './useArchiveDownload'

export interface DownloadActionProps {
  readonly download: ArchiveDownload
  /** Distinct files in the bill. */
  readonly files: number
  /**
   * Distinct generated recipes on the plan. Defaults to none.
   *
   * The button's disabled test is `files + generated === 0`, not `files === 0`,
   * and the difference is a real room: a plan built entirely out of generated
   * bases has no catalog files at all and is still a download. Row S5 made
   * `buildArchivePlan` accept exactly that — *"a room built entirely out of
   * generated bases is a real room, and refusing it would be this function
   * reporting 'nothing to download' about something"* — and a button that stayed
   * greyed out would have made that unreachable from the UI, which is the shape
   * of regression this row exists to close.
   */
  readonly generated?: number
}

export function DownloadAction({ download, files, generated = 0 }: DownloadActionProps) {
  const { state } = download
  const busy = state.status === 'preparing' || state.status === 'running'
  const nothing = files + generated === 0

  return (
    <div className="of-bill-download">
      {state.status === 'failed' ? (
        <div className="of-bill-fail" role="alert" data-kind={state.failure.kind}>
          <strong className="of-bill-note-head">{state.failure.headline}.</strong>{' '}
          {state.failure.detail}
          <span className="of-bill-fail-actions">
            {/*
              The split offer comes before the URL list because it is the better
              answer: N real zips rather than a text file of md5-named URLs to
              feed a download manager by hand. It is absent when
              `splitArchivePlans` found no packing — one file already over the
              limit — and then the URL list is the only offer, as it always was.
            */}
            {state.failure.kind === 'too-large' && state.failure.splitPlans !== undefined ? (
              <Button
                size="sm"
                onClick={() => {
                  download.saveSplitPart(0)
                }}
              >
                Save as {state.failure.splitPlans.length} smaller files
              </Button>
            ) : null}
            {state.failure.kind === 'too-large' && state.failure.plan !== undefined ? (
              <Button size="sm" onClick={download.saveUrlList}>
                Take the URL list{' '}
                <VisuallyHidden>and the attribution table instead</VisuallyHidden>
              </Button>
            ) : null}
            {state.failure.retryable ? (
              <Button size="sm" onClick={download.start}>
                Try again
              </Button>
            ) : null}
            <Button size="sm" onClick={download.dismiss}>
              Dismiss
            </Button>
          </span>
          {/*
            §11's URL list is the honest answer for a room too large to stream,
            and it has nothing to say about a mesh that was never published —
            there is no URL, because the bytes were made in this browser. Row
            S5's `urlListShortfall` is that sentence and it is rendered *beside
            the offer*, not after it is taken: a download manager handed a list
            that silently omits four of the files is the degradation path failing
            quietly, which is worse than the size limit it was working around.
          */}
          {state.failure.urlListShortfall === undefined ? null : (
            <span className="of-bill-fail-note">{state.failure.urlListShortfall}</span>
          )}
        </div>
      ) : null}

      {state.status === 'saved' ? (
        <p className="of-bill-saved" role="status">
          Saved <span className="of-bill-file">{state.filename}</span> —{' '}
          {fileSizeLabel(state.bytes)}
          {state.via === 'blob' ? ', buffered in memory' : ', streamed straight to disk'}.
        </p>
      ) : null}

      {/*
        The next part, offered rather than fired. A second save with no user
        gesture between it and the first is what a popup blocker exists to stop,
        so the sequence is one press per part — see `useArchiveDownload`'s note.

        Read off `download.splitPlans` together with `state.part` because the
        failure that first carried the parts is gone by now: saving part 1 moved
        `state` to `'saved'`.
      */}
      {download.splitPlans !== undefined && state.status === 'saved' && state.part !== undefined
        ? (() => {
            // Bound here because TypeScript cannot see the guard above still
            // holds inside `onClick`'s closure.
            const part = state.part
            return part.index + 1 < part.of ? (
              <p className="of-bill-progress-text" role="status">
                Saved part {part.index + 1} of {part.of} —{' '}
                <Button
                  size="sm"
                  onClick={() => {
                    download.saveSplitPart(part.index + 1)
                  }}
                >
                  Save part {part.index + 2} of {part.of}
                </Button>
              </p>
            ) : (
              <p className="of-bill-saved" role="status">
                Saved all {part.of} parts.
              </p>
            )
          })()
        : null}

      {state.status === 'running' ? (
        <p className="of-bill-progress">
          <progress
            className="of-bill-bar"
            value={state.bytesWritten}
            max={state.plan.predictedLength}
          >
            {fileSizeLabel(state.bytesWritten)} of {fileSizeLabel(state.plan.predictedLength)}
          </progress>
          <span className="of-bill-progress-text">
            {state.part === undefined
              ? null
              : `Part ${String(state.part.index + 1)} of ${String(state.part.of)} — `}
            {fileSizeLabel(state.bytesWritten)} of {fileSizeLabel(state.plan.predictedLength)} ·
            file {String(Math.min(state.entriesStarted, state.entries))} of{' '}
            {String(state.entries)}
          </span>
        </p>
      ) : null}

      {state.status === 'preparing' ? (
        <p className="of-bill-progress-text" role="status">
          {fileSizeLabel(state.plan.predictedLength)} ready — choose where to save it.
        </p>
      ) : null}

      <Button
        tone="primary"
        full
        disabled={nothing || busy}
        onClick={download.start}
        aria-busy={busy || undefined}
      >
        <span aria-hidden="true">⬇</span>
        <span>{busy ? 'Downloading…' : 'Download tile pack'}</span>
        {nothing ? <VisuallyHidden>— nothing is placed yet</VisuallyHidden> : null}
      </Button>

      {busy ? (
        <Button size="sm" className="of-bill-cancel" onClick={download.cancel}>
          Cancel
        </Button>
      ) : null}

      <p className="of-bill-caption">
        {/*
          One line, and it is the half a reader cannot get from anywhere else on
          the panel: why the total is smaller than the print count implies, and
          that these are the files themselves rather than the preview meshes.
          `LICENSE.txt` and `ATTRIBUTION.csv` are the archive's first two entries
          whatever this says and `download/download.test.ts` reads them out of a
          real zip — naming them here was an inventory of the file, in a footer
          whose job is to say what pressing the button costs.
        */}
        One zip, one copy of each file &mdash; full-resolution originals.
        {generated === 0 ? null : (
          <>
            {' '}
            Generated bases ride under <code>generated/</code> with{' '}
            <code>GENERATED.txt</code>: they are derivatives of Apache-2.0 OpenSCAD geometry, so{' '}
            <code>ATTRIBUTION.csv</code> does not and cannot cover them.
          </>
        )}
      </p>
    </div>
  )
}
