/**
 * The stride experiment: measure the error before trusting it.
 *
 * `architecture-plan.md` §14 costs this row as "strided range-reads (~13 GB,
 * sub-0.03 mm)". The 0.03 mm was never measured. This module measures it.
 *
 * ## The design
 *
 * A stratified sample spanning the whole size range is read **in full**, so the
 * exact bounding box of each mesh is known. Every candidate stride is then
 * applied to those same vertices and the resulting box compared with the exact
 * one. That isolates the question — *does skipping facets lose an extreme?* —
 * from the transport, and it is the only way to get a real bound: a strided read
 * cannot detect its own error, because the vertex it missed is by definition one
 * it did not fetch.
 *
 * Stratification is by byte size, in equal-count bands, taking the median-sized
 * member of each band. Facet count scales with bytes, and a stride's error is a
 * function of how much of the mesh it skips, so the size range is the axis that
 * matters. Sculpted tiles and untextured plain bases both appear, which is the
 * other axis that matters: a plain base has a few hundred facets and a stride of
 * 8 over it is already a decimation, while a sculpted floor has a million and
 * loses almost nothing.
 *
 * ## What the transport arithmetic says separately
 *
 * R2 charges no egress, so a stride saves **wall-clock and memory, not money**,
 * and it costs *more* Class B operations than one whole-object GET. With
 * 64 KiB-coalesced windows a stride only transfers less than the whole object
 * once `50 × stride > 65536`, i.e. `stride > 1310` — every smaller stride is a
 * whole-object read wearing a `Range` header. {@link strideTransfer} reports the
 * real figures per stride so the trade is visible rather than assumed.
 */
import type { CatalogFile } from '../../src/catalog'
import { parseStl } from '../../src/three/stl/parse'

import type { MeasureTarget } from './catalog'
import { modelUrl } from './catalog'
import { boundingBox, round, strideError } from './extent'
import type { FetchOptions } from './fetch'
import { facetRanges, fetchObject, mapLimit, rangeBytes } from './fetch'

/** Strides tried. A bisection ladder from "almost everything" to "almost nothing". */
export const CANDIDATE_STRIDES: readonly number[] = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 4096]

/** Meshes in the sample. The row's floor is 30. */
export const DEFAULT_SAMPLE = 36

/** One mesh's exact box and what every stride did to it. */
export interface CalibrationSample {
  blob: string
  bytes: number
  format: string
  triangles: number
  sizeMm: readonly [number, number, number]
  /** Stride → the error it produced on this mesh. */
  errors: Record<number, { maxFaceErrorMm: number; maxSizeErrorMm: number; facets: number }>
}

/** What a real strided read of one mesh would transfer. */
export interface StrideTransfer {
  stride: number
  requests: number
  bytes: number
  /** `bytes / objectBytes`. Above 1 is impossible; at 1 the stride saves nothing. */
  fraction: number
}

/** Per-stride summary across the sample — the table the decision is made from. */
export interface StrideVerdict {
  stride: number
  /** Worst error any mesh in the sample suffered, mm. This is the bound. */
  maxFaceErrorMm: number
  /** Median across the sample, mm. Context only; a footprint is decided by the worst case. */
  medianFaceErrorMm: number
  /** Meshes whose box was reproduced exactly. */
  exact: number
  /** Meshes where the error exceeded the plan's claimed 0.03 mm. */
  overPlanClaim: number
  /** Bytes a real coalesced range read would transfer across the whole sample. */
  sampleBytes: number
  /** Requests it would cost. One whole-object GET per mesh is the baseline. */
  sampleRequests: number
}

export interface CalibrationReport {
  samples: CalibrationSample[]
  verdicts: StrideVerdict[]
  /** Bytes the full reads cost — the price of knowing. */
  bytesRead: number
  /** The claim in `architecture-plan.md` §14, for comparison. */
  planClaimMm: number
  /** Sample meshes that could not be read, with the reason. */
  failures: { blob: string; reason: string }[]
}

/** §14's unmeasured claim, in millimetres. */
export const PLAN_CLAIM_MM = 0.03

/**
 * A byte-stratified sample of the work list.
 *
 * Deterministic: equal-count bands over the byte-sorted list, median member of
 * each. No randomness, so a re-run calibrates the same meshes and a changed
 * table means a changed corpus.
 */
export function stratifiedSample(
  targets: readonly MeasureTarget[],
  size = DEFAULT_SAMPLE,
): MeasureTarget[] {
  if (targets.length <= size) return [...targets]
  const sorted = [...targets].sort((a, b) => a.bytes - b.bytes || a.ord - b.ord)
  const picks: MeasureTarget[] = []
  for (let band = 0; band < size; band += 1) {
    const from = Math.floor((band * sorted.length) / size)
    const to = Math.floor(((band + 1) * sorted.length) / size)
    const at = Math.min(sorted.length - 1, Math.floor((from + to) / 2))
    const pick = sorted[at]
    if (pick !== undefined && !picks.includes(pick)) picks.push(pick)
  }
  return picks
}

/** Requests and bytes a coalesced strided read of `triangles` facets would cost. */
export function strideTransfer(triangles: number, objectBytes: number, stride: number): StrideTransfer {
  const ranges = facetRanges(triangles, stride)
  const bytes = rangeBytes(ranges)
  return {
    stride,
    requests: ranges.length + 1, // + the 84-byte preamble probe
    bytes: Math.min(bytes, objectBytes),
    fraction: objectBytes === 0 ? 1 : Math.min(1, bytes / objectBytes),
  }
}

export interface CalibrateOptions {
  catalog: CatalogFile
  targets: readonly MeasureTarget[]
  strides?: readonly number[]
  concurrency?: number
  fetch?: FetchOptions
  onSample?: (sample: CalibrationSample, index: number, total: number) => void
}

/** Read the sample in full and tabulate every stride's real error. */
export async function calibrate(options: CalibrateOptions): Promise<CalibrationReport> {
  const strides = options.strides ?? CANDIDATE_STRIDES
  const samples: CalibrationSample[] = []
  const failures: { blob: string; reason: string }[] = []
  let bytesRead = 0

  // One unreadable mesh must not lose the other 35: a calibration that abandons
  // itself on a single 404 has cost the bucket a full sample for nothing.
  const results = await mapLimit(
    options.targets,
    options.concurrency ?? 4,
    async (target, index): Promise<CalibrationSample | undefined> => {
      try {
        const sample = await measureSample(options.catalog, target, strides, options.fetch)
        if (sample !== undefined) {
          bytesRead += target.bytes
          options.onSample?.(sample, index, options.targets.length)
        }
        return sample
      } catch (error) {
        failures.push({
          blob: target.blob,
          reason: error instanceof Error ? error.message : String(error),
        })
        return undefined
      }
    },
  )
  for (const result of results) if (result !== undefined) samples.push(result)

  return {
    samples,
    verdicts: strides.map((stride) => verdict(stride, samples)),
    bytesRead,
    planClaimMm: PLAN_CLAIM_MM,
    failures,
  }
}

async function measureSample(
  catalog: CatalogFile,
  target: MeasureTarget,
  strides: readonly number[],
  fetchOptions?: FetchOptions,
): Promise<CalibrationSample | undefined> {
  const object = await fetchObject(modelUrl(catalog, target.blob), target.blob, undefined, fetchOptions)
  const parsed = parseStl(object.bytes)
  const exact = boundingBox(parsed.positions, parsed.triangles, 1)
  if (exact === undefined) return undefined

  const errors: CalibrationSample['errors'] = {}
  for (const stride of strides) {
    const error = strideError(parsed.positions, parsed.triangles, stride)
    if (error === undefined) continue
    errors[stride] = {
      maxFaceErrorMm: round(error.maxFaceErrorMm, 6),
      maxSizeErrorMm: round(error.maxSizeErrorMm, 6),
      facets: error.facets,
    }
  }

  return {
    blob: target.blob,
    bytes: target.bytes,
    format: parsed.format,
    triangles: parsed.triangles,
    sizeMm: [round(exact.sizeMm[0], 4), round(exact.sizeMm[1], 4), round(exact.sizeMm[2], 4)],
    errors,
  }
}

function verdict(stride: number, samples: readonly CalibrationSample[]): StrideVerdict {
  const errors: number[] = []
  let sampleBytes = 0
  let sampleRequests = 0
  for (const sample of samples) {
    const error = sample.errors[stride]
    if (error === undefined) continue
    errors.push(error.maxFaceErrorMm)
    const transfer = strideTransfer(sample.triangles, sample.bytes, stride)
    sampleBytes += transfer.bytes
    sampleRequests += transfer.requests
  }
  const sorted = [...errors].sort((a, b) => a - b)
  const median = sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] as number)

  return {
    stride,
    maxFaceErrorMm: errors.length === 0 ? 0 : Math.max(...errors),
    medianFaceErrorMm: median,
    exact: errors.filter((error) => error === 0).length,
    overPlanClaim: errors.filter((error) => error > PLAN_CLAIM_MM).length,
    sampleBytes,
    sampleRequests,
  }
}
