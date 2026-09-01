/**
 * The size gate — the whole reason this viewer is safe to ship.
 *
 * architecture-plan.md §8 puts "Detail viewer, 'View in 3D'" in v1 as *raw STL,
 * gated at ~20–25 MB*, and the gate is the load-bearing half of that sentence.
 * The corpus, re-derived from the emitted index (8,702 live rows, 108.0 GB):
 *
 * | | bytes | est. triangles | position+normal arrays |
 * | --- | --- | --- | --- |
 * | smallest | 84 | **0** | 0 |
 * | median | 10,364,884 | 207 k | 14.9 MB |
 * | **gate** | 25,165,824 | 503 k | 36.2 MB |
 * | p95 | 32,891,184 | 658 k | 47.4 MB |
 * | largest | 108,912,184 | 2.18 M | 156.8 MB |
 *
 * The right-hand column is why a gate exists at all. A raw STL is decoded into
 * two non-indexed `Float32Array`s — positions and recomputed normals, 36 bytes
 * per vertex — and then uploaded to the GPU, so the *resident* cost of the
 * largest file is above 300 MB with the source buffer still in flight. Mobile
 * Safari's tab budget does not survive that, and it does not survive it
 * *quietly*: the tab is killed, so the failure is indistinguishable from the
 * app crashing.
 *
 * ## Where the number came from
 *
 * 24 MiB — the top of the plan's band. Measured against the real index:
 *
 * | limit | tiles viewable in 3D |
 * | --- | --- |
 * | 20 MB | 79.5% |
 * | 22 MB | 84.2% |
 * | **24 MiB (25,165,824 B)** | **88.8%** |
 * | 25 MB | 88.6% |
 *
 * (24 MiB beats 25 MB because it is the larger number — 25.17 against 25.00.)
 * So 88.8% of the archive opens in 3D and 11.2% stays on the sprite sheet,
 * which is a deliberate, stated split rather than a surprise.
 *
 * ## Why it reads `bytes` and not a `HEAD`
 *
 * `CatalogRecord.bytes` is in the index for `predictLength` (§11), so the
 * decision is already in memory: **the gate costs no request.** That matters
 * because the refusal has to be renderable at the same instant the drawer opens
 * — a "View in 3D" button that appears, then retracts a round-trip later, is
 * worse than one that was never offered.
 *
 * `bytes` is a build-time snapshot, so it can in principle disagree with the
 * bucket. It is therefore not the only check: `loadModel.ts` caps the *actual*
 * stream at the same limit and aborts, which is the half that cannot be stale.
 *
 * Nothing in this module imports three, `@/materials` or React — the panel needs
 * the decision *before* it will pay for the 3D chunk.
 */
import type { CatalogRecord } from '@/catalog'

/**
 * The gate. 24 MiB.
 *
 * Both this and the stream cap in `loadModel.ts` read it, and
 * `gate.test.ts` pins the corpus coverage it implies, so moving it moves a
 * number a reviewer can see.
 */
export const STL_GATE_BYTES = 24 * 1024 * 1024

/** A binary STL's fixed preamble: 80-byte header + `uint32` facet count. */
export const STL_BINARY_HEADER_BYTES = 84

/** Bytes per binary facet: normal (12) + three vertices (36) + attribute (2). */
export const STL_BINARY_FACET_BYTES = 50

/** What the detail preview should show. */
export type ViewerMode = 'stl' | 'sprite'

export interface GateDecision {
  /** `'stl'` to offer the 3D view; `'sprite'` to stay on the pre-rendered sheet. */
  readonly mode: ViewerMode
  /** The record's `bytes`, carried so the refusal can quote it. */
  readonly bytes: number
  /** The limit that was applied. */
  readonly limit: number
  /** How far over the limit, in bytes; `0` when the gate passed. */
  readonly over: number
  /** One sentence, for the UI. Not an error message — a refusal is normal. */
  readonly reason: string
}

/**
 * Decide from the index alone.
 *
 * A zero-byte record is refused: there is nothing to fetch, and offering a 3D
 * view of nothing is a worse answer than the sprite sheet.
 */
export function stlGate(
  record: Pick<CatalogRecord, 'bytes'>,
  limit: number = STL_GATE_BYTES,
): GateDecision {
  const bytes = record.bytes

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return {
      mode: 'sprite',
      bytes,
      limit,
      over: 0,
      reason: 'The index records no file size for this tile, so there is nothing to load.',
    }
  }

  if (bytes > limit) {
    return {
      mode: 'sprite',
      bytes,
      limit,
      over: bytes - limit,
      reason:
        `This mesh is ${formatMegabytes(bytes)}, over the ${formatMegabytes(limit)} limit for ` +
        'in-browser 3D. The pre-rendered angles are the preview for this tile.',
    }
  }

  return {
    mode: 'stl',
    bytes,
    limit,
    over: 0,
    reason: `${formatMegabytes(bytes)} mesh, within the ${formatMegabytes(limit)} limit.`,
  }
}

/**
 * Facet count a binary STL of this size must hold.
 *
 * Exact for binary — the format is fixed-width — and used to size the "this
 * will take a moment" copy and the memory estimate. An ASCII file of the same
 * byte count holds roughly 20× fewer triangles, so this is an upper bound
 * there.
 */
export function estimateBinaryTriangles(bytes: number): number {
  if (bytes <= STL_BINARY_HEADER_BYTES) return 0
  return Math.floor((bytes - STL_BINARY_HEADER_BYTES) / STL_BINARY_FACET_BYTES)
}

/**
 * Bytes of typed array a mesh of this file size decodes to.
 *
 * Three vertices per facet, three floats each, **times two** for the recomputed
 * normals — `geometry.ts` recomputes them rather than trusting the file's, and
 * a non-indexed geometry cannot share a normal between faces. The GPU then
 * holds its own copy, so double this again for the resident total.
 */
export function estimateGeometryBytes(bytes: number): number {
  return estimateBinaryTriangles(bytes) * 3 * 3 * 4 * 2
}

/** `10.4 MB`. One decimal, decimal megabytes, matching the drawer's spec grid. */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
