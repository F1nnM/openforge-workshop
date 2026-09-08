/**
 * The ported reading against the real corpus — **3,695 slots over 3,036 tiles**.
 *
 * Two jobs, and the second is the one that makes this file worth its runtime:
 *
 *   1. **Every figure in `measure.ts`'s docblock is re-measured here**, so the
 *      table of readings fails the suite rather than sitting stale. The byte
 *      prices that used to sit beside it are gone: the index has no size budget
 *      any more, and compressing 5.9 MB at quality 11 to restate a number nobody
 *      would act on was the most expensive thing in this suite.
 *   2. **The two readings are compared.** The plan's open question was "thousands
 *      versus twelve", and the whole value of the port is that it answers it with
 *      the function the live catalog serves compositions with. Both numbers are
 *      measured side by side so the answer is a comparison and not a claim.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`). **CI does have it** — the stamp step regenerates it
 * from the pinned fixtures first — so `assertComposition` below runs on every
 * pull request. Row X5 corrected this note, which claimed the file was absent in
 * CI — and that is why the same row declined C1's request to move
 * `assertComposition` into `pipeline/build.ts`: at a measured 644 ms per index it
 * would add ~3.2 s to `pipeline/catalog.test.ts` and no coverage at all, because
 * the assertion below already runs there. `tools/hygiene/project.test.ts` carries
 * that argument in full.
 *
 * Absent — a fresh checkout that has not imported — the whole block skips
 * **loudly**, naming the path and the command, the precedent
 * `pipeline/catalog.test.ts` and `src/search/corpus.test.ts` both set.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile as CatalogFileType, PartSlot, TileId } from '@/catalog'
import { CatalogFile } from '@/catalog'

import { createCompositionIndex } from './candidates'
import { assertComposition, measureComposition } from './measure'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)
const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'real corpus'
  : `real corpus — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

/** Materialising 99,931 candidate sets is the slow row of the pricing table. */
const SLOW_MS = 300_000

/** Ordinals ascending, delta-encoded — the leanest honest encoding of a set. */
function deltas(ordinals: readonly number[]): number[] {
  const sorted = [...ordinals].sort((a, b) => a - b)
  const out: number[] = []
  let previous = 0
  for (const ordinal of sorted) {
    out.push(ordinal - previous)
    previous = ordinal
  }
  return out
}

describeCorpus(title, () => {
  const file: CatalogFileType = present
    ? CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
    : ({ records: [], tags: [] } as unknown as CatalogFileType)

  const index = createCompositionIndex(file)
  const report = measureComposition(file)

  const ordOf = new Map<TileId, number>(file.records.map((record) => [record.id, record.ord]))
  const slotsOf = (): { tile: TileId; slot: PartSlot }[] =>
    file.records.flatMap((record) => (record.config?.parts ?? []).map((slot) => ({ tile: record.id, slot })))

  /* --------------------------------------------------------------- the shape */

  it('finds the composition corpus the plan describes', () => {
    expect(report.slots).toBe(3695)
    expect(report.tilesWithSlots).toBe(3036)
    expect(report.distinctSlots).toBe(110)
    expect(report.refs).toBe(99)
  })

  it('finds exactly four `constrain` roots and no source control at all', () => {
    // The decisive evidence: `constrain` refs are namespace roots that are not
    // tags, `require` refs are exact tags. A grammar with one rule for both
    // could not produce this split.
    expect(report.constrainRoots).toEqual(['shape', 'size|depth', 'size|width', 'texture'])
    expect(report.withSourceControl).toBe(0)
  })

  it('holds every `require` and `deny` ref against the tag table', () => {
    const dangling = report.constrainRoots
    const exact = index.refs.filter((ref) => !index.postings.idOf.has(ref))
    // The only refs that are not tags are the four prefix roots.
    expect(exact.sort()).toEqual(dangling)
  })

  /* ------------------------------------------------------------ the readings */

  it('narrows the median slot from thousands to twelve-ish', () => {
    console.log(
      `wide   sets ${String(report.wide.sets)} median ${String(report.wide.median)} mean ${String(report.wide.mean)} ` +
        `max ${String(report.wide.max)} empty ${String(report.wide.empty)} under50 ${String(report.wide.underFifty)}`,
    )
    console.log(
      `ported sets ${String(report.ported.sets)} median ${String(report.ported.median)} mean ${String(report.ported.mean)} ` +
        `max ${String(report.ported.max)} empty ${String(report.ported.empty)} under50 ${String(report.ported.underFifty)}`,
    )

    expect(report.wide.median).toBe(1868)
    expect(report.ported.median).toBe(14)
    expect(report.ported.underFifty).toBe(2843)
    expect(report.wide.median / report.ported.median).toBeCloseTo(133.4, 1)
  })

  it('leaves 9 slots nothing can fill, and 526 dead ends in the initial state', () => {
    expect(report.unsatisfiable).toHaveLength(9)
    expect(report.ported.empty).toBe(526)
    // 517 of the 526 are `base` slots emptied by an inherited texture.
    expect(report.deadEndBlame['texture|towne']).toBe(225)
    expect(report.deadEndBlame['shape|wall|low']).toBe(164)
    // One fixture defect requires and denies the same tag.
    expect(
      report.unsatisfiable.filter((slot) => slot.require.some((tag) => slot.deny.includes(tag))),
    ).toHaveLength(1)
  })

  it('passes its own assertions', () => {
    expect(() => {
      assertComposition(report)
    }).not.toThrow()
  })

  /* ------------------------------------------------------------- the pricing */

  it('prices the wide reading, deduplicated to the 110 distinct slots', () => {
    const seen = new Set<string>()
    const sets: number[][] = []
    for (const { slot } of slotsOf()) {
      const key = JSON.stringify(slot)
      if (seen.has(key)) continue
      seen.add(key)
      const candidates = index.candidatesFor({
        require: (slot.tags.require ?? []).map((ref) => ref.tag),
        deny: (slot.tags.deny ?? []).map((ref) => ref.tag),
        accept: [],
      })
      sets.push(deltas(candidates.tiles.map((tile) => ordOf.get(tile) ?? 0)))
    }
    // Deduplicating by the raw *declaration* lands on the same 110 as
    // `measure.ts`'s canonical key, which is itself a small corpus fact: no two
    // tiles write one slot with their refs in a different order, so the
    // order-insensitive key is currently buying nothing. It stays, because a key
    // that only works while the fixtures happen to be tidy is not a key.
    expect(sets.length).toBe(110)
  })

  it('resolves 3,695 tile-slots across the corpus', () => {
    /* The structural half of what used to be a pricing table: every slot every
       tile declares resolves, and the count is pinned. The two encodings this
       test used to weigh at brotli 11 are gone — payload was never what made the
       wide reading wrong, and `measure.ts` carries the argument that did. */
    const lean: number[][] = []
    for (const { tile, slot } of slotsOf()) {
      const candidates = index.resolve(slot, tile)
      lean.push(deltas(candidates.tiles.map((id) => ordOf.get(id) ?? 0)))
    }
    expect(lean.length).toBe(3695)
  })

  it(
    'materialises 99,931 candidate sets over every sibling-selection state',
    () => {
      const sets: number[][] = []
      for (const record of file.records) {
        const parts = record.config?.parts ?? []
        if (parts.length === 0) continue
        const base = parts.map((slot) => index.resolve(slot, record.id))
        if (parts.length === 1) {
          sets.push(deltas((base[0]?.tiles ?? []).map((id) => ordOf.get(id) ?? 0)))
          continue
        }
        parts.forEach((slot, at) => {
          const others = parts.map((_part, other) => other).filter((other) => other !== at)
          /* Every combination of picks for the other slots. A slot with no
             candidate contributes one "nothing chosen" state, so the product is
             never zero and the count is the honest number of sets. */
          const pools = others.map((other) => {
            const tiles = base[other]?.tiles ?? []
            return tiles.length === 0 ? [undefined] : [...tiles]
          })
          let states: (TileId | undefined)[][] = [[]]
          for (const pool of pools) {
            states = states.flatMap((state) => pool.map((pick) => [...state, pick]))
          }
          for (const state of states) {
            const siblings = state.map((pick, which) => ({
              partName: parts[others[which] ?? 0]?.name ?? '',
              tags: pick === undefined ? [] : index.tagsOf(pick),
            }))
            const candidates = index.resolve(slot, record.id, siblings)
            sets.push(deltas(candidates.tiles.map((id) => ordOf.get(id) ?? 0)))
          }
        })
      }

      expect(sets.length).toBe(99_931)
    },
    SLOW_MS,
  )

  it('costs 0 emitted bytes, and one measured index at run time', () => {
    console.log(`postings: ${String(report.postingsBytes)} B for ${String(file.tags.length)} tags over ${String(file.records.length)} records`)
    expect(report.postingsBytes).toBe(index.postings.bytes)
    // **101,427 since row B1**, which emits `role|<x>` and `form|<x>` as
    // interned tags: 84,023 scanned references plus two derived ones on each of
    // the 8,702 records. This directory needed **no code change** to accept a
    // `role|` predicate — `require` is exact equality against the intern table,
    // and the postings walk cannot tell a derived tag from a scanned one — and
    // the memory here is the whole price of that. `pipeline/role.ts` carries why
    // the alternative encodings were rejected.
    expect(index.postings.docs.length).toBe(101_427)
    expect(file.tags).toHaveLength(930)
    // The whole emitted-bytes claim, stated as an assertion: no module in this
    // directory is imported by `pipeline/`, so the artefact cannot contain
    // anything it produces.
    //
    // The ceiling moved with the references, from 400,000 B to 450,000 B, and
    // the headroom it leaves is deliberately the same fraction it always was:
    // 409,432 B measured (`(930 + 1) * 4` offsets plus `101,427 * 4` docs)
    // against 339,756 B before row B1, both about 10% under the line. It is a run-time
    // memory ceiling, not a payload one — the payload cost of the same change is
    // 1,165 B and is asserted in `src/generator/panel/corpus.test.ts`.
    expect(report.postingsBytes).toBe(409_432)
    expect(report.postingsBytes).toBeLessThan(450_000)
  })
})
