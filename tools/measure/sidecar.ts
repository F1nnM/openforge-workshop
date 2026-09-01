/**
 * The derived-metadata sidecar: the artefact rows W4, W5, G2 and X4 read.
 *
 * ## Keyed by md5, because a path is not stable
 *
 * `CLAUDE.md`'s creator-workflow section is explicit that files move and get
 * renamed mid-design and that md5 is how the scanner copes. The same applies in
 * the other direction: a re-export changes the md5 and *should* invalidate the
 * measurement, because the mesh changed. Keying on `id` would silently carry a
 * stale dimension across a re-export; keying on md5 makes the measurement
 * disappear, which is the correct failure — a consumer that cannot find a blob
 * has no dimension and must refuse rather than guess.
 *
 * ## Provenance and confidence on every value
 *
 * This is the single most important property of the file. W5 turns `arc` into an
 * annular sector across 40 compile-breaking files and W4 corrects `QxG`; both
 * are only honest if they can tell a measured dimension from an absent one. So:
 *
 *   - Every entry carries `status`. `'measured'` means the bytes were read and
 *     **hashed to the md5 the index named** — `provenance.verification` records
 *     which check ran, because the bucket's ETag is a multipart ETag above 8 MiB
 *     and is not the md5 (see `fetch.ts`). `'failed'` means it was attempted and
 *     could not be trusted, with the reason. **There is no third state that
 *     looks like a number but is a guess.**
 *   - Every measured entry carries {@link ReadProvenance}: how it was read, how
 *     many facets the geometry came from, and `boundMm` — the largest error the
 *     read method can hide. A full read has `confidence: 'exact'` and
 *     `boundMm: 0`; a strided read has `confidence: 'bounded'` and the bound
 *     from the calibration table.
 *   - `extent` is `null` for a mesh with zero facets (the corpus has one such
 *     file, a valid 84-byte binary header). That is "not measurable", not "zero
 *     size", and a consumer must treat it the way it treats a missing entry.
 *   - `arc` is `null` when no sector fit was attempted, and carries
 *     `fit: 'rejected'` with a reason when one was attempted and refused. A
 *     rejected fit still exposes its best-effort radii **for diagnosis only**;
 *     `fit` is the field a consumer branches on, and only `'sector'` and
 *     `'annulus'` are footprints.
 *
 * ## Resumable by construction
 *
 * Results are appended to a JSON-lines log as each mesh completes
 * ({@link appendEntry}), and a run reloads that log and skips what is already
 * there ({@link readLog}). The 11.05 GB of reads is therefore paid once even
 * across an interrupted run, which matters at ~4 MB/s. The log lives under
 * `tools/measure/.cache/` and is gitignored; the sidecar assembled from it
 * ({@link buildSidecar}) is the committed artefact.
 *
 * ## The version stamp
 *
 * Row **X4** stamps five artefacts in one CI step — the index, the LOD store,
 * the thumbnail set, the share manifest and this file — because md5 churn
 * invalidates all five silently. {@link MEASURE_SIDECAR_VERSION} versions this
 * *format*, and `catalog` carries the whole `VersionStamp` of the index the
 * target sets were derived from, which is the field X4 joins on. The two move
 * independently, exactly as `pipeline/version.ts` keeps `PIPELINE_VERSION`
 * separate from `SCHEMA_VERSION`.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { CatalogFile } from '../../src/catalog'
import type { StlFormat } from '../../src/three/stl/parse'

import type { SectorResult } from './arc'
import type { TargetSet } from './catalog'
import type { Verification } from './fetch'
import { MM_PER_UNIT } from './extent'
import type { Vec3 } from './extent'

/**
 * Version of this sidecar's own shape.
 *
 * Bump when a field's meaning changes. Consumers must refuse a version they do
 * not know rather than reading fields positionally — a renamed unit or a changed
 * confidence vocabulary is exactly the kind of drift that produces a plausible
 * footprint in the wrong place.
 */
export const MEASURE_SIDECAR_VERSION = 1

/** How a measurement was obtained, and what it can be wrong by. */
export interface ReadProvenance {
  /** `'full'` read every facet. `'stride'` read every `stride`-th. */
  read: 'full' | 'stride'
  stride?: number
  /** Bytes transferred from the bucket for this mesh. */
  bytesRead: number
  /** Facets the geometry was computed from. */
  facets: number
  /**
   * How the bytes were proved to be the file the index named.
   *
   * `'content-md5'` — the received bytes were hashed and matched. Definitive.
   * `'etag'` — a partial read matched a plain-md5 ETag. See `fetch.ts` on why a
   * multipart ETag is refused rather than trusted.
   */
  verification: Verification
  /**
   * Whether the object's ETag is itself its md5.
   *
   * `false` for a multipart-uploaded object. Recorded because blocker **B5**
   * assumes it is always `true`, and measured across this corpus it is not.
   */
  etagIsMd5: boolean
  /**
   * Largest error, in millimetres, the read method can hide on any box face.
   *
   * `0` with `confidence: 'exact'` for a full read: every vertex was seen, so
   * the box is the box. For a strided read this is the calibrated bound from
   * `calibrate.ts`, and it is a **bound, not an estimate**.
   */
  boundMm: number
  confidence: 'exact' | 'bounded'
}

/** The axis-aligned box, in both units the project uses. */
export interface ExtentValue {
  minMm: Vec3
  maxMm: Vec3
  sizeMm: Vec3
  sizeUnits: Vec3
}

/** A mesh that was read and measured. */
export interface MeasuredEntry {
  status: 'measured'
  blob: string
  /** Which of the target-set questions this mesh answers. */
  sets: TargetSet[]
  /** Size in bytes, from the index and confirmed by the read. */
  bytes: number
  format: StlFormat
  triangles: number
  /** Triangles the parser dropped for a non-finite coordinate. Normally 0. */
  dropped: number
  provenance: ReadProvenance
  /** `null` when the mesh has no facets: not measurable, not zero-sized. */
  extent: ExtentValue | null
  /** `null` when no sector fit was attempted. */
  arc: SectorResult | null
}

/** A mesh that could not be measured, and why. */
export interface FailedEntry {
  status: 'failed'
  blob: string
  sets: TargetSet[]
  bytes: number
  /** `StlFetchError.kind`, `StlParseError.kind`, or `'unknown'`. */
  kind: string
  reason: string
}

export type MeasurementEntry = MeasuredEntry | FailedEntry

/** Counts a run states about itself, so partial coverage is legible. */
export interface SidecarCoverage {
  /** Distinct md5 values in the union of the target sets. */
  blobs: number
  measured: number
  failed: number
  /** Targets not attempted — a run that was interrupted or limited. */
  pending: number
  /** Per-set blob counts and how many of each were measured. */
  sets: Record<TargetSet, { blobs: number; measured: number }>
  bytesRead: number
  /**
   * How the measured meshes were proved to be the files the index named.
   *
   * `etagIsNotMd5` is the count of objects whose ETag is the S3/R2 **multipart**
   * form and therefore not an md5 at all. Blocker **B5** asks for
   * `Access-Control-Expose-Headers: ETag` on the premise that the ETag *is* the
   * md5; this number is how far that premise actually goes on this corpus.
   */
  verification: { contentMd5: number; etag: number; etagIsNotMd5: number }
}

/** The committed file. */
export interface MeasureSidecar {
  tool: 'openforge-workshop-measure'
  /** {@link MEASURE_SIDECAR_VERSION}. */
  version: number
  generated: string
  /** The index the target sets came from. Row X4's join key. */
  catalog: CatalogFile['version']
  units: { mmPerUnit: number }
  /** Named constants and thresholds, so a number can be reproduced from the file alone. */
  method: Record<string, number | string>
  coverage: SidecarCoverage
  /** Every attempted mesh, md5-keyed, sorted by key. */
  measurements: Record<string, MeasurementEntry>
}

/** `SOURCE_DATE_EPOCH` overrides the clock, as `pipeline/version.ts` does. */
export function generatedAt(now: () => number = Date.now): string {
  const pinned = process.env.SOURCE_DATE_EPOCH
  if (pinned !== undefined && /^\d+$/.test(pinned.trim())) {
    return new Date(Number(pinned.trim()) * 1000).toISOString()
  }
  return new Date(now()).toISOString()
}

/* -------------------------------------------------------------- the log */

/** Append one completed entry. Creates the directory and file on first use. */
export function appendEntry(logPath: string, entry: MeasurementEntry): void {
  mkdirSync(dirname(logPath), { recursive: true })
  appendFileSync(logPath, `${JSON.stringify(entry)}\n`, 'utf8')
}

/**
 * Every entry already in the log, md5-keyed. A later line wins over an earlier
 * one for the same md5, so a retried failure is superseded by its success.
 *
 * A truncated final line — what an interrupted process leaves behind — is
 * dropped rather than throwing: the mesh simply gets re-read, which is the
 * cheapest correct response.
 */
export function readLog(logPath: string): Map<string, MeasurementEntry> {
  const entries = new Map<string, MeasurementEntry>()
  if (!existsSync(logPath)) return entries
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    const entry = parsed as MeasurementEntry
    if (typeof entry.blob !== 'string' || entry.blob === '') continue
    entries.set(entry.blob, entry)
  }
  return entries
}

/* ----------------------------------------------------------- the sidecar */

export interface BuildSidecarOptions {
  catalog: CatalogFile
  entries: Map<string, MeasurementEntry>
  /**
   * The md5 values the current work list asks for.
   *
   * Entries outside it are dropped rather than carried. The log is append-only
   * and survives a reclassification — W3 moved 403 tiles between footprint
   * buckets mid-row — so without this the sidecar would keep describing meshes
   * that are no longer anybody's question, under labels that no longer apply.
   * Omit to keep everything in the log.
   */
  wanted?: ReadonlySet<string>
  /** Blob count and per-set blob counts of the full work list. */
  coverage: { blobs: number; sets: Record<TargetSet, number> }
  method: Record<string, number | string>
  now?: () => number
}

/** Assemble the committed sidecar from the log. Pure — no I/O. */
export function buildSidecar(options: BuildSidecarOptions): MeasureSidecar {
  const wanted = options.wanted
  const keys = [...options.entries.keys()]
    .filter((key) => wanted === undefined || wanted.has(key))
    .sort()
  const measurements: Record<string, MeasurementEntry> = {}
  let measured = 0
  let failed = 0
  let bytesRead = 0
  const verification = { contentMd5: 0, etag: 0, etagIsNotMd5: 0 }
  const perSet = new Map<TargetSet, number>()

  for (const key of keys) {
    const entry = options.entries.get(key)
    if (entry === undefined) continue
    measurements[key] = entry
    if (entry.status === 'measured') {
      measured += 1
      bytesRead += entry.provenance.bytesRead
      if (entry.provenance.verification === 'content-md5') verification.contentMd5 += 1
      else verification.etag += 1
      if (!entry.provenance.etagIsMd5) verification.etagIsNotMd5 += 1
      for (const set of entry.sets) perSet.set(set, (perSet.get(set) ?? 0) + 1)
    } else {
      failed += 1
    }
  }

  const sets = Object.fromEntries(
    Object.entries(options.coverage.sets).map(([set, blobs]) => [
      set,
      { blobs, measured: perSet.get(set as TargetSet) ?? 0 },
    ]),
  ) as SidecarCoverage['sets']

  return {
    tool: 'openforge-workshop-measure',
    version: MEASURE_SIDECAR_VERSION,
    generated: generatedAt(options.now),
    catalog: options.catalog.version,
    units: { mmPerUnit: MM_PER_UNIT },
    method: options.method,
    coverage: {
      blobs: options.coverage.blobs,
      measured,
      failed,
      pending: Math.max(0, options.coverage.blobs - measured - failed),
      sets,
      bytesRead,
      verification,
    },
    measurements,
  }
}

/**
 * Serialise with the header pretty-printed and **one line per measurement**.
 *
 * Not a style choice. The file is ~840 kB over 1,163 meshes, and md5 churn is the
 * creator's normal workflow — a re-exported tile should show up as exactly one
 * changed line in review. Fully-indented JSON spreads each measurement over
 * forty lines and triples the size; fully-minified JSON makes the whole file one
 * line and every change look total. This is the form that is both small and
 * reviewable.
 *
 * Keys are md5-sorted by {@link buildSidecar}, so the ordering is stable across
 * runs and a diff shows only what actually moved.
 */
export function serialiseSidecar(sidecar: MeasureSidecar): string {
  const { measurements, ...header } = sidecar
  const head = JSON.stringify(header, null, 1)
  const rows = Object.keys(measurements).map(
    (blob) => `  ${JSON.stringify(blob)}: ${JSON.stringify(measurements[blob])}`,
  )
  // Splice the measurements in as the final member of the same object. The
  // header always has members, so the separating comma is unconditional.
  const open = head.slice(0, head.lastIndexOf('}')).replace(/\s+$/, '')
  const body = rows.length === 0 ? '{}' : `{\n${rows.join(',\n')}\n }`
  return `${open},\n "measurements": ${body}\n}\n`
}

/** Write the sidecar, creating its directory. */
export function writeSidecar(path: string, sidecar: MeasureSidecar): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, serialiseSidecar(sidecar), 'utf8')
}

/**
 * Read a sidecar and refuse a version this build does not understand.
 *
 * The refusal is the point: a consumer that silently accepted a future version
 * would read a renamed field as a dimension.
 */
export function readSidecar(path: string): MeasureSidecar {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const sidecar = parsed as MeasureSidecar
  if (sidecar.tool !== 'openforge-workshop-measure') {
    throw new Error(`${path} is not a measure sidecar (tool: ${String(sidecar.tool)})`)
  }
  if (sidecar.version !== MEASURE_SIDECAR_VERSION) {
    throw new Error(
      `${path} is sidecar version ${String(sidecar.version)}; this build reads ` +
        `${String(MEASURE_SIDECAR_VERSION)}. Re-run \`npm run measure\` or update the reader.`,
    )
  }
  return sidecar
}

/* ------------------------------------------------------- consumer helpers */

/**
 * The measured extent of a blob, or `undefined` when there is none to place.
 *
 * The helper W4 and W5 should call. `undefined` for a missing entry, a failed
 * entry, a facet-less mesh **and** for a confidence a caller will not accept —
 * so "refuse to place a footprint whose dimension is unknown" is one call, not a
 * chain of field checks each of which can be forgotten.
 */
export function measuredExtent(
  sidecar: MeasureSidecar,
  blob: string,
  minimum: ReadProvenance['confidence'] = 'bounded',
): ExtentValue | undefined {
  const entry = sidecar.measurements[blob]
  if (entry === undefined || entry.status !== 'measured') return undefined
  if (entry.extent === null) return undefined
  if (minimum === 'exact' && entry.provenance.confidence !== 'exact') return undefined
  return entry.extent
}

/**
 * The measured annular sector of a blob, or `undefined`.
 *
 * Returns a value **only** for `fit: 'sector'` or `'annulus'`. A rejected fit is
 * not a sector with a large error bar; it is a mesh that is a different shape,
 * and W5 must fall back rather than place it.
 */
export function measuredSector(
  sidecar: MeasureSidecar,
  blob: string,
): Extract<SectorResult, { fit: 'sector' | 'annulus' }> | undefined {
  const entry = sidecar.measurements[blob]
  if (entry === undefined || entry.status !== 'measured') return undefined
  const arc = entry.arc
  if (arc === null || arc.fit === 'rejected') return undefined
  return arc
}
