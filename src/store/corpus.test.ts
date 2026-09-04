/**
 * The persisted shape, measured against the real corpus and the real templates.
 *
 * **This file changed subject in row A1, rather than being deleted with the
 * field it was written for.** It used to measure the library's key: the 8,702 →
 * 3,822 collapse, an `AggregateAddress`'s exposure to a sibling retiring, the
 * length of a design id against a file id. All of that went with `library`, and
 * so did the one claim it made that the *store* relied on — the `TileId` /
 * `DesignId` lexical disjointness, which existed so `salvageLibrary` could
 * recognise a file id sitting among the keys. `salvageLibrary` is gone, nothing
 * else in the app parses a key as a `TileId` to recognise an older shape, and a
 * measurement kept for a reader that no longer exists is the no-op the standing
 * instruction says to clean up.
 *
 * What replaced it is the same *kind* of file: the claims row A1's schema rests
 * on that are claims about the data rather than about the code, measured here so
 * that the argument in `schema.ts` fails a test rather than going stale.
 *
 *   1. **{@link TemplateId}'s pattern accepts what the build actually ships.** A
 *      pattern on a persisted identity is the only thing standing between a
 *      corrupt blob and an instance naming no template, and it is also the one
 *      way to refuse a legitimate id by accident.
 *   2. **A template id and a file id are lexically disjoint.** `migrations.ts`
 *      reports "template is not a template id" for a `tiles/…` path, and that
 *      message is only honest if no real template id is also a real file id.
 *   3. **A slot name is not a slug**, so `SlotName` cannot carry a pattern.
 *   4. **Part names are unique within a template**, which is what makes `fills`
 *      a map rather than an array — see `schema.ts#TemplateInstance`.
 *   5. **The three lock systems disagree for 37.1% of items**, which is the
 *      entire justification for `SlotFill.pinned` and therefore for contract
 *      **C-k**. This is the one measurement carried over unchanged, and it moved
 *      here from the library block because the field that needs it moved.
 *   6. **A fill map holds at most five entries**, which bounds the persisted
 *      payload and is where §3.4's "share fragments grow ~5x" comes from.
 *
 * `catalog.json` is gitignored and rebuilt from the fixtures
 * (`npm run import:catalog`). **CI does have it** — the stamp step regenerates it
 * from the pinned fixtures before the suite runs — so every figure below is
 * re-measured on each pull request. Absent, the corpus block skips **loudly**,
 * naming the path and the command, the precedent `src/search/corpus.test.ts`
 * sets. The template block needs no catalog and never skips.
 *
 * ## What this file cannot prove
 *
 * Nothing here runs the store. It reads the emitted index, the shipped template
 * table and arithmetic over them, so it says what the *shape* is worth; whether
 * the store keeps that shape correctly is `workshopStore.test.ts`'s job and
 * whether a foreign blob is refused is `migrations.test.ts`'s.
 *
 * It also reaches `@/screens/assemblies/templates` — the one import in this
 * directory that does, and it is deliberately confined to a test. `schema.ts`
 * spends its `TemplateId` docblock refusing that dependency for shipped code:
 * the store must not reach a screen, and the 40-entry table has no business in
 * its file closure. A test is where the two can be compared without either
 * importing the other.
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile as CatalogFileType, TileId } from '@/catalog'
import { CatalogFile, TileId as TileIdSchema, buildAggregateIndex, selectVariant } from '@/catalog'
import { PRINT_OPTIONS } from '@/assembly'
import { RECIPE_TEMPLATES } from '@/screens/assemblies/templates'

import { LockSystem, SlotName, TemplateId } from './schema'

const CATALOG = 'public/catalog/catalog.json'
const present = existsSync(CATALOG)
const describeCorpus = present ? describe : describe.skip
const title = present
  ? 'the persisted shape against the real corpus'
  : `the persisted shape — SKIPPED, no ${CATALOG} (run \`npm run import:catalog\`)`

function loadCatalog(): CatalogFileType {
  return CatalogFile.parse(JSON.parse(readFileSync(CATALOG, 'utf8')))
}

/* ------------------------------------------------------------- the templates */

describe('the persisted shape against the shipped templates', () => {
  it('accepts all 40 shipped template ids', () => {
    // The test that stops the pattern being tightened into something the
    // generator cannot satisfy. `pipeline/templates.ts#templateSlug` is
    // `toLowerCase().replace(/[^a-z0-9]+/g, '-')` with the ends trimmed, so this
    // is the *generator's* whole range checked against the *schema's*.
    expect(RECIPE_TEMPLATES).toHaveLength(40)
    for (const template of RECIPE_TEMPLATES) {
      expect(TemplateId.safeParse(template.id).success, template.id).toBe(true)
    }
    expect(new Set(RECIPE_TEMPLATES.map((template) => template.id)).size).toBe(40)
  })

  it('does not require the hyphen that all 40 happen to have', () => {
    // All 40 ids carry at least one hyphen, and requiring one would have bought
    // lexical disjointness from a `DesignId` (`d` + twelve hex, no hyphen). It is
    // deliberately not required: `templateSlug` produces a single segment from a
    // one-word family name, and row B4 generates 52 families from
    // `(role, form, build)` whose names this row cannot see. Refusing a
    // legitimate id is the worse failure — see `schema.ts#TemplateId`.
    expect(RECIPE_TEMPLATES.filter((template) => template.id.includes('-'))).toHaveLength(40)
    expect(TemplateId.safeParse('wall').success).toBe(true)
    expect(TemplateId.safeParse('d4c2a57740b65').success).toBe(true)
  })

  it('refuses the shapes migrations.ts reports by name', () => {
    // Each of these is a value `migrations.ts` can meet in the template slot,
    // and each has to fail the pattern for the report to be honest.
    for (const value of ['', 'tiles/x/y.stl', 'gen:bases-square', 'S2W-Corner', 'has space', 'trailing-', '-leading']) {
      expect(TemplateId.safeParse(value).success, value).toBe(false)
    }
  })

  it('keeps part names unique within a template, which is what makes fills a map', () => {
    // The fact that lets `fills` be a `Record<SlotName, SlotFill>` without
    // lying: an array would admit two fills for `floor` and need a policy for
    // which one wins. 0 of 40 templates has a repeated part name.
    for (const template of RECIPE_TEMPLATES) {
      expect(new Set(template.parts.map((part) => part.name)).size, template.id).toBe(template.parts.length)
    }
  })

  it('has slot names a slug pattern would refuse, so SlotName carries none', () => {
    // 128 parts over six distinct names — `column`, `right wall`, `left wall`,
    // `floor`, `base`, `wall` — and **8 parts carry one of the two names with a
    // space in it**. So a `TemplateId`-style pattern on a slot name would refuse
    // 8 of 128 shipped parts outright, which is why `SlotName` is `min(1)` and
    // the *meaning* check belongs to whoever holds the template.
    const parts = RECIPE_TEMPLATES.flatMap((template) => template.parts)
    expect(parts).toHaveLength(128)

    const names = new Set(parts.map((part) => part.name))
    expect([...names].sort()).toEqual(['base', 'column', 'floor', 'left wall', 'right wall', 'wall'])
    expect(parts.filter((part) => part.name.includes(' '))).toHaveLength(8)
    expect([...names].filter((name) => name.includes(' '))).toHaveLength(2)

    for (const name of names) {
      expect(SlotName.safeParse(name).success, name).toBe(true)
      expect(TemplateId.safeParse(name).success, name).toBe(name.includes(' ') ? false : true)
    }
  })

  it('bounds a fill map at five entries, which is where “~5x” comes from', () => {
    // §3.4, item 6: "slot fills become room state, so `SHARE_FORMAT_VERSION`
    // bumps and share fragments grow ~5x". This is that factor, measured: every
    // one of the 40 templates has either 3 or 5 parts, so a persisted instance
    // carries at most five fills where a version 5 placement carried one
    // identity. It is the bound on the payload rather than the mean of it.
    const counts = new Set(RECIPE_TEMPLATES.map((template) => template.parts.length))
    expect([...counts].sort()).toEqual([3, 5])
    expect(Math.max(...RECIPE_TEMPLATES.map((template) => template.parts.length))).toBe(5)
  })
})

/* ---------------------------------------------------------------- the corpus */

describeCorpus(title, () => {
  const file = present ? loadCatalog() : undefined
  const index = file === undefined ? undefined : buildAggregateIndex(file)

  it('keeps the template and file id spaces disjoint, which is what makes the report honest', () => {
    if (file === undefined) throw new Error('no catalog')
    // `migrations.ts` says "template is not a template id" when it meets a
    // `tiles/…` path in that slot, and the message is only capable of being
    // right if the two spaces cannot overlap. Structurally guaranteed —
    // `TileId` requires a `tiles/` prefix and `/` fails `TemplateId`'s pattern —
    // and measured here because "structurally guaranteed" is what a stale
    // docblock says.
    const tiles = new Set<TileId>(file.records.map((record) => record.id))
    expect(tiles.size).toBeGreaterThan(8000)
    expect([...tiles].filter((tile) => TemplateId.safeParse(tile).success)).toEqual([])
    expect(RECIPE_TEMPLATES.filter((template) => TileIdSchema.safeParse(template.id).success)).toEqual([])
  })

  it('gives every fill a file id the schema accepts', () => {
    if (file === undefined) throw new Error('no catalog')
    // `SlotFill.tile` is a `TileId`, so every record in the archive has to be
    // nameable by one or a legitimate fill would be unrepresentable. Row X5
    // tightened `TileId` from `min(1)` to a catalog path and this is that
    // tightening checked from the store's side.
    for (const record of file.records) {
      expect(TileIdSchema.safeParse(record.id).success).toBe(true)
    }
  })

  it('measures the lock disagreement that SlotFill.pinned exists for', () => {
    if (index === undefined) throw new Error('no catalog')
    // **The one measurement carried over from the library block, because the
    // field that needs it moved.** §2.1: a file-valued fill freezes the lock
    // choice at fill time, so without the `pinned` bit switching lock style
    // would leave a placed room unchanged — contradicting the requirement row V3
    // shipped, that the base a user sees follows their lock selection.
    //
    // The size of that failure is this number: for every item where the three
    // systems pick two or more distinct files, a room filled under one lock is
    // showing the wrong file under another. With the bit, C2 re-solves every
    // `auto` fill and leaves every `pinned` one alone.
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

    expect(index.aggregates.length).toBe(3822)
    expect(disagree).toBe(1419)
    expect(disagree / index.aggregates.length).toBeCloseTo(0.371, 3)
    // The distribution, because "37.1%" hides that 551 items have a *third*
    // distinct answer — those are the items where two lock changes move the fill
    // twice.
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
})
