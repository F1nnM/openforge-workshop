/**
 * Turning a run into numbers a reviewer can check.
 *
 * The only interesting arithmetic here is the **corpus projection**. The sample is
 * stratified, not uniform, so a mean over it would be badly biased — the `gate`
 * stratum is a third of the sample and 11.2% of the corpus. So the projection is
 * done per stratum: mean LOD bytes among sampled objects **above** the gate times
 * the corpus count above the gate, plus the same below. That is the difference
 * between an honest estimate and one that triples the store's size.
 */
import type { JournalEntry } from './run'

export interface Spread {
  count: number
  total: number
  mean: number
  median: number
  p95: number
  min: number
  max: number
}

export interface RunStats {
  /** LOD object sizes, bytes. */
  lodBytes: Spread
  /** Source STL sizes, bytes. */
  sourceBytes: Spread
  /** LOD triangle counts. */
  triangles: Spread
  /** Source triangle counts. */
  sourceTriangles: Spread
  /** Post-weld / pre-weld vertex ratio, over objects that were welded. */
  weldRatio: Spread
  /** Surface-area error as a fraction, over objects that were decimated. */
  areaError: Spread
  /** Byte reduction on totals, source STL → LOD GLB. */
  byteReduction: number
  /** Triangle reduction on totals. */
  triangleReduction: number
  /** How many objects fell outside the target band, and why. */
  passThrough: number
  escalated: number
  unfaithful: number
}

export interface CorpusProjection {
  /** Distinct md5s in the corpus. */
  blobs: number
  aboveGate: number
  belowGate: number
  /** Projected store size, bytes. */
  bytes: number
  /** Sample means the projection used, per stratum. */
  meanAboveGate: number
  meanBelowGate: number
  /** Source bytes the full pass would read from the bucket. */
  sourceBytes: number
}

export function summarise(entries: readonly JournalEntry[]): RunStats {
  const produced = entries.filter((entry) => entry.outcome === 'written')
  const welded = produced.filter((entry) => entry.weld !== null)
  const decimated = produced.filter((entry) => entry.fidelity !== null && !entry.passThrough)

  const sourceBytes = spread(produced.map((entry) => entry.sourceBytes))
  const lodBytes = spread(produced.map((entry) => entry.bytes))
  const sourceTriangles = spread(produced.map((entry) => entry.sourceTriangles))
  const triangles = spread(produced.map((entry) => entry.triangles))

  return {
    lodBytes,
    sourceBytes,
    triangles,
    sourceTriangles,
    weldRatio: spread(welded.map((entry) => entry.weld?.ratio ?? 0)),
    areaError: spread(decimated.map((entry) => entry.fidelity?.areaError ?? 0)),
    byteReduction: lodBytes.total === 0 ? 0 : sourceBytes.total / lodBytes.total,
    triangleReduction: triangles.total === 0 ? 0 : sourceTriangles.total / triangles.total,
    passThrough: produced.filter((entry) => entry.passThrough).length,
    escalated: produced.filter((entry) => entry.escalated).length,
    unfaithful: produced.filter((entry) => entry.fidelity !== null && !entry.fidelity.acceptable).length,
  }
}

/**
 * Project the sample onto the whole corpus, stratified by the gate.
 *
 * `corpusSourceBytes` is the sum of `bytes` over distinct md5s, which is what a
 * full pass actually reads — not the 108.0 GB sum over *records*, which
 * double-counts the 349 rows that share a mesh.
 */
export function project(
  entries: readonly JournalEntry[],
  corpus: { blobs: number; aboveGate: number; sourceBytes: number },
): CorpusProjection {
  const produced = entries.filter((entry) => entry.outcome === 'written')
  const above = produced.filter((entry) => entry.aboveGate).map((entry) => entry.bytes)
  const below = produced.filter((entry) => !entry.aboveGate).map((entry) => entry.bytes)

  const meanAbove = mean(above)
  const meanBelow = mean(below)
  const belowGate = corpus.blobs - corpus.aboveGate

  return {
    blobs: corpus.blobs,
    aboveGate: corpus.aboveGate,
    belowGate,
    bytes: Math.round(meanAbove * corpus.aboveGate + meanBelow * belowGate),
    meanAboveGate: meanAbove,
    meanBelowGate: meanBelow,
    sourceBytes: corpus.sourceBytes,
  }
}

export function spread(values: readonly number[]): Spread {
  if (values.length === 0) {
    return { count: 0, total: 0, mean: 0, median: 0, p95: 0, min: 0, max: 0 }
  }
  const sorted = [...values].sort((a, b) => a - b)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    count: sorted.length,
    total,
    mean: total / sorted.length,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  }
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))
  return sorted[index] ?? 0
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** `10.4 MB` / `43.0 KB` / `912 B`. Decimal units, one decimal place. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  const abs = Math.abs(bytes)
  if (abs >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`
  if (abs >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`
  if (abs >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`
  return `${bytes.toFixed(0)} B`
}

/** `207,296`. Thousands separators, because six-digit triangle counts are unreadable. */
export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}
