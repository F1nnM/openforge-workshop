/**
 * The plan: order, licensing entries, and the prediction.
 *
 * This is the suite that holds the Worker's plan assembly to
 * `src/download/plan.ts`'s. It cannot call `buildArchivePlan` from that module —
 * its type imports reach `@/assembly` → `@/store`, which needs DOM globals a
 * Worker project does not have, and that is the seam the PR reports. What it
 * *can* do, and does, is assert every observable consequence of that assembly
 * against the same shared functions the browser path uses:
 *
 *   - the entry order is `LICENSE.txt`, `ATTRIBUTION.csv`, then the models in
 *     request order;
 *   - `LICENSE.txt` is exactly `licenceText({ files, bytes, generatedAt })` with
 *     the file count, the *model* byte total and the request timestamp — the
 *     same three arguments `plan.ts` passes;
 *   - `ATTRIBUTION.csv` is exactly `attributionCsv(rows)` over rows carrying the
 *     entry name, the md5, every catalog path, the source URL, the size and the
 *     copy count — the same six fields `plan.ts` fills;
 *   - the published length is `predictZipLength` of the ordered metadata, which
 *     is the browser's own arithmetic.
 *
 * Because those functions are imported rather than reimplemented, an archive
 * from either path carries the same licence and the same table. The remaining
 * risk is the fifteen lines of assembly, and that is what is pinned here.
 */
import { describe, expect, it } from 'vitest'

import { attributionCsv, licenceText } from '../../src/download/attribution'
import { needsZip64, predictZipLength, utf8Length } from '../../src/download/clientZip'

import { ATTRIBUTION_ENTRY_NAME, LICENSE_ENTRY_NAME, buildArchivePlan, entryMetadata } from './archive'
import { validateArchiveRequest } from './request'
import { MODELS_BASE, md5, requestBody, requestFile, urlFor } from './testing/fixtures'

function planFor(files: readonly ReturnType<typeof requestFile>[]) {
  return buildArchivePlan(validateArchiveRequest(requestBody(files)), MODELS_BASE)
}

describe('entry order', () => {
  it('puts the licence and the attribution table in front of every model', () => {
    const plan = planFor([requestFile(1), requestFile(2)])
    expect(plan.entries.map((entry) => entry.name)).toEqual([
      LICENSE_ENTRY_NAME,
      ATTRIBUTION_ENTRY_NAME,
      'models/cave/wall-1.stl',
      'models/cave/wall-2.stl',
    ])
  })

  it('keeps the models in request order, because the prediction depends on offsets', () => {
    const plan = planFor([requestFile(3), requestFile(1), requestFile(2)])
    expect(plan.models.map((model) => model.md5)).toEqual([md5(3), md5(1), md5(2)])
  })

  it('has no way to suppress the licensing entries', () => {
    // Section 10, obligation 2 is a launch gate: there is no option, so there is
    // nothing to assert but that a minimal archive still carries both.
    const plan = planFor([requestFile(1)])
    expect(plan.entries.filter((entry) => entry.kind === 'text')).toHaveLength(2)
  })
})

describe('the licensing entries are the same bytes the browser writes', () => {
  it('writes LICENSE.txt with the file count, the model bytes and the timestamp', () => {
    const plan = planFor([requestFile(1, { bytes: 100 }), requestFile(2, { bytes: 250 })])
    const entry = plan.entries[0]
    expect(entry?.kind).toBe('text')
    expect(entry?.kind === 'text' ? entry.text : '').toBe(
      licenceText({ files: 2, bytes: 350, generatedAt: new Date('2026-09-02T10:00:00.000Z') }),
    )
  })

  it('prints model bytes, not archive bytes, in LICENSE.txt', () => {
    const plan = planFor([requestFile(1, { bytes: 1_000 })])
    expect(plan.modelBytes).toBe(1_000)
    expect(plan.predictedLength).toBeGreaterThan(plan.modelBytes)
    const entry = plan.entries[0]
    expect(entry?.kind === 'text' ? entry.text : '').toContain(licenceText({ files: 1, bytes: 1_000, generatedAt: plan.generatedAt }))
  })

  it('writes ATTRIBUTION.csv with one row per entry and the URL it will stream from', () => {
    const files = [requestFile(1, { bytes: 100, copies: 3, paths: ['tiles/a.stl', 'tiles/b.stl'] }), requestFile(2, { bytes: 250 })]
    const plan = planFor(files)
    const expected = attributionCsv([
      { entry: 'models/cave/wall-1.stl', md5: md5(1), catalogPaths: ['tiles/a.stl', 'tiles/b.stl'], sourceUrl: urlFor(1), bytes: 100, copies: 3 },
      { entry: 'models/cave/wall-2.stl', md5: md5(2), catalogPaths: ['tiles/cave/thick_wall/wall-2.stl'], sourceUrl: urlFor(2), bytes: 250, copies: 1 },
    ])
    const entry = plan.entries[1]
    expect(entry?.kind === 'text' ? entry.text : '').toBe(expected)
  })

  it('sizes the text entries in UTF-8 bytes rather than code units', () => {
    const plan = planFor([requestFile(1, { paths: ['tiles/cave/60°.stl'] })])
    for (const entry of plan.entries) {
      if (entry.kind === 'text') expect(entry.bytes).toBe(utf8Length(entry.text))
    }
    const csv = plan.entries[1]
    expect(csv?.kind === 'text' ? csv.bytes : 0).toBeGreaterThan(csv?.kind === 'text' ? csv.text.length : 0)
  })
})

describe('the prediction', () => {
  it('is predictZipLength of exactly the ordered metadata', () => {
    const plan = planFor([requestFile(1, { bytes: 4_096 }), requestFile(2, { bytes: 8_192 })])
    expect(plan.predictedLength).toBe(predictZipLength(entryMetadata(plan.entries)))
  })

  it('agrees with the writer about ZIP64', () => {
    const plan = planFor([requestFile(1, { bytes: 4_096 })])
    expect(plan.zip64).toBe(needsZip64(entryMetadata(plan.entries)))
    expect(plan.zip64).toBe(false)
  })

  it('calls for ZIP64 on a room past the 32-bit ceiling', () => {
    // Fifty placements at the corpus p95 of 32.87 MB is 1.6435 GB, which is
    // under 4 GB — but a large room with auto-inserted bases is not, and the
    // framing has to be right either side of that line.
    const files = Array.from({ length: 140 }, (_unused, index) =>
      requestFile(index, { name: `models/wall-${String(index)}.stl`, bytes: 32_870_000 }),
    )
    const plan = planFor(files)
    expect(plan.modelBytes).toBe(4_601_800_000)
    expect(plan.zip64).toBe(true)
    expect(plan.predictedLength).toBe(predictZipLength(entryMetadata(plan.entries)))
  })
})

describe('the URLs', () => {
  it('composes one per md5 from the bucket binding, never from the wire', () => {
    const plan = planFor([requestFile(1), requestFile(2)])
    expect(plan.models.map((model) => model.url)).toEqual([urlFor(1), urlFor(2)])
  })

  it('follows a different binding, so staging can point elsewhere', () => {
    const base = 'https://staging.example.com/assets/models'
    const plan = buildArchivePlan(validateArchiveRequest(requestBody([requestFile(1)])), base)
    expect(plan.models[0]?.url).toBe(urlFor(1, base))
  })
})
