/**
 * The download button's state machine.
 *
 * `@/download` is four calls and every one of them can fail in a way the user
 * has to be told about specifically. This hook is where each typed error becomes
 * a sentence, and it is deliberately the *only* place in the builder that knows
 * about them — the panel renders {@link DownloadFailure}, which is prose plus a
 * kind, and never a raw `Error`.
 *
 * ## Every failure is distinct, and one of them is a real product limit
 *
 * | error | what the user is told | offer |
 * | --- | --- | --- |
 * | `EmptyArchiveError` | nothing is placed | — |
 * | `ArchiveTooLargeToBufferError` | this browser cannot stream a save, and the room is over the buffering limit | the URL list, plus `ATTRIBUTION.csv` |
 * | `NoSaveTargetError` | this browser offers no way to save a file | — |
 * | `BlobFetchError` | which file failed, and from where | retry |
 * | `PreviewMeshRefusedError` | the archive refused a URL that was not an original STL | — |
 * | `ArchiveLengthMismatchError` | the archive came out short or long and was **failed rather than saved** | retry |
 * | `ArchiveNamingError` | two entries could not be told apart | — |
 *
 * The too-large case is checked **before a byte is fetched**, not only caught
 * from `saveArchive`. `save.ts` refuses at 512 MB when there is no
 * `showSaveFilePicker` — iOS Safari, always — and discovering that after
 * downloading 900 MB over a phone connection would be the worst possible time to
 * find out. The error is the same type either way, so there is one branch in the
 * UI; it is just raised earlier. `saveArchive`'s own check stays as the backstop.
 *
 * ## A cancellation is not a failure
 *
 * A dismissed file picker and a pressed Cancel both land back on `idle`. Users
 * report a "download failed" message for a download they cancelled, and they are
 * right to.
 *
 * ## Why `environment` and `source` are injectable
 *
 * They are the two seams `@/download` already publishes — `saveArchive` takes a
 * {@link SaveEnvironment} and `openArchiveStream` takes a {@link BlobSource} —
 * and this hook passes them straight through. That is what lets the component
 * tests drive all seven rows of the table above without a network and without a
 * browser that can save a file. Production passes neither and gets R2 plus the
 * real browser.
 */
import { useCallback, useMemo, useRef, useState } from 'react'

import type { BillOfTiles } from '@/assembly'
import type { CatalogAssets } from '@/catalog'
import type { ArchivePlan, BlobSource, SaveEnvironment, SaveVia } from '@/download'
import {
  ArchiveLengthMismatchError,
  ArchiveNamingError,
  ArchiveTooLargeToBufferError,
  BLOB_FALLBACK_LIMIT_BYTES,
  BlobFetchError,
  EmptyArchiveError,
  NoSaveTargetError,
  PreviewMeshRefusedError,
  browserSaveEnvironment,
  buildArchivePlan,
  openArchiveStream,
  r2BlobSource,
  saveArchive,
  urlListFilename,
  urlListText,
} from '@/download'

/** Which failure this is, for the panel's own branching. Prose is in the object. */
export type DownloadFailureKind =
  | 'empty'
  | 'too-large'
  | 'no-save-target'
  | 'fetch'
  | 'refused'
  | 'length-mismatch'
  | 'naming'
  | 'unknown'

export interface DownloadFailure {
  readonly kind: DownloadFailureKind
  readonly headline: string
  readonly detail: string
  /** Whether pressing the button again could plausibly work. */
  readonly retryable: boolean
  /**
   * The plan the failure happened on, when there is one.
   *
   * Present for the too-large case, which is the one where the plan is still the
   * answer: it holds the URL list and the attribution table.
   */
  readonly plan?: ArchivePlan
}

export type DownloadState =
  | { readonly status: 'idle' }
  /** A plan exists and the picker may be open; nothing is being fetched yet. */
  | { readonly status: 'preparing'; readonly plan: ArchivePlan }
  | {
      readonly status: 'running'
      readonly plan: ArchivePlan
      readonly bytesWritten: number
      /** Entries begun, licensing files included. */
      readonly entriesStarted: number
      readonly entries: number
      /** The entry being written, for a line under the bar. */
      readonly entry: string | undefined
    }
  | { readonly status: 'saved'; readonly bytes: number; readonly filename: string; readonly via: SaveVia }
  | { readonly status: 'failed'; readonly failure: DownloadFailure }

export interface ArchiveDownload {
  readonly state: DownloadState
  /** Build a plan, open the stream and save it. A no-op while one is in flight. */
  readonly start: () => void
  /** Abort an in-flight download. Lands on `idle`, not on a failure. */
  readonly cancel: () => void
  /** Clear a finished or failed run so the button reads as an action again. */
  readonly dismiss: () => void
  /**
   * §11's degradation path: the model URLs as a text file, **and** the
   * attribution table beside it.
   *
   * Both, always. §10's obligation does not lapse because the transport changed,
   * and the URL list carries no attribution of its own — every file in it lands
   * under its md5, so `ATTRIBUTION.csv` is the only route back to a readable name.
   */
  readonly saveUrlList: () => void
}

export interface ArchiveDownloadOptions {
  readonly bill: BillOfTiles
  readonly assets: Pick<CatalogAssets, 'models'>
  /** Injected by tests; production probes the browser. */
  readonly environment?: SaveEnvironment
  /** Injected by tests; production fetches from R2. */
  readonly source?: BlobSource
}

export function useArchiveDownload({ bill, assets, environment, source }: ArchiveDownloadOptions): ArchiveDownload {
  const [state, setState] = useState<DownloadState>({ status: 'idle' })
  const abort = useRef<AbortController | null>(null)
  /** Guards re-entry: a second click while a stream is open would fetch twice. */
  const running = useRef(false)

  const cancel = useCallback(() => {
    abort.current?.abort()
    abort.current = null
    running.current = false
    setState({ status: 'idle' })
  }, [])

  const dismiss = useCallback(() => {
    setState({ status: 'idle' })
  }, [])

  const start = useCallback(() => {
    if (running.current) return
    running.current = true

    const controller = new AbortController()
    abort.current = controller

    void (async () => {
      let plan: ArchivePlan | undefined
      try {
        plan = buildArchivePlan(bill, { assets })
        setState({ status: 'preparing', plan })

        const host = environment ?? browserSaveEnvironment()
        // Refused before the first fetch rather than after the last one. See the
        // module note; `saveArchive` checks this too and stays the backstop.
        if (host.showSaveFilePicker === undefined && plan.predictedLength > (host.blobLimitBytes ?? BLOB_FALLBACK_LIMIT_BYTES)) {
          throw new ArchiveTooLargeToBufferError(plan.predictedLength, host.blobLimitBytes ?? BLOB_FALLBACK_LIMIT_BYTES)
        }

        const openPlan = plan
        const stream = openArchiveStream(openPlan, {
          source: source ?? r2BlobSource(assets),
          signal: controller.signal,
          onProgress: (progress) => {
            setState({
              status: 'running',
              plan: openPlan,
              bytesWritten: progress.bytesWritten,
              entriesStarted: progress.entriesStarted,
              entries: progress.entries,
              entry: progress.entry?.name,
            })
          },
        })

        const result = await saveArchive(openPlan, stream, host)
        if (result.outcome === 'cancelled') {
          setState({ status: 'idle' })
          return
        }
        setState({ status: 'saved', bytes: result.bytes, filename: result.filename, via: result.via })
      } catch (error) {
        if (controller.signal.aborted) {
          setState({ status: 'idle' })
          return
        }
        setState({ status: 'failed', failure: classify(error, plan) })
      } finally {
        running.current = false
        abort.current = null
      }
    })()
  }, [assets, bill, environment, source])

  const saveUrlList = useCallback(() => {
    const plan = state.status === 'failed' ? state.failure.plan : undefined
    if (plan === undefined) return
    saveText(urlListFilename(plan), urlListText(plan), 'text/plain')
    for (const entry of plan.entries) {
      if (entry.kind === 'text' && entry.name.endsWith('.csv')) saveText('ATTRIBUTION.csv', entry.text, 'text/csv')
    }
  }, [state])

  return useMemo(
    () => ({ state, start, cancel, dismiss, saveUrlList }),
    [state, start, cancel, dismiss, saveUrlList],
  )
}

/* ---------------------------------------------------------------- classifying */

/**
 * One error, one message.
 *
 * `instanceof` per type rather than a switch on `error.name`: every one of these
 * is exported from `@/download` and thrown in the same realm, and the two that
 * carry data — the size and the limit, the expected and actual byte counts — are
 * only readable through the class.
 */
function classify(error: unknown, plan: ArchivePlan | undefined): DownloadFailure {
  if (error instanceof EmptyArchiveError) {
    return {
      kind: 'empty',
      headline: 'Nothing to download',
      detail: 'Place a tile first — an archive holding only a licence is not a result.',
      retryable: false,
    }
  }

  if (error instanceof ArchiveTooLargeToBufferError) {
    return {
      kind: 'too-large',
      headline: `Too large for this browser to save in one file`,
      detail:
        `This room is ${sizeLabel(error.bytes)} and this browser has no streaming save, so it would have to hold ` +
        `the whole archive in memory — the limit is ${sizeLabel(error.limit)}. Take the URL list instead and ` +
        'feed it to a download manager, or build the room in sections.',
      retryable: false,
      ...(plan === undefined ? {} : { plan }),
    }
  }

  if (error instanceof NoSaveTargetError) {
    return {
      kind: 'no-save-target',
      headline: 'This browser cannot save a file',
      detail:
        'Neither a file picker nor a download link is available here. Open the builder in a normal browser tab ' +
        'and try again.',
      retryable: false,
    }
  }

  if (error instanceof BlobFetchError) {
    return {
      kind: 'fetch',
      headline: 'A model could not be fetched',
      detail: `${error.url} did not return the file. Nothing was saved. ${error.message}`,
      retryable: true,
    }
  }

  if (error instanceof PreviewMeshRefusedError) {
    return {
      kind: 'refused',
      headline: 'The archive refused a file',
      detail:
        `${error.url} is not the original STL the index measured, so it was not put in the archive. This is a ` +
        'storage problem rather than something you can retry around.',
      retryable: false,
    }
  }

  if (error instanceof ArchiveLengthMismatchError) {
    return {
      kind: 'length-mismatch',
      headline: 'The archive came out the wrong size',
      detail:
        `Expected exactly ${sizeLabel(error.expected)} and got ${sizeLabel(error.actual)}. The download was ` +
        'failed rather than saved: a streamed zip records its sizes at the end, so a truncated one still opens ' +
        'and one of the meshes inside it would be corrupt.',
      retryable: true,
    }
  }

  if (error instanceof ArchiveNamingError) {
    return {
      kind: 'naming',
      headline: 'Two files could not be told apart',
      detail: `${error.message} Nothing was saved.`,
      retryable: false,
    }
  }

  return {
    kind: 'unknown',
    headline: 'The download failed',
    detail: error instanceof Error ? error.message : String(error),
    retryable: true,
  }
}

/** Bytes as the panel spells them. Decimal, one place — the corpus's own convention. */
function sizeLabel(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

/**
 * Hand a text file to the download manager.
 *
 * The same anchor trick `save.ts` uses for the blob path, and for the same
 * reason: there is no other way to produce a file from a static site. Revoked on
 * the next task rather than immediately — revoking in the same tick as the click
 * cancels the download in Safari.
 */
function saveText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}
