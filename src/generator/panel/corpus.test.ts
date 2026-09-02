/// <reference types="node" />
/**
 * The resolver against all 1,963 archived bases.
 *
 * Skipped when `public/catalog/catalog.json` has not been built, the way
 * `src/composition/corpus.test.ts` and `src/search/corpus.test.ts` are, and CI
 * builds it before the suite runs.
 *
 * **This is the row's gate on base filenames.** Every archived base must fall
 * into one of five classes on evidence in its own name, cross-checked against a
 * field the pipeline derived independently from the tags; a name that falls into
 * none throws, and the census below is pinned so that a corpus which grew or
 * shrank fails with a number to read rather than passing quietly. The gate
 * belongs in `buildCatalog` and cannot go there yet: `tsconfig.node.json` would
 * have to list `src/generator/panel/resolve.ts` and `sweep.ts` in its `include`,
 * and that file is another row's. The request is filed in this row's report, the
 * way rows C1, W7 and X4 each filed theirs against the same file.
 */
import { existsSync, readFileSync } from 'node:fs'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import type { CatalogFile as CatalogFileType } from '@/catalog'

import { OPENING_STATE } from './GeneratorDrawer'
import { canonicalise, recipeKey } from './recipe'
import { buildBaseResolver, classifyArchiveBase, replayIndex } from './resolve'
import { PANEL_ENTRIES } from './schemas'
import { replaySweeps } from './sweep'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)
const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'the archive, all of it'
  : `the archive — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/** `pipeline/version.ts`'s epoch, so a payload figure is comparable across branches. */
const PAYLOAD_TIMESTAMP = '2026-01-01T00:00:00.000Z'

function brotli(text: string): number {
  return brotliCompressSync(Buffer.from(text, 'utf8'), {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
  }).length
}

describeCorpus(title, () => {
  const file = JSON.parse(readFileSync(CATALOG, 'utf8')) as CatalogFileType
  const bases = file.records.filter((record) => record.layer === 'base')
  const resolver = buildBaseResolver(file.records)
  const replayed = replayIndex()

  it('accounts for every archived base, and the classes are pinned', () => {
    // The gate. `classifyArchiveBase` throws on a name it cannot place, so
    // reaching this assertion at all means all 1,963 were placed.
    expect(resolver.census.bases).toBe(1963)
    expect({
      generated: resolver.census.generated,
      sculpted: resolver.census.sculpted,
      sizeCode: resolver.census.sizeCode,
      unsweptCoordinate: resolver.census.unsweptCoordinate,
      unsweptShape: resolver.census.unsweptShape,
    }).toEqual({
      // The sweep tables reproduce this many of the archive's base filenames.
      generated: 736,
      // Sculpted textures — cave, wood, brick, aztlan, sewer. No OpenSCAD path.
      sculpted: 728,
      // OpenLOCK letter codes. No generator parameter names one.
      sizeCode: 236,
      // A carried shape at a coordinate the tables do not sweep.
      unsweptCoordinate: 31,
      // A plain dimensioned base from a sweep the tables do not carry at all.
      unsweptShape: 232,
    })
    expect(
      resolver.census.generated +
        resolver.census.sculpted +
        resolver.census.sizeCode +
        resolver.census.unsweptCoordinate +
        resolver.census.unsweptShape,
    ).toBe(resolver.census.bases)
  })

  it('resolves 682 recipe keys and refuses 27 the archive answers twice', () => {
    expect(resolver.census.keys).toBe(682)
    // Three causes, all real: two archived files under two spellings of one
    // shape, two radial coordinate rows that write one filename, and one
    // duplicate name in two directories. Handing over either file would be
    // handing over a file that is not the one the parameters describe.
    expect(resolver.census.ambiguous).toBe(27)
    expect(resolver.census.keys + resolver.census.ambiguous).toBe(709)
  })

  it('replays 127 files the archive does not publish', () => {
    // The tables have moved since the sweep ran. These are recipes the panel can
    // still render; they are simply not cache hits.
    expect(resolver.census.unpublished).toBe(127)
    expect(replaySweeps()).toHaveLength(857)
  })

  it('opens every shape on a recipe the archive publishes', () => {
    for (const entry of PANEL_ENTRIES) {
      const recipe = { v: 1 as const, entry, parameters: canonicalise(entry, OPENING_STATE[entry]) }
      const hit = resolver.resolve(recipe)
      expect(hit, `${entry} must open on a cache hit`).not.toBeNull()
      expect(hit?.blob).toMatch(/^[0-9a-f]{32}$/)
    }
  })

  it('reaches 265 of the 442 archived bases from the shapes it offers', () => {
    let expressible = 0
    let unitDimension = 0
    let toplessLock = 0
    for (const record of bases) {
      const classified = classifyArchiveBase(record, replayed)
      if (classified.kind !== 'generated') continue
      if (!(PANEL_ENTRIES as readonly string[]).includes(classified.swept.entry)) continue
      const p = classified.swept.parameters
      const x = typeof p.x === 'number' ? p.x : 2
      const y = typeof p.y === 'number' ? p.y : 2
      if (x < 2 || y < 2) unitDimension += 1
      else if (p.LOCK === 'openlock_topless') toplessLock += 1
      else expressible += 1
    }
    // Reachable by setting controls: every value is in the schema's own options.
    expect(expressible).toBe(265)
    // Barred by the file's own `x`/`y` dropdown, which starts at 2.
    expect(unitDimension).toBe(147)
    // Barred by `LOCK`, which has no `openlock_topless`.
    expect(toplessLock).toBe(30)
    expect(expressible + unitDimension + toplessLock).toBe(442)
  })

  it('costs 3,776 B brotli to ship, at the payload epoch, so it is derived instead', () => {
    // Measured the way rows C1 and A1 measured theirs: the same file at
    // `PAYLOAD_EPOCH`, once without the field and once with it. Row X4
    // established that the clock alone swings this by 655 B, so a delta
    // measured at the build clock would not be a delta.
    const atEpoch = { ...file, version: { ...file.version, built: PAYLOAD_TIMESTAMP } }
    const baseline = brotli(JSON.stringify(atEpoch))
    expect(baseline).toBe(365_403)

    const map: Record<string, number> = {}
    for (const record of bases) {
      const classified = classifyArchiveBase(record, replayed)
      if (classified.kind !== 'generated') continue
      map[recipeKey({ v: 1, entry: classified.swept.entry, parameters: classified.swept.parameters })] = record.ord
    }
    expect(Object.keys(map)).toHaveLength(709)
    const withMap = brotli(JSON.stringify({ ...atEpoch, bases: map }))
    expect(withMap - baseline).toBe(3_776)
    // The row expected ~12 KB. It is 3.3x smaller than that and still 0 is
    // cheaper, because every input is already in the records.
    expect(withMap - baseline).toBeLessThan(12_288)
  }, 180_000)

  it('derives the map in well under a frame budget, once', () => {
    const started = performance.now()
    buildBaseResolver(file.records)
    const elapsed = performance.now() - started
    // Measured at 31 ms over all 8,702 records on the machine this was written
    // on. Asserted as a ceiling rather than a point, because a CI runner is not
    // that machine and the claim is "cheap enough to derive", not "31".
    expect(elapsed).toBeLessThan(400)
  })

  it('never resolves two different blobs to one recipe', () => {
    const seen = new Map<string, string>()
    for (const record of bases) {
      const classified = classifyArchiveBase(record, replayed)
      if (classified.kind !== 'generated') continue
      const recipe = { v: 1 as const, entry: classified.swept.entry, parameters: classified.swept.parameters }
      const hit = resolver.resolve(recipe)
      if (hit === null) continue
      const key = recipeKey(recipe)
      const held = seen.get(key)
      if (held !== undefined) expect(held).toBe(hit.blob)
      seen.set(key, hit.blob)
    }
    expect(seen.size).toBe(resolver.census.keys)
  })

  it('holds the archive’s bases as ASCII STL, which is why a hit is not a byte claim', () => {
    // Not fetched: the byte length in the index is enough to show the archive's
    // meshes are not what this engine writes. `engine.test.ts` renders the
    // candidates and compares the digests; this pins the arithmetic that says a
    // binary STL of that length would have a non-integral triangle count.
    const archived = bases.find((record) => record.file === 'plain#base+square.1x1.openlock,magnetic+flex.stl')
    expect(archived?.bytes).toBe(106_092)
    // A binary STL is 84 + 50n bytes. 106,092 is not.
    expect((106_092 - 84) % 50).not.toBe(0)
  })
})
