/**
 * Reading the sidecar back as answers.
 *
 * The sidecar is the contract; this is the human readout of it, and it exists so
 * the numbers in the PR body are computed from the committed artefact rather than
 * transcribed from a run's scrollback. Every figure the row reports —
 * band distribution for the 292, sweeps for the 165, widths for the `xG` trio,
 * boxes for the 921 — comes out of here.
 *
 * Nothing here decides anything. It groups, counts and quantiles. The refusal to
 * place an unmeasured footprint lives in `sidecar.ts`'s accessors, where a
 * consumer will actually hit it.
 */
import type { SectorRejection } from './arc'
import type { MeasureTarget, TargetSet } from './catalog'
import { round } from './extent'
import type { MeasureSidecar, MeasurementEntry } from './sidecar'

/** A count keyed by a rounded value, sorted by descending count. */
export type Histogram = { value: string; count: number }[]

function histogram(values: readonly string[]): Histogram {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/** Min / median / max of a numeric sample. `undefined` for an empty one. */
export function quantiles(
  values: readonly number[],
): { min: number; median: number; max: number; count: number } | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return {
    min: round(sorted[0] as number, 4),
    median: round(sorted[Math.floor(sorted.length / 2)] as number, 4),
    max: round(sorted[sorted.length - 1] as number, 4),
    count: sorted.length,
  }
}

/** Entries in one target set, measured only. */
export function entriesInSet(sidecar: MeasureSidecar, set: TargetSet): MeasurementEntry[] {
  return Object.values(sidecar.measurements).filter((entry) => entry.sets.includes(set))
}

export interface SectorSummary {
  /** Measured meshes in the set. */
  measured: number
  /** How many fitted an annular sector or a full annulus. */
  fitted: number
  /** How many were refused, by reason. */
  rejected: Record<SectorRejection, number>
  /** How many were never fitted (the fit was not attempted). */
  notAttempted: number
  /** `Rin–Rout` bands of the fitted meshes, rounded to 0.05 units. */
  bands: Histogram
  /** Band *widths* (`Rout − Rin`), rounded to 0.05 units. */
  bandWidths: Histogram
  /** Sweeps of the fitted meshes, rounded to 0.5°. */
  sweeps: Histogram
  /** How far fitted centres sat from the mesh origin, mm. Audits §4's assumption. */
  centreOffsetMm: ReturnType<typeof quantiles>
  /** Reconstruction residuals of the fitted meshes, mm. The fit's own error. */
  bboxResidualMm: ReturnType<typeof quantiles>
  /** The fitted meshes' own error bars on inner/outer radius, mm. */
  radiusToleranceMm: ReturnType<typeof quantiles>
}

/** Sector outcomes across one target set. */
export function summariseSectors(sidecar: MeasureSidecar, set: TargetSet): SectorSummary {
  const entries = entriesInSet(sidecar, set)
  const rejected: Record<SectorRejection, number> = {
    'no-vertices': 0,
    'degenerate-band': 0,
    'few-arc-vertices': 0,
    'box-mismatch': 0,
  }
  const bands: string[] = []
  const bandWidths: string[] = []
  const sweeps: string[] = []
  const offsets: number[] = []
  const residuals: number[] = []
  const tolerances: number[] = []
  let measured = 0
  let fitted = 0
  let notAttempted = 0

  for (const entry of entries) {
    if (entry.status !== 'measured') continue
    measured += 1
    const arc = entry.arc
    if (arc === null) {
      notAttempted += 1
      continue
    }
    if (arc.fit === 'rejected') {
      rejected[arc.reason] += 1
      continue
    }
    fitted += 1
    bands.push(`[${snap(arc.innerRadiusUnits)}, ${snap(arc.outerRadiusUnits)}]`)
    bandWidths.push(snap(arc.outerRadiusUnits - arc.innerRadiusUnits))
    sweeps.push(snapAngle(arc.sweepDeg))
    offsets.push(arc.centreOffsetMm)
    residuals.push(arc.bboxResidualMm)
    tolerances.push(arc.radiusToleranceMm)
  }

  return {
    measured,
    fitted,
    rejected,
    notAttempted,
    bands: histogram(bands),
    bandWidths: histogram(bandWidths),
    sweeps: histogram(sweeps),
    centreOffsetMm: quantiles(offsets),
    bboxResidualMm: quantiles(residuals),
    radiusToleranceMm: quantiles(tolerances),
  }
}

/** 0.05-unit grid — finer than any band the research names, coarse enough to group. */
function snap(units: number): string {
  return (Math.round(units * 20) / 20).toFixed(2)
}

/** 0.5° grid — finer than the 11.25° bisection ladder's smallest step. */
function snapAngle(degrees: number): string {
  return (Math.round(degrees * 2) / 2).toFixed(1)
}

export interface CodeExtent {
  code: string
  blobs: number
  /** Largest horizontal extent, units — the "width" a size tag claims. */
  longUnits: ReturnType<typeof quantiles>
  /** Smaller horizontal extent, units — the wall thickness for a strip. */
  shortUnits: ReturnType<typeof quantiles>
  /** Vertical extent, units. */
  heightUnits: ReturnType<typeof quantiles>
  /** How many fitted an annular sector — for `xG`, the answer should be none. */
  fittedSectors: number
  /** Oriented strip widths where a rejection reported one, units. */
  stripWidthUnits: ReturnType<typeof quantiles>
  stripLengthUnits: ReturnType<typeof quantiles>
}

/**
 * Horizontal and vertical extents grouped by `size|openlock` code.
 *
 * The two horizontal axes are sorted per mesh into long and short rather than
 * reported as x and y, because a tile's orientation in its own file is not part
 * of the tessellation contract and mixing the two axes would make the median
 * meaningless. The vertical axis is taken as the *third* one — whichever axis the
 * sector fit called the extrusion, or Z when no fit ran.
 */
export function summariseCodes(
  sidecar: MeasureSidecar,
  targets: readonly MeasureTarget[],
  codes: readonly string[],
): CodeExtent[] {
  const codeByBlob = new Map<string, string>()
  for (const target of targets) {
    if (target.sizeCode !== undefined) codeByBlob.set(target.blob, target.sizeCode)
  }

  return codes.map((code) => {
    const long: number[] = []
    const short: number[] = []
    const height: number[] = []
    const stripWidth: number[] = []
    const stripLength: number[] = []
    let blobs = 0
    let fittedSectors = 0

    for (const [blob, entry] of Object.entries(sidecar.measurements)) {
      if (codeByBlob.get(blob) !== code) continue
      if (entry.status !== 'measured' || entry.extent === null) continue
      blobs += 1
      const [x, y, z] = entry.extent.sizeUnits
      long.push(Math.max(x, y))
      short.push(Math.min(x, y))
      height.push(z)
      const arc = entry.arc
      if (arc === null) continue
      if (arc.fit !== 'rejected') {
        fittedSectors += 1
        continue
      }
      if (arc.strip !== undefined) {
        stripWidth.push(arc.strip.widthUnits)
        stripLength.push(arc.strip.lengthUnits)
      }
    }

    return {
      code,
      blobs,
      longUnits: quantiles(long),
      shortUnits: quantiles(short),
      heightUnits: quantiles(height),
      fittedSectors,
      stripWidthUnits: quantiles(stripWidth),
      stripLengthUnits: quantiles(stripLength),
    }
  })
}

export interface ExtentSummary {
  measured: number
  /** Meshes with no facets, so no extent. */
  withoutExtent: number
  longUnits: ReturnType<typeof quantiles>
  shortUnits: ReturnType<typeof quantiles>
  heightUnits: ReturnType<typeof quantiles>
  /** `long × short` rounded to 0.25 units — the footprint a `rect` would use. */
  footprints: Histogram
}

/** Box statistics for a target set — the answer for the 921 `none` tiles. */
export function summariseExtents(sidecar: MeasureSidecar, set: TargetSet): ExtentSummary {
  const long: number[] = []
  const short: number[] = []
  const height: number[] = []
  const footprints: string[] = []
  let measured = 0
  let withoutExtent = 0

  for (const entry of entriesInSet(sidecar, set)) {
    if (entry.status !== 'measured') continue
    measured += 1
    if (entry.extent === null) {
      withoutExtent += 1
      continue
    }
    const [x, y, z] = entry.extent.sizeUnits
    const big = Math.max(x, y)
    const small = Math.min(x, y)
    long.push(big)
    short.push(small)
    height.push(z)
    footprints.push(`${quarter(big)}×${quarter(small)}`)
  }

  return {
    measured,
    withoutExtent,
    longUnits: quantiles(long),
    shortUnits: quantiles(short),
    heightUnits: quantiles(height),
    footprints: histogram(footprints),
  }
}

/** 0.25-unit grid: the finest step the tessellation system uses is 0.5. */
function quarter(units: number): string {
  return (Math.round(units * 4) / 4).toFixed(2)
}
