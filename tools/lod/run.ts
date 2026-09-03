/**
 * The run: fetch, verify, weld, simplify, encode, stage, journal.
 *
 * ## Incremental and idempotent, keyed on md5
 *
 * The output path *is* half the state, exactly as in `tools/thumbnails/run.ts`: a
 * GLB lives at `{out}/lod/{md5[0:6]}/{md5}.glb`, the md5 is the source mesh's
 * content address, and a re-exported mesh is a new md5 under a new path — so a
 * file that exists is a file that is correct.
 *
 * The other half is a **journal**, `{out}/lod-journal.jsonl`, appended one line
 * per finished object. The thumbnail tool needs no journal because everything its
 * manifest reports about an object is recoverable from the object's bytes. This
 * tool's manifest reports the *weld ratio and the fidelity error*, which are
 * properties of the derivation and are gone once the GLB is written. Without the
 * journal a resumed run would emit a manifest whose most important columns were
 * null for every object it skipped — which is to say, for every object, on the
 * run that finally completes the corpus.
 *
 * So: append after each object, resume by reading it back, and skip an object
 * only when the journal *and* the file agree it is done. Deleting the journal
 * costs a re-derivation, never a wrong answer.
 *
 * ## Failure is per object and loud at the end
 *
 * One 404 must not lose the other 8,352 objects, so a failure is recorded against
 * its blob and the run continues; the CLI exits non-zero if anything failed. Four
 * things are *not* tolerated and each fails its own object with its own name:
 * a body that does not hash to the md5 asked for ({@link BlobMismatchError}), a
 * weld that did not reduce the vertex count ({@link WeldNoOpError}), and a
 * simplification that could not reach the band ({@link TargetMissedError}).
 * A zero-facet STL is not a failure — it is reported as `empty` and produces no
 * object, because there is no mesh to decimate and `src/three/gate.ts` already
 * refuses 3D for it.
 *
 * ## The shared-abstraction seam, reported rather than taken
 *
 * `fetch.ts` here and `tools/thumbnails/fetch.ts` now hold the same
 * retry/backoff/`mapLimit`/User-Agent shape with different verification and
 * different politeness constants, and this file mirrors that file's report
 * structure. A `tools/shared/bucket.ts` is the obvious extraction — but three
 * rows would then own it (G1, X1's backfill and whatever runs the measurement
 * sidecar), so it is **named here as a seam for a later row** instead of created
 * now. The duplicated surface is about 90 lines.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { CatalogFile } from '../../src/catalog'

import { lodKey, lodPath, modelUrl } from './catalog'
import type { DecimateOptions, DecimateResult } from './decimate'
import { EmptyMeshError, decimate, ready, readGlb } from './decimate'
import type { FetchOptions } from './fetch'
import { DEFAULT_CONCURRENCY, DEFAULT_MIN_INTERVAL_MS, cachePath, fetchModel, mapLimit } from './fetch'
import type { SamplePick } from './sample'

/** The journal's filename inside the output directory. */
export const JOURNAL_NAME = 'lod-journal.jsonl'

export interface RunOptions {
  catalog: CatalogFile
  picks: readonly SamplePick[]
  outDir: string
  /** On-disk STL cache. Off unless given. */
  cacheDir?: string
  /** Re-derive objects that already exist. */
  force?: boolean
  concurrency?: number
  minIntervalMs?: number
  decimate?: DecimateOptions
  fetch?: Pick<FetchOptions, 'fetchImpl' | 'sleep' | 'timeoutMs' | 'retries'>
  onProgress?: (event: ProgressEvent) => void
  /** Injected in tests. Defaults to `Date.now`. */
  now?: () => number
}

export type Outcome = 'written' | 'skipped' | 'empty' | 'failed'

export interface ProgressEvent {
  index: number
  total: number
  blob: string
  outcome: Outcome
  sourceBytes: number
  triangles?: number
  bytes?: number
  reason?: string
}

/**
 * One journal line. Everything the manifest needs about an object that this
 * process may not have produced.
 */
export interface JournalEntry {
  blob: string
  key: string
  ord: number
  tiles: number
  designs: number
  aboveGate: boolean
  outcome: 'written' | 'empty'
  format: DecimateResult['format']
  sourceBytes: number
  sourceTriangles: number
  droppedTriangles: number
  bytes: number
  triangles: number
  vertices: number
  weld: { before: number; after: number; ratio: number } | null
  fidelity: { areaError: number; volumeError: number; bboxDelta: number; acceptable: boolean } | null
  passThrough: boolean
  escalated: boolean
  attempts: number
  compression: DecimateResult['compression']
  extents: [number, number, number]
  fetchMs: number
  decimateMs: number
}

/** One object that could not be produced. */
export interface RunFailure {
  blob: string
  key: string
  url: string
  kind: string
  reason: string
}

export interface RunReport {
  attempted: number
  written: number
  skipped: number
  empty: number
  failed: RunFailure[]
  /** Meshes pulled from the bucket this run. */
  fetched: number
  /** Meshes served from the on-disk cache. */
  fromCache: number
  /** Bytes of STL pulled over the wire this run. */
  sourceBytesFetched: number
  /** Journal entries covering every pick that has ever succeeded. */
  entries: JournalEntry[]
  /** Staged bytes, keyed by object key, for the manifest's sha256 column. */
  contents: Map<string, Uint8Array>
  elapsedMs: number
}

export async function runLod(options: RunOptions): Promise<RunReport> {
  const now = options.now ?? Date.now
  const startedAt = now()
  await ready()

  const journalPath = join(options.outDir, JOURNAL_NAME)
  const journal = readJournal(journalPath)
  const total = options.picks.length

  const outcomes = await mapLimit(
    options.picks,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    async (pick, index) => {
      const result = await one(pick, options, journal, journalPath, now)
      options.onProgress?.({
        index,
        total,
        blob: pick.target.blob,
        outcome: result.outcome,
        sourceBytes: pick.target.bytes,
        ...(result.entry === undefined ? {} : { triangles: result.entry.triangles, bytes: result.entry.bytes }),
        ...(result.failure === undefined ? {} : { reason: result.failure.reason }),
      })
      return result
    },
    { minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, sleep: options.fetch?.sleep },
  )

  const report: RunReport = {
    attempted: total,
    written: 0,
    skipped: 0,
    empty: 0,
    failed: [],
    fetched: 0,
    fromCache: 0,
    sourceBytesFetched: 0,
    entries: [],
    contents: new Map(),
    elapsedMs: now() - startedAt,
  }

  for (const result of outcomes) {
    switch (result.outcome) {
      case 'written':
        report.written += 1
        break
      case 'skipped':
        report.skipped += 1
        break
      case 'empty':
        report.empty += 1
        break
      case 'failed':
        if (result.failure) report.failed.push(result.failure)
        continue
    }
    if (result.fetched === 'network') {
      report.fetched += 1
      report.sourceBytesFetched += result.entry?.sourceBytes ?? 0
    } else if (result.fetched === 'cache') {
      report.fromCache += 1
    }
    if (result.entry) report.entries.push(result.entry)
    if (result.contents) report.contents.set(result.entry?.key ?? '', result.contents)
  }

  report.elapsedMs = now() - startedAt
  return report
}

interface OneResult {
  outcome: Outcome
  entry?: JournalEntry
  contents?: Uint8Array
  failure?: RunFailure
  fetched?: 'network' | 'cache' | 'none'
}

async function one(
  pick: SamplePick,
  options: RunOptions,
  journal: Map<string, JournalEntry>,
  journalPath: string,
  now: () => number,
): Promise<OneResult> {
  const { target } = pick
  const key = lodKey(options.catalog, target.blob)
  const path = lodPath(options.catalog, target.blob, options.outDir)
  const url = modelUrl(options.catalog, target.blob)

  const done = journal.get(target.blob)
  if (!options.force && done !== undefined && (done.outcome === 'empty' || existsSync(path))) {
    return {
      outcome: done.outcome === 'empty' ? 'empty' : 'skipped',
      entry: done,
      ...(done.outcome === 'empty' ? {} : { contents: readFileSync(path) }),
      fetched: 'none',
    }
  }

  // The file is there but the journal is not — a deleted journal, or a run
  // killed between the write and the append. Re-read the object rather than
  // re-downloading 108 MB, and say in the entry that the derivation figures are
  // unrecoverable.
  if (!options.force && done === undefined && existsSync(path)) {
    const contents = readFileSync(path)
    const summary = await readGlb(contents)
    const entry: JournalEntry = {
      ...baseEntry(pick, key),
      outcome: 'written',
      format: 'binary',
      sourceTriangles: 0,
      droppedTriangles: 0,
      bytes: contents.byteLength,
      triangles: summary.triangles,
      vertices: summary.vertices,
      weld: null,
      fidelity: null,
      passThrough: false,
      escalated: false,
      attempts: 0,
      compression: summary.extensionsRequired.includes('EXT_meshopt_compression')
        ? 'EXT_meshopt_compression'
        : 'none',
      extents: summary.extents,
      fetchMs: 0,
      decimateMs: 0,
    }
    appendJournal(journalPath, entry)
    journal.set(target.blob, entry)
    return { outcome: 'skipped', entry, contents, fetched: 'none' }
  }

  try {
    const fetchStart = now()
    const source = await fetchModel(url, target.blob, {
      ...(options.cacheDir === undefined ? {} : { cacheDir: options.cacheDir }),
      ...options.fetch,
    })
    const fetchMs = now() - fetchStart

    const decimateStart = now()
    const result = await decimate(source.bytes, options.decimate ?? {})
    const decimateMs = now() - decimateStart

    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, result.glb)

    const entry: JournalEntry = {
      ...baseEntry(pick, key),
      outcome: 'written',
      format: result.format,
      sourceTriangles: result.sourceTriangles,
      droppedTriangles: result.droppedTriangles,
      bytes: result.glb.byteLength,
      triangles: result.triangles,
      vertices: result.vertices,
      weld: { before: result.weld.before, after: result.weld.after, ratio: result.weld.ratio },
      fidelity: {
        areaError: result.fidelity.areaError,
        volumeError: result.fidelity.volumeError,
        bboxDelta: result.fidelity.bboxDelta,
        acceptable: result.fidelity.acceptable,
      },
      passThrough: result.passThrough,
      escalated: result.escalated,
      attempts: result.attempts,
      compression: result.compression,
      extents: result.source.extents,
      fetchMs,
      decimateMs,
    }
    appendJournal(journalPath, entry)
    journal.set(target.blob, entry)

    return {
      outcome: 'written',
      entry,
      contents: result.glb,
      fetched: source.fromCache ? 'cache' : 'network',
    }
  } catch (error) {
    if (error instanceof EmptyMeshError) {
      const entry: JournalEntry = {
        ...baseEntry(pick, key),
        outcome: 'empty',
        format: 'binary',
        sourceTriangles: 0,
        droppedTriangles: 0,
        bytes: 0,
        triangles: 0,
        vertices: 0,
        weld: null,
        fidelity: null,
        passThrough: true,
        escalated: false,
        attempts: 0,
        compression: 'none',
        extents: [0, 0, 0],
        fetchMs: 0,
        decimateMs: 0,
      }
      appendJournal(journalPath, entry)
      journal.set(target.blob, entry)
      return { outcome: 'empty', entry, fetched: 'none' }
    }
    return {
      outcome: 'failed',
      failure: {
        blob: target.blob,
        key,
        url,
        kind: error instanceof Error ? error.name : 'Error',
        reason: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

function baseEntry(pick: SamplePick, key: string): Pick<
  JournalEntry,
  'blob' | 'key' | 'ord' | 'tiles' | 'designs' | 'aboveGate' | 'sourceBytes'
> {
  return {
    blob: pick.target.blob,
    key,
    ord: pick.target.ord,
    tiles: pick.target.ids.length,
    designs: pick.target.designs.length,
    aboveGate: pick.target.aboveGate,
    sourceBytes: pick.target.bytes,
  }
}

/* ------------------------------------------------------------------- journal */

/**
 * Read the journal, last line wins per blob.
 *
 * A truncated final line — the shape of a run killed mid-append — is dropped
 * rather than thrown on: the object it describes gets re-derived, which is the
 * cheap and correct outcome.
 */
export function readJournal(path: string): Map<string, JournalEntry> {
  const entries = new Map<string, JournalEntry>()
  if (!existsSync(path)) return entries
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    let parsed: JournalEntry
    try {
      parsed = JSON.parse(line) as JournalEntry
    } catch {
      continue
    }
    if (typeof parsed.blob === 'string') entries.set(parsed.blob, parsed)
  }
  return entries
}

/** Append one line. `O_APPEND` on a line this short is atomic between workers. */
export function appendJournal(path: string, entry: JournalEntry): void {
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(entry)}\n`)
}

/** Bytes of a cached STL, when one is on disk. Used by the dry-run plan. */
export function cachedSourceBytes(cacheDir: string | undefined, blob: string): number | undefined {
  if (cacheDir === undefined) return undefined
  const path = cachePath(cacheDir, blob)
  if (!existsSync(path)) return undefined
  return statSync(path).size
}
