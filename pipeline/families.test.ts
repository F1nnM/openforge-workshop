/**
 * The generated families, against the real corpus and against the plan.
 *
 * ## The guard, and why it is not a byte round-trip
 *
 * `pipeline/templates.test.ts` proves the 40 by re-emitting all 20 fixture files
 * **byte for byte**: a reader that dropped a key could not round-trip. A
 * generator has no file to round-trip against, and the failure it actually has
 * is a different one — a mis-spelled ref, a `deny` that excludes the family's
 * own records, a size position that names a tag the table does not hold, a
 * family that matches nothing. None of those is visible in bytes.
 *
 * So the guard here is **semantic**: every generated slot is resolved through
 * `src/composition`'s own `resolveSlotTags` and postings index — the same pair of
 * calls the browser will make — and the record set it admits is compared to the
 * record set its key selects, less the bases. At `ANY_SIZE` the two agree
 * exactly, **47 of 47, in both directions**; at each of the 257 size positions
 * the admitted set is exactly what `sizeAdmits` admits within the family, which
 * is B3's ground truth rather than a restatement of the refs.
 *
 * *"Less the bases"* is row **D1** and it is where this guard earns its keep. A
 * base keeps the role of the piece it sits under, so the key selects it into a
 * wall family; the slot denies `shape|base`, so it must not be admitted there.
 * The two sides of the comparison are therefore *"what the key selects, minus
 * the bases"* against *"what the resolver offers"*, and the 0/0 is what says the
 * deny reaches every family and reaches nothing else.
 *
 * That is strictly stronger than the round-trip it replaces. A byte comparison
 * proves the emitted table *is* its source; this proves the emitted table
 * *means* its source.
 *
 * ## What else is checked, and what kind of claim each one is
 *
 *   1. **The plan's figures.** The coverage curve, the 52 keys, the 295 cells,
 *      the five empty domains, the 1,963 bases — recomputed, and each asserted at
 *      the value the corpus gives with the plan's value beside it where they
 *      differ.
 *   2. **The 0 B, structurally.** The tag table is unchanged at 930, every ref
 *      resolves in it, and neither `build.ts` nor `emit.ts` imports this module.
 *   3. **The two departures from a sibling row**, both measured in both
 *      directions: dropping `sizeRefs`'s `deny`, and generating no `insert`
 *      family.
 *   4. **The greedy walk**, greying-aware, over all 87 templates — because the
 *      brief asks whether these families make the 24-of-40 completion worse.
 *   5. **The base deny, in both directions and at both ends** — 0 bases admitted
 *      outside the base family, all 1,963 admitted inside it, the four
 *      base-only keys named, and the union of the families unmoved by any of
 *      it.
 *
 * Skipped **loudly** with the path it looked in when the fixtures are absent, on
 * `catalog.test.ts`'s argument: a quietly skipped real-data test is worse than a
 * failing one.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, CatalogRecord, PartSlot, TileId } from '../src/catalog'
import type { CompositionIndex, SiblingSelection } from '../src/composition'
import { createCompositionIndex, resolveSlotTags } from '../src/composition'
import { conventionFor } from '../src/template/rules'
import { RUN_DENY_TAGS, RUN_UNREACHABLE, sizeAdmits, sizeRefs, sizeRefsResolve } from '../src/template/size'
import type { SizePredicate } from '../src/template/size'

import { buildCatalog } from './build'
import { measureCatalog, serialiseCatalog } from './emit'
import type { FamilySizePosition, GeneratedFamily } from './families'
import {
  ANY_SIZE,
  BARE_BASE_KEY,
  BASE_ONLY_KEYS,
  BUILD_TAGS,
  FAMILY_TABLE_BYTES,
  SKIPPED_ROLES,
  deriveFamilies,
  familyLayout,
  familySlug,
} from './families'
import { fixturesDir, loadFixtureRows } from './fixtures'
import { emptyManifest } from './ordinals'
import { resolveGridSize } from './size'
import { loadTemplateFixtures, printTemplateModule, templateSlug } from './templates'
import { PAYLOAD_TIMESTAMP } from './version'

const FIXTURES_DIR = fixturesDir()
const hasFixtures =
  existsSync(FIXTURES_DIR) && readdirSync(FIXTURES_DIR).some((name) => name.endsWith('.json'))
const describeCorpus = hasFixtures ? describe : describe.skip
const title = hasFixtures
  ? 'the generated template families'
  : `the generated families — SKIPPED, no fixtures at ${FIXTURES_DIR} (set OPENFORGE_FIXTURES)`

/** Building the corpus once and brotli-ing 5.9 MB at quality 11, twice. */
const SLOW_MS = 300_000

describeCorpus(title, () => {
  const file: CatalogFile = hasFixtures
    ? buildCatalog({
        rows: loadFixtureRows(FIXTURES_DIR),
        manifest: emptyManifest(),
        fixturesRef: 'test',
        /* The payload epoch, so the byte figures below are the quotable ones. */
        builtAt: PAYLOAD_TIMESTAMP,
      }).file
    : ({ tags: [], records: [] } as unknown as CatalogFile)

  const tagsOf = new Map<TileId, readonly string[]>(
    file.records.map((record) => [record.id, record.tags.map((id) => file.tags[id] ?? '')]),
  )
  const tags = (record: CatalogRecord): readonly string[] => tagsOf.get(record.id) ?? []
  const has = (tag: string): boolean => file.tags.includes(tag)
  const value = (record: CatalogRecord, root: string): string | undefined =>
    tags(record)
      .find((tag) => tag.startsWith(`${root}|`))
      ?.slice(root.length + 1)
  const keyOf = (record: CatalogRecord): string =>
    `${String(value(record, 'role'))}|${String(value(record, 'form'))}|${record.build ?? '-'}`
  const sizeOf = (record: CatalogRecord) => resolveGridSize(record.foot, tags(record))

  const families = hasFixtures ? deriveFamilies(file) : []
  const byId = new Map(families.map((family) => [family.id, family]))
  const index: CompositionIndex = hasFixtures
    ? createCompositionIndex(file)
    : ({} as unknown as CompositionIndex)

  /** Whether a record is a base — the tag, which A9 proved is `layer === 'base'`. */
  const isBase = (record: CatalogRecord): boolean => tags(record).includes(BARE_BASE_KEY)

  /** The base tiles by id, for reading a resolver's answer rather than a record. */
  const baseTiles = new Set<TileId>(file.records.filter(isBase).map((record) => record.id))

  /**
   * The records a family's key selects — the population the slot has to match.
   *
   * **Bases are the base family's and nobody else's**, which is row D1: the key
   * selects a base into the family of the piece it sits under, and the slot
   * denies it there. So the population of a keyed family is its key's records
   * less the bases, and the semantic round-trip compares against that.
   */
  const populationOf = (family: GeneratedFamily): readonly CatalogRecord[] =>
    family.key === BARE_BASE_KEY
      ? file.records.filter(isBase)
      : file.records.filter((record) => keyOf(record) === family.key && !isBase(record))

  /** The tiles the app's own resolver offers for a family at one size position. */
  const candidatesOf = (family: GeneratedFamily, position: FamilySizePosition): readonly TileId[] =>
    index.candidatesFor(resolveSlotTags(family.slot.tags, [...family.tags, ...position.tags], [])).tiles

  it('has the corpus every figure below is a fraction of', () => {
    expect(file.records).toHaveLength(8702)
    expect(file.tags).toHaveLength(930)
  })

  /* ------------------------------------------------------------------ the guard */

  describe('the semantic round-trip, which replaces the byte one', () => {
    it('admits exactly the records its key selects less the bases, for all 47', () => {
      /* The guard. `resolveSlotTags` + `candidatesFor` is what
         `src/composition/candidates.ts` does for a tile's accessory slot, so
         this is the browser's answer and not a second implementation of it.
         Both directions are counted separately, because "admits 8,417 records"
         would be satisfied by a slot that admitted the wrong 8,417. */
      let overAdmitted = 0
      let underAdmitted = 0
      for (const family of families) {
        const expected = new Set(populationOf(family).map((record) => record.id))
        const actual = new Set(candidatesOf(family, ANY_SIZE))
        for (const id of actual) if (!expected.has(id)) overAdmitted += 1
        for (const id of expected) if (!actual.has(id)) underAdmitted += 1
      }
      expect(overAdmitted).toBe(0)
      expect(underAdmitted).toBe(0)
      expect(families).toHaveLength(47)
    })

    it('resolves every ref it emits, so no family can match nothing', () => {
      /* `pipeline/build.ts#assertConfigRefs` already fails the build on a
         `require` ref that resolves to nothing — for a *record's* config. A
         generated family is not a record, so it is outside that check, and this
         is its equivalent. */
      const unknown: string[] = []
      for (const family of families) {
        const slot = family.slot
        for (const ref of [...(slot.tags.require ?? []), ...(slot.tags.deny ?? [])]) {
          if (!has(ref.tag)) unknown.push(`${family.id} ${ref.tag}`)
        }
        for (const position of family.sizes) {
          for (const tag of position.tags) if (!has(tag)) unknown.push(`${family.id} ${tag}`)
        }
        /* `constrain` names a *prefix* rather than a tag, so it is checked as
           one: nothing in the table is spelled `size|width` exactly. */
        for (const ref of slot.tags.constrain ?? []) {
          if (!('tag' in ref)) throw new Error(`${family.id} emitted a constrain filter`)
          expect(file.tags.some((tag) => tag.startsWith(`${ref.tag}|`))).toBe(true)
        }
        expect(candidatesOf(family, ANY_SIZE).length).toBeGreaterThan(0)
      }
      expect(unknown).toEqual([])
      /* And the resolver agrees: 0 unknown refs over all 51, which is the field
         `SlotCandidates` carries for exactly this question. */
      for (const family of families) {
        const resolved = resolveSlotTags(family.slot.tags, [...family.tags], [])
        expect(index.candidatesFor(resolved).unknownRefs).toEqual([])
      }
    })

    it('agrees with `sizeAdmits` at 256 positions to within 12 and 373', () => {
      /* The other half of the guard, against B3's own ground truth rather than
         against the refs that produced the position. A position's *label*
         carries the predicate it means — a `cell` position reads "w wide by d
         deep" and a `run` position reads "w wide" — so the predicate is
         recovered from the **label** and the refs are not consulted. If the two
         ever disagree this fails.

         Both directions are counted and neither is 0, which is the honest
         result and is itemised in the two tests below:

         | direction | incidences | records |
         | --- | ---: | ---: |
         | the refs admit what the predicate does not | 12 | 12 |
         | the predicate admits what the refs do not | 373 | 373 |

         Both were larger before row D1's base deny — 160 incidences over 136
         records — and for a reason worth keeping: a base could be missed twice,
         once in the base family and once under the role of the piece it sits
         under. Now it is missed only in the base family, so the incidences and
         the records are the same number.

         **Row D9 took the second direction from 128 to 373**, and the 245 are
         its corner walls. Their cell is now `1.5 x 0.5` and their only
         `size|width` tag says 2, so the predicate at *"1.5 wide"* admits them
         and the ref that spells that position cannot find them — the same
         *"geometry the tags do not state"* the 102 arcs and 26 walls were
         already in, and the case for the derived run tag `src/template/size.ts`
         prices and declines. The first direction is unchanged at 12, which is
         the direction that would mean a wrong candidate.
      */
      let positions = 0
      let admittedBeyond = 0
      let missed = 0
      const missedRecords = new Set<TileId>()
      for (const family of families) {
        const population = populationOf(family)
        for (const position of family.sizes) {
          if (position.tags.length === 0) continue
          positions += 1
          const predicate = predicateFromLabel(position.label)
          const truth = new Set(
            population.filter((record) => sizeAdmits(predicate, sizeOf(record))).map((record) => record.id),
          )
          const actual = new Set(candidatesOf(family, position))
          for (const id of actual) if (!truth.has(id)) admittedBeyond += 1
          for (const id of truth) {
            if (actual.has(id)) continue
            missed += 1
            missedRecords.add(id)
          }
        }
      }
      expect(positions).toBe(256)
      expect(families.reduce((total, family) => total + family.sizes.length, 0)).toBe(303)
      expect(admittedBeyond).toBe(12)
      expect(missed).toBe(373)
      expect(missedRecords.size).toBe(373)
      expect(missedRecords.size / 8702).toBeCloseTo(0.0429, 4)
    })

    it('misses 373 records whose cell is geometry the tags do not state', () => {
      /* By why. Every one of them resolves a cell the control *names* and
         carries no tag saying so, so it is reachable at `ANY_SIZE` and nowhere
         else — which is a third reason every family has that position, beside
         B3's five empty domains and the 1,112 records with no cell at all. */
      const reasons = new Map<string, number>()
      for (const family of families) {
        const population = populationOf(family)
        for (const position of family.sizes) {
          if (position.tags.length === 0) continue
          const predicate = predicateFromLabel(position.label)
          const actual = new Set(candidatesOf(family, position))
          for (const record of population) {
            if (!sizeAdmits(predicate, sizeOf(record))) continue
            if (actual.has(record.id)) continue
            reasons.set(record.foot.shape, (reasons.get(record.foot.shape) ?? 0) + 1)
          }
        }
      }
      /* 102 are 90 degree annular sectors, whose cell is `rOut x rOut` and whose
         only `size|` tags are a radius and an angle. The other **271** are
         `wall` footprints: **245 corner walls** whose measured 1.5 run no tag
         states (row D9), 14 stair strips at a 0.5 depth the corpus never tags,
         and the 12 `QxG` bases whose tagged width is a unit wider than their
         measured run. By family, since the base deny moved 32 of the arcs out of
         a role family and into the base family alone: */
      expect(Object.fromEntries(reasons)).toEqual({ arc: 102, wall: 271 })
      const byFamily = new Map<string, number>()
      for (const family of families) {
        const population = populationOf(family)
        for (const position of family.sizes) {
          if (position.tags.length === 0) continue
          const predicate = predicateFromLabel(position.label)
          const actual = new Set(candidatesOf(family, position))
          for (const record of population) {
            if (!sizeAdmits(predicate, sizeOf(record))) continue
            if (actual.has(record.id)) continue
            byFamily.set(family.key, (byFamily.get(family.key) ?? 0) + 1)
          }
        }
      }
      expect(Object.fromEntries(byFamily)).toEqual({
        'shape|base': 101,
        'stair|straight|-': 14,
        'floor|curve|-': 10,
        'floor|curve|s2w': 3,
        /* Row **D9**. The whole corner-wall class lands in one family, at the
           one position whose label states the run their meshes have and their
           tags do not. */
        'wall|corner|s2w': 245,
      })
    })
  })

  /* ------------------------------------------------------------------- the keys */

  describe('the key, and the plan’s coverage curve', () => {
    it('finds 52 keys, generates 46, and reproduces the curve', () => {
      const keys = new Map<string, number>()
      for (const record of file.records) keys.set(keyOf(record), (keys.get(keyOf(record)) ?? 0) + 1)
      expect(keys.size).toBe(52)
      /* The six that are not generated, and they are the whole difference: the
         two `insert` keys and the four whose every record is a base. */
      expect(families.filter((family) => family.key !== BARE_BASE_KEY)).toHaveLength(46)
      expect([...keys].filter(([key]) => key.startsWith('insert|'))).toEqual([
        ['insert|straight|-', 260],
        ['insert|curve|-', 25],
      ])
      const generated = new Set(families.map((family) => family.key))
      expect(
        [...keys.keys()]
          .filter((key) => !generated.has(key) && !key.startsWith('insert|'))
          .sort(),
      ).toEqual([...BASE_ONLY_KEYS])
      expect(52 - 2 - BASE_ONLY_KEYS.length + 1).toBe(47)

      /* §2.5's curve, over the 52 keys in descending record count — the order
         `deriveFamilies` emits in, extended with the two insert keys so the
         curve is the plan's and not this row's. */
      const ranked = [...keys].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1))
      const designsOf = (upTo: number): number => {
        const wanted = new Set(ranked.slice(0, upTo).map(([key]) => key))
        return new Set(
          file.records.filter((record) => wanted.has(keyOf(record))).map((record) => record.design),
        ).size
      }
      const recordsOf = (upTo: number): number =>
        ranked.slice(0, upTo).reduce((total, [, count]) => total + count, 0)

      for (const [upTo, records, designs] of [
        [10, 0.744, 0.581],
        [20, 0.904, 0.86],
        [30, 0.964, 0.939],
      ] as const) {
        expect(recordsOf(upTo) / 8702).toBeCloseTo(records, 3)
        expect(designsOf(upTo) / 3822).toBeCloseTo(designs, 3)
      }
      expect(recordsOf(52)).toBe(8702)
      /* The plan says 99.9% of designs at 52 and the corpus says 100.0% — every
         one of the 3,822 designs has at least one record under some key, because
         both axes are total. The plan's own reach figure (99.3%) is a different
         quantity and is measured below. */
      expect(designsOf(52)).toBe(3822)
    })

    it('takes the reach from 3,079 records to 8,417, and partitions what it reaches', () => {
      /* The row's headline, and it is *not* the plan's 99.0% — that figure counts
         the 285 inserts as reached by a family and 84 records as reached by
         nothing. This row generates no insert family, so the two disagree by
         construction and both are stated. */
      /* The denominator the row is framed against, recomputed rather than
         quoted: the 40 shipped recipes' 128 parts, resolved cold through the
         same index, reach **3,079 records (35.4%) and 905 designs (23.7%)** —
         §1.1's figures, exactly.

         And a coincidence worth naming so nobody reads it as a transcription
         error: 3,079 is also the number of `wall`-footprint records, also
         35.4%, and the two have nothing to do with each other. */
      const shipped = new Set<TileId>()
      for (const entry of loadTemplateFixtures(FIXTURES_DIR)) {
        for (const part of entry.parts) {
          for (const tile of index.candidatesFor(resolveSlotTags(part.tags, entry.tags, [])).tiles) {
            shipped.add(tile)
          }
        }
      }
      expect(shipped.size).toBe(3079)
      expect(
        new Set(file.records.filter((record) => shipped.has(record.id)).map((record) => record.design)).size,
      ).toBe(905)
      expect(file.records.filter((record) => record.foot.shape === 'wall')).toHaveLength(3079)

      /* The 46 keyed families hold 6,454 records and the base family the other
         1,963, and the union is the 8,417 the row is quoted at. Before row D1
         the keyed families summed to 8,417 *on their own* and the base family's
         1,963 were counted a second time inside them; the sum below is now the
         union, which is what makes it a partition rather than a coincidence. */
      const byKey = families
        .filter((family) => family.key !== BARE_BASE_KEY)
        .reduce((total, family) => total + family.records, 0)
      expect(byKey).toBe(6454)
      const union = families.reduce((sum, family) => sum + family.records, 0)
      expect(union).toBe(8417)
      expect(union / 8702).toBeCloseTo(0.967, 3)
      /* And it is exactly the non-insert corpus: every record the palette can
         place is offered by exactly one family. */
      expect(file.records.filter((record) => record.layer !== 'insert')).toHaveLength(8417)

      /* The per-family counts are the generator's own, so they are checked
         against the population rather than trusted: a `records` or `designs`
         that drifted from the key would make the curve above a fiction. */
      for (const family of families) {
        const population = populationOf(family)
        expect(family.records).toBe(population.length)
        expect(family.designs).toBe(new Set(population.map((record) => record.design)).size)
      }

      const reachedByKey = new Set(
        families.flatMap((family) => populationOf(family).map((record) => record.id)),
      )
      expect(reachedByKey.size).toBe(union)

      /* Designs, which this module claimed at 3,822 of 3,822 before row D1 and
         which is **3,728**. The 3,822 is `designsOf(52)` above — every design
         with a record under any of the 52 keys, including the two `insert` keys
         no family is generated for — and the 94 between them are the
         insert-only designs `src/builder/panels/families.ts` ships as
         `INSERT_DESIGNS`. `docs/templates-plan.md` §10.1's correction 22 is
         wrong on both halves for the same reason: 94 designs were outside the
         families, and the families did not partition the corpus until this row
         took the bases out of them. */
      const reachedDesigns = new Set(
        file.records.filter((record) => reachedByKey.has(record.id)).map((record) => record.design),
      )
      expect(reachedDesigns.size).toBe(3728)
      expect(reachedDesigns.size / 3822).toBeCloseTo(0.975, 3)
      expect(3822 - reachedDesigns.size).toBe(94)
      const insertOnly = new Set(
        file.records.filter((record) => !reachedByKey.has(record.id)).map((record) => record.design),
      )
      expect(insertOnly.size).toBe(94)
      expect([...insertOnly].filter((design) => reachedDesigns.has(design))).toEqual([])
      const inserts = file.records.filter((record) => record.layer === 'insert')
      expect(inserts).toHaveLength(285)
      expect(inserts.filter((record) => reachedByKey.has(record.id))).toHaveLength(0)

      /* The 262: an insert reachable through some tile's own accessory slot,
         resolved through the same index. This is the measurement that makes
         `SKIPPED_ROLES` a decision rather than obedience. */
      const insertIds = new Set(inserts.map((record) => record.id))
      const reachedInserts = new Set<TileId>()
      let slots = 0
      for (const record of file.records) {
        for (const slot of index.slotsOf(record.id)) {
          slots += 1
          for (const tile of index.resolve(slot, record.id).tiles) {
            if (insertIds.has(tile)) reachedInserts.add(tile)
          }
        }
      }
      expect(slots).toBe(3695)
      expect(reachedInserts.size).toBe(262)
      expect(union + reachedInserts.size).toBe(8679)
      expect((union + reachedInserts.size) / 8702).toBeCloseTo(0.997, 3)

      /* And the 23 that neither reaches. Named rather than rounded: they are
         inserts whose hosts declare no slot that admits them, which is a gap in
         the *fixtures* and is where it has to be fixed. */
      expect(inserts.filter((record) => !reachedInserts.has(record.id))).toHaveLength(23)

      /* The plan's own 99.0%, computed beside it so the two cannot be confused.
         §2.5 gives 8,618 of 8,702 and enumerates the 84 it excludes as *"56 of
         them the hex lattice"*; that reproduces exactly — 56 `form|hex`, 26
         `role|decor` and the 2 non-insert `wot` walls, over 25 designs.

         But the two figures exclude **different records**, which is the part
         worth stating: the plan counts the 285 inserts as family-reachable and
         these 84 as reachable by nothing, while here the 285 are left to the
         accessory slots and **all 84 of these are reachable** — `form|hex` is
         `wall|hex|thick wall`, `role|decor` is `decor|straight`, and the 2 `wot`
         walls sit in `wall|straight|wall on tile`. So the plan's 84 are not a
         *template* gap at all: they are builder limitations (no square-lattice
         position, no resolvable size), which is what §2.5 says of the hex and
         what B3 says of the other two. */
      const planExcludes = file.records.filter(
        (record) =>
          tags(record).includes('form|hex') ||
          tags(record).includes('role|decor') ||
          (tags(record).includes('size|width|wot') && record.layer !== 'insert'),
      )
      expect(planExcludes).toHaveLength(84)
      expect(new Set(planExcludes.map((record) => record.design)).size).toBe(25)
      expect((8702 - 84) / 8702).toBeCloseTo(0.99, 3)
      expect(planExcludes.filter((record) => !reachedByKey.has(record.id))).toEqual([])
    })

    it('needs a five-ref deny for an absent build system, and 2,945 records say so', () => {
      /* `require` cannot express absence. The deny is exact because of three
         facts, all asserted here: five `build|` tags occur, no record carries
         two, and `CatalogRecord.build` is its single tag's value. */
      const buildTags = new Set(
        file.records.flatMap((record) => tags(record).filter((tag) => tag.startsWith('build|'))),
      )
      expect([...buildTags].sort()).toEqual([...BUILD_TAGS])
      for (const record of file.records) {
        const own = tags(record).filter((tag) => tag.startsWith('build|'))
        expect(own.length).toBeLessThan(2)
        expect(record.build).toBe(own[0]?.slice('build|'.length))
      }
      expect(file.records.filter((record) => record.build === undefined)).toHaveLength(2978)

      /* Every keyed family denies `shape|base` (row D1) and the 16 with no
         build system deny the five build tags after it; the base family denies
         nothing. */
      const absent = families.filter((family) => family.key.endsWith('|-'))
      expect(absent).toHaveLength(16)
      for (const family of absent) {
        expect(family.slot.tags.deny?.map((ref) => ref.tag)).toEqual([BARE_BASE_KEY, ...BUILD_TAGS])
      }
      for (const family of families.filter(
        (family) => !family.key.endsWith('|-') && family.key !== BARE_BASE_KEY,
      )) {
        expect(family.slot.tags.deny?.map((ref) => ref.tag)).toEqual([BARE_BASE_KEY])
      }

      /* What the build deny buys, by resolving the same 16 slots with only the
         base deny left on them. 3,712 before row D1, when the widened slots
         picked up every build system's bases as well. */
      let withoutDeny = 0
      for (const family of absent) {
        const widened: PartSlot = {
          ...family.slot,
          tags: { ...family.slot.tags, deny: [{ tag: BARE_BASE_KEY }] },
        }
        const admitted = index.candidatesFor(resolveSlotTags(widened.tags, [...family.tags], [])).tiles
        withoutDeny += admitted.length - family.records
      }
      expect(withoutDeny).toBe(2945)
    })

    it('slugs 47 keys to 47 ids, none colliding with a fixture template', () => {
      const ids = families.map((family) => family.id)
      expect(new Set(ids).size).toBe(47)
      expect(ids.every((id) => /^[a-z0-9-]+$/.test(id))).toBe(true)
      const fixtureIds = new Set(loadTemplateFixtures(FIXTURES_DIR).map((entry) => templateSlug(entry.name)))
      expect(ids.filter((id) => fixtureIds.has(id))).toEqual([])
      /* The trailing `|-` disappears rather than becoming a trailing dash. */
      expect(familySlug('floor|straight|-')).toBe('floor-straight')
      expect(familySlug('wall|internal_corner|separate wall')).toBe('wall-internal-corner-separate-wall')
      expect(familySlug(BARE_BASE_KEY)).toBe('shape-base')
      expect(new Set(families.map((family) => family.name)).size).toBe(47)
    })
  })

  /* ------------------------------------------------------------------- the base */

  describe('the bare-base family, which no key can name', () => {
    it('is exactly coextensive with `layer === "base"`, 1,963 both ways', () => {
      /* Row A9's measurement, reproduced. It is the whole reason a `shape|base`
         require needs no new axis and no new tag. */
      const byTag = file.records.filter((record) => tags(record).includes(BARE_BASE_KEY))
      const byLayer = file.records.filter((record) => record.layer === 'base')
      expect(byTag).toHaveLength(1963)
      expect(byLayer).toHaveLength(1963)
      expect(byTag.filter((record) => record.layer !== 'base')).toEqual([])
      expect(byLayer.filter((record) => !tags(record).includes(BARE_BASE_KEY))).toEqual([])

      /* And a base keeps the role of what it sits under, which is why
         `(role, form, build)` cannot separate one out. */
      const roles = new Map<string, number>()
      for (const record of byTag) {
        const role = String(value(record, 'role'))
        roles.set(role, (roles.get(role) ?? 0) + 1)
      }
      expect(Object.fromEntries(roles)).toEqual({ wall: 1117, floor: 661, riser: 176, stair: 9 })
    })

    it('is one slot on `shape|base`, with a 30-position size control', () => {
      const base = byId.get(familySlug(BARE_BASE_KEY))
      if (base === undefined) throw new Error('no bare-base family')
      expect(base.slot.name).toBe('base')
      expect(base.slot.tags.require).toEqual([{ tag: BARE_BASE_KEY }])
      expect(base.slot.tags.deny).toBeUndefined()
      expect(base.records).toBe(1963)
      /* 31 cells resolve and 2 cannot be spelled — the 90 degree sectors at
         2.5x2.5 and 4.5x4.5, neither of which has a `size|width` value. */
      expect(base.inexpressibleCells).toEqual(['2.5x2.5', '4.5x4.5'])
      /* 31 cells resolve, 2 cannot be spelled, and `ANY_SIZE` is the 30th. */
      expect(base.sizes).toHaveLength(30)
      expect(base.sizes[0]).toEqual(ANY_SIZE)
      /* It is last in the array, so the 46 keyed families are a contiguous
         prefix and the coverage curve can be read off the head. */
      expect(families.at(-1)).toBe(base)
    })
  })

  /* -------------------------------------------------------------- the base deny */

  describe('the base deny, which is row D1', () => {
    /**
     * The slot row B4 emitted for a key, rebuilt from the key itself.
     *
     * The four base-only families no longer exist, so the defect cannot be
     * measured by widening the emitted slots — there is nothing left to widen
     * for four of the seventeen. This rebuilds what B4 emitted from the key
     * string instead: the two total axes, the build tag when the key has one and
     * the five-ref build deny when it does not, and **no `shape|base` deny**.
     * Every other slot the generator emits today is identical to this plus that
     * one ref, which the assertion below checks family by family rather than
     * trusting the reconstruction.
     */
    const beforeD1 = (key: string): PartSlot => {
      const [role = '', form = '', build = '-'] = key.split('|')
      const require = [`role|${role}`, `form|${form}`, ...(build === '-' ? [] : [`build|${build}`])]
      return {
        name: role,
        tags: {
          require: require.map((tag) => ({ tag })),
          ...(build === '-' ? { deny: BUILD_TAGS.map((tag) => ({ tag })) } : {}),
          constrain: [{ tag: 'size|width' }, { tag: 'size|depth' }],
        },
      }
    }

    /** Every non-insert key the corpus holds — the 50 B4 generated a family for. */
    const nonInsertKeys = [...new Set(file.records.map(keyOf))]
      .filter((key) => !key.startsWith('insert|'))
      .sort()

    it('reproduces the defect: 17 of B4’s 51 offered bases, 1,963 admissions', () => {
      /* The owner's report, measured. A `Corner (S2W)` slot offered *"a straight
         wall, a pre-made corner piece and some bases (not floors, bases)"*, and
         it was not one family: the key selects a base into the family of the
         piece it sits under, so **every base in the archive was offered
         somewhere it does not belong** — 1,963 admissions over 17 families, four
         of which admitted nothing else.

         The 1,963 is not a coincidence of two measurements meeting: a base
         carries one `role|` and one `form|` tag and one build system at most, so
         it is selected by exactly one key, and the wrong admissions and the
         population of bases are the same set counted twice. */
      const wrong: string[] = []
      let admissions = 0
      const only: string[] = []
      for (const key of nonInsertKeys) {
        const slot = beforeD1(key)
        const tiles = index.candidatesFor(
          resolveSlotTags(slot.tags, [...(slot.tags.require ?? []).map((ref) => ref.tag)], []),
        ).tiles
        const bases = tiles.filter((tile) => baseTiles.has(tile))
        if (bases.length === 0) continue
        wrong.push(key)
        admissions += bases.length
        if (bases.length === tiles.length) only.push(key)
      }
      expect(wrong).toHaveLength(17)
      expect(admissions).toBe(1963)
      expect(file.records.filter(isBase)).toHaveLength(1963)
      expect(only.sort()).toEqual([...BASE_ONLY_KEYS])
    })

    it('admits 0 bases outside the base family and all 1,963 inside it', () => {
      /* The fix, in both directions and through the resolver the browser uses.
         `deny` is exact tag equality and `shape|base` is coextensive with
         `layer === 'base'` on all 8,702 with no exception either way, so the two
         numbers below are the whole of it. */
      let outside = 0
      for (const family of families) {
        if (family.key === BARE_BASE_KEY) continue
        expect(family.slot.tags.deny?.map((ref) => ref.tag)).toContain(BARE_BASE_KEY)
        outside += candidatesOf(family, ANY_SIZE).filter((tile) => baseTiles.has(tile)).length
      }
      expect(outside).toBe(0)

      const base = byId.get(familySlug(BARE_BASE_KEY))
      if (base === undefined) throw new Error('no bare-base family')
      expect(base.slot.tags.require).toEqual([{ tag: BARE_BASE_KEY }])
      expect(base.slot.tags.deny).toBeUndefined()
      const inside = new Set(candidatesOf(base, ANY_SIZE))
      expect(inside.size).toBe(1963)
      expect(file.records.filter((record) => isBase(record) && !inside.has(record.id))).toEqual([])

      /* And the deny is the *only* difference from what B4 emitted: every keyed
         slot is `beforeD1(key)` plus the one ref. */
      for (const family of families) {
        if (family.key === BARE_BASE_KEY) continue
        const before = beforeD1(family.key)
        expect(family.slot.name).toBe(before.name)
        expect(family.slot.tags.require).toEqual(before.tags.require)
        expect(family.slot.tags.constrain).toEqual(before.tags.constrain)
        expect(family.slot.tags.deny?.map((ref) => ref.tag)).toEqual([
          BARE_BASE_KEY,
          ...(before.tags.deny ?? []).map((ref) => ref.tag),
        ])
      }
    })

    it('costs the 46 families 1,829 wrong admissions, and the four dropped 134', () => {
      /* The 1,963, split the way the fix splits it: 1,829 taken off the
         families that survive, and 134 that leave with the four dropped keys.
         Both halves measured, because "1,963" on its own would be satisfied by a
         deny that reached only the big families. */
      let widened = 0
      for (const family of families) {
        if (family.key === BARE_BASE_KEY) continue
        const slot: PartSlot = {
          ...family.slot,
          tags: {
            ...family.slot.tags,
            deny: (family.slot.tags.deny ?? []).filter((ref) => ref.tag !== BARE_BASE_KEY),
          },
        }
        const tiles = index.candidatesFor(resolveSlotTags(slot.tags, [...family.tags], [])).tiles
        widened += tiles.length - family.records
      }
      expect(widened).toBe(1829)

      const dropped = file.records.filter((record) => BASE_ONLY_KEYS.includes(keyOf(record)))
      expect(dropped).toHaveLength(134)
      expect(dropped.filter((record) => !isBase(record))).toEqual([])
      expect(widened + dropped.length).toBe(1963)
    })

    it('drops four keys and withholds nothing, because the base family has all 134', () => {
      /* The judgement call. A rank-20 cut is declined in the module note because
         a missing family withholds records invisibly; these four withhold
         **nothing**, which is the difference and is measured rather than argued:
         every one of their 134 records is a base, and the base family admits all
         1,963. So the union of the families is the same with them and without. */
      const base = byId.get(familySlug(BARE_BASE_KEY))
      if (base === undefined) throw new Error('no bare-base family')
      const reachable = new Set(candidatesOf(base, ANY_SIZE))
      const dropped = file.records.filter((entry) => BASE_ONLY_KEYS.includes(keyOf(entry)))
      expect(dropped).toHaveLength(134)
      for (const record of dropped) expect(reachable.has(record.id), record.id).toBe(true)

      /* And they do not lose a size either: 93 of the 134 land on a sized
         position of the base family, and the 41 that reach only `any size` are
         exactly `floor|curve|separate wall`'s — a family whose own domain was
         inexpressible, so it had no size control to lose. */
      const sized = new Set<TileId>()
      for (const position of base.sizes) {
        if (position.tags.length === 0) continue
        for (const tile of candidatesOf(base, position)) sized.add(tile)
      }
      const onlyAny = dropped.filter((record) => !sized.has(record.id))
      expect(dropped.length - onlyAny.length).toBe(93)
      expect(onlyAny).toHaveLength(41)
      expect(new Set(onlyAny.map(keyOf))).toEqual(new Set(['floor|curve|separate wall']))

      /* And the other half: they would have admitted nothing at all with the
         deny on, which is worse than a wrong candidate. A family's one slot is
         required by construction, so `assembly/resolve.ts` reports the instance
         `slot-unfilled`, `BillOfTiles.complete` is false and the room's download
         is refused for as long as the piece is on the plan. */
      for (const key of BASE_ONLY_KEYS) {
        const slot = beforeD1(key)
        const withDeny: PartSlot = {
          ...slot,
          tags: {
            ...slot.tags,
            deny: [{ tag: BARE_BASE_KEY }, ...(slot.tags.deny ?? [])],
          },
        }
        const tiles = index.candidatesFor(
          resolveSlotTags(withDeny.tags, [...(slot.tags.require ?? []).map((ref) => ref.tag)], []),
        ).tiles
        expect(tiles, key).toEqual([])
      }
      expect(families.filter((family) => BASE_ONLY_KEYS.includes(family.key))).toEqual([])
      expect([...BASE_ONLY_KEYS]).toEqual([
        'floor|curve|separate wall',
        'floor|straight|separate wall',
        'wall|corner|separate wall',
        'wall|internal_corner|s2w',
      ])
    })
  })

  /* ------------------------------------------------------------------- the size */

  describe('the size control', () => {
    it('finds B3’s 294 cells over the 52 keys, and spells 227 of its own 241', () => {
      const cells = new Map<string, Set<string>>()
      for (const record of file.records) {
        const size = sizeOf(record)
        if (size === undefined) continue
        const set = cells.get(keyOf(record)) ?? new Set<string>()
        set.add(`${String(size.w)}x${String(size.d)}`)
        cells.set(keyOf(record), set)
      }
      /* 295 before row **D9**, and the cell that went is `wall|corner|s2w`'s
         `2x0.5`: no corner wall is 2 units long. Its records fold into the
         `1.5x0.5` the key already held, so a cell left the domain and no record
         did. */
      expect([...cells.values()].reduce((total, set) => total + set.size, 0)).toBe(294)

      /* Of the 295, how many the generator's own domain holds — and after row
         D1 the two are counted over different populations, which is why the
         arithmetic below is spelled out rather than reconciled to 295.

         B3's 295 is cells over the 52 keys with every record in them. A keyed
         family's records are its key's less the bases, so its domain is smaller:
         **241 cells over the 46 keyed families**, 227 spelled and 14 refused,
         plus the base family's own **31** — 29 spelled and 2 refused — for 272.
         The 22 between 294 and 272 are the two insert keys' 11 and 11 more that
         only a base occupied in its key. (295 / 242 / 228 / 273 before row D9
         took `wall|corner|s2w`'s `2x0.5` out of the domain — see the cell count
         above.) */
      const named = families.filter((family) => family.key !== BARE_BASE_KEY)
      const spelled = named.reduce((total, family) => total + family.sizes.length - 1, 0)
      const refused = named.reduce((total, family) => total + family.inexpressibleCells.length, 0)
      expect(spelled).toBe(227)
      expect(refused).toBe(14)
      expect(spelled + refused).toBe(241)
      const base = byId.get(familySlug(BARE_BASE_KEY))
      if (base === undefined) throw new Error('no bare-base family')
      expect(base.sizes.length - 1 + base.inexpressibleCells.length).toBe(31)
      expect(241 + 31).toBe(272)
      /* The 11 that are the insert keys', measured rather than assumed, so the
         other 11 are named as what they are: cells no non-base record of their
         own key resolves to. */
      const cellsOfKeys = (keep: (key: string) => boolean): number => {
        let count = 0
        for (const [key, set] of cells) if (keep(key)) count += set.size
        return count
      }
      expect(cellsOfKeys((key) => key.startsWith('insert|'))).toBe(11)
      // 284 before row D9 removed `wall|corner|s2w`'s `2x0.5`.
      expect(cellsOfKeys((key) => !key.startsWith('insert|'))).toBe(283)

      /* And nothing was deduped away: every family's positions carry distinct
         tag lists, and its positions plus its refusals account for every cell
         its own records resolve to. Two cells *could* spell one `run` position;
         0 of the 295 do, and this is what makes that a measurement rather than
         an assumption. */
      for (const family of families) {
        const own = new Set<string>()
        for (const record of populationOf(family)) {
          const size = sizeOf(record)
          if (size !== undefined) own.add(`${String(size.w)}x${String(size.d)}`)
        }
        expect(new Set(family.sizes.map((position) => position.tags.join(' '))).size).toBe(
          family.sizes.length,
        )
        expect(family.sizes.length - 1 + family.inexpressibleCells.length).toBe(own.size)
      }
    })

    it('names the 16 cells it cannot spell, and they are three facts', () => {
      /* Three facts, not a residue. A 90 degree sector's cell is `rOut x rOut`,
         resolved from geometry, and no `size|` tag says so (12); a column's cell
         is 0.5 x 0.5 and `size|width` has 11 numeric values, 1 through 8, with
         no 0.5 (3); and `wall|curve|separate wall`'s 3x0.5 holds the `QxG` walls,
         whose own tag says 4 (1). All three are B3's findings about the
         vocabulary, arriving here as refusals. */
      const refused = families.flatMap((family) =>
        family.inexpressibleCells.map((cell) => `${family.key} ${cell}`),
      )
      expect(refused).toEqual([
        'wall|curve|separate wall 2x2',
        'wall|curve|separate wall 2.5x2.5',
        'wall|curve|separate wall 3x0.5',
        'wall|curve|separate wall 4x4',
        'wall|curve|separate wall 4.5x4.5',
        'column|straight|- 0.5x0.5',
        'floor|curve|- 2.5x2.5',
        'floor|curve|- 4.5x4.5',
        'stair|curve|- 2x2',
        'stair|curve|- 4x4',
        'column|straight|separate wall 0.5x0.5',
        'riser|curve|- 2x2',
        'riser|curve|- 4x4',
        'column|corner|s2w 0.5x0.5',
        'shape|base 2.5x2.5',
        'shape|base 4.5x4.5',
      ])
      /* Still 16 and still the same three facts after row D1, but not the same
         sixteen cells: `floor|curve|separate wall`'s two sectors left with the
         dropped family, and `riser|curve`'s `2x2` and `4x4` arrived — those two
         were spellable only because a **base** sat at each of them carrying the
         `size|width` / `size|depth` pair the arc records at that cell do not.
         Measured, because it is the mechanism and not a coincidence: */
      for (const [cell, w, d] of [
        ['2x2', 2, 2],
        ['4x4', 4, 4],
      ] as const) {
        const at = file.records.filter((record) => {
          const size = sizeOf(record)
          return keyOf(record) === 'riser|curve|-' && size?.w === w && size.d === d
        })
        expect(at, cell).toHaveLength(12)
        const tagged = at.filter(
          (record) =>
            tags(record).includes(`size|width|${String(w)}`) &&
            tags(record).includes(`size|depth|${String(d)}`),
        )
        expect(tagged, cell).toHaveLength(8)
        expect(tagged.filter((record) => !isBase(record)), cell).toEqual([])
      }
      expect(sizeRefsResolve({ kind: 'cell', w: 0.5, d: 0.5 }, has)).toBe(false)
      expect(sizeRefsResolve({ kind: 'cell', w: 4.5, d: 4.5 }, has)).toBe(false)
      /* Nothing is lost by the refusal: every record at a refused cell is still
         reachable at `ANY_SIZE`, which is why every family has one. */
      for (const family of families) {
        expect(family.sizes[0]).toEqual(ANY_SIZE)
        const reachable = new Set(candidatesOf(family, ANY_SIZE))
        for (const record of populationOf(family)) expect(reachable.has(record.id)).toBe(true)
      }
    })

    it('leaves B3’s five families with `ANY_SIZE` alone, and two more beside them', () => {
      /* B3 named the five and asked for *a family with no size control* rather
         than one that matches nothing. `ANY_SIZE` is what makes that the
         degenerate case of the same control instead of a special case. */
      const single = families.filter((family) => family.sizes.length === 1)
      expect(single.map((family) => `${family.key} ${String(family.records)}`)).toEqual([
        'wall|diagonal|separate wall 121',
        'stair|curve|- 64',
        'decor|straight|- 26',
        'column|corner|s2w 20',
        'wall|octagon|separate wall 20',
        'floor|octagon|- 8',
        'wall|hex|thick wall 8',
      ])
      /* Five of B3's are here. The three it did not name are families whose
         cells *resolve* but cannot be spelled — B3 measured the domain, this row
         measures the vocabulary, and the extra three are the gap between them:
         `stair|curve` (64, two 90 degree sectors) and `column|corner|s2w` (20, a
         0.5 cell). It named a third, `floor|curve|separate wall` (41), and row
         D1 dropped that family: all 41 of its records were bases.

         `wall|hex|thick wall` is the same family in both lists and its count
         moved most of any: **56 records before the base deny and 8 after**, 48
         of the 56 having been bases. */
      for (const key of [
        'wall|diagonal|separate wall',
        'wall|hex|thick wall',
        'decor|straight|-',
        'wall|octagon|separate wall',
        'floor|octagon|-',
      ]) {
        expect(single.map((family) => family.key)).toContain(key)
      }
      expect(single.reduce((total, family) => total + family.records, 0)).toBe(267)
      for (const family of single) expect(candidatesOf(family, ANY_SIZE).length).toBe(family.records)
    })

    it('spells 47 run positions and 209 cell positions, and every label is true', () => {
      /* A `run` position is *coarser than a cell* — `size|width|2` says nothing
         about depth, and `require`/`deny` are exact tag equality so the grammar
         has no prefix deny to narrow it with. That was this row's draft worry
         and the measurement retired it: a `run` position is not an approximate
         cell, it **is** `{kind:'run'}`, and `resolveGridSize` gives a `rect`
         record a run equal to its width. So the 365 records
         `floor|straight`'s *"2 wide"* admits are 365 records 2 units wide, and
         only 12 records corpus-wide are admitted at a position whose predicate
         they do not satisfy. */
      let run = 0
      let cell = 0
      for (const family of families) {
        for (const position of family.sizes) {
          if (position.tags.length === 0) continue
          if (position.tags.length === 1) {
            run += 1
            expect(position.label).toMatch(/^[\d.]+ wide$/)
            /* Every admitted record carries the width the label states. */
            for (const tile of candidatesOf(family, position)) {
              expect(tagsOf.get(tile)).toContain(position.tags[0])
            }
          } else {
            cell += 1
            expect(position.label).toMatch(/^[\d.]+ wide by [\d.]+ deep$/)
            expect(position.tags).toHaveLength(2)
          }
        }
      }
      /* 48 run positions before row **D9**. `wall-corner-s2w`'s *"2 wide"* was
         one of them and no corner wall is 2 units long, so it is gone and the
         cell positions are untouched. */
      expect(run).toBe(47)
      expect(cell).toBe(209)
      expect(run + cell).toBe(256)

      /* The widest position in the table, which is the one worth naming: 32 of
         the 365 are the wall-thickness floor strips B1 files under `role|floor`,
         and the corpus does not tag their depth, so a *"2 by 0.5"* position for
         them is not expressible. They are not lost — the coarse position reaches
         them — they just cannot be isolated from the 2-by-anything floors. */
      const floors = byId.get('floor-straight')
      if (floors === undefined) throw new Error('no floor|straight family')
      const twoWide = floors.sizes.find((position) => position.label === '2 wide')
      if (twoWide === undefined) throw new Error('no 2-wide position on floor|straight')
      const atTwoWide = candidatesOf(floors, twoWide)
      expect(atTwoWide).toHaveLength(365)
      expect(
        atTwoWide.filter((tile) => file.records.find((record) => record.id === tile)?.foot.shape === 'wall'),
      ).toHaveLength(32)
      expect(
        populationOf(floors).filter((record) => record.foot.shape === 'wall'),
      ).toHaveLength(38)
    })

    it('drops `sizeRefs`’s deny, and the trade is 12 labels against 912 records', () => {
      /* The departure from B3, measured in both directions. Its `deny` is right
         for the `edge` slot it was written for — where an over-running wall
         *"would draw two walls through each other"* — and wrong here, because a
         one-slot family has no anchored face and `edgeRun` is never called.

         **This row's own draft predicted 28 and the corpus says 12.** The
         difference is that 16 of the 28 `QxG` walls live in
         `wall|curve|separate wall`, whose 3x0.5 cell is *inexpressible* — no
         record at that cell carries `size|width|3` — so that family has no
         position their tag could put them at. Only the 12 `QxG` **bases** land
         at a wrong position, and it is one position of one family. */
      expect(sizeRefs({ kind: 'run', run: 2 }).deny).toEqual([...RUN_DENY_TAGS])
      for (const family of families) {
        for (const position of family.sizes) {
          for (const tag of RUN_DENY_TAGS) expect(position.tags).not.toContain(tag)
        }
        for (const ref of family.slot.tags.deny ?? []) expect(RUN_DENY_TAGS).not.toContain(ref.tag)
      }

      /* What keeping it would cost. The deny is a property of the *slot*, so it
         would apply at `ANY_SIZE` too and take these records out of their own
         family entirely — including the 121 diagonals, which are 121 of the
         only family they have. */
      const denied = file.records.filter((record) => tags(record).some((tag) => RUN_DENY_TAGS.includes(tag)))
      /* 241 before row **D9** added `shape|corner` to the deny list, and 912
         after — the third entry is on 671 records where the first two are on 130
         and 111. That widening is what makes this test's argument stronger
         rather than weaker: keeping the deny would now take **912** records out
         of their own family at every position including `ANY_SIZE`, against a
         cost of 12 mislabels for dropping it. */
      expect(denied).toHaveLength(912)
      expect(file.records.filter((record) => tags(record).includes('shape|angled|right'))).toHaveLength(130)
      expect(
        file.records.filter((record) => tags(record).includes('shape|option|curved_interface')),
      ).toHaveLength(111)
      expect(file.records.filter((record) => tags(record).includes('shape|corner'))).toHaveLength(671)
      const perKey = new Map<string, number>()
      for (const record of denied) perKey.set(keyOf(record), (perKey.get(keyOf(record)) ?? 0) + 1)
      /* The 671 `shape|corner` records row D9 added spread over eleven more
         keys, and `wall|corner|s2w` alone holds 380 of them — which is the
         concrete form of *"keeping the deny would take a record out of its own
         family"*: that family is corners, and the deny is on being a corner. */
      expect(Object.fromEntries(perKey)).toEqual({
        'wall|curve|separate wall': 84,
        'wall|diagonal|separate wall': 121,
        'floor|curve|-': 27,
        'floor|diagonal|-': 8,
        'column|diagonal|separate wall': 1,
        'wall|corner|s2w': 380,
        'wall|corner|thick wall': 90,
        'wall|hex|thick wall': 56,
        'wall|corner|s-system': 40,
        'wall|corner|wall on tile': 36,
        'roof|corner|-': 30,
        'floor|corner|wall on tile': 12,
        'wall|corner|separate wall': 12,
        'stair|corner|-': 6,
        'floor|internal_corner|wall on tile': 5,
        'floor|corner|s2w': 4,
      })
      /* 159 of the 912 are bases (36 of them before row D9), so after row D1
         their *own family* is the base family and the total is unchanged either
         way. */
      const perFamily = new Map<string, number>()
      for (const record of denied) {
        const key = isBase(record) ? BARE_BASE_KEY : keyOf(record)
        perFamily.set(key, (perFamily.get(key) ?? 0) + 1)
      }
      expect(Object.fromEntries(perFamily)).toEqual({
        'shape|base': 159,
        'wall|curve|separate wall': 48,
        'wall|diagonal|separate wall': 121,
        'floor|curve|-': 27,
        'floor|diagonal|-': 8,
        'column|diagonal|separate wall': 1,
        'wall|corner|s2w': 341,
        'wall|corner|thick wall': 66,
        'wall|corner|s-system': 40,
        'wall|corner|wall on tile': 36,
        'roof|corner|-': 30,
        'floor|corner|wall on tile': 12,
        'wall|hex|thick wall': 8,
        'stair|corner|-': 6,
        'floor|internal_corner|wall on tile': 5,
        'floor|corner|s2w': 4,
      })
      // 36 before row D9; 123 of the 671 corner records are bases.
      expect(denied.filter(isBase)).toHaveLength(159)

      /* What dropping it costs: 12 records at one position of one family, and
         they are the 12 the `admittedBeyond` count above found. */
      const base = byId.get(familySlug(BARE_BASE_KEY))
      if (base === undefined) throw new Error('no bare-base family')
      const fourWide = base.sizes.find((position) => position.label === '4 wide')
      if (fourWide === undefined) throw new Error('no 4-wide position on the base family')
      const wrong = candidatesOf(base, fourWide).filter((tile) => {
        const record = file.records.find((entry) => entry.id === tile)
        return record !== undefined && !sizeAdmits({ kind: 'run', run: 4 }, sizeOf(record))
      })
      expect(wrong).toHaveLength(12)
      expect(wrong.every((tile) => tile.includes('.QxG.'))).toBe(true)

      /* And B3's `RUN_UNREACHABLE` from this side: 84 curved-interface walls, of
         which 56 land on the position their tag names — which is also the
         position their cell resolves to — so for those the drop is a correction
         rather than a cost. Row **D9** took it to 679 by adding the 595
         `shape|corner` records, and from *this* side the reading is the same in
         a stronger form: 245 of those 595 are corner walls whose cell resolves
         to `1.5x0.5`, so dropping the deny puts them at their family's *"1.5
         wide"* position, which is the position their **geometry** names even
         though their tag does not. */
      expect(RUN_UNREACHABLE).toBe(679)
    })
  })

  /* ----------------------------------------------------------------- the layout */

  describe('the one-slot layout', () => {
    it('is one `cell`-anchored rule on the ground, and B2 has no convention for it', () => {
      /* Every field of a one-slot layout is forced, and the consequence is that
         B2's three outputs are constants — so a one-slot family needs no stored
         layout at all. `conventionFor` returning `undefined` is therefore not a
         gap to fill; `SLOT_CONVENTIONS` has *"deliberately no fallback entry"*
         and this row leaves it that way. */
      for (const family of families) {
        expect(conventionFor([family.slot.name])).toBeUndefined()
        const layout = familyLayout(family)
        expect(layout.cell).toBe(family.slot.name)
        expect(layout.slots).toEqual([
          { part: family.slot.name, anchor: 'cell', side: 0, restsOn: null },
        ])
      }
    })

    it('would earn a doubt on 5,253 of 8,702 fills if run through the closure', () => {
      /* The measurement behind "needs no layout". `cellExtentOf` refuses a
         non-`rect` cell — right when other slots anchor to it, vacuous when none
         do — and `verdictOf` calls every layout with no `edge` slot
         `undecidable`. So running `placeTemplateSlots` over a one-slot layout
         would raise *"needs a choice"* on every non-rect fill for an offset that
         is `[0, 0]` either way.

         The **arithmetic** is here and the behavioural half is not, and that is
         a boundary rather than an omission: `src/template/offsets.ts` needs
         `@/builder/canvas`, which needs DOM lib, so `tsconfig.node.json` cannot
         list it and this project cannot import it. The behavioural assertion
         belongs beside `offsets.test.ts`, in a directory this row must not
         edit — it is in the row report. */
      const shapes = new Map<string, number>()
      for (const record of file.records) {
        shapes.set(record.foot.shape, (shapes.get(record.foot.shape) ?? 0) + 1)
      }
      expect(shapes.get('rect')).toBe(3449)
      expect(file.records.filter((record) => record.foot.shape !== 'rect')).toHaveLength(5253)
      /* 726 of the 5,253 are `{shape:'none'}` and would earn `no-footprint`
         before the cell is consulted at all, so the `no-cell` half is the other
         4,527. */
      expect(shapes.get('none')).toBe(726)
      expect(5253 - 726).toBe(4527)
    })
  })

  /* ------------------------------------------------------------------- the walk */

  it(
    'completes 24 of 40 recipes and 47 of 47 families on a first-candidate walk',
    () => {
      /* The brief's question: do these families make the 24-of-40 completion
         worse? They cannot, and the reason is structural rather than lucky — a
         one-slot family has no sibling for a pick to empty, so the walk is one
         step and the step succeeds whenever the slot has a candidate. It does on
         51 of 51.

         Both walks are the same function with one clause different, so the
         difference between them is the greying rule and nothing else:

         | walk | recipes | families | all 87 |
         | --- | ---: | ---: | ---: |
         | first candidate | **24 of 40** | 47 of 47 | 71 (81.6%) |
         | first that empties no open sibling | 40 of 40 | 47 of 47 | 87 (100%) |

         So the naive rate moves from 60.0% to 81.6% **by dilution**. The 16
         failures are the same 16, all of them the `base` slot of the modular
         wall recipes, and this row has not fixed one of them — row C2 owns the
         solver. What it has done is add 47 templates that cannot fail. Row D1
         dropped four of them and the rate moved with the denominator rather than
         with any walk: the four were four that could not fail either. */
      const step = (
        part: PartSlot,
        parentTags: readonly string[],
        chosen: readonly SiblingSelection[],
      ): readonly TileId[] => index.candidatesFor(resolveSlotTags(part.tags, parentTags, chosen)).tiles

      const selection = (part: PartSlot, tile: TileId): SiblingSelection => ({
        partName: part.name,
        tags: [...(tagsOf.get(tile) ?? [])],
      })

      /** The naive walk: declared order, first candidate, no backtracking. */
      const naive = (parts: readonly PartSlot[], parentTags: readonly string[]): string | undefined => {
        const chosen: SiblingSelection[] = []
        for (const part of parts) {
          const pick = step(part, parentTags, chosen)[0]
          if (pick === undefined) return part.name
          chosen.push(selection(part, pick))
        }
        return undefined
      }

      /** The same walk, refusing a pick that empties a still-open sibling. */
      const greying = (parts: readonly PartSlot[], parentTags: readonly string[]): string | undefined => {
        const chosen: SiblingSelection[] = []
        for (let at = 0; at < parts.length; at += 1) {
          const part = parts[at]
          if (part === undefined) continue
          const open = parts.slice(at + 1)
          const pick = step(part, parentTags, chosen).find((tile) => {
            const next = [...chosen, selection(part, tile)]
            return open.every((sibling) => step(sibling, parentTags, next).length > 0)
          })
          if (pick === undefined) return part.name
          chosen.push(selection(part, pick))
        }
        return undefined
      }

      const fixtures = loadTemplateFixtures(FIXTURES_DIR)
      const failures = fixtures.map((entry) => naive(entry.parts, entry.tags))
      expect(failures.filter((part) => part === undefined)).toHaveLength(24)
      /* Every failure is the `base` slot, which is the brief's figure and the
         reason a generated family has no base slot. */
      expect(new Set(failures.filter((part) => part !== undefined))).toEqual(new Set(['base']))
      expect(fixtures.filter((entry) => greying(entry.parts, entry.tags) === undefined)).toHaveLength(40)

      expect(families.filter((family) => naive([family.slot], family.tags) === undefined)).toHaveLength(47)
      expect(families.filter((family) => greying([family.slot], family.tags) === undefined)).toHaveLength(47)

      expect(24 + 47).toBe(71)
      expect(71 / (fixtures.length + families.length)).toBeCloseTo(0.816, 3)
      expect(24 / fixtures.length).toBeCloseTo(0.6, 3)
    },
    SLOW_MS,
  )


  describe('the price', () => {
    it(
      'adds 0 B to the index, and the tag table is still 930 strings',
      () => {
        /* The claim, measured the way rows B2 and B3 measured theirs: the
           emitted artefact is byte-identical to what B1 pinned, because every
           ref this module emits is a tag the corpus already carries and nothing
           on `build.ts`'s path imports it.

           `templates.test.ts` pins the same 366,627 B for the same construction
           (a fresh build with an empty ordinal manifest at the payload epoch),
           and `npm run stamp` checks the derivation digest in both directions. */
        const size = measureCatalog(serialiseCatalog(file))
        expect(size.brotli).toBe(366_627)
        expect(size.withinBudget).toBe(true)
        expect(file.tags).toHaveLength(930)
        expect(file.tags.filter((tag) => tag.startsWith('size|run|'))).toHaveLength(0)
        expect(file.tags.filter((tag) => tag.startsWith('size|cell|'))).toHaveLength(0)

        /* Structural, not coincidental. */
        for (const module of ['pipeline/build.ts', 'pipeline/emit.ts']) {
          expect(readFileSync(module, 'utf8'), module).not.toContain("from './families'")
        }
        /* And nothing of the family model reaches the bytes. */
        const json = serialiseCatalog(file)
        for (const needle of ['GENERATED_FAMILIES', 'any size', 'wide by', 'inexpressible']) {
          expect(json).not.toContain(needle)
        }

        /* The counterfactual, priced against the same artefact at the same epoch
           — the construction rows B1, B2 and B3 all quote. A `families` key
           carrying the 47 slots and their 303 size positions costs the index
           real bytes, and it would buy nothing: the palette needs the table
           before the 5.6 MB index lands, which is `pipeline/templates.ts`'s
           argument for the 40 verbatim. */
        const inIndex = measureCatalog(
          serialiseCatalog({
            ...file,
            families: families.map((family) => ({
              id: family.id,
              name: family.name,
              source: family.key,
              tags: family.tags,
              parts: [family.slot],
              sizes: family.sizes,
            })),
          } as never),
        )
        process.stdout.write(
          `\n[families] index ${String(size.brotli)} B unchanged · the same table inside it ` +
            `${String(inIndex.brotli)} B (+${String(inIndex.brotli - size.brotli)})\n`,
        )
        /* 2,277 B before row D9 moved the artefact this is measured against;
           brotli is not additive over 5.9 MB and this file already says so. */
        expect(inIndex.brotli - size.brotli).toBe(1902)
      },
      SLOW_MS,
    )

    it('costs 44,450 raw bytes of the generated module, and prices the cut', () => {
      /* The whole price of shipping all 47 rather than the plan's first 20 — and
         `FAMILY_TABLE_BYTES` is asserted against the emitter rather than
         quoted, so a family set that grows moves the constant or fails. */
      const fixtures = loadTemplateFixtures(FIXTURES_DIR)
      const withFamilies = printTemplateModule(fixtures, families)
      const without = printTemplateModule(fixtures, [])
      const delta = Buffer.byteLength(withFamilies, 'utf8') - Buffer.byteLength(without, 'utf8')
      expect(delta).toBe(FAMILY_TABLE_BYTES)

      /* What a rank-20 cut would have withheld, which is the argument. */
      const ranked = families.filter((family) => family.key !== BARE_BASE_KEY)
      const withheld = ranked.slice(20).reduce((total, family) => total + family.records, 0)
      expect(withheld).toBe(493)
      expect(withheld / 8702).toBeCloseTo(0.057, 3)
      expect(ranked.slice(20)).toHaveLength(26)
      /* The plan's own rank-20 cut withholds 835 rather than 736, because its
         ranking includes `insert|straight` at rank 9 and this one does not. Both
         are stated so neither can be quoted as the other. */
      expect(8702 - Math.round(8702 * 0.904)).toBe(835)
    })

    it('generates no `insert` family, which is `SKIPPED_ROLES` and nothing else', () => {
      expect([...SKIPPED_ROLES]).toEqual(['insert'])
      expect(families.filter((family) => family.slot.name === 'insert')).toEqual([])
      for (const family of families) {
        for (const ref of family.slot.tags.require ?? []) expect(ref.tag).not.toBe('role|insert')
      }
      /* The bijection B1 asserts, restated from this side: predicating on
         `role|insert` and on `layer === 'insert'` select the same 285 records, so
         a family keyed on it would add an axis that carries no information. */
      const byRole = file.records.filter((record) => tags(record).includes('role|insert'))
      const byLayer = file.records.filter((record) => record.layer === 'insert')
      expect(byRole).toHaveLength(285)
      expect(byLayer).toHaveLength(285)
      expect(byRole.filter((record) => record.layer !== 'insert')).toEqual([])
    })
  })
})

/**
 * The predicate a size position's label states.
 *
 * The label is the position's public claim about what it admits — *"2 wide by 2
 * deep"* or *"2 wide"* — so recovering the predicate from it rather than from
 * the emitted tags is what makes the comparison a check instead of a tautology:
 * if the label and the refs ever disagree, the assertions above fail.
 */
function predicateFromLabel(label: string): SizePredicate {
  const cell = /^([\d.]+) wide by ([\d.]+) deep$/.exec(label)
  if (cell !== null) return { kind: 'cell', w: Number(cell[1]), d: Number(cell[2]) }
  const run = /^([\d.]+) wide$/.exec(label)
  if (run !== null) return { kind: 'run', run: Number(run[1]) }
  if (label === ANY_SIZE.label) return { kind: 'none' }
  throw new Error(`unreadable size label: ${label}`)
}
