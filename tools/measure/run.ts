/**
 * The run: read each mesh once, measure it, append the result, move on.
 *
 * ## Resumability is the log, not a checkpoint
 *
 * Every completed mesh — measured or failed — is appended to the JSON-lines log
 * before the next one starts, and a run reloads the log and skips what is in it.
 * There is no separate state file to get out of sync, no timestamps, and nothing
 * to clean up after a `SIGINT`: the log *is* the state, keyed by the same md5 the
 * sidecar is keyed by. At the measured ~4 MB/s aggregate this is what turns an
 * interrupted 11.05 GB run into a resumed one rather than a repeated one.
 *
 * A failure is logged too, deliberately. A 404 or an ETag mismatch is a finding
 * about the corpus that four later rows need to see; re-reading it on every run
 * would hide it behind the noise. `--retry-failed` is how you ask for another
 * attempt.
 *
 * ## Failure is per mesh and loud at the end
 *
 * One bad object must not lose the other 1,100, so a failure is recorded against
 * its md5 and the run continues; the CLI exits non-zero if anything failed. The
 * one thing that is *not* tolerated is an ETag that is not the md5 the index
 * named — see `fetch.ts`. That is not a transient failure, it is a measurement of
 * the wrong mesh waiting to happen.
 *
 * ## Which meshes get a sector fit
 *
 * The fit is attempted when the shipped classifier calls the tile an `arc`, or
 * when its tags carry a curve marker at all. That covers all three arc
 * questions, and it also covers the `none` tiles that are curved — which is the
 * bucket row **W3** is about to move 742 tiles out of. It is skipped for the
 * remaining `none` tiles, where the row's stated need is an axis-aligned box and
 * where a sector fit over a 1.45-million-triangle sculpted floor would cost
 * seconds for a guaranteed rejection. `--fit-all` overrides.
 */
import type { BlobId, CatalogFile } from '../../src/catalog'
import { StlParseError, parseStl } from '../../src/three/stl/parse'
import { BINARY_FACET_BYTES, BINARY_HEADER_BYTES } from '../../src/three/stl/parse'

import { fitAnnularSector } from './arc'
import type { MeasureTarget } from './catalog'
import { modelUrl } from './catalog'
import { boundingBox, roundVec } from './extent'
import type { FetchOptions, Verification } from './fetch'
import {
  DEFAULT_CONCURRENCY,
  DEFAULT_MIN_INTERVAL_MS,
  MAX_CONCURRENCY,
  StlFetchError,
  facetRanges,
  fetchObject,
  mapLimit,
  rangeBytes,
} from './fetch'
import type { ExtentValue, FailedEntry, MeasuredEntry, MeasurementEntry, ReadProvenance } from './sidecar'
import { appendEntry, readLog } from './sidecar'

/** The five markers `pipeline/footprint.ts` calls non-rectangular. Read, not imported — see `catalog.ts`. */
const CURVE_MARKERS = ['curved', 'radial', 'concave', 'convex', 'hex'] as const

export interface RunOptions {
  catalog: CatalogFile
  targets: readonly MeasureTarget[]
  /** JSON-lines log. Read for resume, appended to as work completes. */
  logPath: string
  concurrency?: number
  minIntervalMs?: number
  /**
   * Facet stride. Omit for exact whole-object reads.
   *
   * Only binary STLs can be strided — an ASCII STL has variable-length records,
   * so there is no arithmetic from a facet index to a byte offset. Those are read
   * in full whatever this says, and their provenance says `'full'`.
   */
  stride?: number
  /** The calibrated error bound for `stride`, mm. Required when `stride` is set. */
  strideBoundMm?: number
  /** Attempt a sector fit on every target, not only curved ones. */
  fitAll?: boolean
  /** Re-read meshes whose previous attempt failed. */
  retryFailed?: boolean
  /** Re-read everything, ignoring the log. */
  force?: boolean
  fetch?: FetchOptions
  onProgress?: (event: ProgressEvent) => void
}

export interface ProgressEvent {
  index: number
  total: number
  blob: string
  outcome: 'measured' | 'failed' | 'skipped'
  bytesRead: number
  reason?: string
}

export interface RunReport {
  measured: number
  failed: number
  skipped: number
  bytesRead: number
  elapsedMs: number
  /** Every entry now known, resumed ones included. Keyed by md5. */
  entries: Map<string, MeasurementEntry>
  failures: FailedEntry[]
}

/** Read, measure and log every target that is not already done. */
export async function runMeasure(options: RunOptions): Promise<RunReport> {
  if (options.stride !== undefined && options.strideBoundMm === undefined) {
    throw new Error('a strided run must state the calibrated error bound (--stride-bound)')
  }

  const existing = options.force === true ? new Map<string, MeasurementEntry>() : readLog(options.logPath)
  const concurrency = Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, MAX_CONCURRENCY)
  const started = Date.now()

  let measured = 0
  let failed = 0
  let skipped = 0
  let bytesRead = 0
  const failures: FailedEntry[] = []

  await mapLimit(
    options.targets,
    concurrency,
    async (target, index) => {
      const done = existing.get(target.blob)
      if (done !== undefined && (done.status === 'measured' || options.retryFailed !== true)) {
        // Refresh set membership from the *current* work list rather than
        // trusting what the log recorded. Row W3 merged mid-run and moved 403
        // tiles between footprint buckets, so which question a mesh answers can
        // change between two runs even though its geometry cannot. The
        // measurement is keyed on md5 and stays valid; the label does not.
        existing.set(target.blob, { ...done, sets: target.sets })
        skipped += 1
        options.onProgress?.({
          index,
          total: options.targets.length,
          blob: target.blob,
          outcome: 'skipped',
          bytesRead: 0,
        })
        return
      }

      const entry = await measureTarget(target, options)
      existing.set(target.blob, entry)
      appendEntry(options.logPath, entry)

      if (entry.status === 'measured') {
        measured += 1
        bytesRead += entry.provenance.bytesRead
      } else {
        failed += 1
        failures.push(entry)
      }
      options.onProgress?.({
        index,
        total: options.targets.length,
        blob: target.blob,
        outcome: entry.status === 'measured' ? 'measured' : 'failed',
        bytesRead: entry.status === 'measured' ? entry.provenance.bytesRead : 0,
        ...(entry.status === 'failed' ? { reason: entry.reason } : {}),
      })
    },
    {
      minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS,
      ...(options.fetch?.sleep === undefined ? {} : { sleep: options.fetch.sleep }),
    },
  )

  return {
    measured,
    failed,
    skipped,
    bytesRead,
    elapsedMs: Date.now() - started,
    entries: existing,
    failures,
  }
}

/** One mesh, from URL to entry. Never throws — a failure becomes a {@link FailedEntry}. */
export async function measureTarget(
  target: MeasureTarget,
  options: Pick<RunOptions, 'catalog' | 'stride' | 'strideBoundMm' | 'fitAll' | 'fetch'>,
): Promise<MeasurementEntry> {
  const url = modelUrl(options.catalog, target.blob)
  try {
    const read =
      options.stride === undefined
        ? await readWhole(url, target.blob, options.fetch)
        : await readStrided(url, target.blob, options.stride, options.strideBoundMm ?? 0, options.fetch)

    const parsed = read.parse()
    const box = boundingBox(parsed.positions, parsed.triangles, 1)
    const extent: ExtentValue | null =
      box === undefined
        ? null
        : {
            minMm: roundVec(box.minMm),
            maxMm: roundVec(box.maxMm),
            sizeMm: roundVec(box.sizeMm),
            sizeUnits: roundVec(box.sizeUnits),
          }

    const wantFit = options.fitAll === true || shouldFit(target)
    const arc = wantFit && parsed.triangles > 0 ? fitAnnularSector(parsed.positions, parsed.triangles) : null

    const provenance: ReadProvenance = {
      read: read.mode,
      ...(read.stride === undefined ? {} : { stride: read.stride }),
      bytesRead: read.bytesRead,
      facets: box?.facets ?? parsed.triangles,
      verification: read.verification,
      etagIsMd5: read.etagIsMd5,
      boundMm: read.boundMm,
      confidence: read.mode === 'full' ? 'exact' : 'bounded',
    }

    const entry: MeasuredEntry = {
      status: 'measured',
      blob: target.blob,
      sets: target.sets,
      bytes: target.bytes,
      format: parsed.format,
      triangles: parsed.triangles,
      dropped: parsed.dropped,
      provenance,
      extent,
      arc,
    }
    return entry
  } catch (error) {
    return {
      status: 'failed',
      blob: target.blob,
      sets: target.sets,
      bytes: target.bytes,
      kind:
        error instanceof StlFetchError
          ? error.kind
          : error instanceof StlParseError
            ? error.kind
            : 'unknown',
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Whether this target's shape is one a sector fit could plausibly describe. */
export function shouldFit(target: MeasureTarget): boolean {
  if (target.shape === 'arc') return true
  const joined = target.tags.join(' ')
  return CURVE_MARKERS.some((marker) => joined.includes(marker))
}

/* ----------------------------------------------------------------- reading */

interface ReadResult {
  mode: 'full' | 'stride'
  stride?: number
  bytesRead: number
  boundMm: number
  verification: Verification
  etagIsMd5: boolean
  /** Deferred so the parse happens outside the fetch's retry loop. */
  parse: () => ReturnType<typeof parseStl>
}

async function readWhole(url: string, blob: BlobId, fetchOptions?: FetchOptions): Promise<ReadResult> {
  const object = await fetchObject(url, blob, undefined, fetchOptions)
  return {
    mode: 'full',
    bytesRead: object.readBytes,
    boundMm: 0,
    verification: object.verification,
    etagIsMd5: object.etagIsMd5,
    parse: () => parseStl(object.bytes),
  }
}

/**
 * A strided read, or a full one when the object is not binary.
 *
 * Two round trips minimum: the 84-byte preamble decides the format and the facet
 * count, and only then are the windows computable. A file whose preamble does
 * not satisfy `84 + 50n === length` is ASCII (or not STL) and is read whole,
 * because a text STL has no fixed record width to stride over.
 *
 * Coalesced windows deliver facets that were not asked for. They are used
 * anyway — extra facets can only shrink the box error, never grow it, so the
 * calibrated bound still holds and `facets` records what was actually seen.
 */
async function readStrided(
  url: string,
  blob: BlobId,
  stride: number,
  boundMm: number,
  fetchOptions?: FetchOptions,
): Promise<ReadResult> {
  const head = await fetchObject(url, blob, { from: 0, to: BINARY_HEADER_BYTES - 1 }, fetchOptions)
  const triangles = declaredFacets(head.bytes)
  const binary =
    triangles !== undefined && BINARY_HEADER_BYTES + triangles * BINARY_FACET_BYTES === head.totalBytes

  if (!binary || triangles === undefined) {
    const whole = await readWhole(url, blob, fetchOptions)
    return { ...whole, bytesRead: whole.bytesRead + head.readBytes }
  }

  const ranges = facetRanges(triangles, stride)
  if (rangeBytes(ranges) >= head.totalBytes) {
    const whole = await readWhole(url, blob, fetchOptions)
    return { ...whole, bytesRead: whole.bytesRead + head.readBytes }
  }

  const bodies = await mapLimit(ranges, 1, (range) => fetchObject(url, blob, range, fetchOptions))
  const facets = bodies.reduce((total, body) => total + Math.floor(body.readBytes / BINARY_FACET_BYTES), 0)
  const positions = new Float32Array(facets * 9)
  let write = 0
  for (const body of bodies) {
    const view = new DataView(body.bytes.buffer, body.bytes.byteOffset, body.bytes.byteLength)
    const count = Math.floor(body.bytes.byteLength / BINARY_FACET_BYTES)
    for (let facet = 0; facet < count; facet += 1) {
      // + 12 skips the stored facet normal, exactly as `parseBinaryStl` does.
      let read = facet * BINARY_FACET_BYTES + 12
      for (let corner = 0; corner < 3; corner += 1) {
        positions[write] = view.getFloat32(read, true)
        positions[write + 1] = view.getFloat32(read + 4, true)
        positions[write + 2] = view.getFloat32(read + 8, true)
        write += 3
        read += 12
      }
    }
  }

  const bytesRead = head.readBytes + bodies.reduce((total, body) => total + body.readBytes, 0)
  return {
    mode: 'stride',
    stride,
    bytesRead,
    boundMm,
    verification: 'etag' as const,
    etagIsMd5: head.etagIsMd5,
    parse: () => ({
      positions,
      triangles: facets,
      format: 'binary' as const,
      sourceBytes: bytesRead,
      dropped: 0,
    }),
  }
}

/** The `uint32` at offset 80 — a binary STL's declared facet count. */
export function declaredFacets(preamble: Uint8Array): number | undefined {
  if (preamble.byteLength < BINARY_HEADER_BYTES) return undefined
  const view = new DataView(preamble.buffer, preamble.byteOffset, preamble.byteLength)
  return view.getUint32(80, true)
}
