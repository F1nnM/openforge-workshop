/**
 * Splitting an archive that would not fit in one file.
 *
 * `save.ts#BLOB_FALLBACK_LIMIT_BYTES` is a real ceiling for a browser with no
 * `showSaveFilePicker`: it buffers the whole archive into a `Blob`, so a room
 * a byte over the limit and a room ten times over it fail identically. Bin
 * packing the bill's files into several archives, each under the ceiling,
 * turns that hard refusal into "save N zips" — no server, and no list of raw
 * md5-named URLs to feed a download manager by hand.
 *
 * **First-fit-decreasing.** Largest files first, each into the first archive
 * with room, opening a new one only when none fits. It is the standard
 * approximation for bin packing and, more to the point here, deterministic:
 * `bill.lines` and a generated section's `meshes` are already in a fixed
 * order, ties are broken by that order, and the same bill packs into the
 * same N archives every time — which is what makes a snapshot test of this
 * module worth writing.
 *
 * **Each partition is built through {@link buildArchivePlan}, unchanged.**
 * A part is not a second zip-writing path: it is an ordinary `ArchivePlan`
 * over a subset of the bill's lines (and, if any land in it, a subset of the
 * generated meshes sharing the one notice), so every guarantee `plan.ts`
 * already gives an archive — the licensing entries first, unique entry
 * names, the exact `predictedLength`, the ZIP64 accounting — holds for a
 * part with no new code. `entries.ts`'s naming is safe to call per-partition
 * because `filenameCollides` is decided once, per bill, before this module
 * ever sees a line; which subset of lines is present does not change it.
 */
import type { BillLine, BillOfTiles } from '@/assembly'
import { downloadSize } from '@/assembly'
import type { BlobId } from '@/catalog'

import { EmptyArchiveError, buildArchivePlan, defaultFilename } from './plan'
import type { ArchivePlan, ArchivePlanOptions, GeneratedArchiveMesh, GeneratedArchiveSection } from './plan'

/**
 * Headroom reserved in every part for `LICENSE.txt`, `ATTRIBUTION.csv`,
 * `GENERATED.txt` and ZIP framing, so a partition's real
 * {@link ArchivePlan.predictedLength} lands under the limit without this
 * module having to build a plan just to find out.
 *
 * Measured, then doubled. `licenceText` is a fixed ~1.6 KB. An
 * `ATTRIBUTION.csv` row is at most a few hundred bytes — the widest corpus
 * field, the RFC-4180-quoted attribution sentence, is under 100 characters —
 * and a realistic partition holds tens to a few hundred files (the `huge`
 * verdict's own worked example is 177.7 median-sized files), so the whole
 * CSV costs tens of kilobytes, not megabytes. `GENERATED.txt` carries the
 * Apache-2.0 licence text, ~11 KB. ZIP framing is 46 bytes plus the entry
 * name per file, negligible at this scale. 2 MB is not a tight budget
 * against any of that; it is one that never has to be, which is the point
 * of reserving it rather than building a plan speculatively and re-packing
 * on a miss.
 */
export const SPLIT_OVERHEAD_BYTES = 2_000_000

/**
 * One file, or one generated mesh, is larger than a part can ever hold —
 * `bytes` alone, before any licensing overhead, exceeds `limit`.
 *
 * Splitting cannot help this case: moving the file to its own part does not
 * shrink it. It is not reachable against the live corpus — the largest
 * corpus file is 108.9 MB, far under any limit this module is called with —
 * but a generated base's size is bounded only by what OpenSCAD renders, so
 * this stays a real, named failure rather than an assumption.
 */
export class ArchivePartTooLargeError extends Error {
  readonly label: string
  readonly bytes: number
  readonly limit: number

  constructor(label: string, bytes: number, limit: number) {
    super(
      `"${label}" is ${String(bytes)} bytes, which alone is too large to fit in a ${String(limit)}-byte part ` +
        `(${String(SPLIT_OVERHEAD_BYTES)} bytes of every part are reserved for licensing and ZIP framing). ` +
        'Splitting the archive cannot help a single file that is already over the limit.',
    )
    this.name = 'ArchivePartTooLargeError'
    this.label = label
    this.bytes = bytes
    this.limit = limit
  }
}

export interface SplitArchiveOptions extends ArchivePlanOptions {
  /** The per-part ceiling — typically the browser's Blob-buffering limit. */
  limitBytes: number
}

/** One thing this module packs into a part: a bill line or a generated mesh. */
interface PackItem {
  readonly blob: BlobId
  readonly bytes: number
  readonly label: string
}

/**
 * Partition a bill (and, if given, a generated section) into several archive
 * plans, each under `options.limitBytes`.
 *
 * Returns one plan when everything already fits in one part — a caller does
 * not need to check first. Throws {@link EmptyArchiveError} for a bill with
 * nothing to pack (mirroring `buildArchivePlan`) and
 * {@link ArchivePartTooLargeError} for a single file too big for any part.
 */
export function splitArchivePlans(bill: Pick<BillOfTiles, 'lines' | 'download'>, options: SplitArchiveOptions): ArchivePlan[] {
  const { limitBytes, generated, filename, generatedAt: generatedAtOption, ...planOptions } = options
  const generatedAt = generatedAtOption ?? new Date()
  const budget = limitBytes - SPLIT_OVERHEAD_BYTES

  const fileItems: PackItem[] = bill.lines.map((line) => ({ blob: line.blob, bytes: line.bytes, label: line.entryName }))
  const meshItems: PackItem[] = (generated?.meshes ?? []).map((mesh) => ({ blob: mesh.blob, bytes: mesh.bytes, label: mesh.stem }))
  const items = [...fileItems, ...meshItems]

  if (items.length === 0) throw new EmptyArchiveError()

  for (const item of items) {
    if (item.bytes > budget) throw new ArchivePartTooLargeError(item.label, item.bytes, limitBytes)
  }

  // First-fit-decreasing: largest first, ties broken by original position —
  // `items` is `bill.lines` then `generated.meshes`, both already in a fixed
  // order, so this sort is stable and the result is deterministic.
  const byBucket = new Map<PackItem, number>()
  const bucketBytes: number[] = []
  const sorted = [...items].sort((a, b) => b.bytes - a.bytes)
  for (const item of sorted) {
    const fit = bucketBytes.findIndex((used) => used + item.bytes <= budget)
    if (fit === -1) {
      byBucket.set(item, bucketBytes.length)
      bucketBytes.push(item.bytes)
    } else {
      byBucket.set(item, fit)
      bucketBytes[fit] = (bucketBytes[fit] ?? 0) + item.bytes
    }
  }

  const partCount = bucketBytes.length
  const bucketIndex = (item: PackItem): number => {
    const index = byBucket.get(item)
    if (index === undefined) throw new Error(`unreachable: ${item.label} was never assigned a part`)
    return index
  }

  const linesByPart: BillLine[][] = Array.from({ length: partCount }, () => [])
  bill.lines.forEach((line, i) => {
    // Non-null: `fileItems` is `bill.lines.map(...)`, same length and order.
    linesByPart[bucketIndex(fileItems[i] as PackItem)]?.push(line)
  })

  const meshesByPart: GeneratedArchiveMesh[][] = Array.from({ length: partCount }, () => [])
  ;(generated?.meshes ?? []).forEach((mesh, i) => {
    meshesByPart[bucketIndex(meshItems[i] as PackItem)]?.push(mesh)
  })

  const stem = (filename ?? defaultFilename(generatedAt)).replace(/\.zip$/, '')

  return linesByPart.map((lines, index) => {
    const meshes = meshesByPart[index] ?? []
    const partBill = { lines, download: downloadSize(lines.reduce((sum, line) => sum + line.bytes, 0)) }
    const section: GeneratedArchiveSection | undefined =
      meshes.length === 0 || generated === undefined ? undefined : { meshes, notice: generated.notice }

    const plan = buildArchivePlan(partBill, {
      ...planOptions,
      generatedAt,
      filename: `${stem}-part-${String(index + 1)}-of-${String(partCount)}.zip`,
      ...(section === undefined ? {} : { generated: section }),
    })

    if (plan.predictedLength > limitBytes) {
      // Unreachable given SPLIT_OVERHEAD_BYTES's margin over a measured worst
      // case — asserted rather than trusted, the same discipline `entries.ts`
      // applies to its own uniqueness guarantee.
      throw new Error(
        `part ${String(index + 1)} of ${String(partCount)} came out ${String(plan.predictedLength)} bytes, over ` +
          `the ${String(limitBytes)}-byte limit — SPLIT_OVERHEAD_BYTES needs raising`,
      )
    }
    return plan
  })
}
