/// <reference types="node" />
/**
 * Tests for assembly resolution.
 *
 * The load-bearing block is `the real corpus` at the bottom, and it is
 * deliberately most of the file. Assembly resolution is a set of claims about
 * the *shape of the OpenForge catalog* — that half of it delegates joinery to a
 * separate base, that the resolved footprint primitive is the key that finds
 * one, that the `size|openlock` code and the `build|` tag are keys that find the
 * wrong thing and nothing respectively — and a handcrafted fixture cannot
 * falsify any of them, because the fixture would be written by whoever wrote the
 * resolver. So the fixtures cover what is true by construction (the weight
 * ordering, the byte thresholds, the empty scene, the slot walk) and every claim
 * about the data is checked against the emitted index.
 *
 * **Two fixture blocks are load-bearing all the same.** `the join key` holds the
 * cases the corpus does *not* contain — a base carrying a size code its shape
 * contradicts, a topper whose code and whose shape point at different bases —
 * because a corpus test cannot assert what the archive does not hold yet, and
 * those are precisely the cases the old key got wrong. And `template instances`
 * is row A3's own: an instance can be incomplete, can name a retired file, and
 * can hold a fill its slot does not admit, and none of those three states exists
 * anywhere in the corpus because nothing has been placed in it.
 *
 * ## What row A3 deleted from this file, and why the deletions are the row
 *
 * Roughly 700 lines of `resolve.ts` existed to guess what the user meant, and
 * the tests that pinned the guessing went with them:
 *
 *   - **Rule 0's whole suite.** `resolveVariant`, the six-verdict table, the
 *     idempotence survey, the "changes which file a placement resolves to"
 *     measurement — all of them asked *which file of this item does the lock
 *     prefer*, and a fill names the file. What survives of rule 0 is
 *     `selectVariantForLock`, asserted at the bottom, because five call sites
 *     outside this directory still ask that question of an **item**.
 *   - **Rule 1's disclosure notes.** `base-auto-inserted` and its three
 *     companions described a part the app added; the app adds none. The
 *     *ranking* is still asserted in full, against the same corpus figures, via
 *     `matchBase` — see `baseMatch.ts` for why it outlived the rule.
 *   - **`a base already on the topper's cell`.** Eight tests about the bill
 *     asking for two prints of one base. Nothing inserts a base, so the bill
 *     cannot ask.
 *
 * If the index is not on this machine the corpus blocks are skipped **loudly** —
 * a banner on stderr and the reason in the suite name — because the default
 * reporter prints a bare "N skipped" and a silently skipped data test is exactly
 * the failure this file exists to catch. The skip is a local-checkout path, not
 * the CI path: CI regenerates the index with `npm run stamp` before the suite
 * runs, so every corpus block below runs on every pull request.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { PrintOption as BarrelPrintOption } from '@/assembly'
import { PRINT_OPTIONS as BARREL_PRINT_OPTIONS, printOption as barrelPrintOption } from '@/assembly'
import type { CatalogFile, CatalogRecord, Face, Footprint, Mount, TileAggregate, Vec3 } from '@/catalog'
import {
  CatalogFile as CatalogFileSchema,
  CatalogRecord as CatalogRecordSchema,
  MEASURED_SPRITE_SHEET,
  TileId,
  buildAggregateIndex,
  resolveTags,
  selectVariant,
} from '@/catalog'
import { createCompositionIndex, resolveSlotTags } from '@/composition'
import { RECIPE_TEMPLATES } from '@/assembly/templates'
import type {
  LockSystem,
  PlacementId,
  SlotFill,
  SlotName,
  TemplateId,
  TemplateInstance,
} from '@/store'

import type { AssemblyIndex, PrintOption } from './assemblyIndex'
import { PRINT_OPTIONS, buildAssemblyIndex, printOption } from './assemblyIndex'
import { MATCH_WEIGHTS, baseGap, matchBase, rankBases } from './baseMatch'
import type { BillOfTiles } from './bill'
import { DOWNLOAD_HUGE_BYTES, DOWNLOAD_LARGE_BYTES, buildBillOfTiles, downloadSize } from './bill'
import { footprintKey } from './footprint'
import { NOTE_SEVERITY, rollUpNotes } from './notes'
import type { AssemblyContext, AssemblySlot, AssemblyTemplate } from './resolve'
import { resolveInstance, selectVariantForLock } from './resolve'
import { AMBIGUOUS_SIZE_CODES, sharedPrimitive } from './sizeCode'

/* -------------------------------------------------------------- test helpers */

/**
 * A record carrying only what base matching reads, parsed through the real
 * schema so the branded ids and the footprint union are the live ones.
 *
 * The corpus block below is where every *claim about the data* belongs, and this
 * helper is deliberately not for that. It exists for the cases the corpus does
 * **not** contain — a base carrying an ambiguous size code, a topper whose code
 * and whose shape point at different bases — because those are exactly the cases
 * the join must already handle correctly on the day the archive grows one.
 */
let fixtureSeq = 0
function fixtureRecord(
  layer: CatalogRecord['layer'],
  foot: Footprint,
  extra: { sizeCode?: string; texture?: string; bytes?: number } = {},
): CatalogRecord {
  fixtureSeq += 1
  const id = `tiles/fixture/${String(fixtureSeq)}.stl`
  return CatalogRecordSchema.parse({
    id,
    ord: fixtureSeq,
    blob: String(fixtureSeq).padStart(32, '0'),
    file: `${String(fixtureSeq)}.stl`,
    bytes: extra.bytes ?? 1_000_000,
    sprite: true,
    thumb: false,
    family: 'tiles/fixture',
    // **Its own design, and that is not cosmetic.** `design` is row A1's
    // aggregation key, so a shared one would collapse every hand-built record
    // here into a single item and break A1's hoisting invariant outright: these
    // records deliberately carry different names, footprints and size codes, and
    // 0 of the 3,822 live aggregates hold two of any of them.
    design: `d-fixture-${String(fixtureSeq)}`,
    name: `fixture ${String(fixtureSeq)}`,
    kinds: [],
    conn: layer === 'topper' ? ['openforge'] : ['openlock'],
    layer,
    tags: [],
    foot,
    ...(extra.sizeCode === undefined ? {} : { sizeCode: extra.sizeCode }),
    ...(extra.texture === undefined ? {} : { texture: extra.texture }),
  })
}

/** An index over hand-built records. `tags: []` makes every base the plain print. */
function fixtureIndex(records: readonly CatalogRecord[]): AssemblyIndex {
  return buildAssemblyIndex({ records, tags: [] } as unknown as CatalogFile)
}

/**
 * The base the ranking hands a topper, how it says it found it, and — when it
 * finds none — which of the three archive gaps that is.
 *
 * **`matchBase` and `baseGap`, and there is no third thing to ask.** Before row
 * A3 this helper also called `resolvePlacement` for the note codes, because rule
 * 1 put the gap classification into a bill. Nothing inserts a base now, so no
 * bill carries those codes and the classifier returns the code directly — see
 * `baseMatch.ts#baseGap` on why that change of return type is the honest one.
 */
function baseFor(topper: CatalogRecord, index: AssemblyIndex) {
  const matched = matchBase(topper, index, 'openlock')
  return { base: matched?.base, match: matched?.match, gap: baseGap(topper, index) }
}

/* ------------------------------------------------------ construction-only tests */

describe('size code table', () => {
  it('publishes the five ambiguous codes as data, so a sixth cannot arrive quietly', () => {
    /* The corpus block below asserts this table against the live catalog in both
       directions. Here it is only the shape of the claim: a code, and the
       primitives it is measured to span.

       `A` is row **D9**'s and it arrived exactly the way this test is written to
       make impossible to miss — the corpus assertion failed and named it. */
    expect(Object.keys(AMBIGUOUS_SIZE_CODES).sort()).toEqual(['A', 'I', 'O', 'S', 'X'])
    expect(AMBIGUOUS_SIZE_CODES.A).toEqual(['wall:1.5', 'wall:2'])
    expect(AMBIGUOUS_SIZE_CODES.O).toEqual(['column', 'tri:2', 'tri:4'])
    for (const [code, primitives] of Object.entries(AMBIGUOUS_SIZE_CODES)) {
      expect(primitives.length, code).toBeGreaterThan(1)
      expect([...primitives].sort(), code).toEqual([...primitives])
    }
  })
})

describe('footprint congruence', () => {
  /**
   * Congruence, asked the way every caller now asks it.
   *
   * `footprintsMatch` was the two-argument form and row A3 deleted it: verified
   * zero consumers repo-wide outside this file and the barrel's re-export. The
   * *key* survived, because `pipeline/catalog.test.ts` and
   * `tools/hygiene/project.test.ts` both import and call it — which is why
   * `footprint.ts` is still here at all.
   */
  const congruent = (a: Footprint, b: Footprint): boolean => {
    const key = footprintKey(a)
    return key !== undefined && key === footprintKey(b)
  }

  it('sorts a rect’s extents, so a rotated tile matches', () => {
    expect(congruent({ shape: 'rect', w: 0.5, d: 2 }, { shape: 'rect', w: 2, d: 0.5 })).toBe(true)
    expect(congruent({ shape: 'rect', w: 1, d: 2 }, { shape: 'rect', w: 1, d: 3 })).toBe(false)
  })

  it('keys an arc on its band pair and sweep, not on the tagged radius', () => {
    const concave = { shape: 'arc', rIn: 2, rOut: 2.5, sweep: 90, band: 'concave', bandBasis: 'measured' } as const
    const convex = { shape: 'arc', rIn: 1.5, rOut: 2, sweep: 45, band: 'convex', bandBasis: 'fallback' } as const
    expect(congruent(concave, { ...concave })).toBe(true)
    expect(congruent(concave, { ...concave, sweep: 45 })).toBe(false)

    // Row W5's reason for the key. Both of these carry `size|radius|2`, and
    // under the pre-W5 `arc:2@90` key they were the same piece — a wall curving
    // outwards and a wall curving inwards.
    expect(congruent({ ...concave, sweep: 45 }, convex)).toBe(false)

    // Congruence is about the outline, so the band *name* is not in the key: a
    // `radial` band at R = 2 degenerates to exactly the quarter disc `F` is.
    const radial = { shape: 'arc', rIn: 0, rOut: 2, sweep: 90, band: 'radial', bandBasis: 'measured' } as const
    expect(congruent(radial, { ...radial, band: 'disc' })).toBe(true)
  })

  it('gives `none` no key at all, so shapeless tiles never match each other', () => {
    expect(footprintKey({ shape: 'none' })).toBeUndefined()
    expect(congruent({ shape: 'none' }, { shape: 'none' })).toBe(false)
  })
})

describe('the join key', () => {
  /**
   * Row D4's whole substance, as a test rather than as the comment it replaces.
   *
   * The comment said the size code was the primary key and the footprint the
   * fallback, "never both", and defended it on the grounds that the code is a
   * functional determinant of width. It is — and a width is not a footprint.
   * Four codes in the corpus span more than one primitive, so this fixture is a
   * legal catalog the old rule gets wrong: one topper, one base that shares its
   * code and is a different shape, one base that is congruent to it and shares
   * nothing else.
   *
   * A code-first join returns the pillar. Anything that reintroduces one fails
   * here, on three assertions that do not depend on the corpus at all.
   */
  it('prefers the congruent base over the base that merely shares the size code', () => {
    // `size|openlock|O` is on 34 columns and 9 triangles in the live corpus, and
    // this is that code with the base the archive does not have yet.
    const topper = fixtureRecord('topper', { shape: 'tri', leg: 4 }, { sizeCode: 'O', texture: 'dungeon_stone' })
    const pillar = fixtureRecord('base', { shape: 'column' }, { sizeCode: 'O', texture: 'dungeon_stone' })
    const triangle = fixtureRecord('base', { shape: 'tri', leg: 4 })
    const { base, match } = baseFor(topper, fixtureIndex([topper, pillar, triangle]))

    expect(base?.id).toBe(triangle.id)
    expect(match?.key).toBe('footprint')
    expect(match?.on).toBe('tri:4')
    // And the pillar was never even a candidate: keying on the code would have
    // offered two, one of which is 0.5 x 0.5 under a 4 x 4 triangle.
    expect(match?.candidates).toBe(1)
  })

  it('does not fall through to the size code when the primitive has no base', () => {
    // The no-fall-through rule, kept from the row before and inverted with the
    // priority. The code has a base; the shape does not; the answer is still no
    // base, because a code-matched base answers a different question.
    const topper = fixtureRecord('topper', { shape: 'rect', w: 0.5, d: 2 }, { sizeCode: 'A' })
    const wallBase = fixtureRecord('base', { shape: 'wall', length: 2 }, { sizeCode: 'A' })
    const { base, gap } = baseFor(topper, fixtureIndex([topper, wallBase]))

    expect(base).toBeUndefined()
    expect(gap).toBe('no-congruent-base')
  })

  it('joins on the size code only for a topper with no primitive at all', () => {
    // The one path the code still reaches, and the corpus population it serves:
    // 14 toppers, every one coded `U`, whose footprint row W4 declined to guess.
    const topper = fixtureRecord('topper', { shape: 'none' }, { sizeCode: 'U' })
    const square = fixtureRecord('base', { shape: 'rect', w: 4, d: 4 }, { sizeCode: 'U' })
    const { base, match } = baseFor(topper, fixtureIndex([topper, square]))

    expect(base?.id).toBe(square.id)
    expect(match?.key).toBe('sizeCode')
    expect(match?.on).toBe('U')
    expect(match?.codeAgrees).toBe(true)
  })

  it('refuses a size code whose bases disagree about their own shape', () => {
    // The latency guard. Today no code is ambiguous *on the base side* — see the
    // corpus block — so this is the archive one base away from where it is now,
    // and the requirement is that the answer be a named gap and not a guess.
    const topper = fixtureRecord('topper', { shape: 'none' }, { sizeCode: 'X' })
    const arc = fixtureRecord('base', {
      shape: 'arc',
      rIn: 4,
      rOut: 4.5,
      sweep: 90,
      band: 'concave',
      bandBasis: 'measured',
    })
    const pillar = fixtureRecord('base', { shape: 'column' })
    const ambiguous = [
      { ...arc, sizeCode: 'X' } as CatalogRecord,
      { ...pillar, sizeCode: 'X' } as CatalogRecord,
    ]
    const { base, gap } = baseFor(topper, fixtureIndex([topper, ...ambiguous]))

    expect(base).toBeUndefined()
    // The archive holds no base this topper can be matched to — which is what
    // `no-matching-base` means, and it is claimed here because the code did not
    // join rather than because the code is absent.
    expect(gap).toBe('no-matching-base')

    // And with the ambiguity removed, the very same topper matches — so the
    // refusal is the ambiguity and nothing else about this fixture.
    const { base: matched } = baseFor(topper, fixtureIndex([topper, ambiguous[0] as CatalogRecord]))
    expect(matched?.id).toBe(arc.id)
  })

  it('refuses a size code whose bases have no shape to agree about', () => {
    // `sharedPrimitive` returns `undefined` for a shapeless member as well as
    // for a disagreement, and both mean the same thing here: nothing in the
    // candidate set can be shown to fit.
    const topper = fixtureRecord('topper', { shape: 'none' }, { sizeCode: 'T' })
    const shapeless = fixtureRecord('base', { shape: 'none' }, { sizeCode: 'T' })
    expect(baseFor(topper, fixtureIndex([topper, shapeless])).base).toBeUndefined()
  })

  it('reports the one primitive a candidate set agrees on, and nothing otherwise', () => {
    const square = fixtureRecord('base', { shape: 'rect', w: 2, d: 2 })
    const rotated = fixtureRecord('base', { shape: 'rect', w: 2, d: 2 })
    const wall = fixtureRecord('base', { shape: 'wall', length: 2 })
    const shapeless = fixtureRecord('base', { shape: 'none' })

    expect(sharedPrimitive([square, rotated])).toBe('rect:2x2')
    expect(sharedPrimitive([square])).toBe('rect:2x2')
    expect(sharedPrimitive([square, wall])).toBeUndefined()
    expect(sharedPrimitive([square, shapeless])).toBeUndefined()
    // Empty is `undefined` rather than a vacuous true: an empty candidate set
    // determines nothing, and a caller must not read it as agreement.
    expect(sharedPrimitive([])).toBeUndefined()
  })

  it('keeps the size code as a family tie-break inside the congruent set', () => {
    // What the code is *for* now. Both candidates fit and both carry the lock, so
    // the code decides — and it decides above texture, which is the one place the
    // ladder is visible from outside.
    const topper = fixtureRecord('topper', { shape: 'wall', length: 2 }, { sizeCode: 'A', texture: 'cave' })
    const sameFamily = fixtureRecord('base', { shape: 'wall', length: 2 }, { sizeCode: 'A', texture: 'dungeon_stone' })
    const sameColour = fixtureRecord('base', { shape: 'wall', length: 2 }, { sizeCode: 'AS', texture: 'cave' })
    const { base, match } = baseFor(topper, fixtureIndex([topper, sameFamily, sameColour]))

    expect(base?.id).toBe(sameFamily.id)
    expect(match?.codeAgrees).toBe(true)
    expect(match?.textureAgrees).toBe(false)
    expect(match?.candidates).toBe(2)
  })

  it('never scores two uncoded records as one family', () => {
    // `undefined === undefined` is not a family. If it were, every uncoded base
    // would outrank a texture-matched one under every uncoded topper.
    const topper = fixtureRecord('topper', { shape: 'wall', length: 2 }, { texture: 'cave' })
    const uncoded = fixtureRecord('base', { shape: 'wall', length: 2 }, { bytes: 1 })
    const coloured = fixtureRecord('base', { shape: 'wall', length: 2 }, { texture: 'cave', bytes: 2 })
    const { base, match } = baseFor(topper, fixtureIndex([topper, uncoded, coloured]))

    expect(base?.id).toBe(coloured.id)
    expect(match?.codeAgrees).toBe(false)
    expect(match?.textureAgrees).toBe(true)
  })
})

describe('match weights', () => {
  /**
   * The property the powers of two exist for: the sum is a lexicographic order.
   * If this ever fails, a texture-matched base could outrank a base that locks —
   * or, the defect row D1 fixed, a topless base could outrank a full one.
   */
  it('cannot let lower criteria outvote a higher one', () => {
    const { lock, option, code, kind, texture } = MATCH_WEIGHTS
    // `option` is graded: two steps for `plain`, so its widest span is 2 × 8.
    const optionSpan = option * (PRINT_OPTIONS.length - 1)
    expect(optionSpan + code + kind + texture).toBeLessThan(lock)
    expect(code + kind + texture).toBeLessThan(option)
    expect(kind + texture).toBeLessThan(code)
    expect(texture).toBeLessThan(kind)
  })

  /**
   * Row D4 retired `shape` and put `code` in its slot, and the reason is that
   * congruence became the *key*: every candidate now has the topper's shape, so
   * a `shape` criterion would score a constant over every candidate set and
   * decide nothing. A criterion that cannot discriminate is not a tie-break, it
   * is a comment with a number attached.
   */
  it('scores five criteria, and no longer one the key already guarantees', () => {
    expect(Object.keys(MATCH_WEIGHTS).sort()).toEqual(['code', 'kind', 'lock', 'option', 'texture'])
    expect(MATCH_WEIGHTS).not.toHaveProperty('shape')
  })
})

/**
 * The surface row A3 left for row C2's fill solver.
 *
 * `matchBase` derives its candidate set by congruence, which is the right key
 * for the archive question `lock-picker/build.ts` asks and the wrong one for a
 * slot: what may fill a template's `base` slot is decided by `@/composition`
 * from the slot's `require`, `deny` and `constrain`. So the ladder is also
 * exported taking the candidates as an argument, and these are the two
 * properties C2 is entitled to rely on.
 */
describe('rankBases, the default-fill surface', () => {
  it('ranks an explicit candidate set by the same ladder matchBase uses', () => {
    const topper = fixtureRecord('topper', { shape: 'wall', length: 2 }, { sizeCode: 'A', texture: 'cave' })
    const sameFamily = fixtureRecord('base', { shape: 'wall', length: 2 }, { sizeCode: 'A', texture: 'dungeon_stone' })
    const sameColour = fixtureRecord('base', { shape: 'wall', length: 2 }, { sizeCode: 'AS', texture: 'cave' })
    const index = fixtureIndex([topper, sameFamily, sameColour])

    // Handed the pool `matchBase` would have derived, the answer is identical —
    // so a solver that gets its candidates from `@/composition` and one that gets
    // them by congruence cannot disagree about which of them is best.
    const ranked = rankBases(topper, [sameFamily, sameColour], index, 'openlock')
    const matched = matchBase(topper, index, 'openlock')
    expect(ranked?.base.id).toBe(matched?.base.id)
    expect(ranked?.option).toBe(matched?.match.option)
    expect(ranked?.codeAgrees).toBe(matched?.match.codeAgrees)
    expect(ranked?.lockAgrees).toBe(matched?.match.lockAgrees)
  })

  it('says nothing about a key, because a slot is not a key', () => {
    // The two fields `BaseMatch` adds and `BaseRanking` does not. A candidate set
    // assembled from a slot's tags was not found by a footprint or a code, and a
    // ranking that reported one would be a true-looking sentence about a join
    // that never happened.
    const topper = fixtureRecord('topper', { shape: 'wall', length: 2 })
    const base = fixtureRecord('base', { shape: 'wall', length: 2 })
    const ranked = rankBases(topper, [base], fixtureIndex([topper, base]), 'openlock')
    expect(ranked).not.toHaveProperty('key')
    expect(ranked).not.toHaveProperty('on')
  })

  it('returns undefined for an empty candidate set rather than inventing a base', () => {
    // `@/composition`'s dead end, which the ranking must not paper over. 0 of the
    // 128 shipped template parts are one in their initial state — asserted
    // against the live corpus below — so this is the state a *pick* can create,
    // not one the recipes ship with.
    const topper = fixtureRecord('topper', { shape: 'wall', length: 2 })
    expect(rankBases(topper, [], fixtureIndex([topper]), 'openlock')).toBeUndefined()
  })

  it('prefers a full base over a cheaper topless one, which is the whole of D1', () => {
    // The defect in one fixture: the topless print of a base is its smallest
    // file, so a `bytes`-ascending tie-break picks it. `option` outranks
    // everything below `lock`, so the ranking picks the base with a top surface
    // even though it is four times the size.
    const topper = fixtureRecord('topper', { shape: 'wall', length: 2 })
    const plain = fixtureRecord('base', { shape: 'wall', length: 2 }, { bytes: 4_000_000 })
    const index = buildAssemblyIndex({
      records: [topper, plain, fixtureRecord('base', { shape: 'wall', length: 2 }, { bytes: 1_000 })],
      tags: ['connection|openlock|topless'],
    } as unknown as CatalogFile)
    // The third record is the cheap one; give it the topless tag through the
    // intern table the index actually reads.
    const cheap = index.byId.get(
      [...index.byId.keys()].find((id) => index.byId.get(id)?.bytes === 1_000) as TileId,
    ) as CatalogRecord
    const withTag = { ...cheap, tags: [0] } as CatalogRecord
    const tagged = buildAssemblyIndex({ records: [topper, plain, withTag], tags: ['connection|openlock|topless'] } as unknown as CatalogFile)

    expect(tagged.basePrintOption.get(withTag.id)).toBe('topless')
    expect(rankBases(topper, [withTag, plain], tagged, 'openlock')?.base.id).toBe(plain.id)
    // And the disclosure a UI needs to explain the choice: both products were on
    // offer, best first.
    expect(rankBases(topper, [withTag, plain], tagged, 'openlock')?.optionsOffered).toEqual(['plain', 'topless'])
  })
})

describe('print options', () => {
  it('reads the modifier off the third segment, never the second', () => {
    expect(printOption(['connection|openlock|topless'])).toBe('topless')
    expect(printOption(['connection|dragonlock|unsupported'])).toBe('unsupported')
    expect(printOption(['connection|openlock', 'connection|magnetic|flex'])).toBe('plain')
    // The `connection|side|openlock` trap: a position in segment one must not
    // suppress a modifier, and must not be read as one either.
    expect(printOption(['connection|side|openlock'])).toBe('plain')
    expect(printOption(['connection|side|openlock|topless'])).toBe('topless')
    // Nothing outside the connection namespace names a print option.
    expect(printOption(['shape|base', 'size|openlock|A'])).toBe('plain')
    expect(printOption([])).toBe('plain')
  })

  it('takes the worst option a tile names, so a plain sibling tag cannot hide it', () => {
    expect(printOption(['connection|magnetic|flex', 'connection|openlock|topless'])).toBe('topless')
    expect(printOption(['connection|openlock|unsupported', 'connection|openlock|topless'])).toBe('topless')
    expect(printOption(['connection|openlock', 'connection|dragonlock|unsupported'])).toBe('unsupported')
  })

  it('is ordered best-first, which is what the ranking reads', () => {
    expect([...PRINT_OPTIONS]).toEqual(['plain', 'unsupported', 'topless'])
  })
})

describe('download verdict', () => {
  it('turns at the two corpus-derived thresholds', () => {
    expect(downloadSize(0).verdict).toBe('ok')
    expect(downloadSize(DOWNLOAD_LARGE_BYTES - 1).verdict).toBe('ok')
    expect(downloadSize(DOWNLOAD_LARGE_BYTES).verdict).toBe('large')
    expect(downloadSize(DOWNLOAD_HUGE_BYTES - 1).verdict).toBe('large')
    expect(downloadSize(DOWNLOAD_HUGE_BYTES).verdict).toBe('huge')
  })

  it('is stated in distinct files, which is the only unit `bytes` is a sum over', () => {
    // **Row C4's restatement.** `DownloadSize.bytes` is one copy per distinct
    // md5, so neither a placement count nor a part count determines it: the
    // thresholds can only be read in files. At the 11,255,184 B median file the
    // 40 shipped recipes admit — measured in the corpus block below — `large` is
    // about fifty of them and `huge` about a hundred and eighty.
    const medianAdmitted = 11_255_184
    expect(DOWNLOAD_LARGE_BYTES / medianAdmitted).toBeCloseTo(45.5, 1)
    expect(DOWNLOAD_HUGE_BYTES / medianAdmitted).toBeCloseTo(177.7, 1)
    expect(downloadSize(45 * medianAdmitted).verdict).toBe('ok')
    expect(downloadSize(46 * medianAdmitted).verdict).toBe('large')
    expect(downloadSize(178 * medianAdmitted).verdict).toBe('huge')
  })

  it('keeps `large` on the byte the buffering fallback refuses at', () => {
    // The reason row C4 restated the thresholds rather than moving them, and it
    // is not a corpus fact. `download/save.ts#BLOB_FALLBACK_LIMIT_BYTES` is
    // 512_000_000 and it is a *refusal*: a browser with no `showSaveFilePicker`
    // — iOS Safari always, plus Firefox and desktop Safari — buffers the whole
    // archive to a `Blob`, and `useArchiveDownload` throws
    // `ArchiveTooLargeToBufferError` above this figure before the first fetch.
    // The `large` verdict is the forecast of that failure, so the two have to be
    // the same number: raise it and a room iOS Safari cannot save reads `ok`,
    // lower it and the bill cries off a download that would have worked.
    //
    // Asserted by value rather than by importing `@/download`'s constant, for
    // two reasons that agree. `save.ts` refuses to import this one because they
    // are the same number for different reasons and a single symbol would let a
    // change to the warning move the refusal; and `src/download`'s whole contract
    // with this directory is two *type* imports, which a test reaching the other
    // way for a value would be the first crack in.
    const blobFallbackLimit = 512_000_000
    expect(DOWNLOAD_LARGE_BYTES).toBe(blobFallbackLimit)
    expect(downloadSize(blobFallbackLimit).verdict).toBe('large')
    expect(downloadSize(blobFallbackLimit - 1).verdict).toBe('ok')
  })

  it('refutes A3’s per-instance calibration: an instance count does not determine bytes', () => {
    // Row A3 read its own figure — one median-filled instance at 26,394,812 B
    // over about three files — as making both thresholds stale by 2.58x, and
    // **that is an artefact of leaving the md5 dedupe out of the arithmetic.**
    // The corpus block below measures two rooms built from the same 40 recipes:
    // solver-filled, 200 instances are the same 36 files and the same
    // 366,230,378 B as 50, so no such room reaches `large` at all; with every
    // slot cycling its candidates, `large` first fires at 19 instances.
    //
    // So the instance count at which `large` fires is between 19 and never, and
    // this is the arithmetic half of that — A3's model is exact while parts and
    // files coincide and overstates once they diverge.
    const a3PerInstance = 26_394_812
    expect(downloadSize(a3PerInstance * 50).verdict).toBe('large')
    expect((a3PerInstance * 50) / DOWNLOAD_LARGE_BYTES).toBeCloseTo(2.58, 2)
    // Against the measured rooms: 14.1% over the maximally varied fifty, 3.60x
    // over the solver-filled fifty.
    expect((a3PerInstance * 50) / 1_156_629_241).toBeCloseTo(1.141, 3)
    expect((a3PerInstance * 50) / 366_230_378).toBeCloseTo(3.6, 2)
    // And the solver-filled room the thresholds are supposed to be about is 0.72x
    // `large`, so it is not merely under the line — it cannot reach it.
    expect(downloadSize(366_230_378).verdict).toBe('ok')
    expect(366_230_378 / DOWNLOAD_LARGE_BYTES).toBeCloseTo(0.72, 2)
  })
})

describe('note vocabulary', () => {
  it('is fourteen codes — nine for the tiles, five for the accessories in them', () => {
    // The deletion, asserted rather than described. Every one of the eight was
    // about a part the app added on the user's behalf; a template declares its
    // base as a slot, so there is nothing for any of them to be about. The three
    // gap codes went with them because `baseGap` is no longer a note, and a
    // `NoteCode` union holding three members nothing emits is the exact silent
    // failure this series keeps meeting.
    expect(Object.keys(NOTE_SEVERITY).sort()).toEqual([
      'build-unspecified',
      'fill-off-slot',
      'hold-modelled-in',
      'hold-off-slot',
      'hold-unanchored',
      'hold-unknown-tile',
      'hold-unplaced',
      'insert-on-grid',
      'lock-unavailable',
      'mixed-build-systems',
      'no-footprint',
      'slot-unfilled',
      'unknown-template',
      'unknown-tile',
    ])
    for (const gone of [
      'base-auto-inserted',
      'base-option-chosen',
      'base-lock-mismatch',
      'base-texture-mismatch',
      'base-already-on-plan',
      'no-matching-base',
      'no-congruent-base',
      'base-unmatchable',
    ]) {
      expect(NOTE_SEVERITY, gone).not.toHaveProperty(gone)
    }
  })

  it('classifies the quarter-of-the-candidates note as info, not warn', () => {
    // `build-unspecified` is true of 3,610 of the 14,241 (slot, candidate) pairs
    // the 128 shipped template slots admit — 25.35%, measured below — so at
    // `warn` it would be wallpaper and the real warnings would be read past.
    expect(NOTE_SEVERITY['build-unspecified']).toBe('info')
    expect(NOTE_SEVERITY['no-footprint']).toBe('info')
    expect(NOTE_SEVERITY['insert-on-grid']).toBe('info')
    // `hold-unplaced` is `no-footprint`'s reading for an accessory — in the
    // bill, not on the plan — and 34 measured host blobs resolved to no mount at
    // all, so at `warn` it would fire on every hold over one of them.
    expect(NOTE_SEVERITY['hold-unplaced']).toBe('info')
    // Its mirror image — the insert unmeasured rather than the host — and `info`
    // for the same reason: the file is in the pack, the gap is in the pass.
    expect(NOTE_SEVERITY['hold-unanchored']).toBe('info')
  })

  it('warns one level down for the two states a hold can be wrong in', () => {
    // The accessory readings of `unknown-tile` and `fill-off-slot`. Separate
    // codes rather than a widening of those two, because a roll-up mixing the
    // levels would count a missing torch as a missing wall.
    expect(NOTE_SEVERITY['hold-unknown-tile']).toBe('warn')
    expect(NOTE_SEVERITY['hold-off-slot']).toBe('warn')
  })

  it('warns for the three states an explicitly-filled instance can be wrong in', () => {
    // Row A3's new work, and all three are `warn` because all three are things
    // the user has to act on before printing: a recipe this build cannot make, a
    // hole in a printable model, and a part that will print and not fit.
    expect(NOTE_SEVERITY['unknown-template']).toBe('warn')
    expect(NOTE_SEVERITY['slot-unfilled']).toBe('warn')
    expect(NOTE_SEVERITY['fill-off-slot']).toBe('warn')
  })

  it('publishes the print-option vocabulary through the barrel', () => {
    // `BaseRanking.option` is of type `PrintOption` and `BaseRanking` is on the
    // public surface, so without these three names a consumer could hold the
    // value and be unable to declare it. The annotation is the assertion — this
    // fails at compile time, not at run time.
    const option: BarrelPrintOption = 'topless'
    expect(BARREL_PRINT_OPTIONS).toBe(PRINT_OPTIONS)
    expect(barrelPrintOption(['connection|openlock|topless'])).toBe(option)
  })

  it('rolls up per code, warnings first, and counts rather than repeats', () => {
    const tile = TileId.parse('tiles/x/a.stl')
    const other = TileId.parse('tiles/x/b.stl')
    const one = 'p1' as PlacementId
    const two = 'p2' as PlacementId
    const floor = 'floor' as SlotName
    const wall = 'wall' as SlotName
    const rolled = rollUpNotes([
      { code: 'build-unspecified', severity: 'info', message: 'm', placement: one, slot: floor, tileId: tile },
      { code: 'build-unspecified', severity: 'info', message: 'm', placement: one, slot: wall, tileId: other },
      { code: 'build-unspecified', severity: 'info', message: 'm', placement: two, slot: floor, tileId: tile },
      { code: 'slot-unfilled', severity: 'warn', message: 'n', placement: two, slot: wall },
    ])
    expect(rolled.map((entry) => entry.code)).toEqual(['slot-unfilled', 'build-unspecified'])
    expect(rolled[1]?.count).toBe(3)
    expect(rolled[1]?.tileIds).toEqual([tile, other].sort())
    // The two fields row A3 added, and the reason: a note about a slot has to say
    // which instance and which slot, because an instance holds up to five and a
    // `slot-unfilled` has no tile id to be found by at all.
    expect(rolled[1]?.placements).toEqual([one, two])
    expect(rolled[1]?.slots).toEqual([floor, wall])
    expect(rolled[0]?.tileIds).toEqual([])
    expect(rolled[0]?.placements).toEqual([two])
    expect(rolled[0]?.slots).toEqual([wall])
  })
})

/* ---------------------------------------------------- row A3: the slot walk */

/**
 * A parsed catalog from a handful of tagged rows.
 *
 * Parsed through the real `CatalogFile` schema rather than cast, because
 * `@/composition` reads the **intern table** — `record.tags` is an array of
 * indices into `file.tags` — and a hand-cast object would let a test pass with a
 * tag list no production catalog could hold. Every claim in `template instances`
 * below rests on the postings index resolving a real tag string to a real
 * record, so the fixture has to be a real catalog.
 */
interface Row {
  readonly id: string
  readonly tags: readonly string[]
  readonly layer: CatalogRecord['layer']
  readonly foot?: Footprint
  readonly build?: string
  readonly conn?: readonly string[]
  readonly blob?: string
  readonly bytes?: number
  /** The host's own composition slots — where a hold goes. See `the holds` below. */
  readonly config?: CatalogRecord['config']
  /** Where they attach, measured. Absent is what every live record carries today. */
  readonly mounts?: CatalogRecord['mounts']
  /** How an insert plugs in, measured. Absent is `hold-unanchored`'s case. */
  readonly anchor?: CatalogRecord['anchor']
  /** Slots whose accessory is already in this mesh, measured. `isModelledIn`'s input. */
  readonly modelledIn?: readonly string[]
}

function worldCatalog(rows: readonly Row[]): CatalogFile {
  const tags = [...new Set(rows.flatMap((row) => row.tags))].sort()
  return CatalogFileSchema.parse({
    version: { schema: 1, pipeline: 1, fixtures: 'test-fixture', manifest: 1, built: '2026-09-01T12:00:00.000Z' },
    assets: {
      models: 'https://objects.openforge.tools/models',
      sprites: 'https://objects.openforge.tools/sprites',
      thumbs: 'https://objects.openforge.tools/thumbs',
      lod: 'https://objects.openforge.tools/lod',
    },
    sprite: MEASURED_SPRITE_SHEET,
    tags,
    records: rows.map((row, index) => {
      const cut = row.id.lastIndexOf('/')
      return {
        id: row.id,
        ord: index + 1,
        blob: row.blob ?? String(index + 1).padStart(32, '0'),
        file: row.id.slice(cut + 1),
        bytes: row.bytes ?? 1_000_000,
        sprite: true,
        thumb: false,
        family: row.id.slice(0, cut),
        design: `d${row.id}`,
        name: row.id.slice(cut + 1),
        kinds: [],
        conn: [...(row.conn ?? ['openlock'])],
        layer: row.layer,
        tags: row.tags.map((tag) => tags.indexOf(tag)),
        foot: row.foot ?? { shape: 'rect', w: 2, d: 2 },
        ...(row.build === undefined ? {} : { build: row.build }),
        ...(row.config === undefined ? {} : { config: row.config }),
        ...(row.mounts === undefined ? {} : { mounts: row.mounts }),
        ...(row.anchor === undefined ? {} : { anchor: row.anchor }),
        ...(row.modelledIn === undefined ? {} : { modelledIn: [...row.modelledIn] }),
      }
    }),
  })
}

/** An assembly index, a composition index and a context, over one fixture catalog. */
function worldOf(rows: readonly Row[], template: AssemblyTemplate, lock?: LockSystem) {
  const file = worldCatalog(rows)
  const index = buildAssemblyIndex(file)
  const composition = createCompositionIndex(file)
  const context: AssemblyContext = {
    templates: (id) => (id === template.id ? template : undefined),
    composition,
    ...(lock === undefined ? {} : { lock }),
  }
  return { file, index, composition, context }
}

/** One instance of a template, with the fills named by slot. */
function instanceOf(
  template: AssemblyTemplate,
  fills: Readonly<Record<string, string>>,
  at = 1,
): TemplateInstance {
  return {
    id: `p${String(at)}` as PlacementId,
    template: template.id as TemplateId,
    x: 0,
    z: 0,
    rotation: 0,
    fills: Object.fromEntries(
      Object.entries(fills).map(([slot, tile]) => [slot, { tile: tile as TileId, pinned: false }]),
    ),
    // *Any* on every axis, which is what these fixtures mean: they are about the
    // fills and say nothing about a control position.
    filters: [],
  }
}

/**
 * The same instance, with accessories fitted into one slot's file.
 *
 * A second helper rather than a widening of {@link instanceOf}, because a hold
 * is a fill *of a fill* — `SlotFill.holds` hangs off the slot's own entry — and
 * threading a nested map through the flat `{ slot: tileId }` shape every other
 * test in this file uses would make the common case read like the rare one.
 */
function holding(
  instance: TemplateInstance,
  slot: string,
  holds: Readonly<Record<string, string>>,
): TemplateInstance {
  const fill = (instance.fills as Readonly<Record<string, SlotFill | undefined>>)[slot]
  if (fill === undefined) throw new Error(`the fixture has no fill in ${slot} to hold anything`)
  return {
    ...instance,
    fills: {
      ...instance.fills,
      [slot]: {
        ...fill,
        holds: Object.fromEntries(
          Object.entries(holds).map(([name, tile]) => [name, { tile: tile as TileId, pinned: false }]),
        ),
      },
    },
  }
}

const slot = (name: string, tags: AssemblySlot['tags'], optional?: boolean): AssemblySlot => ({
  name,
  tags,
  ...(optional === undefined ? {} : { optional }),
})

describe('template instances', () => {
  /** A three-slot recipe in the shape the 40 shipped ones have: floor, wall, base. */
  const ROOM: AssemblyTemplate = {
    id: 'fixture-room',
    tags: ['object|tile'],
    parts: [
      slot('floor', { require: [{ tag: 'shape|floor' }] }),
      slot('wall', { require: [{ tag: 'shape|wall' }] }),
      slot('base', { require: [{ tag: 'shape|base' }] }),
    ],
  }

  // Every row declares a `build`, so the note lists below are exact. Absence is
  // a note of its own — `build-unspecified`, true of a quarter of the corpus —
  // and it has its own test with its own rows rather than colouring every
  // assertion in this block.
  const ROWS: readonly Row[] = [
    { id: 'tiles/room/floor.stl', tags: ['shape|floor'], layer: 'integral', build: 'separate wall' },
    {
      id: 'tiles/room/wall.stl',
      tags: ['shape|wall'],
      layer: 'topper',
      foot: { shape: 'wall', length: 2 },
      build: 'separate wall',
    },
    { id: 'tiles/room/base.stl', tags: ['shape|base'], layer: 'base', build: 'separate wall' },
  ]

  const FLOOR = 'tiles/room/floor.stl'
  const WALL = 'tiles/room/wall.stl'
  const BASE = 'tiles/room/base.stl'

  it('walks the template’s declared slots, in the template’s declared order', () => {
    const { index, context } = worldOf(ROWS, ROOM)
    const resolved = resolveInstance(instanceOf(ROOM, { floor: FLOOR, wall: WALL, base: BASE }), index, context)

    // One `slots` entry per *declared* slot, and one `parts` entry per *resolved
    // fill* — the distinction that makes an unfilled slot a value rather than an
    // absence a caller has to infer by differencing two lists.
    expect(resolved.slots.map((entry) => entry.slot)).toEqual(['floor', 'wall', 'base'])
    expect(resolved.parts.map((part) => part.slot)).toEqual(['floor', 'wall', 'base'])
    expect(resolved.parts.map((part) => part.record.id)).toEqual([FLOOR, WALL, BASE])
    expect(resolved.complete).toBe(true)
    expect(resolved.notes.map((entry) => entry.code)).toEqual([])
    expect(resolved.slots.every((entry) => entry.admissible === true)).toBe(true)
  })

  it('has no `tile` and no `role` — contract C-h, honoured by deletion', () => {
    // The two fields row A3 deleted rather than repointed. `tile` was one record
    // per placement, and "the primary slot's record" would describe a third of
    // this instance while type-checking everywhere; `role` meant *did the user
    // put this here or did rule 1*, and nothing is auto-inserted, so every part
    // would read `'placed'` and a UI would say "no added bases" where the truth
    // is that the question no longer applies.
    //
    // Asserted at run time as well as by the types, because a `ResolvedInstance`
    // reaches the panel as a plain object and an over-eager spread could put
    // either field back without any call site changing.
    const { index, context } = worldOf(ROWS, ROOM)
    const resolved = resolveInstance(instanceOf(ROOM, { floor: FLOOR, base: BASE }), index, context)
    expect(resolved).not.toHaveProperty('tile')
    expect(resolved).not.toHaveProperty('resolution')
    for (const part of resolved.parts) {
      expect(part).not.toHaveProperty('role')
      expect(part).not.toHaveProperty('match')
      // What replaces `role`, and it says strictly more: the slot the recipe
      // asked for, rather than a guess at who chose it.
      expect(part.slot).toBeDefined()
      expect(part.pinned).toBe(false)
    }
  })

  it('places an incomplete instance anyway, and refuses its download', () => {
    // §3.2's "places anyway" and hazard 6 together. The instance is on the grid
    // with two of three slots filled, so it resolves, prints what it has and
    // says what is missing — and `complete` is what stops the zip, because a
    // pack one file short of a printable model is worse than no pack.
    const { index, context } = worldOf(ROWS, ROOM)
    const resolved = resolveInstance(instanceOf(ROOM, { floor: FLOOR, base: BASE }), index, context)

    expect(resolved.parts).toHaveLength(2)
    expect(resolved.complete).toBe(false)
    expect(resolved.notes.map((entry) => entry.code)).toEqual(['slot-unfilled'])
    const note = resolved.notes[0]
    expect(note?.slot).toBe('wall')
    expect(note?.placement).toBe('p1')
    // No tile id, because there is no tile: this is the note that would show a
    // count with an empty subject list if `Note` carried only a `tileId`.
    expect(note?.tileId).toBeUndefined()
    expect(note?.message).toContain('wall slot is empty')

    const bill = buildBillOfTiles([resolved.instance], index, context)
    expect(bill.complete).toBe(false)
    expect(bill.unfilled).toEqual([{ placement: 'p1', template: 'fixture-room', slot: 'wall' }])
  })

  it('treats an absent `optional` as required, which is every shipped slot', () => {
    // `PartSlot.optional` is absent on 1,050 of the 3,695 live tile slots and
    // **absence means required**; over the 40 shipped templates it is absent
    // from all 128 parts, asserted against the live table below. So the gate has
    // to read absence as required or it passes on every incomplete instance in
    // the app.
    const required: AssemblyTemplate = { ...ROOM, parts: [slot('floor', { require: [{ tag: 'shape|floor' }] })] }
    const optional: AssemblyTemplate = {
      ...ROOM,
      parts: [slot('floor', { require: [{ tag: 'shape|floor' }] }, true)],
    }

    const bare = worldOf(ROWS, required)
    const withRequired = resolveInstance(instanceOf(required, {}), bare.index, bare.context)
    expect(withRequired.complete).toBe(false)
    expect(withRequired.notes.map((entry) => entry.code)).toEqual(['slot-unfilled'])
    expect(withRequired.slots[0]?.optional).toBe(false)

    const lax = worldOf(ROWS, optional)
    const withOptional = resolveInstance(instanceOf(optional, {}), lax.index, lax.context)
    expect(withOptional.complete).toBe(true)
    expect(withOptional.notes).toEqual([])
    expect(withOptional.slots[0]?.optional).toBe(true)
  })

  it('loses one part to a retired fill, not the whole instance', () => {
    // Hazard 6's substance. Before A3 a dead identity cost a whole placement and
    // emitted a visible `unknown-tile`; per-slot it costs one file, so the other
    // two slots still print — and the same instance no longer announces itself
    // as unresolvable. Both notes fire: `unknown-tile` says *which* of the two
    // things went wrong, `slot-unfilled` carries the consequence.
    const { index, context } = worldOf(ROWS, ROOM)
    const dead = 'tiles/room/retired.stl'
    const resolved = resolveInstance(
      instanceOf(ROOM, { floor: FLOOR, wall: dead, base: BASE }),
      index,
      context,
    )

    expect(resolved.parts.map((part) => part.record.id)).toEqual([FLOOR, BASE])
    expect(resolved.complete).toBe(false)
    expect(resolved.notes.map((entry) => entry.code).sort()).toEqual(['slot-unfilled', 'unknown-tile'])

    // The subject is the **file**, which is a catalog identity a reader can look
    // up — the whole difference from the pre-A3 form, where the placement named a
    // design and the message had to carry an id the catalog did not hold.
    const unknown = resolved.notes.find((entry) => entry.code === 'unknown-tile')
    expect(unknown?.tileId).toBe(dead)
    expect(unknown?.slot).toBe('wall')
    expect(resolved.slots[1]?.record).toBeUndefined()
    // Not `false`: there was nothing to check, and reporting "checked and wrong"
    // for "not checked" is the state a boolean would have collapsed.
    expect(resolved.slots[1]?.admissible).toBeUndefined()
  })

  it('names a template this build does not ship, without inventing a tile id', () => {
    // Hazard 9. A template id is not a catalog identity at all — none of the 40
    // carries `file_metadata`, so none is a `CatalogRecord` — so it goes in the
    // message and never in `Note.tileId`, which a UI resolves through the
    // catalog.
    const { index, context } = worldOf(ROWS, ROOM)
    const stray = { ...instanceOf(ROOM, { floor: FLOOR }), template: 'not-a-template' as TemplateId }
    const resolved = resolveInstance(stray, index, context)

    expect(resolved.template).toBeUndefined()
    expect(resolved.slots).toEqual([])
    expect(resolved.parts).toEqual([])
    expect(resolved.complete).toBe(false)
    expect(resolved.notes.map((entry) => entry.code)).toEqual(['unknown-template'])
    expect(resolved.notes[0]?.tileId).toBeUndefined()
    expect(resolved.notes[0]?.message).toContain('not-a-template')

    // And it still fails the gate, because an instance whose recipe this build
    // does not hold cannot be shown to be complete.
    const bill = buildBillOfTiles([stray], index, context)
    expect(bill.complete).toBe(false)
    expect(bill.unfilled).toEqual([{ placement: 'p1', template: 'not-a-template', slot: undefined }])
  })

  it('says when a fill is not one of the files its slot admits', () => {
    // Row A3's new work, and the condition the old resolver structurally could
    // not express: the base slot requires `shape|base` and the floor does not
    // carry it, so this fill will print and will not fit. Nothing refuses it —
    // §7 — and the part is still billed.
    const { index, context } = worldOf(ROWS, ROOM)
    const resolved = resolveInstance(
      instanceOf(ROOM, { floor: FLOOR, wall: WALL, base: FLOOR }),
      index,
      context,
    )

    expect(resolved.parts).toHaveLength(3)
    expect(resolved.complete).toBe(true)
    expect(resolved.slots[2]?.admissible).toBe(false)
    const note = resolved.notes.find((entry) => entry.code === 'fill-off-slot')
    expect(note?.slot).toBe('base')
    expect(note?.tileId).toBe(FLOOR)
    expect(note?.message).toContain('will print and will not fit')
    // A complete instance can still be a wrong one: the gate is about missing
    // files, and this is about a file that fits nothing.
    expect(resolved.slots[0]?.admissible).toBe(true)
  })

  it('threads the sibling fills into the constrain join, which is what makes it narrow', () => {
    // The check that would pass vacuously if the sibling tags were not
    // threaded — and it is the reason `tagsOfFills` exists. `constrain` collects
    // tags under a prefix from the parent *and* the siblings and adds the
    // survivors to `require`, so a `colour` constraint on slot `b` is decided by
    // whatever fills slot `a`.
    //
    // A template's own tags share **no root** with its constrain entries, which
    // is why a template narrows where a tile does not: 8,645 narrowings in
    // 11,938 observations against a tile parent's 0 in 33,221.
    const COLOURED: AssemblyTemplate = {
      id: 'fixture-coloured',
      tags: ['object|tile'],
      parts: [
        slot('a', { require: [{ tag: 'kind|a' }] }),
        slot('b', { require: [{ tag: 'kind|b' }], constrain: [{ tag: 'colour' }] }),
      ],
    }
    const rows: readonly Row[] = [
      { id: 'tiles/c/a-red.stl', tags: ['kind|a', 'colour|red'], layer: 'integral', build: 's2w' },
      { id: 'tiles/c/b-red.stl', tags: ['kind|b', 'colour|red'], layer: 'integral', build: 's2w' },
      { id: 'tiles/c/b-blue.stl', tags: ['kind|b', 'colour|blue'], layer: 'integral', build: 's2w' },
    ]
    const { index, context } = worldOf(rows, COLOURED)
    const admissibility = (fills: Readonly<Record<string, string>>) =>
      resolveInstance(instanceOf(COLOURED, fills), index, context).slots.map((entry) => entry.admissible)

    // With no sibling, nothing constrains `colour` and both blues and reds fit.
    expect(admissibility({ b: 'tiles/c/b-blue.stl' })).toEqual([undefined, true])
    // With a red sibling, `colour|red` joins `b`'s require — so the red fits and
    // the blue does not. If the siblings were not passed, both would be `true`.
    expect(admissibility({ a: 'tiles/c/a-red.stl', b: 'tiles/c/b-red.stl' })).toEqual([true, true])
    expect(admissibility({ a: 'tiles/c/a-red.stl', b: 'tiles/c/b-blue.stl' })).toEqual([true, false])
  })

  it('ignores a fills key that is not a slot of the template', () => {
    // `store/schema.ts` states the condition and why it is expressible: checking
    // it would need the template table, which must not enter the store's file
    // closure, so an unknown key fails closed the same way an unknown template
    // does — nothing renders it, because rendering walks the template's parts
    // and asks `fills` for each. This is that walk.
    const { index, context } = worldOf(ROWS, ROOM)
    const stray = instanceOf(ROOM, { floor: FLOOR, wall: WALL, base: BASE, ceiling: FLOOR })
    const resolved = resolveInstance(stray, index, context)
    expect(resolved.slots.map((entry) => entry.slot)).toEqual(['floor', 'wall', 'base'])
    expect(resolved.parts).toHaveLength(3)
    expect(resolved.notes).toEqual([])
  })

  it('reports the per-file facts about every fill, not about one of them', () => {
    // The four notes the brief keeps, now asked once per *fill* rather than once
    // per placement. `no-footprint` and `insert-on-grid` are properties of a
    // record, and a placement holds up to five records.
    const rows: readonly Row[] = [
      { id: 'tiles/odd/shapeless.stl', tags: ['shape|floor'], layer: 'integral', foot: { shape: 'none' } },
      { id: 'tiles/odd/insert.stl', tags: ['shape|wall'], layer: 'insert' },
      { id: 'tiles/odd/base.stl', tags: ['shape|base'], layer: 'base', build: 'wall on tile' },
    ]
    const { index, context } = worldOf(rows, ROOM)
    const resolved = resolveInstance(
      instanceOf(ROOM, {
        floor: 'tiles/odd/shapeless.stl',
        wall: 'tiles/odd/insert.stl',
        base: 'tiles/odd/base.stl',
      }),
      index,
      context,
    )

    const codes = resolved.notes.map((entry) => entry.code)
    expect(codes).toContain('no-footprint')
    expect(codes).toContain('insert-on-grid')
    // `build-unspecified` fires for the two rows with no `build|` tag and not for
    // the base, which has one — three fills, two notes, which is the per-fill
    // reading a per-placement one could not produce.
    expect(codes.filter((code) => code === 'build-unspecified')).toHaveLength(2)
    expect(
      resolved.notes.filter((entry) => entry.code === 'build-unspecified').map((entry) => entry.slot).sort(),
    ).toEqual(['floor', 'wall'])
    // Nothing is refused: §7, and all three parts are billed.
    expect(resolved.parts).toHaveLength(3)
  })

  it('warns when a fill carries lock systems and not the preferred one', () => {
    const rows: readonly Row[] = [
      {
        id: 'tiles/lock/floor.stl',
        tags: ['shape|floor'],
        layer: 'integral',
        conn: ['dragonlock'],
        build: 'separate wall',
      },
    ]
    const template: AssemblyTemplate = { ...ROOM, parts: [slot('floor', { require: [{ tag: 'shape|floor' }] })] }
    const { index, context } = worldOf(rows, template, 'openlock')
    const resolved = resolveInstance(instanceOf(template, { floor: 'tiles/lock/floor.stl' }), index, context)
    const note = resolved.notes.find((entry) => entry.code === 'lock-unavailable')
    expect(note?.message).toContain('offers dragonlock, not openlock')
    expect(note?.slot).toBe('floor')

    // With no preference the note cannot fire — there is nothing to disagree
    // with, and applying a default here would silently decide for a caller that
    // deliberately had not.
    const { index: bare, context: noLock } = worldOf(rows, template)
    expect(
      resolveInstance(instanceOf(template, { floor: 'tiles/lock/floor.stl' }), bare, noLock).notes,
    ).toEqual([])
  })

  it('counts two slots resolving to one file as two prints of one download — contract C-c', () => {
    // The md5 dedupe got *more* load-bearing, not less. Two slots of one
    // instance can legitimately name the same file, and that is a `quantity` of
    // 2 on one line: one download, two prints on the bed.
    const TWO_BASES: AssemblyTemplate = {
      id: 'fixture-two-bases',
      tags: ['object|tile'],
      parts: [
        slot('base', { require: [{ tag: 'shape|base' }] }),
        slot('base 2', { require: [{ tag: 'shape|base' }] }),
      ],
    }
    const rows: readonly Row[] = [
      { id: 'tiles/two/base.stl', tags: ['shape|base'], layer: 'base', bytes: 4_096, build: 'separate wall' },
    ]
    const { index, context } = worldOf(rows, TWO_BASES)
    const bill = buildBillOfTiles(
      [instanceOf(TWO_BASES, { base: 'tiles/two/base.stl', 'base 2': 'tiles/two/base.stl' })],
      index,
      context,
    )

    expect(bill.files).toBe(1)
    expect(bill.parts).toBe(2)
    expect(bill.copies).toBe(2)
    expect(bill.lines[0]?.quantity).toBe(2)
    // One download, because the line is a file and the file is one md5.
    expect(bill.download.bytes).toBe(4_096)
    // And `tileIds` cannot tell you who asked: one catalog path, quantity two.
    // That is hazard 5, and `slots` is what carries the provenance instead —
    // `tileIds` is retained unchanged because `download/plan.ts` copies it into
    // `ATTRIBUTION.csv` as `catalogPaths`.
    expect(bill.lines[0]?.tileIds).toEqual(['tiles/two/base.stl'])
    expect(bill.lines[0]?.slots).toEqual([
      { placement: 'p1', slot: 'base', tile: 'tiles/two/base.stl' },
      { placement: 'p1', slot: 'base 2', tile: 'tiles/two/base.stl' },
    ])
    expect(bill.complete).toBe(true)
  })

  it('sees a build-system mix across the slots of one instance', () => {
    // Hazard 3, and the silent form of it: `mixedBuildNote` read one
    // `tile?.build` per placement, so a scene whose floors are `separate wall`
    // and whose walls are `wall on tile` showed one system per instance and no
    // mix at all. Absence of a note is indistinguishable from nothing being
    // wrong, which is why the loop is over parts.
    const rows: readonly Row[] = [
      { id: 'tiles/mix/floor.stl', tags: ['shape|floor'], layer: 'integral', build: 'separate wall' },
      { id: 'tiles/mix/wall.stl', tags: ['shape|wall'], layer: 'topper', build: 'wall on tile' },
      { id: 'tiles/mix/base.stl', tags: ['shape|base'], layer: 'base', build: 'separate wall' },
    ]
    const { index, context } = worldOf(rows, ROOM)
    const one = instanceOf(ROOM, {
      floor: 'tiles/mix/floor.stl',
      wall: 'tiles/mix/wall.stl',
      base: 'tiles/mix/base.stl',
    })
    const bill = buildBillOfTiles([one], index, context)

    // **One instance**, two build systems, one note. A per-placement reading
    // would have seen a single record and reported nothing.
    expect(bill.placements).toBe(1)
    const note = bill.notes.find((entry) => entry.code === 'mixed-build-systems')
    expect(note?.message).toContain('separate wall, wall on tile')

    // And a scene that genuinely does not mix stays quiet.
    const uniform = worldOf(
      rows.map((row) => ({ ...row, build: 'separate wall' })),
      ROOM,
    )
    expect(
      buildBillOfTiles([one], uniform.index, uniform.context).notes.map((entry) => entry.code),
    ).not.toContain('mixed-build-systems')
  })

  it('returns an empty bill for an empty scene rather than throwing', () => {
    const { index, context } = worldOf(ROWS, ROOM)
    const bill = buildBillOfTiles([], index, context)
    expect(bill.lines).toEqual([])
    expect(bill.placements).toBe(0)
    expect(bill.parts).toBe(0)
    expect(bill.files).toBe(0)
    expect(bill.copies).toBe(0)
    expect(bill.download).toEqual({ bytes: 0, verdict: 'ok', threshold: DOWNLOAD_LARGE_BYTES })
    expect(bill.notes).toEqual([])
    expect(bill.collisions).toEqual([])
    expect(bill.resolved).toEqual([])
    // Complete because nothing in it is missing. Refusing the download of an
    // empty scene is `download/plan.ts`'s `EmptyArchiveError`, and it already
    // does.
    expect(bill.complete).toBe(true)
    expect(bill.unfilled).toEqual([])
  })

  it('has no baseQuantity and no baseCopies — hazard 4, honoured by deletion', () => {
    // Both counted `role === 'base'`, which meant *the app added this*. Handing
    // every fill `role: 'placed'` would have left them at zero and a UI reading
    // "no added bases" rather than "this no longer applies"; mapping a slot
    // *named* `base` to that role would have counted a deliberate user choice as
    // an auto-insert. So the fields are gone and every reader is a compile error.
    const { index, context } = worldOf(ROWS, ROOM)
    const bill = buildBillOfTiles([instanceOf(ROOM, { base: BASE })], index, context)
    expect(bill).not.toHaveProperty('baseCopies')
    expect(bill.lines[0]).not.toHaveProperty('baseQuantity')
  })
})

/* ------------------------------------------------------- the accessory holds */

/**
 * Holds: the accessories fitted into a slot's own file.
 *
 * Everything here is a fixture rather than a corpus measurement, and that is a
 * choice about *coverage*, not a gap in the data: 969 live records carry
 * `mounts` since the 2026-09-10 measuring run, and the corpus block at the foot
 * of this file exercises the counting rule against them — all 20 accessory
 * declarations across the 40 recipes resolve to exactly one measured mount.
 * What the corpus cannot supply is the *arithmetic's* edge cases, because it
 * does not happen to contain them: a hold over a host with four mounts, one with
 * none, one whose record is missing. Those are the cases the rule exists for, so
 * they are built here rather than hunted for.
 *
 * The four-socket host is not a convenience either: a 1×1 full pillar carries
 * one torch socket per face, so a `quantity` of 4 from a single hold is the case
 * the arithmetic exists for.
 */
describe('the holds', () => {
  const WALL = 'tiles/hold/wall.stl'
  const TORCH = 'tiles/hold/torch.stl'
  const GONE = 'tiles/hold/retired-torch.stl'

  /** A one-slot recipe, so an instance is one host file and its accessories. */
  const HOST: AssemblyTemplate = {
    id: 'fixture-host',
    tags: ['object|tile'],
    parts: [slot('wall', { require: [{ tag: 'shape|wall' }] })],
  }

  /** The measured torch socket on one face: 5.5 × 3 mm, 65° from the face normal. */
  function torchSocket(face: Face, normal: Vec3): Mount {
    return {
      slot: 'torch',
      kind: 'socket',
      face,
      normal,
      at: [normal[0] * 6.35, normal[1] * 6.35, 38.1],
      axis: [-normal[0] * 0.4226, -normal[1] * 0.4226, 0.9063],
      section: [5.5, 3],
      depth: 14,
    }
  }

  /** The four faces of a full pillar, one socket each. */
  const PILLAR_FACES: readonly (readonly [Face, Vec3])[] = [
    ['-y', [0, -1, 0]],
    ['+y', [0, 1, 0]],
    ['-x', [-1, 0, 0]],
    ['+x', [1, 0, 0]],
  ]

  /**
   * A host declaring a `torch` accessory slot, with `sockets` of them measured.
   *
   * `optional` is absent by default, which is the corpus reading: 1,047 of the
   * 1,244 accessory declarations omit it and **absence means required**.
   */
  function hostRow(
    options: {
      readonly sockets?: number
      readonly optional?: boolean
      /** The mesh already carries the torch — `CatalogRecord.modelledIn`. */
      readonly modelledIn?: boolean
    } = {},
  ): Row {
    return {
      id: WALL,
      tags: ['shape|wall'],
      layer: 'topper',
      build: 'separate wall',
      bytes: 4_096,
      config: {
        parts: [
          {
            name: 'torch',
            tags: { require: [{ tag: 'kind|torch' }] },
            ...(options.optional === undefined ? {} : { optional: options.optional }),
          },
        ],
      },
      ...(options.modelledIn === true ? { modelledIn: ['torch'] } : {}),
      ...(options.sockets === undefined
        ? {}
        : {
            mounts: PILLAR_FACES.slice(0, options.sockets).map(([face, normal]) =>
              torchSocket(face, normal),
            ),
          }),
    }
  }

  const TORCH_ROW: Row = {
    id: TORCH,
    tags: ['kind|torch'],
    layer: 'insert',
    build: 'separate wall',
    bytes: 2_048,
    // A 7 x 7 x 12 mm peg, anchored at the narrow end at `z = 0`. An insert without one
    // is `hold-unanchored` and cannot be drawn, which is its own case below.
    anchor: { kind: 'peg', at: [0, 0, 0], axis: [0, 0, 1], size: [7, 7, 12] },
  }

  /** The same torch nobody has measured — the insert half of the pair. */
  const UNANCHORED_TORCH_ROW: Row = {
    id: TORCH,
    tags: ['kind|torch'],
    layer: 'insert',
    build: 'separate wall',
    bytes: 2_048,
  }

  /** One instance of {@link HOST} whose wall holds the named accessories. */
  function scene(holds: Readonly<Record<string, string>>): TemplateInstance {
    return holding(instanceOf(HOST, { wall: WALL }), 'wall', holds)
  }

  it('bills one copy of a hold per measured mount — a full pillar carries four sockets', () => {
    const { index, context } = worldOf([hostRow({ sockets: 4 }), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([scene({ torch: TORCH })], index, context)

    // One line for the torch, four prints of it, one download: the host's four
    // sockets are four places the same file goes, which is the md5 dedupe's own
    // case one level down.
    const line = bill.lines.find((entry) => entry.tile.id === TORCH)
    expect(line?.quantity).toBe(4)
    expect(line?.slots).toEqual([{ placement: 'p1', slot: 'wall', tile: TORCH, hold: 'torch' }])
    expect(bill.files).toBe(2)
    expect(bill.copies).toBe(5)
    expect(bill.download.bytes).toBe(4_096 + 2_048)
    // Nothing missing and nothing undrawable: the host was measured.
    expect(bill.complete).toBe(true)
    expect(bill.unfilled).toEqual([])
    expect(bill.unplaced).toEqual([])
  })

  /**
   * A `wide` doorway: **one** measured opening, authored for two leaves.
   *
   * 47.5 mm is the measured convention (2 × 24.6 mm of leaf), and the `door`
   * slot is what a leaf and a lintel both fill — the same opening, two slots,
   * which is why the bill cannot read the copies off the mount count.
   */
  const DOORWAY_MOUNT: Mount = {
    slot: 'door',
    kind: 'opening',
    face: '-y',
    normal: [0, -1, 0],
    at: [0, -6.35, 24],
    width: 47.5,
    sill: 4.5,
    head: 44,
    openTop: true,
    leaves: 2,
  }

  const DOOR = 'tiles/hold/door.stl'
  const LINTEL = 'tiles/hold/lintel.stl'

  /** A wide door wall declaring both slots the one opening serves. */
  const DOORWAY_ROW: Row = {
    id: WALL,
    tags: ['shape|wall'],
    layer: 'topper',
    build: 'separate wall',
    bytes: 4_096,
    config: {
      parts: [
        { name: 'door', tags: { require: [{ tag: 'kind|door' }] } },
        { name: 'lintel', tags: { require: [{ tag: 'kind|lintel' }] }, optional: true },
      ],
    },
    mounts: [DOORWAY_MOUNT, { ...DOORWAY_MOUNT, slot: 'lintel' }],
  }

  /** One of a pair: 24.6 mm of leaf in a 47.5 mm opening, 52 % of it. */
  const HALF_LEAF_ROW: Row = {
    id: DOOR,
    tags: ['kind|door'],
    layer: 'insert',
    build: 'separate wall',
    bytes: 2_048,
    anchor: { kind: 'leaf', at: [0, 0, 0], axis: [0, 1, 0], size: [24.6, 3.9, 35.5] },
  }

  /** `door_lintel.double.1.stl`'s measurement: one 60.85 mm slab, 128 % of it. */
  const DOUBLE_LINTEL_ROW: Row = {
    id: LINTEL,
    tags: ['kind|lintel'],
    layer: 'insert',
    build: 'separate wall',
    bytes: 1_024,
    anchor: { kind: 'leaf', at: [0, 0, 0], axis: [0, 0, 1], size: [60.85, 12.99, 7.09] },
  }

  /**
   * The count the bill was short by: **two** leaves on one measured opening.
   *
   * A doorway `require`-ing `size|wide` is one mount and two prints, so a
   * quantity read off `mountsFor(...).length` under-counted all 85 of them — a
   * download that cannot fill the doorway it was built from. The lintel over the
   * same opening is one piece, and the two are told apart by their span alone:
   * `catalog/mounts.ts#copiesOf`, which is what `buildRoom3D` draws by.
   */
  it('bills two leaves and one lintel for one wide doorway', () => {
    const { index, context } = worldOf([DOORWAY_ROW, HALF_LEAF_ROW, DOUBLE_LINTEL_ROW], HOST)
    const scene = holding(instanceOf(HOST, { wall: WALL }), 'wall', { door: DOOR, lintel: LINTEL })
    const bill = buildBillOfTiles([scene], index, context)

    expect(bill.lines.find((entry) => entry.tile.id === DOOR)?.quantity).toBe(2)
    expect(bill.lines.find((entry) => entry.tile.id === LINTEL)?.quantity).toBe(1)
    // The wall, two leaves and one lintel: four prints of three files.
    expect(bill.files).toBe(3)
    expect(bill.copies).toBe(4)
    expect(bill.download.bytes).toBe(4_096 + 2_048 + 1_024)
    expect(bill.complete).toBe(true)
    expect(bill.unplaced).toEqual([])

    const held = bill.resolved[0]?.holds ?? []
    expect(held.map((one) => [one.hold, one.mounts, one.copies])).toEqual([
      ['door', 1, 2],
      ['lintel', 1, 1],
    ])
  })

  it('resolves one entry per declared accessory slot, filled or not', () => {
    const { index, context } = worldOf([hostRow({ sockets: 4 }), TORCH_ROW], HOST)
    const resolved = resolveInstance(scene({ torch: TORCH }), index, context)

    expect(resolved.holds).toEqual([
      {
        slot: 'wall',
        hold: 'torch',
        optional: false,
        fill: { tile: TORCH, pinned: false },
        record: index.byId.get(TORCH as TileId),
        modelledIn: false,
        mounts: 4,
        // Four sockets, one torch each: `copies` and `mounts` part company only
        // on a `wide` doorway's pair of leaves.
        copies: 4,
      },
    ])
    // The hold is a part like any other, and it is the part that carries the
    // count: `quantity` is where four sockets stop being one print.
    const part = resolved.parts.find((entry) => entry.hold !== undefined)
    expect(part?.slot).toBe('wall')
    expect(part?.hold).toBe('torch')
    expect(part?.quantity).toBe(4)
    expect(resolved.parts.find((entry) => entry.hold === undefined)?.quantity).toBe(1)
  })

  it('bills an unmeasured host’s hold once, and says the plan cannot draw it', () => {
    // `CatalogRecord.mounts` is absent both for a host with no accessory slot
    // and for a host nobody has measured, and `mountsFor` folds the two
    // together — so this is the state every live record is in today. The
    // accessory still prints: a download taken before the measuring pass has
    // caught up holds the file the user chose.
    const { index, context } = worldOf([hostRow(), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([scene({ torch: TORCH })], index, context)

    expect(bill.lines.find((entry) => entry.tile.id === TORCH)?.quantity).toBe(1)
    expect(bill.unplaced).toEqual([{ placement: 'p1', slot: 'wall', hold: 'torch', tile: TORCH }])
    // `info`, for `no-footprint`'s reason: in the bill, not on the plan, and a
    // gap in the measurement rather than a fault in the room.
    const note = bill.notes.find((entry) => entry.code === 'hold-unplaced')
    expect(note?.severity).toBe('info')
    expect(note?.message).toContain('torch')
    // It is filled, so it is not a hole: the download is not refused over it.
    expect(bill.complete).toBe(true)
  })

  it('bills an unmeasured insert once, and says the plan cannot draw that either', () => {
    // The host is measured to the millimetre and the *accessory* is not: no
    // `anchor` means no point on its own mesh to seat on the socket, so
    // `builder/three/instances.ts` neither draws nor fetches it. One row and one
    // note, aimed at the other file of the pair than `hold-unplaced`'s.
    const { index, context } = worldOf([hostRow({ sockets: 4 }), UNANCHORED_TORCH_ROW], HOST)
    const bill = buildBillOfTiles([scene({ torch: TORCH })], index, context)

    // Still four prints: the mounts are real and the user has to print one per
    // socket whether or not anything can draw them.
    expect(bill.lines.find((entry) => entry.tile.id === TORCH)?.quantity).toBe(4)
    expect(bill.unplaced).toEqual([{ placement: 'p1', slot: 'wall', hold: 'torch', tile: TORCH }])
    const note = bill.notes.find((entry) => entry.code === 'hold-unanchored')
    expect(note?.severity).toBe('info')
    expect(note?.message).toContain('plugs in')
    // One fault, one note: the host's own measurement is not in question.
    expect(bill.notes.map((entry) => entry.code)).toEqual(['hold-unanchored'])
    expect(bill.complete).toBe(true)
  })

  it('refuses the download for a required accessory slot with no hold', () => {
    const { index, context } = worldOf([hostRow({ sockets: 4 }), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([instanceOf(HOST, { wall: WALL })], index, context)

    expect(bill.complete).toBe(false)
    expect(bill.unfilled).toEqual([
      { placement: 'p1', template: 'fixture-host', slot: 'wall', hold: 'torch' },
    ])
    expect(bill.resolved[0]?.complete).toBe(false)
    expect(bill.resolved[0]?.holds[0]).toEqual({
      slot: 'wall',
      hold: 'torch',
      optional: false,
      fill: undefined,
      record: undefined,
      modelledIn: false,
      mounts: 4,
      // No insert, so nothing to count copies of: one per mount is the answer
      // `mounts` alone always gave.
      copies: 4,
    })
  })

  it('asks nothing for a slot the host has built in, and refuses no download', () => {
    /*
      **F6.** The three `floor,brazier+small.2x2` blobs declare a `brazier` slot
      and are 31.6–33.2 mm tall because the brazier is sculpted onto the floor.
      The slot is *satisfied by the print*: not a declaration the room can fill,
      so not an `unfilled` entry and not a refused download.
    */
    const { index, context } = worldOf([hostRow({ modelledIn: true }), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([instanceOf(HOST, { wall: WALL })], index, context)

    expect(bill.complete).toBe(true)
    expect(bill.unfilled).toEqual([])
    expect(bill.resolved[0]?.holds).toEqual([])
    expect(bill.files).toBe(1)
    expect(bill.notes.map((one) => one.code)).not.toContain('slot-unfilled')
  })

  it('reports a hold in a built-in slot at info, and bills nothing for it', () => {
    // A share link or an older saved room can carry one, and dropping it would
    // be the disagreement `hold-off-slot` exists to prevent — except that here
    // *nothing* is printed for it, because the piece needs nothing.
    const { index, context } = worldOf([hostRow({ modelledIn: true }), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([scene({ torch: TORCH })], index, context)

    const held = bill.resolved[0]?.holds ?? []
    expect(held.map((one) => [one.hold, one.modelledIn, one.copies])).toEqual([['torch', true, 0]])
    expect(bill.complete).toBe(true)
    // One file — the wall. The torch is neither a line nor a copy.
    expect(bill.files).toBe(1)
    expect(bill.copies).toBe(1)
    expect(bill.unplaced).toEqual([])
    const note = bill.notes.find((one) => one.code === 'hold-modelled-in')
    expect(note?.severity).toBe('info')
    expect(note?.message).toContain('built in')
  })

  it('leaves an optional accessory slot empty without refusing anything', () => {
    // 197 of the 1,244 declarations are optional, and an empty one of those is
    // a decoration declined rather than a hole in the print.
    const { index, context } = worldOf([hostRow({ sockets: 4, optional: true }), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([instanceOf(HOST, { wall: WALL })], index, context)

    expect(bill.complete).toBe(true)
    expect(bill.unfilled).toEqual([])
    expect(bill.resolved[0]?.holds[0]?.optional).toBe(true)
    expect(bill.notes).toEqual([])
  })

  it('reports a hold naming a file this build does not hold, and bills nothing for it', () => {
    const { index, context } = worldOf([hostRow({ sockets: 4 }), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([scene({ torch: GONE })], index, context)

    expect(bill.lines.map((entry) => entry.tile.id)).toEqual([WALL])
    const note = bill.notes.find((entry) => entry.code === 'hold-unknown-tile')
    expect(note?.severity).toBe('warn')
    expect(note?.tileIds).toEqual([GONE])
    expect(note?.slots).toEqual(['wall'])
    // The same missing-file reading the slot walk gives: nothing resolved for a
    // required declaration, so the pack would be one file short.
    expect(bill.complete).toBe(false)
    expect(bill.unfilled).toEqual([
      { placement: 'p1', template: 'fixture-host', slot: 'wall', hold: 'torch' },
    ])
  })

  it('counts a hold on a slot the host does not declare, and says so', () => {
    // Nothing the app writes can produce it — the editor offers the host's own
    // `config.parts` — so what reaches it is a hand-edited blob or a share link
    // decoded against another manifest. It is **counted anyway**, because a hold
    // this resolver dropped would be a file the room draws and the bill does not
    // list.
    const { index, context } = worldOf([hostRow({ sockets: 4, optional: true }), TORCH_ROW], HOST)
    const bill = buildBillOfTiles([scene({ lintel: TORCH })], index, context)

    const note = bill.notes.find((entry) => entry.code === 'hold-off-slot')
    expect(note?.severity).toBe('warn')
    expect(note?.message).toContain('lintel')
    // **One note, not two.** An undeclared slot has no mount by construction, so
    // `hold-unplaced` beside this would report the consequence as a second fact.
    expect(bill.notes.map((entry) => entry.code)).toEqual(['hold-off-slot'])
    expect(bill.lines.find((entry) => entry.tile.id === TORCH)?.quantity).toBe(1)
    expect(bill.copies).toBe(2)
    expect(bill.resolved[0]?.holds.map((entry) => entry.hold)).toEqual(['torch', 'lintel'])
    // An undeclared slot has no declaration to be required by, so it can never
    // refuse a download.
    expect(bill.complete).toBe(true)
  })

  it('sums two accessory slots of one file onto one line, and keeps their order total', () => {
    // The md5 dedupe's case at the accessory level, and the one that makes
    // `bySlotRef`'s `hold` leg load-bearing: two holds of **one** slot of one
    // instance naming one file agree on placement, slot and tile, so without the
    // fourth key their order would be whatever the walk happened to produce.
    const twoSlots: Row = {
      ...hostRow({ sockets: 2, optional: true }),
      config: {
        parts: [
          { name: 'torch', optional: true, tags: { require: [{ tag: 'kind|torch' }] } },
          { name: 'lintel', optional: true, tags: { require: [{ tag: 'kind|torch' }] } },
        ],
      },
      mounts: [
        ...PILLAR_FACES.slice(0, 2).map(([face, normal]) => torchSocket(face, normal)),
        { slot: 'lintel', kind: 'surface', face: '+z', normal: [0, 0, 1], at: [0, 0, 44] },
      ],
    }
    const { index, context } = worldOf([twoSlots, TORCH_ROW], HOST)
    const bill = buildBillOfTiles([scene({ torch: TORCH, lintel: TORCH })], index, context)

    // One file, one download, three prints: two sockets and one surface.
    const line = bill.lines.find((entry) => entry.tile.id === TORCH)
    expect(line?.quantity).toBe(3)
    expect(line?.tileIds).toEqual([TORCH])
    expect(line?.slots).toEqual([
      { placement: 'p1', slot: 'wall', tile: TORCH, hold: 'lintel' },
      { placement: 'p1', slot: 'wall', tile: TORCH, hold: 'torch' },
    ])
    expect(bill.files).toBe(2)
    expect(bill.copies).toBe(4)
    expect(bill.parts).toBe(4)
    expect(bill.download.bytes).toBe(4_096 + 2_048)
  })

  it('ignores the host’s `base` slot, which is a base match and not an accessory', () => {
    // 2,451 of the 3,695 live file slots are `base`, and the builder's base
    // comes from footprint congruence rather than from the texture-inheriting
    // slot — so reading one as an accessory would put a required hole in 2,451
    // hosts that nothing in the app can fill.
    const withBase: Row = {
      ...hostRow({ sockets: 4 }),
      config: {
        parts: [
          { name: 'base', tags: { require: [{ tag: 'shape|base' }] } },
          { name: 'torch', tags: { require: [{ tag: 'kind|torch' }] } },
        ],
      },
    }
    const { index, context } = worldOf([withBase, TORCH_ROW], HOST)
    const resolved = resolveInstance(scene({ torch: TORCH }), index, context)

    expect(resolved.holds.map((entry) => entry.hold)).toEqual(['torch'])
    expect(resolved.complete).toBe(true)
  })

  it('holds nothing for a slot whose own file left the archive', () => {
    // The host is what declares the accessory slots and what carries the
    // mounts, so a fill this catalog cannot resolve has neither — and the slot
    // already reports itself twice over.
    const { index, context } = worldOf([hostRow({ sockets: 4 }), TORCH_ROW], HOST)
    const resolved = resolveInstance(
      holding(instanceOf(HOST, { wall: GONE }), 'wall', { torch: TORCH }),
      index,
      context,
    )

    expect(resolved.holds).toEqual([])
    expect(resolved.parts).toEqual([])
    expect(resolved.notes.map((entry) => entry.code).sort()).toEqual(['slot-unfilled', 'unknown-tile'])
  })
})

/* ------------------------------------------------------------ the real corpus */

const CATALOG_PATH = process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')

function loadCatalog(): CatalogFile | undefined {
  if (!existsSync(CATALOG_PATH)) return undefined
  return CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
}

const catalog = loadCatalog()

if (catalog === undefined) {
  process.stderr.write(
    [
      '',
      '  ' + '='.repeat(76),
      '  ASSEMBLY TESTS SKIPPED — NO CATALOG INDEX',
      '  ' + '='.repeat(76),
      `  Looked for: ${CATALOG_PATH}`,
      '  Every claim this module makes is a claim about the real corpus, and none',
      '  of them was checked. The handcrafted tests above passed; they only prove',
      '  self-consistency.',
      '',
      '  Produce the index with:   npm run import:catalog',
      '  Or point at one with:     OPENFORGE_CATALOG=/path/to/catalog.json',
      '  ' + '='.repeat(76),
      '',
    ].join('\n'),
  )
}

const describeCorpus = catalog === undefined ? describe.skip : describe
const corpusSuite =
  catalog === undefined
    ? `the real corpus — SKIPPED, no catalog index at ${CATALOG_PATH} (run: npm run import:catalog)`
    : 'the real corpus'

describeCorpus(corpusSuite, () => {
  // Safe: the suite is skipped when the index is absent, and `describe.skip`
  // still evaluates the body, so the assertion has to be non-throwing.
  const file = catalog ?? ({ records: [], tags: [] } as unknown as CatalogFile)
  const index = buildAssemblyIndex(file)
  const records = file.records
  const byLayer = (layer: CatalogRecord['layer']) => records.filter((record) => record.layer === layer)
  const toppers = byLayer('topper')
  const bases = byLayer('base')

  it('found the corpus the plan describes', () => {
    expect(index.stats.records).toBeGreaterThan(8000)
    expect(index.stats.toppers).toBe(4363)
    expect(index.stats.bases).toBe(1963)
    expect(index.stats.sharedBlobs).toBe(171)
    expect(index.stats.sharedBlobRecords).toBe(520)
    expect(index.stats.collidingFilenames).toBe(89)
  })

  it('carries no aggregate layer, and needs none', () => {
    // Row A3 dropped `AssemblyIndex.aggregates`. It rode here because a
    // placement named a `DesignId` and this layer was the only thing that could
    // turn one into a record; a fill names a file, so `byId` is the whole lookup.
    // Verified rather than assumed: the one reader outside this directory,
    // `builder/panels/slots/planSlots.ts`, reads it as
    // `index.aggregates.byDesign.get(placement.design)` — and `placement.design`
    // is a field A1 deleted, so that line is a compile error either way.
    expect(index).not.toHaveProperty('aggregates')
    // And the builder takes one argument, so no call site can pass an aggregate
    // layer built over a different catalog.
    expect(buildAssemblyIndex).toHaveLength(1)
  })

  it('measures the size code against width, and finds 245 exceptions on code `A`', () => {
    // §7's table, and row A3 moved it *here* from `sizeCode.ts`. The module used
    // to publish `SIZE_CODE_WIDTH_UNITS` and `sizeCodeWidth`, and both had zero
    // consumers repo-wide — `src/search/textIndex.ts` names the constant only in
    // a docblock, explaining why its own size-token vocabulary omits `QxG`. So
    // the exports went and the assertion stayed: a drifted tag still fails the
    // build, and there is no longer a hard-coded table for it to drift against.
    /* **Row D9 broke the "no exceptions" half of this, and A3's deletion is why
       it cost nothing.** §7's table said the code determines the width, and over
       2,822 tiles it did. 157 corner-wall meshes read out of R2 say that on 245
       records tagged `size|openlock|A` the run is **1.500**: a corner wall's
       `size|width|2` names the cell it fills, not the piece, so the commonest
       code in the corpus is not a width determinant after all.

       This is exactly the drift the assertion was left here to catch, and it
       caught it. Had `SIZE_CODE_WIDTH_UNITS` still existed, every reader of
       `sizeCodeWidth('A')` would now be half a unit wrong in silence; the join
       moved to the footprint, so nothing but this assertion had to change. The
       245 are asserted **by identity** below rather than counted, so a 246th
       cannot arrive unnoticed. */
    const widths: Readonly<Record<string, number>> = { A: 2, BA: 1.5, IA: 1, D: 3, Q: 4 }
    let checked = 0
    const mismatches: string[] = []
    for (const record of records) {
      const expected = record.sizeCode === undefined ? undefined : widths[record.sizeCode]
      if (expected === undefined) continue
      const measured =
        record.foot.shape === 'rect' ? record.foot.w : record.foot.shape === 'wall' ? record.foot.length : undefined
      if (measured === undefined) continue
      checked += 1
      if (measured !== expected) mismatches.push(`${record.id}: ${record.sizeCode ?? ''} is ${String(measured)}`)
    }
    expect(checked).toBe(2822)
    /* All 245 are code `A`, all measure 1.5 against a coded 2, and all carry a
       corner tag — the three facts that make them the class D9 measured rather
       than a drifted tag. */
    expect(mismatches).toHaveLength(245)
    for (const line of mismatches) expect(line).toMatch(/: A is 1\.5$/)
    const corners = records.filter(
      (record) =>
        record.sizeCode === 'A' &&
        record.foot.shape === 'wall' &&
        record.foot.length === 1.5,
    )
    expect(corners).toHaveLength(245)
    // And every other coded record still agrees with the table, which is the
    // half that did not move.
    expect(mismatches.filter((line) => !line.includes(': A is'))).toEqual([])

    // Row W4's finding, and the reason no width table should come back from the
    // tag: `QxG` is tagged `size|width|4` and the mesh measures 3.000. Its
    // footprint is `wall:3`, so the base match already treats it as three units
    // wide by congruence, and an entry would have to say 3.
    expect(widths.QxG).toBeUndefined()
    const qxg = records.filter((record) => record.sizeCode === 'QxG')
    expect(qxg.length).toBeGreaterThan(0)
    expect(new Set(qxg.map((record) => footprintKey(record.foot)))).toEqual(new Set(['wall:3']))
  })

  /* -------------------------------------------------- the code is not a key */

  it('measures the five size codes that span more than one primitive', () => {
    /* Row D4's premise, against the live corpus and in both directions: every
       code `AMBIGUOUS_SIZE_CODES` names really does span more than one
       primitive, and no code outside it does. The second half is the one that
       matters — it is what fails if a corpus rebuild mints another one.

       **It did.** Row D9's corner-wall correction minted the fifth, and it is
       `A` — the commonest code in the corpus, spanning `wall:1.5` and `wall:2`.
       This assertion is what said so. */
    const spans = new Map<string, Set<string>>()
    const counts = new Map<string, Map<string, number>>()
    for (const record of records) {
      if (record.sizeCode === undefined) continue
      const key = footprintKey(record.foot)
      if (key === undefined) continue
      const set = spans.get(record.sizeCode) ?? new Set<string>()
      set.add(key)
      spans.set(record.sizeCode, set)
      const tally = counts.get(record.sizeCode) ?? new Map<string, number>()
      tally.set(key, (tally.get(key) ?? 0) + 1)
      counts.set(record.sizeCode, tally)
    }

    const measured = Object.fromEntries(
      [...spans.entries()].filter(([, keys]) => keys.size > 1).map(([code, keys]) => [code, [...keys].sort()]),
    )
    expect(measured).toEqual(AMBIGUOUS_SIZE_CODES)

    // And the counts behind the headline case: `size|openlock|O` is on 43
    // records that resolve to three incompatible primitives. Matching on the
    // code can put a 0.5 x 0.5 pillar under a 4 x 4 triangle.
    expect(Object.fromEntries(counts.get('O') ?? [])).toEqual({ column: 34, 'tri:2': 5, 'tri:4': 4 })
    const o = records.filter((record) => record.sizeCode === 'O')
    expect(o).toHaveLength(43)
    expect(o.filter((record) => record.layer === 'integral')).toHaveLength(38)
    expect(o.filter((record) => record.layer === 'topper')).toHaveLength(5)

    // Row W5's second instance: 18 `arc` records and 11 `column` records under
    // one code. Under a code join those 29 are one candidate class; under the
    // primitive they are two, and nothing curved is offered a pillar.
    expect(Object.fromEntries(counts.get('X') ?? [])).toEqual({ 'arc:4-4.5@90': 18, column: 11 })
    expect(records.filter((record) => record.sizeCode === 'X')).toHaveLength(29)
  })

  it('shows the ambiguity was latent for two independent reasons, and asserts both', () => {
    // Assert the latency, not just the fix. The old key never produced a wrong
    // bill, and it is worth being precise about why, because neither reason is a
    // rule about codes.
    //
    // **One: no base carries an ambiguous code ambiguously.** All 26 codes on
    // the base side are footprint determinants — the `I` bases are all
    // `rect:1x1`, the `S` bases all `rect:1x2`, the `X` bases all
    // `arc:4-4.5@90` — so a code join's candidate set was always one shape.
    const baseCodes = new Map<string, CatalogRecord[]>()
    for (const base of bases) {
      if (base.sizeCode === undefined) continue
      baseCodes.set(base.sizeCode, [...(baseCodes.get(base.sizeCode) ?? []), base])
    }
    expect(baseCodes.size).toBe(26)
    const heterogeneous = [...baseCodes.entries()].filter(([, group]) => sharedPrimitive(group) === undefined)
    expect(heterogeneous.map(([code]) => code)).toEqual([])

    /* **Two: the codes whose toppers span two primitives — and row D9 ended the
       coincidence this reason rested on.**

       It used to be one code, `O`, on 3 `tri:2` and 2 `tri:4` toppers and **zero
       bases**, so the join it would have mismatched never ran. This paragraph
       said the arrangement was *"an accident of what has been published, one
       tile away from ending"*.

       It has ended, and not by a new tile. `A` now spans two topper primitives —
       **245 `wall:1.5` corner walls against 440 `wall:2` straight ones**, from
       D9's mesh measurement — and unlike `O` it has **86 bases**, all of them
       `wall:2`. So a code-first join would today hand every one of those 245
       corner walls a base half a unit longer than the wall standing on it: 245
       wrong bills, on the commonest code in the corpus.

       **That is a live defect in the retired key, not in the shipped one.** Row
       D4 moved the join to the footprint before this measurement existed, and
       the assertions below record that the shipped key gets all 245 right. The
       argument for the re-key was *"one tile away from ending"*; the correct
       reading now is that it had already ended and nothing had measured it. */
    expect(index.basesBySizeCode.has('O')).toBe(false)
    const spanningToppers = Object.keys(AMBIGUOUS_SIZE_CODES).filter((code) => {
      const spans = new Set(
        toppers.filter((record) => record.sizeCode === code).map((record) => footprintKey(record.foot)),
      )
      return spans.size > 1
    })
    expect(spanningToppers.sort()).toEqual(['A', 'O'])
    // `O` still has no base to mismatch against. `A` has 86, and they agree with
    // each other — which is what makes the mismatch a *width* error rather than
    // a refusal: `sharedPrimitive` would happily return `wall:2` for them.
    expect(index.basesBySizeCode.get('O')).toBeUndefined()
    const aBases = bases.filter((record) => record.sizeCode === 'A')
    expect(aBases).toHaveLength(86)
    expect(sharedPrimitive(aBases)).toBe('wall:2')
    expect(
      Object.fromEntries(
        [...new Set(toppers.filter((record) => record.sizeCode === 'A').map((record) => footprintKey(record.foot)))]
          .sort()
          .map((key) => [
            key ?? '(none)',
            toppers.filter((record) => record.sizeCode === 'A' && footprintKey(record.foot) === key).length,
          ]),
      ),
    ).toEqual({ 'wall:1.5': 245, 'wall:2': 440 })

    // And for the three ambiguous codes whose bases and toppers still agree, the
    // old coincidence holds — which is why it was never a wrong bill *there*.
    const spanned = new Map<string, { basePrimitive: string | undefined; toppers: number; primitives: string[] }>()
    for (const [code, group] of baseCodes) {
      if (!Object.hasOwn(AMBIGUOUS_SIZE_CODES, code)) continue
      const carried = toppers.filter((record) => record.sizeCode === code)
      const primitives = [...new Set(carried.map((record) => footprintKey(record.foot) ?? '(none)'))].sort()
      spanned.set(code, { basePrimitive: sharedPrimitive(group), toppers: carried.length, primitives })
    }
    expect(Object.fromEntries(spanned)).toEqual({
      A: { basePrimitive: 'wall:2', toppers: 685, primitives: ['wall:1.5', 'wall:2'] },
      I: { basePrimitive: 'rect:1x1', toppers: 50, primitives: ['rect:1x1'] },
      S: { basePrimitive: 'rect:1x2', toppers: 96, primitives: ['rect:1x2'] },
      X: { basePrimitive: 'arc:4-4.5@90', toppers: 0, primitives: [] },
    })
    // `A` is the one that no longer satisfies it, and it is excluded by name
    // rather than by loosening the check.
    spanned.delete('A')
    for (const { basePrimitive, primitives } of spanned.values()) {
      for (const primitive of primitives) expect(primitive).toBe(basePrimitive)
    }
  })

  /* ----------------------------------------------------------- the base ranking */

  /**
   * The four preferences a bill can be drawn under. `undefined` is not a fourth
   * lock system, it is "no preference", and it is included because the old
   * ranking handed it a topless base 69.8% of the time.
   */
  const preferences: readonly (LockSystem | undefined)[] = ['openlock', 'dragonlock', 'magnetic', undefined]

  /**
   * The candidate set for a topper, by the ranking's own key rule — row D4's:
   * the resolved primitive, and the size code only where there is no primitive
   * and the code's bases agree on one.
   */
  function candidatesOf(tile: CatalogRecord): readonly CatalogRecord[] | undefined {
    const foot = footprintKey(tile.foot)
    if (foot !== undefined) return index.basesByFootprint.get(foot)
    if (tile.sizeCode === undefined) return undefined
    const candidates = index.basesBySizeCode.get(tile.sizeCode)
    return candidates === undefined || sharedPrimitive(candidates) === undefined ? undefined : candidates
  }

  /**
   * The key rule as it shipped **before row D4**: the size code first, the
   * footprint second, never both. Frozen deliberately — it is what keeps every
   * D1 figure below a claim about the *ranking* and every D4 figure a claim
   * about the *key*.
   */
  function legacyCandidatesOf(tile: CatalogRecord): readonly CatalogRecord[] | undefined {
    if (tile.sizeCode !== undefined) return index.basesBySizeCode.get(tile.sizeCode)
    const foot = footprintKey(tile.foot)
    return foot === undefined ? undefined : index.basesByFootprint.get(foot)
  }

  /**
   * The ranking as it shipped *before* row D1, reproduced in full: candidates
   * ordered `bytes` ascending then `id`, scored `lock` 8 / `shape` 4 / `kind` 2 /
   * `texture` 1 with no notion of a print option, first candidate at the best
   * score wins.
   *
   * Written out rather than remembered, because every before-figure below is a
   * claim about the defect and a remembered number cannot falsify anything.
   */
  function legacyBase(
    tile: CatalogRecord,
    lock: LockSystem | undefined,
    key: (record: CatalogRecord) => readonly CatalogRecord[] | undefined = legacyCandidatesOf,
  ): CatalogRecord | undefined {
    const candidates = key(tile)
    if (candidates === undefined || candidates.length === 0) return undefined
    const ordered = [...candidates].sort((a, b) => (a.bytes !== b.bytes ? a.bytes - b.bytes : a.id < b.id ? -1 : 1))

    let best: CatalogRecord | undefined
    let bestScore = -1
    for (const base of ordered) {
      let score = 0
      if (lock === undefined || base.conn.includes(lock)) score += 8
      if (base.foot.shape === tile.foot.shape) score += 4
      if (base.kinds.some((kind) => kind !== 'base' && tile.kinds.includes(kind))) score += 2
      if (base.texture !== undefined && base.texture === tile.texture) score += 1
      if (score > bestScore) {
        bestScore = score
        best = base
      }
    }
    return best
  }

  /** The base the shipped ranking picks, or `undefined` when it finds none. */
  function shippedBase(tile: CatalogRecord, lock: LockSystem | undefined): CatalogRecord | undefined {
    return matchBase(tile, index, lock)?.base
  }

  const optionOf = (base: CatalogRecord): PrintOption => index.basePrintOption.get(base.id) ?? 'plain'

  /** Print-option tally and distinct-base reach for one ranking under one preference. */
  function survey(
    rank: (tile: CatalogRecord, lock: LockSystem | undefined) => CatalogRecord | undefined,
    lock: LockSystem | undefined,
  ): {
    matched: number
    byOption: Record<PrintOption, number>
    reach: Set<TileId>
    reachByOption: Record<PrintOption, number>
  } {
    const byOption: Record<PrintOption, number> = { plain: 0, unsupported: 0, topless: 0 }
    const reachByOption: Record<PrintOption, number> = { plain: 0, unsupported: 0, topless: 0 }
    const reach = new Set<TileId>()
    let matched = 0
    for (const topper of toppers) {
      const base = rank(topper, lock)
      if (base === undefined) continue
      matched += 1
      byOption[optionOf(base)] += 1
      if (!reach.has(base.id)) reachByOption[optionOf(base)] += 1
      reach.add(base.id)
    }
    return { matched, byOption, reach, reachByOption }
  }

  it('counts the print-option variants the base range holds', () => {
    // 584 of 1,963 bases are a print variant rather than the base itself, which
    // is the pool `bytes`-ascending was drawing most of its answers from.
    expect(index.stats.basesByPrintOption).toEqual({ plain: 1379, unsupported: 206, topless: 378 })
    const { plain, unsupported, topless } = index.stats.basesByPrintOption
    expect(plain + unsupported + topless).toBe(index.stats.bases)

    // Total over bases, and over nothing else.
    expect(index.basePrintOption.size).toBe(index.stats.bases)
    for (const base of bases) expect(index.basePrintOption.has(base.id)).toBe(true)
    for (const topper of toppers) expect(index.basePrintOption.has(topper.id)).toBe(false)
  })

  it('collapses the topless rate under openlock from 81.6% to zero', () => {
    const before = survey(legacyBase, 'openlock')
    const after = survey(shippedBase, 'openlock')
    // The pre-D1 ranking over row D4's key: the *ranking* held still and only
    // the key moved, which is what tells the two rows' figures apart.
    const beforeReKeyed = survey((tile, lock) => legacyBase(tile, lock, candidatesOf), 'openlock')

    // **Who gets a base at all is a property of the key, not of the ranking.**
    // Both rankings match 3,943 toppers under the pre-D4 key and 3,986 under
    // D4's, so the +43 belongs to the key and the ranking still never refuses.
    expect(before.matched).toBe(3943)
    expect(beforeReKeyed.matched).toBe(3986)
    expect(after.matched).toBe(3986)
    expect(after.matched - before.matched).toBe(43)

    // The defect, measured on this corpus by the old ranking written out above.
    expect(before.byOption.topless).toBe(3216)
    expect(before.byOption.topless / before.matched).toBeCloseTo(0.816, 3)
    expect(before.byOption.unsupported).toBe(256)
    expect(before.byOption.plain).toBe(471)

    // And the defect is a property of the ranking, not of the key either: give
    // the old ranking D4's wider candidate sets and it still hands out a topless
    // base 81.7% of the time. Both rows' findings are independent of each other.
    expect(beforeReKeyed.byOption.topless).toBe(3258)
    expect(beforeReKeyed.byOption.topless / beforeReKeyed.matched).toBeCloseTo(0.817, 3)

    // And after: **3,986 of 3,986** matched openlock toppers get the full base.
    // This is the figure the brief names as the reason the ranking had to
    // survive row A3 at all — it is the decision a slot solver inherits.
    expect(after.byOption).toEqual({ plain: 3986, unsupported: 0, topless: 0 })
  })

  it('collapses it under every lock preference, to the three cases the corpus forces', () => {
    const measured = preferences.map((lock) => ({
      lock: lock ?? 'none',
      before: survey(legacyBase, lock).byOption,
      after: survey(shippedBase, lock).byOption,
    }))

    const allPlain: Record<PrintOption, number> = { plain: 3986, unsupported: 0, topless: 0 }
    const magneticAfter: Record<PrintOption, number> = { plain: 3983, unsupported: 0, topless: 3 }
    expect(measured).toEqual([
      { lock: 'openlock', before: { plain: 471, unsupported: 256, topless: 3216 }, after: allPlain },
      { lock: 'dragonlock', before: { plain: 3880, unsupported: 60, topless: 3 }, after: allPlain },
      { lock: 'magnetic', before: { plain: 2209, unsupported: 35, topless: 1699 }, after: magneticAfter },
      { lock: 'none', before: { plain: 794, unsupported: 316, topless: 2833 }, after: allPlain },
    ])
  })

  /**
   * The guarantee, stated as a property rather than a count: a print variant can
   * only win when no plainer candidate under the same key carries the lock.
   *
   * This is what makes the three magnetic cases above defensible instead of
   * residual noise — they are the corpus, not the ranking.
   */
  it('never hands out a print variant while a plainer base carries the same key and the lock', () => {
    let forced = 0
    for (const lock of preferences) {
      for (const topper of toppers) {
        const base = shippedBase(topper, lock)
        if (base === undefined) continue
        const option = optionOf(base)
        if (option === 'plain') continue
        forced += 1
        const plainer = (candidatesOf(topper) ?? []).filter(
          (candidate) => PRINT_OPTIONS.indexOf(optionOf(candidate)) < PRINT_OPTIONS.indexOf(option),
        )
        expect(plainer.every((candidate) => lock !== undefined && !candidate.conn.includes(lock))).toBe(true)
      }
    }
    // Three, all magnetic, all under `footprint rect:1.5x3`.
    expect(forced).toBe(3)
  })

  it('widens the set of full bases the ranking can reach', () => {
    const before = survey(legacyBase, 'openlock')
    const after = survey(shippedBase, 'openlock')

    // The headline figure of the defect: 117 of 1,963 bases ever handed out by
    // the old ranking, and 97 of those 117 were print variants rather than bases.
    expect(before.reach.size).toBe(117)
    expect(before.reachByOption).toEqual({ plain: 20, unsupported: 17, topless: 80 })

    // After: 116 distinct bases and every one of them is a full base, so the
    // reachable *product* range is 5.8 times wider.
    expect(after.reach.size).toBe(116)
    expect(after.reachByOption).toEqual({ plain: 116, unsupported: 0, topless: 0 })
    expect(after.reachByOption.plain / before.reachByOption.plain).toBeCloseTo(5.8, 2)

    const union = (rank: (tile: CatalogRecord, lock: LockSystem | undefined) => CatalogRecord | undefined) => {
      const reach = new Set<TileId>()
      for (const lock of preferences) for (const id of survey(rank, lock).reach) reach.add(id)
      return reach
    }
    const beforeUnion = union(legacyBase)
    const afterUnion = union(shippedBase)
    expect(beforeUnion.size).toBe(322)
    expect(afterUnion.size).toBe(336)
    expect(afterUnion.size - beforeUnion.size).toBe(14)

    const full = (reach: Set<TileId>) =>
      [...reach].filter((id) => optionOf(index.byId.get(id) as CatalogRecord) === 'plain').length
    expect(full(beforeUnion)).toBe(191)
    expect(full(afterUnion)).toBe(335)
    expect(full(afterUnion) - full(beforeUnion)).toBe(144)
  })

  it('falls back to the size code for the 14 toppers with no primitive, and only those', () => {
    // The whole of the code key's remaining reach. Every one of them is coded
    // `U` — the code row W4 refused to derive a footprint from.
    const codeKeyed = toppers.filter((record) => matchBase(record, index, 'openlock')?.match.key === 'sizeCode')
    expect(codeKeyed).toHaveLength(14)
    expect(new Set(codeKeyed.map((record) => record.sizeCode))).toEqual(new Set(['U']))
    expect(codeKeyed.every((record) => footprintKey(record.foot) === undefined)).toBe(true)
    // 7 candidates, and they agree on `rect:4x4` — which is the gate, not a
    // coincidence.
    for (const record of codeKeyed) {
      expect(matchBase(record, index, 'openlock')?.match.candidates).toBe(7)
    }
    expect(sharedPrimitive(index.basesBySizeCode.get('U') ?? [])).toBe('rect:4x4')
  })

  it('reports the options a candidate set offered, best first', () => {
    for (const topper of toppers) {
      const match = matchBase(topper, index, 'openlock')?.match
      if (match === undefined) continue
      const offered = match.optionsOffered
      expect(offered.length).toBeGreaterThan(0)
      // A projection of PRINT_OPTIONS, so the order is the preference order and
      // no option is repeated.
      expect(offered).toEqual(PRINT_OPTIONS.filter((option) => offered.includes(option)))
      expect(offered).toContain(match.option)
    }
  })

  /* ----------------------------------------------- the build-tag join must fail */

  it('proves a build-tag join silently returns nothing for 857 toppers', () => {
    const wallOnTile = records.filter((record) => record.build === 'wall on tile')
    expect(wallOnTile).toHaveLength(863)
    expect(wallOnTile.filter((record) => record.layer === 'base')).toHaveLength(0)
    expect(wallOnTile.filter((record) => record.layer === 'topper')).toHaveLength(857)
    expect(bases.filter((record) => record.build === 'wall on tile')).toHaveLength(0)

    // The join, written out: for every one of those toppers, a base keyed on the
    // build tag has zero candidates — and it returns *no base*, not an error.
    const basesByBuild = new Map<string, CatalogRecord[]>()
    for (const base of bases) {
      const key = base.build ?? '(none)'
      basesByBuild.set(key, [...(basesByBuild.get(key) ?? []), base])
    }
    expect(basesByBuild.get('wall on tile')).toBeUndefined()

    // The shipped join, on the same tiles, finds a base for 630 of them. The
    // contrast is the point: 630 against the build join's 0.
    const topperSide = wallOnTile.filter((record) => record.layer === 'topper')
    expect(topperSide.filter((record) => matchBase(record, index, 'openlock') !== undefined)).toHaveLength(630)
    expect(topperSide.filter((record) => footprintKey(record.foot) === undefined)).toHaveLength(227)
  })

  /* ------------------------------------------------------ the honest size gap */

  it('measures the openforge toppers whose code no base carries, and what the primitive recovers', () => {
    const coded = toppers.filter((record) => record.sizeCode !== undefined)
    const codeGap = coded.filter((record) => !index.basesBySizeCode.has(record.sizeCode ?? ''))

    // The code gap itself is a fact about tags and is untouched by row D4: 129
    // coded toppers name a code no base in the archive carries.
    expect(coded).toHaveLength(1999)
    expect(codeGap).toHaveLength(129)

    // What changed is that a missing *code* is no longer a missing *base*. 43 of
    // the 129 are congruent to a base the archive does have.
    const recovered = codeGap.filter((record) => matchBase(record, index, 'openlock') !== undefined)
    expect(recovered).toHaveLength(43)

    // The remaining 86 have no base under either key, and are reported by the
    // code — the actionable half, and the index of `docs/corpus-base-gap.md`.
    const stillGapped = codeGap.filter((record) => !recovered.includes(record))
    expect(stillGapped).toHaveLength(86)
    for (const record of stillGapped) {
      expect(baseGap(record, index), record.id).toBe('no-matching-base')
    }
  })

  it('gains the 43 toppers whose code the archive lacks but whose shape it covers', () => {
    const gained = toppers.filter((record) => {
      const key = footprintKey(record.foot)
      const codeless = record.sizeCode !== undefined && !index.basesBySizeCode.has(record.sizeCode)
      return codeless && key !== undefined && index.basesByFootprint.has(key)
    })
    const byCode = new Map<string, number>()
    for (const record of gained) byCode.set(record.sizeCode ?? '', (byCode.get(record.sizeCode ?? '') ?? 0) + 1)
    expect(Object.fromEntries([...byCode.entries()].sort())).toEqual({ II: 11, IO: 16, IX: 16 })
    expect(gained).toHaveLength(43)
    expect(new Set(gained.map((record) => footprintKey(record.foot)))).toEqual(new Set(['rect:1x1']))
    expect(index.basesByFootprint.get('rect:1x1')).toHaveLength(119)

    // Every one of them now gets a base, and it is a plain, congruent one.
    for (const record of gained) {
      const match = matchBase(record, index, 'openlock')?.match
      expect(match?.key).toBe('footprint')
      expect(match?.on).toBe('rect:1x1')
      expect(match?.option).toBe('plain')
      // And not on the code: no base carries `II`, `IO` or `IX`.
      expect(match?.codeAgrees).toBe(false)
    }

    // The five `O` toppers are not among them, and this is why.
    const o = toppers.filter((record) => record.sizeCode === 'O')
    expect(o).toHaveLength(5)
    expect(new Set(o.map((record) => footprintKey(record.foot)))).toEqual(new Set(['tri:2', 'tri:4']))
    expect(index.basesByFootprint.has('tri:2')).toBe(false)
    expect(index.basesByFootprint.has('tri:4')).toBe(false)
  })

  it('hands out the same base as the code key did, but for D9’s 245 corner walls', () => {
    /* The re-key was **additive on this corpus**: for all 3,943 toppers the code
       key matched, the primitive key handed out the identical base, and 43 more
       gained one. The `code` weight is what makes that true — congruence pools
       across families, so without the tie-break 434 toppers would drift.

       **Row D9 made it non-additive on 245, and that is the correction landing
       rather than the re-key failing.** Those toppers are corner walls whose run
       is 1.5 and whose code says 2, so the *old* code key was matching them
       against 2-unit bases. Now the primitive key matches them against 1.5-unit
       ones — a different base, and the right one. `different: 245` here is the
       measure of how wrong the code key was on them, not of any regression: the
       assertion below that every match is congruent to its topper still holds
       over all four preferences. */
    const d1UnderOldKey = (tile: CatalogRecord, lock: LockSystem | undefined): CatalogRecord | undefined => {
      const candidates = legacyCandidatesOf(tile)
      if (candidates === undefined || candidates.length === 0) return undefined
      let best: CatalogRecord | undefined
      let bestScore = -1
      for (const base of candidates) {
        const option = optionOf(base)
        let score = (PRINT_OPTIONS.length - 1 - PRINT_OPTIONS.indexOf(option)) * MATCH_WEIGHTS.option
        if (lock === undefined || base.conn.includes(lock)) score += MATCH_WEIGHTS.lock
        // The criterion row D4 retired, as D1 shipped it.
        if (base.foot.shape === tile.foot.shape) score += 4
        if (base.kinds.some((kind) => kind !== 'base' && tile.kinds.includes(kind))) score += MATCH_WEIGHTS.kind
        if (base.texture !== undefined && base.texture === tile.texture) score += MATCH_WEIGHTS.texture
        if (score > bestScore) {
          bestScore = score
          best = base
        }
      }
      return best
    }

    for (const lock of preferences) {
      let same = 0
      let different = 0
      let gained = 0
      let lost = 0
      for (const topper of toppers) {
        const before = d1UnderOldKey(topper, lock)
        const after = shippedBase(topper, lock)
        if (before === undefined && after === undefined) continue
        if (before === undefined) gained += 1
        else if (after === undefined) lost += 1
        else if (before.id === after.id) same += 1
        else different += 1
      }
      expect({ lock: lock ?? 'none', same, different, gained, lost }).toEqual({
        lock: lock ?? 'none',
        same: 3698,
        different: 245,
        gained: 43,
        lost: 0,
      })
    }
  })

  it('widens the candidate pools, because congruence pools across code families', () => {
    let codePairs = 0
    let primitivePairs = 0
    const keysUsed = new Set<string>()
    let smallest = Number.POSITIVE_INFINITY
    let largest = 0
    for (const topper of toppers) {
      codePairs += legacyCandidatesOf(topper)?.length ?? 0
      primitivePairs += candidatesOf(topper)?.length ?? 0
      const match = matchBase(topper, index, 'openlock')?.match
      if (match === undefined) continue
      keysUsed.add(`${match.key}:${match.on}`)
      smallest = Math.min(smallest, match.candidates)
      largest = Math.max(largest, match.candidates)
    }
    /* The cost of the fix, stated: **390,847** candidate pairs against 334,189,
       a 17.0% wider scan for 43 more matched toppers and every match congruent.
       383,252 before row D9 split 245 corner walls off the `wall:2` congruence
       class into `wall:1.5`, which is a *larger* pool rather than a smaller one:
       `wall:1.5` already had 769 members and the class those toppers now join is
       the bigger of the two. The code side is untouched at 334,189 — a code join
       never looked at the run. */
    expect(codePairs).toBe(334_189)
    expect(primitivePairs).toBe(390_847)
    // 43 of the 44 congruence classes the bases cover are reached by a topper,
    // plus the one size code that still finds a base.
    expect(keysUsed.size).toBe(43)
    expect([...keysUsed].filter((key) => key.startsWith('sizeCode:'))).toEqual(['sizeCode:U'])
    expect(smallest).toBe(2)
    expect(largest).toBe(150)
    expect(index.stats.baseFootprints).toBe(44)
  })

  it('hands every topper with a primitive a base congruent to it, under every preference', () => {
    // Not "the key is the footprint" but the consequence: no base is ever put
    // under a topper of a different shape. 15,888 matches over the four
    // preferences, and a code join would have to be reintroduced for this to
    // fail.
    let checked = 0
    for (const lock of preferences) {
      for (const topper of toppers) {
        const base = shippedBase(topper, lock)
        if (base === undefined) continue
        const key = footprintKey(topper.foot)
        if (key === undefined) continue
        checked += 1
        expect(footprintKey(base.foot), `${topper.id} under ${lock ?? 'none'}`).toBe(key)
      }
    }
    expect(checked).toBe(15_888)
  })

  it('separates the three ways a base can be missing, identically under every preference', () => {
    // The load-bearing claim of `docs/corpus-base-gap.md`: the gap is a property
    // of the corpus **and of the key**, and never of the ranking. A candidate set
    // is either empty or it is not, and which member wins cannot decide whether
    // one exists — which is why `baseGap` takes no lock at all.
    const measured = preferences.map((lock) => {
      const gaps = { 'no-matching-base': 0, 'no-congruent-base': 0, 'base-unmatchable': 0 }
      let withBase = 0
      for (const record of toppers) {
        if (matchBase(record, index, lock) !== undefined) {
          withBase += 1
          continue
        }
        const gap = baseGap(record, index)
        expect(gap, record.id).toBeDefined()
        if (gap !== undefined) gaps[gap] += 1
      }
      const total = Object.values(gaps).reduce((sum, count) => sum + count, 0)
      // Every topper is either matched to a base or classified into one of the
      // three gaps — no silent third outcome.
      expect(withBase + total, `lock: ${lock ?? 'none'}`).toBe(toppers.length)
      return gaps
    })

    // 86 bases the corpus should have and does not; 31 footprints nothing
    // supports; 260 toppers with no key at all.
    expect(measured[0]).toEqual({ 'no-matching-base': 86, 'no-congruent-base': 31, 'base-unmatchable': 260 })
    for (const gaps of measured) expect(gaps).toEqual(measured[0])
  })

  it('classifies every gap by the step that failed, and by exactly one of them', () => {
    // A partition of the toppers with no base by *which key was missing*,
    // asserted as the biconditional rather than as three counts, so it survives
    // a corpus rebuild.
    let gapped = 0
    for (const record of toppers) {
      if (matchBase(record, index, 'openlock') !== undefined) {
        // The other direction, and it is what makes this a partition: a topper
        // with a base is in no gap at all.
        expect(baseGap(record, index), record.id).toBeUndefined()
        continue
      }
      gapped += 1
      // A code the base range does not answer to is an archive gap whichever key
      // failed, because naming the code is what a report upstream can act on.
      // Below that, the primitive decides.
      const codeUnanswered = record.sizeCode !== undefined && !index.basesBySizeCode.has(record.sizeCode)
      const expected = codeUnanswered
        ? 'no-matching-base'
        : footprintKey(record.foot) !== undefined
          ? 'no-congruent-base'
          : record.sizeCode !== undefined
            ? 'no-matching-base'
            : 'base-unmatchable'
      expect(baseGap(record, index), record.id).toBe(expected)

      // And the pre-D4 formula — "has a code at all" rather than "has a code no
      // base carries" — agrees on every gapped topper in this corpus, which is
      // the latency: the two rules only diverge for a topper whose code *is*
      // carried by bases of a shape it is not, and no such topper exists yet.
      const preD4 =
        record.sizeCode !== undefined
          ? 'no-matching-base'
          : footprintKey(record.foot) !== undefined
            ? 'no-congruent-base'
            : 'base-unmatchable'
      expect(preD4, record.id).toBe(expected)
    }
    expect(gapped).toBe(377)
  })

  it('names the nine size codes the base range is missing', () => {
    const missing = new Map<string, number>()
    for (const record of toppers) {
      const code = record.sizeCode
      if (code === undefined || index.basesBySizeCode.has(code)) continue
      missing.set(code, (missing.get(code) ?? 0) + 1)
    }
    expect(Object.fromEntries([...missing.entries()].sort())).toEqual({
      II: 11,
      IO: 16,
      IX: 16,
      L: 20,
      O: 5,
      P: 12,
      PA: 6,
      PB: 20,
      PC: 23,
    })
    expect([...missing.values()].reduce((total, count) => total + count, 0)).toBe(129)

    // 26 codes on the base side against 27 on the topper side. After row D4
    // three of these nine are answered by congruence anyway (`II`, `IO`, `IX`,
    // all `rect:1x1`) and six are not, and only the six leave a topper with
    // nothing to sit on.
    expect(index.basesBySizeCode.size).toBe(26)
    expect(new Set(toppers.map((record) => record.sizeCode).filter((code) => code !== undefined)).size).toBe(27)

    const answeredByShape = [...missing.keys()].filter((code) => {
      const shapes = new Set(
        toppers.filter((record) => record.sizeCode === code).map((record) => footprintKey(record.foot)),
      )
      return [...shapes].every((key) => key !== undefined && index.basesByFootprint.has(key))
    })
    expect(answeredByShape.sort()).toEqual(['II', 'IO', 'IX'])
  })

  it('shows the 31 unsupportable shapes are geometry, not an omission', () => {
    // 17 of these are half a unit wide and the base range starts at a full unit,
    // so no base can carry them and telling somebody to go and find one would
    // send them after an object that does not exist. Four are a real hole in an
    // otherwise complete range. The remaining 10 are row W5's third kind.
    const shapeless = toppers.filter((record) => baseGap(record, index) === 'no-congruent-base')
    const keys = new Map<string, number>()
    for (const record of shapeless) {
      const key = footprintKey(record.foot) ?? '(none)'
      keys.set(key, (keys.get(key) ?? 0) + 1)
    }
    expect(Object.fromEntries([...keys.entries()].sort())).toEqual({
      'arc:0.5-2@90': 1,
      'arc:2.5-4@22.5': 2,
      'arc:2.5-4@45': 2,
      'arc:2.5-4@90': 2,
      'arc:4.5-6@11.25': 1,
      'arc:4.5-6@22.5': 1,
      'arc:4.5-6@45': 1,
      'rect:0.5x1': 3,
      'rect:0.5x2': 14,
      'rect:2x6': 4,
    })

    // The 13 `curved+interface` floors have LEFT this bucket, because they no
    // longer have a footprint to be incongruent about.
    expect(
      shapeless.filter((record) => resolveTags(file, record).includes('shape|option|curved_interface')),
    ).toEqual([])
    expect(index.basesByFootprint.has('arc:2.5-4@90')).toBe(false)

    // And 10 `s2w_radial` toppers have ARRIVED: a shape the corpus has no base
    // for at all, distinguishable only once congruence keys on the band.
    const s2w = shapeless.filter((record) => footprintKey(record.foot)?.startsWith('arc:'))
    expect(s2w).toHaveLength(10)
    expect(s2w.every((record) => record.foot.shape === 'arc' && record.foot.band === 's2w_radial')).toBe(true)

    // Every one of the 31 is uncoded, which is what keeps this bucket and the
    // archive-gap bucket apart after row D4.
    expect(shapeless.every((record) => record.sizeCode === undefined)).toBe(true)

    // Why no base can carry the 17: nothing in the base range has an extent
    // below one grid unit.
    const baseExtents = new Set<number>()
    for (const base of bases) {
      if (base.foot.shape === 'rect') baseExtents.add(Math.min(base.foot.w, base.foot.d))
      if (base.foot.shape === 'wall') baseExtents.add(base.foot.length)
    }
    expect(Math.min(...baseExtents)).toBe(1)

    // And why the four `2x6` slabs are the arguable omission: the range holds
    // both neighbours.
    expect(index.basesByFootprint.has('rect:2x4')).toBe(true)
    expect(index.basesByFootprint.has('rect:2x8')).toBe(true)
    expect(index.basesByFootprint.has('rect:2x6')).toBe(false)
  })

  it('shows the unmatchable toppers carry no shape at all', () => {
    // The third cause, and the one that is neither an archive gap nor geometry:
    // the topper publishes no key. `foot.shape === 'none'` is the only way
    // `footprintKey` can be absent, and it is the same fact that keeps these off
    // the plan view — so there is nothing to file upstream, because nothing says
    // what shape of base to look for.
    const unmatchable = toppers.filter((record) => baseGap(record, index) === 'base-unmatchable')
    expect(unmatchable).toHaveLength(260)
    expect(unmatchable.every((record) => record.foot.shape === 'none')).toBe(true)
    expect(unmatchable.every((record) => record.sizeCode === undefined)).toBe(true)
    expect(unmatchable.every((record) => footprintKey(record.foot) === undefined)).toBe(true)
  })

  it('reaches 87.7% of the code-less toppers, on what is now the primary key', () => {
    const codeless = toppers.filter((record) => record.sizeCode === undefined)
    const matched = codeless.filter((record) => matchBase(record, index, 'openlock') !== undefined)
    // Row D4 leaves this population **exactly** where it was, which is the point
    // of measuring it here: these toppers have no code, so the primitive was
    // already the only key they ever had.
    expect(codeless).toHaveLength(2364)
    expect(matched).toHaveLength(2073)
  })
})

/* ------------------------------------- the real corpus, through the real 40 */

/**
 * Row A3's own corpus block: the 40 shipped recipes, resolved against the
 * archive.
 *
 * Separate from the block above because it asks a different kind of question.
 * That one is about the *archive* — which base fits which topper, and where the
 * corpus has holes. This one is about the **recipes**: whether every declared
 * slot can be filled at all, what an instance costs, and whether the resolver
 * walks a real template correctly. Neither could be asked of a fixture, and
 * before this row neither could be asked at all, because a placement was one
 * tile and there were no recipes in the resolution path.
 *
 * `RECIPE_TEMPLATES` is imported from `@/screens/assemblies/templates` — a screen
 * — and that is a **test-only** reach, precedent set by `src/store/corpus.test.ts`
 * which imports the same table for the same reason. `src/assembly`'s own modules
 * take {@link AssemblyTemplate} structurally and never import a screen; this
 * block is where the structural contract is proved against the real data.
 */
describeCorpus(catalog === undefined ? 'the 40 recipes — SKIPPED' : 'the 40 recipes', () => {
  const file = catalog ?? ({ records: [], tags: [] } as unknown as CatalogFile)
  const index = buildAssemblyIndex(file)
  const composition = createCompositionIndex(file)

  /**
   * `RecipeTemplate` satisfying {@link AssemblyTemplate} with no cast and no
   * adapter — which is the assignability claim `resolve.ts` makes in prose.
   *
   * The annotation is the assertion: if `TemplatePart` ever stops being
   * assignable to `AssemblySlot`, this line fails to compile rather than the
   * templates silently resolving as `any`. That is hazard 2 of the brief, in the
   * one place this row could hit it.
   */
  /* The 40 read from the fixtures, and not row **E3**'s two authored beside them
     in the same array. Every figure in this block is a measurement of *those 40* —
     14,241 candidate pairs, 2,990 distinct admitted files, the 366 MB a
     fifty-instance room downloads — and folding two more templates in would
     silently redefine what each one is a measurement of. E3's own reach and
     closure are measured in `src/template/corpus.test.ts`. */
  const templates: readonly AssemblyTemplate[] = RECIPE_TEMPLATES.filter(
    (template) => !template.source.startsWith('authored:'),
  )
  const byId = new Map(templates.map((template) => [template.id, template]))
  const context: AssemblyContext = {
    templates: (id) => byId.get(id),
    composition,
    lock: 'openlock',
  }

  /**
   * Fill every slot of a template the way row C2's solver will have to.
   *
   * Walked in the template's **declared order**, so each slot is narrowed by the
   * ones before it — C3 measured that walking cold needs more than one page of
   * cards for 39 of the 128 parts and walking in order needs it for 4. A `base`
   * slot is default-filled with {@link rankBases}, which is the surface row A3
   * left for exactly this, ranked against the first non-base sibling already
   * chosen; every other slot takes its first candidate in catalog-id order,
   * which is deterministic and is not a claim about what a user would pick.
   */
  function defaultFilled(template: AssemblyTemplate, at: number): TemplateInstance {
    const fills: Record<string, string> = {}
    const siblings: { partName: string; tags: readonly string[] }[] = []
    for (const part of template.parts) {
      const resolved = resolveSlotTags(part.tags, template.tags, siblings)
      const candidates = composition.candidatesFor(resolved)
      if (candidates.tiles.length === 0) continue

      let chosen = candidates.tiles[0] as string
      if (part.name === 'base') {
        const reference = siblings
          .map((sibling) => index.byId.get(fills[sibling.partName] as TileId))
          .find((record) => record !== undefined && record.layer !== 'base')
        const pool = candidates.tiles
          .map((tile) => index.byId.get(tile))
          .filter((record): record is CatalogRecord => record !== undefined)
        const ranked = reference === undefined ? undefined : rankBases(reference, pool, index, 'openlock')
        if (ranked !== undefined) chosen = ranked.base.id
      }

      fills[part.name] = chosen
      siblings.push({ partName: part.name, tags: composition.tagsOf(chosen as TileId) })
    }
    return {
      id: `t${String(at)}` as PlacementId,
      template: template.id as TemplateId,
      x: 0,
      z: 0,
      rotation: 0,
      fills: Object.fromEntries(
        Object.entries(fills).map(([slot, tile]) => [slot, { tile: tile as TileId, pinned: false }]),
      ),
      filters: [],
    }
  }

  /**
   * Fill every slot from a **different** candidate than the instance before it.
   *
   * The other extreme from {@link defaultFilled}, and row C4 needs both: a
   * deterministic solver picks one file per slot for ever, so a room of it
   * saturates and no instance count reaches `large`; a user varying every slot
   * shares no file with the instance beside it, and that is the room A3's
   * dedupe-free arithmetic was implicitly modelling. Neither is *the* room —
   * which is the finding.
   *
   * Walked in declared order like {@link defaultFilled}, so each slot is
   * narrowed by the ones already picked, and `at` indexes into the surviving
   * candidate list modulo its length so the walk never falls off a short one.
   */
  function variedFilled(template: AssemblyTemplate, at: number): TemplateInstance {
    const fills: Record<string, { tile: TileId; pinned: boolean }> = {}
    const siblings: { partName: string; tags: readonly string[] }[] = []
    for (const part of template.parts) {
      const candidates = composition.candidatesFor(resolveSlotTags(part.tags, template.tags, siblings))
      if (candidates.tiles.length === 0) continue
      const chosen = candidates.tiles[at % candidates.tiles.length] as TileId
      fills[part.name] = { tile: chosen, pinned: true }
      siblings.push({ partName: part.name, tags: composition.tagsOf(chosen) })
    }
    return {
      id: `v${String(at)}` as PlacementId,
      template: template.id as TemplateId,
      x: at % 10,
      z: Math.floor(at / 10),
      rotation: 0,
      fills,
      filters: [],
    }
  }

  /** The middle value, low side on an even count — every distribution below. */
  function median(values: readonly number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }

  /** The value at a fraction of the sorted distribution, clamped to the last. */
  function percentile(values: readonly number[], fraction: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0
  }

  it('ships 40 recipes over 128 parts, and six distinct slot names', () => {
    expect(templates).toHaveLength(40)
    const parts = templates.flatMap((template) => template.parts)
    expect(parts).toHaveLength(128)

    const names = new Map<string, number>()
    for (const part of parts) names.set(part.name, (names.get(part.name) ?? 0) + 1)
    expect(Object.fromEntries([...names.entries()].sort())).toEqual({
      base: 40,
      column: 8,
      floor: 40,
      'left wall': 4,
      'right wall': 4,
      wall: 32,
    })

    // Every one of the 40 declares a `base` slot, which is the fact that killed
    // rule 1: the base is not inserted, it is asked for.
    expect(templates.every((template) => template.parts.some((part) => part.name === 'base'))).toBe(true)
    // 3 to 5 parts each, median 3 — the arithmetic behind the download figures
    // below.
    const counts = templates.map((template) => template.parts.length).sort((a, b) => a - b)
    expect(counts[0]).toBe(3)
    expect(counts[counts.length - 1]).toBe(5)
    expect(counts[Math.floor(counts.length / 2)]).toBe(3)
  })

  it('declares `optional` on none of the 128 parts, so every slot is required', () => {
    // The measurement the download gate rests on. `PartSlot.optional` is absent
    // on 1,050 of the 3,695 live *tile* slots and absence means required; over
    // the 40 templates it is absent from **all 128**, so there is no template in
    // the build for which an empty slot is acceptable and the gate applies to
    // every one of them.
    const declared = templates.flatMap((template) => template.parts).filter((part) => part.optional !== undefined)
    expect(declared).toEqual([])
  })

  it('has a candidate for every one of the 128 parts — no recipe ships a dead end', () => {
    // `@/composition`'s `deadEnd` is C2's greying, and 526 of the 3,695 live
    // *tile* slots are already one in their initial state. Over the templates it
    // is **zero**, which is what makes `rankBases` returning `undefined` a state
    // a pick can create rather than one the recipes ship with.
    let dead = 0
    let pairs = 0
    let inserts = 0
    let shapeless = 0
    let unspecified = 0
    for (const template of templates) {
      for (const part of template.parts) {
        const candidates = composition.candidatesFor(resolveSlotTags(part.tags, template.tags, []))
        if (candidates.deadEnd) dead += 1
        pairs += candidates.tiles.length
        for (const tile of candidates.tiles) {
          const record = index.byId.get(tile)
          if (record === undefined) continue
          if (record.layer === 'insert') inserts += 1
          if (record.foot.shape === 'none') shapeless += 1
          if (record.build === undefined) unspecified += 1
        }
      }
    }
    expect(dead).toBe(0)
    expect(pairs).toBe(14_241)

    // The three per-file notes, sized against the population that can actually
    // reach them. `insert-on-grid` is **unreachable through the solver** — 0 of
    // the 14,241 (slot, candidate) pairs names an insert — so what can reach it
    // is exactly a pinned or imported fill from outside the candidate set.
    expect(inserts).toBe(0)
    expect(shapeless).toBe(60)
    // And `build-unspecified` at 25.35% is why it is `info`: at `warn` it would
    // be wallpaper and the real warnings would be read past.
    expect(unspecified).toBe(3610)
    expect(unspecified / pairs).toBeCloseTo(0.2535, 4)
  })

  it('fills 18 of the 40 recipes greedily, and reports all 30 holes rather than hiding them', () => {
    // **A finding for row C2, and it refutes the obvious solver.** Every one of
    // the 128 parts has candidates in isolation — asserted above, 0 dead ends —
    // and yet a greedy first-candidate walk in declared order leaves **16 of the
    // 40** with an empty `base` slot. All 16 are the
    // `s2w-wall-on-tile-wall-*-modular` recipes, and in every case that slot had
    // candidates before its siblings were chosen (48 of them, 305 for the drain)
    // and was emptied by the picks in front of it.
    //
    // That is row C2's own measurement reproduced on templates: a sibling pick is
    // *inert or fatal*, never merely narrowing, so a solver with no ordering
    // policy and no backtracking paints itself into a corner. Whether it fills
    // `base` first, reorders, or backtracks is C2's decision; what this row owes
    // it is that the corner is **visible** rather than silent.
    //
    // **The accessory slots are the second corner, and six recipes fail on
    // nothing else.** The walk fills template slots and knows nothing about the
    // slots the *files* it picks declare: 15 of the 40 instances hold 20
    // accessory declarations between them, 14 of those are required — absence of
    // `optional` means required, and 1,047 of the corpus's 1,244 declarations
    // omit it — and a doorway with no door is a hole in the print exactly as an
    // empty `base` slot is. So 22 instances are incomplete over 30 holes: 10 on
    // the base alone, 6 on accessories alone, 6 on both.
    //
    // Which is the whole of hazard 6: the resolver does not refuse the instance
    // (§3.2 places anyway), it reports every hole and fails the download gate. A
    // bill that looked complete here would ship a zip several files short of a
    // printable model.
    const instances = templates.map((template, at) => defaultFilled(template, at))
    const resolved = instances.map((instance) => resolveInstance(instance, index, context))

    const complete = resolved.filter((entry) => entry.complete)
    const incomplete = resolved.filter((entry) => !entry.complete)
    expect(complete).toHaveLength(18)
    expect(incomplete).toHaveLength(22)

    for (const entry of incomplete) {
      const holes = entry.slots.filter((slot) => slot.record === undefined).map((slot) => slot.slot)
      const missing = entry.holds.filter((held) => !held.optional && held.record === undefined)
      // Every *template* hole is a `base` slot, every one is reported by name,
      // and an instance is here because of one, an accessory, or both.
      expect(holes, entry.instance.template).toEqual(holes.length === 0 ? [] : ['base'])
      expect(holes.length + missing.length, entry.instance.template).toBeGreaterThan(0)
      expect(
        entry.notes.filter((note) => note.code === 'slot-unfilled').map((note) => note.slot),
        entry.instance.template,
      ).toEqual(holes)
      // And the fills that *were* made are still admissible and still billed —
      // one part lost, not the instance.
      expect(entry.parts.length, entry.instance.template).toBe(entry.slots.length - holes.length)
      expect(entry.slots.filter((slot) => slot.record !== undefined).every((slot) => slot.admissible === true)).toBe(
        true,
      )
    }

    // The six that are short of an accessory and nothing else. Their template
    // slots are all filled, so before holds reached the gate these read as
    // printable models with no door, no grate and no portcullis in them.
    const accessoryOnly = incomplete.filter((entry) => entry.slots.every((slot) => slot.record !== undefined))
    expect(accessoryOnly).toHaveLength(6)

    // The 18 that do complete resolve cleanly: every fill came from its own
    // slot's candidate set, so `fill-off-slot` cannot fire.
    for (const entry of complete) {
      expect(entry.notes.filter((note) => note.code === 'fill-off-slot'), entry.instance.template).toEqual([])
      expect(entry.notes.filter((note) => note.code === 'slot-unfilled'), entry.instance.template).toEqual([])
      expect(entry.parts).toHaveLength(entry.slots.length)
    }

    // 128 declared slots, 112 filled by the greedy walk.
    expect(resolved.reduce((sum, entry) => sum + entry.slots.length, 0)).toBe(128)
    expect(resolved.reduce((sum, entry) => sum + entry.parts.length, 0)).toBe(112)

    // The accessory declarations those 112 files carry, and what is required of
    // them. Six are optional — two `treasure`, two `frame`, two `shutters` — and
    // an empty one of those refuses nothing.
    const declared = resolved.flatMap((entry) => entry.holds)
    expect(declared).toHaveLength(20)
    expect(resolved.filter((entry) => entry.holds.length > 0)).toHaveLength(15)
    expect(
      declared
        .filter((held) => held.optional)
        .map((held) => held.hold)
        .sort(),
    ).toEqual(['frame', 'frame', 'shutters', 'shutters', 'treasure', 'treasure'])
    expect(
      declared
        .filter((held) => !held.optional)
        .map((held) => held.hold)
        .sort(),
    ).toEqual([
      'door',
      'door',
      'door',
      'door',
      'grate',
      'grate',
      'lintel',
      'lintel',
      'portcullis',
      'portcullis',
      'top',
      'top',
      'torch',
      'torch',
    ])

    // **Every one of the 20 has exactly one measured mount**, now that
    // `pipeline/mounts/inventory.json` holds the real run — a doorway, a
    // socket or a surface read off the host mesh, one place per declaration.
    // Nothing is `unplaced` all the same, because nothing is *held*: an accessory
    // reaches that list only once a file has been chosen for it.
    expect(declared.map((held) => held.mounts)).toEqual(Array.from({ length: 20 }, () => 1))

    const bill = buildBillOfTiles(instances, index, context)
    expect(bill.placements).toBe(40)
    expect(bill.parts).toBe(112)
    // The gate, over the whole scene: 22 instances short of a printable model,
    // and the download must refuse rather than ship 40 recipes with holes.
    expect(bill.complete).toBe(false)
    expect(bill.unfilled).toHaveLength(30)
    expect(new Set(bill.unfilled.filter((hole) => hole.hold === undefined).map((hole) => hole.slot))).toEqual(
      new Set(['base']),
    )
    expect(new Set(bill.unfilled.filter((hole) => hole.hold !== undefined).map((hole) => hole.hold))).toEqual(
      new Set(['door', 'grate', 'lintel', 'portcullis', 'top', 'torch']),
    )
    expect(bill.unplaced).toEqual([])
    // More parts than placements, which is §2's "parts list" reading — and now a
    // property of the recipe rather than of an inserted base.
    expect(bill.parts).toBeGreaterThan(bill.placements)
  })

  it('gives every default-filled base slot a full base, not a print variant', () => {
    // The decision row A3 kept, exercised through the surface row C2 will use.
    // `rankBases` is handed the slot's *composition* candidates rather than a
    // congruence pool, and the guarantee has to survive that change of pool: a
    // topless base has no top surface and is a different product.
    //
    // 24 of the 40, because the other 16 have no base to rank — see the test
    // above. The figure being short of 40 is the solver's problem, not the
    // ranking's: where there is a pool at all, the pick is the full base.
    let ranked = 0
    for (const [at, template] of templates.entries()) {
      const resolved = resolveInstance(defaultFilled(template, at), index, context)
      const base = resolved.parts.find((part) => part.slot === 'base')
      if (base === undefined) continue
      ranked += 1
      expect(index.basePrintOption.get(base.record.id) ?? 'plain', `${template.id} / ${base.record.id}`).toBe('plain')
      // And it is a real base, not merely something the slot admitted.
      expect(base.record.layer, template.id).toBe('base')
    }
    expect(ranked).toBe(24)
  })

  it('measures the median distinct file the 40 recipes admit — row C4’s unit', () => {
    // **The restatement, computed rather than quoted.** `DownloadSize.bytes` is
    // one copy per distinct md5, so the only unit either threshold can be stated
    // in is the distinct file — not the placement it was calibrated on, and not
    // the part either, since a part that repeats costs nothing.
    const admitted = new Map<string, CatalogRecord>()
    for (const template of templates) {
      for (const part of template.parts) {
        for (const tile of composition.candidatesFor(resolveSlotTags(part.tags, template.tags, [])).tiles) {
          const record = index.byId.get(tile)
          if (record !== undefined && !admitted.has(record.blob)) admitted.set(record.blob, record)
        }
      }
    }
    const bytes = [...admitted.values()].map((record) => record.bytes)

    expect(admitted.size).toBe(2990)
    expect(bytes.reduce((sum, value) => sum + value, 0)).toBe(37_047_210_327)
    expect(median(bytes)).toBe(11_255_184)
    expect(percentile(bytes, 0.9)).toBe(24_415_784)
    expect(percentile(bytes, 0.95)).toBe(29_292_934)
    expect(Math.max(...bytes)).toBe(108_912_184)

    // The file a builder user actually meets is **8.6% larger** than the
    // whole-corpus median, not 2.58x anything — which is the first half of why
    // row C4 restated the thresholds instead of moving them.
    expect(median(records.map((record) => record.bytes))).toBe(10_364_884)
    expect(median(bytes) / median(records.map((record) => record.bytes))).toBeCloseTo(1.086, 3)

    // Both thresholds, in files.
    expect(DOWNLOAD_LARGE_BYTES / median(bytes)).toBeCloseTo(45.5, 1)
    expect(DOWNLOAD_HUGE_BYTES / median(bytes)).toBeCloseTo(177.7, 1)
    expect(DOWNLOAD_LARGE_BYTES / percentile(bytes, 0.95)).toBeCloseTo(17.5, 1)
  })

  it('shows that an instance count does not determine the download at all', () => {
    // **The second half, and the refutation of A3's 2.58x.** A3 multiplied a
    // median candidate per slot by the number of instances and never deduped,
    // and the dedupe is the dominant term rather than a correction. Two rooms
    // over the same 40 recipes, through the real `buildBillOfTiles`:
    //
    //   - `defaultFilled` is the greedy solver stand-in, so it picks the same
    //     file for the same slot every time. 40 recipes are the whole vocabulary,
    //     so the room **saturates**: one instance of each is 112 parts over 36
    //     files, and the two hundredth instance adds 0 bytes. No such room can
    //     reach `large`.
    //   - `variedFilled` cycles each slot's candidate list, so no two instances
    //     share a fill until the sets run out. That is the other extreme, and it
    //     trips `large` at 19 instances.
    //
    // So the instance count at which `large` fires is between **19 and never**,
    // and `bill.ts`'s docblock names neither.
    const solver = (n: number): BillOfTiles =>
      buildBillOfTiles(
        Array.from({ length: n }, (_, at) => defaultFilled(templates[at % templates.length] as AssemblyTemplate, at)),
        index,
        context,
      )

    const twenty = solver(20)
    expect([twenty.files, twenty.download.bytes, twenty.download.verdict]).toEqual([23, 235_565_147, 'ok'])
    for (const n of [50, 100, 200]) {
      const room = solver(n)
      expect([room.files, room.download.bytes, room.download.verdict], `n=${String(n)}`).toEqual([
        36,
        366_230_378,
        'ok',
      ])
    }
    // 0.72x `large`, and it is a ceiling rather than a reading: the parts keep
    // growing and the files do not.
    expect(solver(200).parts).toBe(560)
    expect(366_230_378 / DOWNLOAD_LARGE_BYTES).toBeCloseTo(0.72, 2)

    const varied = (n: number): BillOfTiles =>
      buildBillOfTiles(
        Array.from({ length: n }, (_, at) => variedFilled(templates[at % templates.length] as AssemblyTemplate, at)),
        index,
        context,
      )

    // Parts and files coincide up to twenty instances, which is exactly the range
    // A3's dedupe-free model is right over — its predicted 528 MB is 3.4% *below*
    // the measurement there, because it takes the median candidate per slot and
    // the varied walk takes each slot's candidates in turn.
    const twentyVaried = varied(20)
    expect([twentyVaried.parts, twentyVaried.files]).toEqual([66, 66])
    expect([twentyVaried.download.bytes, twentyVaried.download.verdict]).toEqual([546_609_140, 'large'])
    expect((26_394_812 * 20) / twentyVaried.download.bytes).toBeCloseTo(0.966, 3)

    // And they diverge from there, which is where the model starts overstating.
    const fiftyVaried = varied(50)
    expect([fiftyVaried.parts, fiftyVaried.files]).toEqual([161, 139])
    expect([fiftyVaried.download.bytes, fiftyVaried.download.verdict]).toEqual([1_156_629_241, 'large'])
    expect((26_394_812 * 50) / fiftyVaried.download.bytes).toBeCloseTo(1.141, 3)

    // The two crossings, in files, which is the unit the thresholds are stated in.
    const nineteen = varied(19)
    expect([nineteen.files, nineteen.download.bytes, nineteen.download.verdict]).toEqual([
      63,
      516_165_775,
      'large',
    ])
    expect(varied(18).download.verdict).toBe('ok')
    const ninety = varied(90)
    expect([ninety.files, ninety.download.bytes, ninety.download.verdict]).toEqual([220, 2_032_018_037, 'huge'])
    expect(varied(89).download.verdict).toBe('large')
  })

  it('measures what one instance costs, and why it is not the threshold’s unit', () => {
    // A3's figure, kept because it is a true fact about an instance and is quoted
    // in `BillPanel.tsx`: taking the median-sized candidate for each declared
    // slot, one instance is 26,394,812 B over 3 files. What row C4 removed is the
    // *inference* from it — see the test above — because multiplying it by an
    // instance count models a room in which no two instances share a file.
    const perInstance = templates.map((template) => {
      let bytes = 0
      for (const part of template.parts) {
        const candidates = composition.candidatesFor(resolveSlotTags(part.tags, template.tags, []))
        bytes += median(candidates.tiles.map((tile) => index.byId.get(tile)?.bytes ?? 0))
      }
      return bytes
    })

    expect(median(perInstance)).toBe(26_394_812)
    expect(Math.min(...perInstance)).toBe(10_019_059)
    expect(Math.max(...perInstance)).toBe(44_321_212)

    // The solver's own pick, for comparison: 17,747,318 B median over 3 parts,
    // which is 33% below the median-candidate model before any dedupe at all.
    const solved = templates.map((template, at) =>
      buildBillOfTiles([defaultFilled(template, at)], index, context),
    )
    expect(median(solved.map((bill) => bill.download.bytes))).toBe(17_747_318)
    expect(median(solved.map((bill) => bill.parts))).toBe(3)
  })

  const records = file.records

  /* ----------------------------------------------------------- the bill, on files */

  /**
   * A one-slot recipe over the real corpus, so a bill's lines are exactly the
   * files a test names.
   *
   * **This is a simplification row A3 bought.** The md5 dedupe, the filename
   * collisions and the byte totals are claims about *files*, and before this row
   * every one of them had to be made through `resolvesToItself` — a helper that
   * filtered the corpus down to records rule 0 would not substitute, because
   * placing a record whose item had a better variant under the preference in
   * force meant the bill deduped a pair the resolver never assembled. A fill
   * names the file, so the population is the whole corpus and the filter is gone.
   *
   * `tags: {}` admits every record — `candidatesFor` starts from the whole
   * document list when the require set is empty — so no fill is ever off-slot
   * and these tests stay about naming.
   */
  const ONE_SLOT_NAME = 'model' as SlotName
  const ONE_SLOT: AssemblyTemplate = { id: 'corpus-one-slot', tags: [], parts: [{ name: ONE_SLOT_NAME, tags: {} }] }
  const oneSlotContext: AssemblyContext = { templates: (id) => (id === ONE_SLOT.id ? ONE_SLOT : undefined), composition }
  const oneOf = (record: CatalogRecord, at: number): TemplateInstance => ({
    id: `f${String(at)}` as PlacementId,
    template: ONE_SLOT.id as TemplateId,
    x: 0,
    z: 0,
    rotation: 0,
    fills: { [ONE_SLOT_NAME]: { tile: record.id, pinned: false } },
    filters: [],
  })

  it('collapses a shared-md5 pair to one line while naming both tiles', () => {
    const shared = [...index.byBlob.values()].find((group) => group.length === 2)
    expect(shared).toBeDefined()
    const [first, second] = shared ?? []
    expect(first?.id).not.toBe(second?.id)
    expect(first?.blob).toBe(second?.blob)

    const bill = buildBillOfTiles(
      [oneOf(first as CatalogRecord, 0), oneOf(second as CatalogRecord, 1)],
      index,
      oneSlotContext,
    )

    // One file to download, two copies to print, both tiles named.
    expect(bill.files).toBe(1)
    expect(bill.lines[0]?.quantity).toBe(2)
    expect(bill.lines[0]?.tileIds).toHaveLength(2)
    expect(bill.download.bytes).toBe(first?.bytes)
    // And the provenance row A3 added: two askers, named by instance and slot.
    expect(bill.lines[0]?.slots).toHaveLength(2)
    expect(bill.lines[0]?.slots.map((ref) => ref.placement)).toEqual(['f0', 'f1'])
  })

  it('counts a file placed twice as two copies of one download', () => {
    const tile = records[0] as CatalogRecord
    const bill = buildBillOfTiles([oneOf(tile, 0), oneOf(tile, 1)], index, oneSlotContext)
    expect(bill.files).toBe(1)
    expect(bill.copies).toBe(2)
    expect(bill.download.bytes).toBe(tile.bytes)
  })

  it('surfaces a filename that two different meshes share', () => {
    const collided = [...index.blobsByFilename.entries()].find(([, blobs]) => blobs.length > 1)
    expect(collided).toBeDefined()
    const [filename, blobs] = collided ?? ['', []]
    const picks = blobs
      .map((blob) => index.byBlob.get(blob)?.[0])
      .filter((record): record is CatalogRecord => record !== undefined)
    expect(picks.length).toBeGreaterThan(1)

    const bill = buildBillOfTiles(
      picks.map((record, at) => oneOf(record, at)),
      index,
      oneSlotContext,
    )
    const lines = bill.lines.filter((line) => line.filename === filename)
    expect(lines).toHaveLength(picks.length)
    for (const line of lines) {
      expect(line.filenameCollides).toBe(true)
      // The disambiguator is the full catalog path, which already exists in the data.
      expect(line.entryName).toBe(line.tile.id)
      expect(line.entryName).toContain(line.filename)
    }
    expect(new Set(lines.map((line) => line.entryName)).size).toBe(lines.length)

    const collision = bill.collisions.find((entry) => entry.filename === filename)
    expect(collision?.blobs).toHaveLength(picks.length)
    expect(new Set(collision?.entryNames).size).toBe(picks.length)
  })

  it('leaves a non-colliding filename on its bare name', () => {
    const unique = records.find((record) => (index.blobsByFilename.get(record.file)?.length ?? 0) === 1)
    const bill = buildBillOfTiles([oneOf(unique as CatalogRecord, 0)], index, oneSlotContext)
    expect(bill.lines[0]?.filenameCollides).toBe(false)
    expect(bill.lines[0]?.entryName).toBe(unique?.file)
    expect(bill.collisions).toEqual([])
  })

  it('names the three-mesh filename three different ways', () => {
    const threeWay = [...index.blobsByFilename.entries()].find(([, blobs]) => blobs.length === 3)
    expect(threeWay).toBeDefined()
    const [, blobs] = threeWay ?? ['', []]
    const picks = blobs
      .map((blob) => index.byBlob.get(blob)?.[0])
      .filter((record): record is CatalogRecord => record !== undefined)
    const bill = buildBillOfTiles(
      picks.map((record, at) => oneOf(record, at)),
      index,
      oneSlotContext,
    )
    expect(new Set(bill.lines.map((line) => line.entryName)).size).toBe(bill.lines.length)
  })

  it('totals match a brute-force sum over forty default-filled recipes', () => {
    // The bill's arithmetic, computed a second way: resolve each instance,
    // flatten the parts, then group with a plain Map keyed on md5.
    const instances = templates.map((template, at) => defaultFilled(template, at))
    const bill = buildBillOfTiles(instances, index, context)

    const parts = instances.flatMap((instance) =>
      resolveInstance(instance, index, context).parts.map((part) => part.record),
    )
    const bytesByBlob = new Map<string, number>()
    const copiesByBlob = new Map<string, number>()
    for (const record of parts) {
      bytesByBlob.set(record.blob, record.bytes)
      copiesByBlob.set(record.blob, (copiesByBlob.get(record.blob) ?? 0) + 1)
    }

    expect(bill.placements).toBe(40)
    expect(bill.parts).toBe(parts.length)
    expect(bill.files).toBe(bytesByBlob.size)
    expect(bill.copies).toBe(parts.length)
    expect(bill.download.bytes).toBe([...bytesByBlob.values()].reduce((a, b) => a + b, 0))
    for (const line of bill.lines) {
      expect(line.quantity, line.blob).toBe(copiesByBlob.get(line.blob))
      // Every copy is accounted for by a named asker — hazard 5's fix, over real
      // data rather than a fixture.
      expect(line.slots, line.blob).toHaveLength(line.quantity)
    }
    // The dedupe is doing work here rather than being vacuous: 128 parts fold
    // onto fewer files, because the recipes share candidates.
    expect(bill.files).toBeLessThan(bill.copies)
  })

  it('warns before an unshippable download', () => {
    const biggest = [...records].sort((a, b) => b.bytes - a.bytes).slice(0, 60)
    const bill = buildBillOfTiles(
      biggest.map((record, at) => oneOf(record, at)),
      index,
      oneSlotContext,
    )
    expect(bill.download.bytes).toBeGreaterThan(DOWNLOAD_LARGE_BYTES)
    expect(bill.download.verdict).not.toBe('ok')
  })

  it('notes a retired fill without dropping the instance beside it', () => {
    const known = records[0] as CatalogRecord
    const dead: TemplateInstance = {
      ...oneOf(known, 9),
      fills: { [ONE_SLOT_NAME]: { tile: 'tiles/nothing/here.stl' as TileId, pinned: false } },
    }
    const bill = buildBillOfTiles([dead, oneOf(known, 1)], index, oneSlotContext)
    expect(bill.placements).toBe(2)
    expect(bill.files).toBe(1)
    expect(bill.notes.map((entry) => entry.code)).toContain('unknown-tile')
    expect(bill.resolved[0]?.parts).toEqual([])
    // And the gate catches it, which is the half a note cannot carry.
    expect(bill.complete).toBe(false)
  })
})

/* ---------------------------------------- rule 0's one surviving half, on the corpus */

/**
 * `selectVariantForLock` over the emitted corpus.
 *
 * All that is left of rule 0, and it is here rather than deleted with the rest
 * because it was never about placements: it answers *which file of this item does
 * this preference want*, which five call sites outside this directory ask and
 * which row C2's fill solver is the sixth to ask. A candidate grid is an **item**
 * grid; the file is chosen from the item afterwards.
 *
 * Every figure is a measurement of a build artefact, not a constant. The point of
 * asserting them is that a *drift* is a decision somebody has to look at: this
 * function decides which file a user prints.
 */
describeCorpus(catalog === undefined ? 'selectVariantForLock — SKIPPED' : 'selectVariantForLock', () => {
  const file = catalog ?? ({ records: [], tags: [] } as unknown as CatalogFile)
  const aggregates = buildAggregateIndex(file)
  const items: readonly TileAggregate[] = aggregates.aggregates

  it('is `selectVariant` with the print options always supplied', () => {
    // The one thing this wrapper exists to guarantee, and what omitting it costs
    // is measured: without `options` the rank falls through to `bytes` ascending,
    // which is the tie-break row D1 removed from base matching for cause, because
    // the topless print of a base is its smallest file. There is exactly one
    // right value for that argument, so it is supplied here rather than offered
    // as a choice to six call sites.
    for (const item of items.slice(0, 400)) {
      for (const lock of ['openlock', 'dragonlock', 'magnetic', undefined] as const) {
        expect(selectVariantForLock(item, lock)).toEqual(
          selectVariant(item, { bottom: lock, options: PRINT_OPTIONS }),
        )
      }
    }
  })

  it('changes which file an item resolves to, and measures how often', () => {
    // The measurement a reviewer should ask for: this is only worth its
    // complexity if the lock preference actually moves the answer. It is also the
    // figure row C2 inherits — a solver that ignored the preference would print
    // the wrong file for over a third of the archive.
    const under = (lock: LockSystem): Map<string, string> =>
      new Map(items.map((item) => [item.design as string, selectVariantForLock(item, lock).variant.id as string]))
    const openlock = under('openlock')
    const moved = (lock: LockSystem): number =>
      [...under(lock).entries()].filter(([design, id]) => openlock.get(design) !== id).length

    expect(moved('dragonlock')).toBe(1414)
    expect(moved('magnetic')).toBe(1164)

    // And 1,419 items — 37.1% of all 3,822, 83.2% of the 1,705 that hold more
    // than one file — do not resolve to the same file under all three. That is
    // the number `SlotFill.pinned` exists for.
    let differs = 0
    for (const item of items) {
      const files = new Set(
        (['openlock', 'dragonlock', 'magnetic'] as const).map((lock) => selectVariantForLock(item, lock).variant.id),
      )
      if (files.size > 1) differs += 1
    }
    expect(differs).toBe(1419)
    expect(items.filter((item) => item.variants.length > 1)).toHaveLength(1705)
    expect(items).toHaveLength(3822)
    expect(differs / items.length).toBeCloseTo(0.371, 3)
  })

  it('is idempotent on the file it picks', () => {
    // Whatever file an item resolves to, resolving that file's own item again
    // gives the same answer — which is what makes a saved scene stable and is the
    // property a solver re-running on a lock change depends on.
    for (const item of items.slice(0, 500)) {
      const first = selectVariantForLock(item, 'openlock').variant.id
      const again = aggregates.byTile.get(first)
      expect(again?.design).toBe(item.design)
      expect(selectVariantForLock(item, 'openlock').variant.id).toBe(first)
    }
  })
})
