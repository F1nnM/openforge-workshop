/// <reference types="node" />
/**
 * The palette's claims about the corpus, measured.
 *
 * Row V3 turned a palette row from a file into an item, and three of the things
 * that makes safe are facts about the data rather than about the code. They are
 * measured here so the arguments in `palette.ts` and `PalettePanel.tsx` fail a
 * test rather than going stale:
 *
 *   1. **Refusing at item level is well posed.** `isPlaceable` used to be asked
 *      of a file. Asking it of an item is only honest if every variant of an item
 *      answers it the same way, which is a corpus property and not a type.
 *   2. **`variantClass === 'base-only'` is the same test as `layer === 'base'`.**
 *      The starter set used to skip base *records*; it now skips base *items*,
 *      and the two agree only because a base is always its own design.
 *   3. **The preview and the armed file disagree, and that is the row's point.**
 *      The panel deliberately renders one and arms the other. If the two rules
 *      ever coincided, half of `PalettePanel`'s docblock would be describing a
 *      distinction with no cases, and the wrong one could be deleted without a
 *      test noticing.
 *
 * A fourth block pins the starter set, because turning it over to items changed
 * its input type and must not have changed its answer.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`). **CI does have it** — the stamp step regenerates it
 * from the pinned fixtures before the suite runs. Absent, every block skips
 * **loudly**, naming the path and the command, the precedent
 * `src/search/corpus.test.ts` sets.
 *
 * ## What this file cannot prove
 *
 * Nothing here renders anything. It is arithmetic over the emitted index, so it
 * says the palette's *premises* hold; whether the panel then reads the right
 * field is `panels.test.tsx`'s job, and whether the row is legible at 272px is a
 * browser's. It also cannot prove any of this *forward*: a future import is free
 * to emit a design whose files disagree about a footprint, and the point of
 * measuring the zero is that such an import fails here instead of quietly
 * greying half a tile.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { selectVariantForLock } from '@/assembly'
import { isPlaceable } from '@/builder/canvas'
import type { CatalogFile, CatalogRecord, DesignId, TileAggregate, TileId } from '@/catalog'
import { CatalogFile as CatalogFileSchema, buildAggregateIndex } from '@/catalog'
import { LockSystem } from '@/store'

import type { PaletteLookup } from './palette'
import { libraryDesigns } from '@/store'

import { paletteRows, searchRows, starterSet } from './palette'

const CATALOG_PATH =
  process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadCatalog(): CatalogFile | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
}

const loaded = loadCatalog()

if (loaded === undefined) {
  process.stderr.write(
    [
      '',
      '='.repeat(72),
      '  builder/panels/palette.corpus.test: SKIPPED — no emitted catalog index.',
      `  Looked for: ${CATALOG_PATH}`,
      '  Build one with:  npm run import:catalog',
      '  Or point at one: OPENFORGE_CATALOG=/path/to/catalog.json',
      '='.repeat(72),
      '',
    ].join('\n'),
  )
}

const describeCorpus = loaded === undefined ? describe.skip : describe

// Safe: every block below is skipped when the index is absent.
const aggregates = loaded === undefined ? undefined : buildAggregateIndex(loaded)
const items: readonly TileAggregate[] = aggregates?.aggregates ?? []
const records: readonly CatalogRecord[] = loaded?.records ?? []
const byId = new Map(records.map((record) => [record.id as string, record]))

/** The records behind one item, which is what the file-level question was asked of. */
const filesOf = (item: TileAggregate): CatalogRecord[] =>
  item.variants.flatMap((variant) => {
    const record = byId.get(variant.id)
    return record === undefined ? [] : [record]
  })

/** The three locks, from the store's own enum rather than a fourth copy of the list. */
const LOCKS: readonly LockSystem[] = LockSystem.options

/* ------------------------------- 0. the wrong key, guarded by the compiler */

/**
 * The failure row V3 fixes, asserted by `tsc` rather than at runtime.
 *
 * The palette's library block rendered **empty** after row V1 re-keyed the
 * library, because `paletteRows(Object.keys(library) as TileId[], …)` kept
 * compiling. A comment saying "that cannot happen now" would be worth nothing, so
 * the three shapes that used to compile are written out here and each carries a
 * `@ts-expect-error` — which **fails the build if the error goes away.** That is
 * what makes the claim capable of failing.
 *
 * Nothing below runs, and it is deliberately not wrapped in an `it`: the
 * assertion is the compiler's, and an `it` with no `expect` in it would be a
 * passing test that proves nothing. `npm run typecheck` and `npm run build` both
 * compile this file.
 *
 * The pairing that makes it work is measured in `palette.ts`' module note:
 * `Record<TileId, true>` **is** assignable to `Record<DesignId, true>` (a
 * branded key collapses to a `string` index signature), while `TileId[]` is
 * **not** assignable to `DesignId[]`. So the array is the safe position, and
 * `libraryDesigns` is what carries the store's key type into it.
 */
declare const fileKeyedLibrary: Readonly<Record<TileId, true>>
declare const fileIds: readonly TileId[]
declare const lookupStub: PaletteLookup
declare const inLibraryByFile: (id: TileId) => boolean

// @ts-expect-error the pre-V1 library shape — a map keyed by file
export const rejectsAFileKeyedLibrary = () => paletteRows(libraryDesigns(fileKeyedLibrary), lookupStub)
// @ts-expect-error a bare array of file ids, which is what the old cast produced
export const rejectsFileIds = () => paletteRows(fileIds, lookupStub)
// @ts-expect-error a membership test that asks about a file rather than an item
export const rejectsAFileKeyedMembershipTest = () => searchRows(items, lookupStub, inLibraryByFile)

/** The shape that is meant to compile, so the three above are not rejecting everything. */
export const acceptsDesigns = (library: Readonly<Record<DesignId, true>>) =>
  paletteRows(libraryDesigns(library), lookupStub)

/* ------------------------------------------------ 1. placeability, at item level */

describeCorpus('a refusal is a property of the item', () => {
  it('is the same answer for every variant of every item', () => {
    const disagreeing = items.filter(
      (item) => new Set(filesOf(item).map((record) => isPlaceable(record))).size > 1,
    )

    // The claim `PalettePanel`'s handoff guard rests on: **no design in the
    // corpus mixes placeable and unplaceable files**, so a refused row cannot be
    // rescued by swapping to a sibling and the palette must not try.
    expect(disagreeing.map((item) => item.name)).toEqual([])

    // And every variant is accounted for — a `flatMap` that silently dropped an
    // id would make the line above vacuously true.
    expect(items.reduce((total, item) => total + filesOf(item).length, 0)).toBe(records.length)
  })

  it('refuses 370 items holding exactly the 726 refused files', () => {
    const refusedFiles = records.filter((record) => record.foot.shape === 'none')
    const refusedItems = items.filter((item) => !isPlaceable(item))

    expect(refusedFiles).toHaveLength(726)
    expect(refusedItems).toHaveLength(370)
    // The partition, which is the same zero as above said as a count: the refused
    // items hold all of the refused files and nothing else.
    expect(refusedItems.reduce((total, item) => total + item.variants.length, 0)).toBe(726)

    // 9.7% of items against 8.3% of files. `palette.ts` states both, because a
    // reader who knows only the file figure will under-count the greyed rows.
    expect(((refusedItems.length / items.length) * 100).toFixed(1)).toBe('9.7')
    expect(((refusedFiles.length / records.length) * 100).toFixed(1)).toBe('8.3')
  })
})

/* --------------------------------------------- 2. a base is always its own design */

describeCorpus('a base never shares an item with anything else', () => {
  it('holds no item mixing a base variant with a non-base one', () => {
    const mixed = items.filter(
      (item) =>
        item.variants.some((variant) => variant.layer === 'base') &&
        item.variants.some((variant) => variant.layer !== 'base'),
    )

    // `starterSet` skips `variantClass === 'base-only'` where it used to skip
    // `record.layer === 'base'`. This zero is what makes those the same test —
    // `shape|base` is part of the design key, so a base is its own design.
    expect(mixed.map((item) => item.name)).toEqual([])

    const baseOnly = items.filter((item) => item.variantClass === 'base-only')
    const baseFiles = records.filter((record) => record.layer === 'base')
    expect(baseOnly.reduce((total, item) => total + item.variants.length, 0)).toBe(baseFiles.length)
  })
})

/* ------------------------------------------------- 3. the preview is not the print */

/**
 * **Row V4 renamed the subject of this block and kept every number.**
 *
 * The palette no longer arms a file, so `armFile` is gone and these three tests
 * ask the same question of the function that took its place:
 * `selectVariantForLock`, which is rule 0's own preference and is what the bill,
 * the canvas and the slots panel all resolve through. The disagreement measured
 * here is therefore no longer "what the row shows against what the row arms" but
 * **"what the row shows against what the build prints"** — a stronger claim about
 * the same two functions, and the one the owner's defect was really about.
 */
describeCorpus('the row shows one file and the build prints another', () => {
  it('disagrees on every one of the 931 two-sided items under openlock', () => {
    const both = items.filter((item) => item.variantClass === 'both')
    expect(both).toHaveLength(931)

    // The owner's defect, counted. The palette used to render the file the
    // library held, which for these items was the `integral` — a tile with its
    // base welded on — while the catalog card showed the topper. The numbers are
    // unchanged by row V4, which is the point: the two functions are the same
    // two functions, and only the *caller* of the second one moved.
    const differing = both.filter((item) => selectVariantForLock(item, 'openlock').variant.id !== item.preview)
    expect(differing).toHaveLength(931)

    // The other two locks disagree less, because `selectVariant` only prefers the
    // integral when the integral offers the lock the build asked for.
    expect(both.filter((item) => selectVariantForLock(item, 'dragonlock').variant.id !== item.preview)).toHaveLength(269)
    expect(both.filter((item) => selectVariantForLock(item, 'magnetic').variant.id !== item.preview)).toHaveLength(396)
  })

  it('disagrees on 1,611 / 609 / 1,055 items over the whole corpus', () => {
    // Beyond the 931 the difference is `variantsByPreference`' `bytes`-ascending
    // tie-break, which a preview must not inherit: the smallest file in a group
    // is routinely the `topless` print, and a palette that showed the topless
    // variant of every tile would be answering a print-option question nobody
    // asked it.
    const counts = LOCKS.map(
      (lock) => items.filter((item) => selectVariantForLock(item, lock).variant.id !== item.preview).length,
    )
    expect(Object.fromEntries(LOCKS.map((lock, at) => [lock, counts[at]]))).toEqual({
      openlock: 1611,
      dragonlock: 609,
      magnetic: 1055,
    })
  })

  it('always arms a variant of the item it was asked about', () => {
    // `selectVariantForLock` is total — `variants` is a non-empty tuple — and it
    // must never reach outside the item, because every consumer of it (the bill's
    // rule 0, `PlanCatalog.record`, `planSlots`) looks the answer up in an index
    // and then reports the item it came from. A file from another item would put
    // somebody else's mesh under this tile's name.
    for (const lock of LOCKS) {
      const escaped = items.filter(
        (item) => !item.variants.some((variant) => variant.id === selectVariantForLock(item, lock).variant.id),
      )
      expect(escaped.map((item) => item.name), lock).toEqual([])
    }
  })
})

/* -------------------------------------------------------------- 4. the starter set */

describeCorpus('the starter set survived becoming a set of items', () => {
  it('is the same six dungeon_stone tiles, now named once each', () => {
    const starter = starterSet(items)
    const chosen = starter.map((designId) => aggregates?.byDesign.get(designId))

    // The record-level version of this function chose these six by name; the
    // item-level one chooses the same six, which is the whole claim of the
    // rewrite. Every field the choice turns on — `kinds`, `foot`, `texture`,
    // `name` — is a hoisted facet, so there was never a per-file question here.
    expect(chosen.map((item) => item?.name)).toEqual([
      'Dungeon Stone Block Floor 1x1',
      'Dungeon Stone Block Floor 2x2',
      'Dungeon Stone Block Floor 2x1',
      'Dungeon Stone Wall 1x IA',
      'Dungeon Stone Wall 2x A',
      'Dungeon Stone Wall 4x Q',
    ])

    // One texture, no bases, all placeable, six distinct designs.
    expect([...new Set(chosen.map((item) => item?.texture))]).toEqual(['dungeon_stone'])
    expect(chosen.every((item) => item?.variantClass !== 'base-only')).toBe(true)
    expect(chosen.every((item) => item !== undefined && isPlaceable(item))).toBe(true)
    expect(new Set(starter).size).toBe(6)
  })

  it('offers six items that are each themselves two-sided', () => {
    // Not decoration: all six are the `both` class, so before this row every one
    // of them opened the builder showing an `integral` — the starter set was the
    // defect at its most visible, on the first six rows a new user ever sees.
    const starter = starterSet(items)
    const classes = starter.map((designId) => aggregates?.byDesign.get(designId)?.variantClass)
    expect(classes).toEqual(['both', 'both', 'both', 'both', 'both', 'both'])
  })
})
