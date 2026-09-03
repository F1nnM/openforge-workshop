/**
 * The library's key, measured against the real corpus.
 *
 * Row V1 changed `WorkshopState.library` from a map of files to a map of
 * **designs**, and three of the four claims that decision rests on are claims
 * about the data rather than about the code. They are measured here so that the
 * argument in `schema.ts` fails a test rather than going stale:
 *
 *   1. **The key survives a reimport.** A `DesignId` is a content hash of the
 *      design; an `AggregateAddress` is the lowest ordinal in the group and moves
 *      when a sibling file retires. The exposure is measured, not asserted.
 *   2. **The two key spaces are disjoint.** `migrations.ts` recognises a file id
 *      sitting in the library by parsing the key as a `TileId` *first*, and that
 *      check is only capable of anything if no real design id is also a real
 *      tile id.
 *   3. **The collapse is real.** Two saves of one item used to leave two
 *      entries, and how often that could happen is a corpus fact.
 *
 * The fourth claim — that the catalog card used to *display* one variant and
 * *persist* another — is row V5's measurement and is asserted in
 * `src/catalog/aggregate.test.ts`; the consequence for storage is asserted in
 * `src/screens/catalog/catalog.test.tsx`.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`). **CI does have it** — the stamp step regenerates it
 * from the pinned fixtures before the suite runs — so every figure below is
 * re-measured on each pull request. Absent, the block skips **loudly**, naming
 * the path and the command, the precedent `src/search/corpus.test.ts` sets.
 *
 * ## What this file cannot prove
 *
 * Nothing here runs the store. It reads the emitted index and arithmetic over
 * it, so it says what the key *is worth*; whether the store keeps the key
 * correctly is `workshopStore.test.ts`'s job and whether a foreign blob is
 * refused is `migrations.test.ts`'s. It also cannot prove the stability claim
 * *forward*: a design hash moving because someone edited a tag, and an address
 * moving because a file retired, are both events in a future import. What is
 * measured is the **exposure** — how many items each hazard could touch — and
 * that is the comparison the key choice actually turned on.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile as CatalogFileType, DesignId, TileId } from '@/catalog'
import { CatalogFile, DesignId as DesignIdSchema, TileId as TileIdSchema, buildAggregateIndex, selectVariant } from '@/catalog'
import { PRINT_OPTIONS } from '@/assembly'

import { LockSystem } from './schema'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)
const describeCorpus = present ? describe : describe.skip
const title = present ? 'the library key against the real corpus' : `the library key — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

function loadCatalog(): CatalogFileType {
  return CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
}

describeCorpus(title, () => {
  const file = present ? loadCatalog() : undefined
  const index = file === undefined ? undefined : buildAggregateIndex(file)

  it('collapses 8,702 files into 3,822 items at 2.28 files each', () => {
    if (file === undefined || index === undefined) throw new Error('no catalog')
    expect(file.records.length).toBe(8702)
    expect(index.aggregates.length).toBe(3822)
    expect(file.records.length / index.aggregates.length).toBeCloseTo(2.277, 3)

    // The bound on the collapse: a user who saved every file in the archive
    // holds 3,822 keys under this key and would have held 8,702 under the old
    // one — 56.1% fewer. Not a realistic library, but it is the exact figure
    // §7's "2.28 files per design" implies, and it is the ceiling every other
    // number here sits under.
    const reduction = 1 - index.aggregates.length / file.records.length
    expect(reduction).toBeCloseTo(0.561, 3)
  })

  it('gives every record a design, so no saved item can be unnameable', () => {
    if (file === undefined) throw new Error('no catalog')
    const designs = new Set<string>()
    for (const record of file.records) {
      expect(DesignIdSchema.safeParse(record.design).success).toBe(true)
      designs.add(record.design)
    }
    expect(designs.size).toBe(3822)
  })

  it('keeps the design and tile id spaces disjoint, which is what makes the salvage check work', () => {
    if (file === undefined) throw new Error('no catalog')
    // `DesignId` is `z.string().min(1)`, so it accepts a catalog path. The only
    // thing standing between a version 1-3 library and a version 4 one full of
    // phantom keys is that a real design id never parses as a `TileId` — which
    // is why `salvageLibrary` tries `TileId` first. Structurally guaranteed by
    // `pipeline/design.ts` (`d` + twelve hex characters), and measured here
    // because "structurally guaranteed" is what a stale docblock says.
    const designs = new Set<DesignId>(file.records.map((record) => record.design))
    const tiles = new Set<TileId>(file.records.map((record) => record.id))

    expect(designs.size).toBe(3822)
    expect([...designs].filter((design) => TileIdSchema.safeParse(design).success)).toEqual([])
    expect([...designs].filter((design) => !/^d[0-9a-f]{12}$/.test(design))).toEqual([])
    // And the other direction, which is the one a hand edit produces: every tile
    // id would be accepted by `DesignId` alone.
    expect([...tiles].every((tile) => DesignIdSchema.safeParse(tile).success)).toBe(true)
  })

  it('measures what an AggregateAddress key would have been exposed to', () => {
    if (index === undefined) throw new Error('no catalog')
    // `AggregateAddress`'s own docblock: *"NOT stable under retirement — if the
    // lowest-ordinal file leaves the corpus the address changes even though the
    // group only shrank"*. The population exposed to that is every multi-file
    // group, because a singleton's address can only change by the item itself
    // leaving, which is not an instability.
    const multi = index.aggregates.filter((aggregate) => aggregate.variants.length >= 2)
    expect(multi.length).toBe(1705)
    expect(multi.length / index.aggregates.length).toBeCloseTo(0.446, 3)

    // The addresses are unique, which is the property that makes an address a
    // usable *URL* — this row is not disputing that, only its use as a
    // persisted key.
    expect(new Set(index.aggregates.map((aggregate) => aggregate.address)).size).toBe(3822)

    // And the reason a stale address could not even be diagnosed: row A1 gave
    // the conversion no inverse, so nothing in `src/catalog` maps an address
    // back to a design except the index built from the current file.
    expect(index.byAddress.size).toBe(3822)
  })

  it('measures how often two saves of one item used to leave two entries', () => {
    if (index === undefined) throw new Error('no catalog')
    // The realistic collapse, through the app's own add path. The catalog card
    // used to save `selectVariant(item, { bottom: lock, options: PRINT_OPTIONS })`,
    // so the file it stored was a function of the lock preference — and for
    // every item where the three systems pick two or more distinct files,
    // pressing Add under one lock and again under another left the *same item*
    // in the library twice, under two keys that the library screen then had to
    // group and explain.
    const picks = new Map<number, number>()
    let disagree = 0
    for (const aggregate of index.aggregates) {
      const chosen = new Set<TileId>()
      for (const lock of LockSystem.options) {
        chosen.add(selectVariant(aggregate, { bottom: lock, options: PRINT_OPTIONS }).variant.id)
      }
      picks.set(chosen.size, (picks.get(chosen.size) ?? 0) + 1)
      if (chosen.size >= 2) disagree += 1
    }

    expect(disagree).toBe(1419)
    expect(disagree / index.aggregates.length).toBeCloseTo(0.371, 3)
    // The distribution, because "37.1%" hides that 551 items have a *third*
    // distinct answer: those could hold three entries for one item.
    //
    // The split is sensitive to `PRINT_OPTIONS`, and getting that wrong is how
    // this measurement was first made wrongly: passing the *modifier vocabulary*
    // (`topless`/`unsupported`/`flex`/`split`) instead of `@/assembly`'s
    // preference order (`plain`/`unsupported`/`topless`) moved the 2-answer and
    // 3-answer buckets to 868/551 and 852/567 respectively. **The total did not
    // move**, which is the reassuring part: 1,419 is a property of the locks
    // disagreeing and not of how ties are broken, and it is the figure
    // `assembly.test.ts` reports independently.
    expect(picks.get(1)).toBe(2403)
    expect(picks.get(2)).toBe(868)
    expect(picks.get(3)).toBe(551)
    expect(picks.get(4)).toBeUndefined()
  })

  it('shows the collapse is rare for a small library and unavoidable for a large one', () => {
    if (file === undefined || index === undefined) throw new Error('no catalog')
    // The honest shape of the many-to-one collapse, and it refutes the reading
    // that it fires constantly. Under **uniform random** file picks it is
    // negligible at library sizes anyone will have: the expected number of
    // duplicate-collapsing picks is 0.02 at ten files and 0.66 at sixty.
    //
    // Which is exactly why the 1,419 above is the number that matters. Nobody
    // assembles a library by picking files uniformly at random; they press Add
    // on one card, change the lock, and press Add again — and *that* path
    // collapses for 37.1% of items rather than for 1%.
    const sizes = index.aggregates.map((aggregate) => aggregate.variants.length)
    const total = file.records.length
    const expectedDesigns = (draw: number): number => {
      let sum = 0
      for (const size of sizes) {
        let none = 1
        for (let taken = 0; taken < size; taken += 1) none *= (total - draw - taken) / (total - taken)
        sum += 1 - none
      }
      return sum
    }

    expect(10 - expectedDesigns(10)).toBeCloseTo(0.02, 2)
    expect(60 - expectedDesigns(60)).toBeCloseTo(0.66, 2)
    expect(200 - expectedDesigns(200)).toBeCloseTo(7.17, 2)
  })

  it('costs a shorter key than the one it replaced, which the share codec argued from', () => {
    if (file === undefined || index === undefined) throw new Error('no catalog')
    // `src/share/scene.ts` excludes the library from a share link for two
    // reasons, and one of them is now much weaker: *"it also costs a full
    // `TileId` per entry, since a library tile has no placement to amortise an
    // ordinal against"*. A design id is 13 characters flat; a tile id runs 39 to
    // 183. So the cost argument is worth 3x to 14x less than when it was made,
    // and the other reason — the library is personal rather than about the
    // artefact — is the one still carrying the decision. Row V4 owns that file.
    const designLengths = new Set([...new Set(file.records.map((record) => record.design))].map((id) => id.length))
    const tileLengths = file.records.map((record) => record.id.length)

    expect([...designLengths]).toEqual([13])
    expect(Math.min(...tileLengths)).toBe(39)
    expect(Math.max(...tileLengths)).toBe(183)
    expect(index.aggregates.length).toBeLessThan(file.records.length)
  })
})
