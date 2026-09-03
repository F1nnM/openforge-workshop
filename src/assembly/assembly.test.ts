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
 * ordering, the byte thresholds, the empty scene) and every claim about the data
 * is checked against the emitted index.
 *
 * **One fixture block is load-bearing all the same**, and row D4 added it: `the
 * join key`. Its cases are the ones the corpus does *not* contain — a base
 * carrying a size code its shape contradicts, a topper whose code and whose
 * shape point at different bases — because a corpus test cannot assert what the
 * archive does not hold yet, and those are precisely the cases the old key got
 * wrong. The corpus block asserts that they are still absent; the fixture block
 * asserts what happens on the day they are not.
 *
 * If that index is not on this machine the block is skipped **loudly** — a
 * banner on stderr and the reason in the suite name — because the default
 * reporter prints a bare "N skipped" and a silently skipped data test is exactly
 * the failure this file exists to catch.
 *
 * **The skip is a local-checkout path, not the CI path.** This docblock used to
 * say the opposite, and row X5 corrected it: CI fetches the pinned fixtures and
 * regenerates the index before it runs the suite — `npm run stamp`, which
 * replaced `npm run import:catalog` there in row X4 — so every corpus block
 * below runs on every pull request. A skipped corpus block on a green board is
 * now a signal that something is wrong with the run, which is the whole reason
 * the banner is loud.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { PrintOption as BarrelPrintOption } from '@/assembly'
import { PRINT_OPTIONS as BARREL_PRINT_OPTIONS, printOption as barrelPrintOption } from '@/assembly'
import type { CatalogFile, CatalogRecord, Footprint } from '@/catalog'
import {
  CatalogFile as CatalogFileSchema,
  CatalogRecord as CatalogRecordSchema,
  DesignId,
  TileId,
  buildAggregateIndex,
  resolveTags,
} from '@/catalog'
import type { LockSystem, Placement } from '@/store'

import type { AssemblyIndex, PrintOption } from './assemblyIndex'
import { PRINT_OPTIONS, buildAssemblyIndex, printOption } from './assemblyIndex'
import { DOWNLOAD_HUGE_BYTES, DOWNLOAD_LARGE_BYTES, buildBillOfTiles, downloadSize } from './bill'
import { footprintKey, footprintsMatch } from './footprint'
import { NOTE_SEVERITY, rollUpNotes } from './notes'
import { MATCH_WEIGHTS, matchBase, missingBaseNote, resolvePlacement, resolveVariant } from './resolve'
import { AMBIGUOUS_SIZE_CODES, SIZE_CODE_WIDTH_UNITS, sharedPrimitive, sizeCodeWidth } from './sizeCode'

/* -------------------------------------------------------------- test helpers */

/**
 * A placement of one **item**, since row V4.
 *
 * Every call site has a `CatalogRecord` in hand and passes `record.design`,
 * which is the same resolution the old `place(record.design)` produced — that helper
 * hopped file → design before doing anything — so every corpus figure below is
 * measured over the same population as before.
 */
const place = (design: string, x = 0, z = 0): Placement => ({
  design: DesignId.parse(design),
  x,
  z,
  rotation: 0,
})

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
    // here into a single item — and then rule 0 would resolve a topper to an
    // unrelated base's file, because `selectVariant` prefers a variant that
    // needs no base. It would also break A1's hoisting invariant outright: these
    // records deliberately carry different names, footprints and size codes, and
    // 0 of the 3,822 live aggregates hold two of any of them. The same
    // correction row A2 made to the builder fixture's `twin`.
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
 * The base the match hands a topper, and how it says it found it.
 *
 * **`matchBase`, not `resolvePlacement`**, and the difference is row A6's rule 0.
 * A placement resolves the *item* before it resolves the base, so asking the
 * resolver what base a topper file gets now answers "none" whenever that item
 * also publishes a one-part print in this lock — 1,808 of the 4,363 topper files
 * under openlock. Every claim in this file about *which base a topper gets* is a
 * claim about the match, so it is asked of the match.
 *
 * The notes still come from `resolvePlacement`, because a note is only emitted
 * when a base is actually inserted, and that is the thing being described.
 */
function baseFor(topper: CatalogRecord, index: AssemblyIndex) {
  const matched = matchBase(topper, index, 'openlock')
  const resolved = resolvePlacement(place(topper.design), index, { lock: 'openlock' })
  return {
    base: matched?.base,
    match: matched?.match,
    codes: resolved.notes.map((entry) => entry.code),
    messages: resolved.notes.map((entry) => entry.message),
  }
}

/* ------------------------------------------------------ construction-only tests */

describe('size code table', () => {
  it('is the five codes §7 publishes, and guesses at none of the other 31', () => {
    expect(Object.keys(SIZE_CODE_WIDTH_UNITS).sort()).toEqual(['A', 'BA', 'D', 'IA', 'Q'])
    expect(sizeCodeWidth('A')).toBe(2)
    expect(sizeCodeWidth('BA')).toBe(1.5)
    expect(sizeCodeWidth('IA')).toBe(1)
    expect(sizeCodeWidth('D')).toBe(3)
    expect(sizeCodeWidth('Q')).toBe(4)
    expect(sizeCodeWidth('S')).toBeUndefined()
    expect(sizeCodeWidth('AxG')).toBeUndefined()
    // Row W4's finding, kept off the table on purpose: `QxG` is tagged
    // `size|width|4` and measures 3.000. An entry here would have to be 3, and
    // the base match does not need one — `QxG` keys `wall:3` by congruence.
    expect(sizeCodeWidth('QxG')).toBeUndefined()
  })

  it('publishes the four ambiguous codes as data, so a fifth cannot arrive quietly', () => {
    // The corpus block below asserts this table against the live catalog in both
    // directions. Here it is only the shape of the claim: a code, and the
    // primitives it is measured to span.
    expect(Object.keys(AMBIGUOUS_SIZE_CODES).sort()).toEqual(['I', 'O', 'S', 'X'])
    expect(AMBIGUOUS_SIZE_CODES.O).toEqual(['column', 'tri:2', 'tri:4'])
    for (const [code, primitives] of Object.entries(AMBIGUOUS_SIZE_CODES)) {
      expect(primitives.length, code).toBeGreaterThan(1)
      expect([...primitives].sort(), code).toEqual([...primitives])
    }
  })
})

describe('footprint congruence', () => {
  it('sorts a rect’s extents, so a rotated tile matches', () => {
    expect(footprintsMatch({ shape: 'rect', w: 0.5, d: 2 }, { shape: 'rect', w: 2, d: 0.5 })).toBe(true)
    expect(footprintsMatch({ shape: 'rect', w: 1, d: 2 }, { shape: 'rect', w: 1, d: 3 })).toBe(false)
  })

  it('keys an arc on its band pair and sweep, not on the tagged radius', () => {
    const concave = { shape: 'arc', rIn: 2, rOut: 2.5, sweep: 90, band: 'concave', bandBasis: 'measured' } as const
    const convex = { shape: 'arc', rIn: 1.5, rOut: 2, sweep: 45, band: 'convex', bandBasis: 'fallback' } as const
    expect(footprintsMatch(concave, { ...concave })).toBe(true)
    expect(footprintsMatch(concave, { ...concave, sweep: 45 })).toBe(false)

    // Row W5's reason for the key. Both of these carry `size|radius|2`, and
    // under the pre-W5 `arc:2@90` key they were the same piece — a wall curving
    // outwards and a wall curving inwards.
    expect(footprintsMatch({ ...concave, sweep: 45 }, convex)).toBe(false)

    // Congruence is about the outline, so the band *name* is not in the key: a
    // `radial` band at R = 2 degenerates to exactly the quarter disc `F` is.
    const radial = { shape: 'arc', rIn: 0, rOut: 2, sweep: 90, band: 'radial', bandBasis: 'measured' } as const
    expect(footprintsMatch(radial, { ...radial, band: 'disc' })).toBe(true)
  })

  it('gives `none` no key at all, so shapeless tiles never match each other', () => {
    expect(footprintKey({ shape: 'none' })).toBeUndefined()
    expect(footprintsMatch({ shape: 'none' }, { shape: 'none' })).toBe(false)
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
    const { base, codes } = baseFor(topper, fixtureIndex([topper, wallBase]))

    expect(base).toBeUndefined()
    expect(codes).toContain('no-congruent-base')
    expect(codes).not.toContain('no-matching-base')
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
    const arc = fixtureRecord('base', { shape: 'arc', rIn: 4, rOut: 4.5, sweep: 90, band: 'concave', bandBasis: 'measured' })
    const pillar = fixtureRecord('base', { shape: 'column' })
    const ambiguous = [
      { ...arc, sizeCode: 'X' } as CatalogRecord,
      { ...pillar, sizeCode: 'X' } as CatalogRecord,
    ]
    const { base, codes, messages } = baseFor(topper, fixtureIndex([topper, ...ambiguous]))

    expect(base).toBeUndefined()
    expect(codes).toContain('no-matching-base')
    expect(messages.join(' ')).toContain('are not all the same shape')

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
   * or, the defect this row fixes, a topless base could outrank a full one.
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

  it('fires `large` on a median fifty-tile room, and not on a median twenty-tile one', () => {
    const medianBytes = 10.36 * 1000 * 1000
    expect(downloadSize(50 * medianBytes).verdict).toBe('large')
    expect(downloadSize(20 * medianBytes).verdict).toBe('ok')
  })
})

describe('note vocabulary', () => {
  it('classifies the third-of-the-corpus notes as info, not warn', () => {
    expect(NOTE_SEVERITY['build-unspecified']).toBe('info')
    expect(NOTE_SEVERITY['base-texture-mismatch']).toBe('info')
    expect(NOTE_SEVERITY['base-auto-inserted']).toBe('info')
    expect(NOTE_SEVERITY['no-matching-base']).toBe('warn')
    expect(NOTE_SEVERITY['base-unmatchable']).toBe('warn')
  })

  it('warns when the base handed out is a print variant rather than the plain base', () => {
    // `warn` and not `info`, and the frequency is what makes that defensible:
    // the corpus block below measures it at 3 placements out of 4,363 under
    // magnetic and 0 under every other preference. A code that fires on a third
    // of the corpus would be wallpaper; this one cannot become wallpaper without
    // the ranking regressing, which is the thing worth being loud about.
    expect(NOTE_SEVERITY['base-option-chosen']).toBe('warn')
  })

  it('publishes the print-option vocabulary through the barrel', () => {
    // `BaseMatch.option` is of type `PrintOption` and `BaseMatch` is on the
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
    const rolled = rollUpNotes([
      { code: 'build-unspecified', severity: 'info', message: 'm', tileId: tile },
      { code: 'build-unspecified', severity: 'info', message: 'm', tileId: other },
      { code: 'build-unspecified', severity: 'info', message: 'm', tileId: tile },
      { code: 'no-matching-base', severity: 'warn', message: 'n', tileId: tile },
    ])
    expect(rolled.map((entry) => entry.code)).toEqual(['no-matching-base', 'build-unspecified'])
    expect(rolled[1]?.count).toBe(3)
    expect(rolled[1]?.tileIds).toEqual([tile, other].sort())
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

/**
 * The aggregate layer over the corpus, built **once** and shared by both corpus
 * blocks below.
 *
 * `buildAssemblyIndex`' second argument defaults to `buildAggregateIndex(file)`,
 * and on the emitted corpus that default is the expensive half — the aggregate
 * index is roughly 4× the assembly index's own cost. Two blocks each taking the
 * default would pay for it twice, in the file that already carries the heaviest
 * corpus work in the suite.
 */
const corpusAggregates =
  catalog === undefined ? undefined : buildAggregateIndex(catalog)

const describeCorpus = catalog === undefined ? describe.skip : describe
const corpusSuite =
  catalog === undefined
    ? `the real corpus — SKIPPED, no catalog index at ${CATALOG_PATH} (run: npm run import:catalog)`
    : 'the real corpus'

describeCorpus(corpusSuite, () => {
  // Safe: the suite is skipped when the index is absent, and `describe.skip`
  // still evaluates the body, so the assertion has to be non-throwing.
  const file = catalog ?? ({ records: [], tags: [] } as unknown as CatalogFile)
  const index = buildAssemblyIndex(file, corpusAggregates)
  const records = file.records
  const byLayer = (layer: CatalogRecord['layer']) => records.filter((record) => record.layer === layer)
  const toppers = byLayer('topper')

  /**
   * `true` when row A6's rule 0 hands back the file that was placed.
   *
   * The bill's own claims — md5 dedupe, filename collisions, copies per file — are
   * about *files*, and rule 0 chooses which file before any of them apply. A test
   * that placed a record whose item has a better variant under the preference in
   * force would be asserting the dedupe over a pair the resolver never assembled.
   * So the records those tests pick are drawn from the ones the resolution leaves
   * alone; the resolution itself is asserted in `variant resolution` below.
   *
   * Defined over the corpus `index`, which the corpus block builds — the fixture
   * blocks give every record its own design and so never substitute at all.
   */
  function resolvesToItself(record: CatalogRecord, lock?: LockSystem): boolean {
    // `resolved === record.id`, since row V4 removed `substituted`: there is no
    // "placed" file to differ from any more, so the question "did the preference
    // pick *this* file" is asked directly.
    return resolveVariant(record.design, index, lock === undefined ? {} : { lock })?.resolved === record.id
  }
  const bases = byLayer('base')

  it('found the corpus the plan describes', () => {
    expect(index.stats.records).toBeGreaterThan(8000)
    expect(index.stats.toppers).toBe(4363)
    expect(index.stats.bases).toBe(1963)
    expect(index.stats.sharedBlobs).toBe(171)
    expect(index.stats.sharedBlobRecords).toBe(520)
    expect(index.stats.collidingFilenames).toBe(89)
  })

  it('confirms the size code is a functional determinant of width, with no exceptions', () => {
    let checked = 0
    const mismatches: string[] = []
    for (const record of records) {
      const expected = record.sizeCode === undefined ? undefined : sizeCodeWidth(record.sizeCode)
      if (expected === undefined) continue
      const measured =
        record.foot.shape === 'rect' ? record.foot.w : record.foot.shape === 'wall' ? record.foot.length : undefined
      if (measured === undefined) continue
      checked += 1
      if (measured !== expected) mismatches.push(`${record.id}: ${record.sizeCode} is ${String(measured)}`)
    }
    expect(checked).toBe(2822)
    expect(mismatches).toEqual([])
  })

  it('measures what the code covers that a width does not: 345 coded tiles', () => {
    const codedWithoutFootprint = records.filter(
      (record) => record.sizeCode !== undefined && record.foot.shape !== 'rect' && record.foot.shape !== 'wall',
    )
    // The figure that made the code the join key, and the reason row D4 could
    // move the key anyway: it is an argument about *widths*, and the primitive
    // is not a width. 249 of these 345 have a perfectly good footprint — the
    // `column`, `diag` and `tri` cases row W4 added — so they key on congruence
    // and never needed the code at all. Measured against the *primitive*, the
    // code's whole remaining coverage advantage is 14 toppers, asserted in
    // 'falls back to the size code for the 14 toppers with no primitive'.
    //
    // 361 before row W3, 299 after it, 345 after W4 — and the rise is the
    // width argument getting *stronger*, not weaker. None of the three cases W4
    // added carries a `w` or a `length` a width join could read:
    //
    //   column 119   no size tag at all beyond the code letter. The code is
    //                literally the only thing these tiles carry.
    //   diag   121   a `run` measured at 2.828-3.536 against a tagged
    //                `size|width|2`. A width join would match all 121 at 2
    //                units, which is worse than missing them.
    //   tri      9   a `leg`, which is the tagged width — the one case here
    //                where a width join would have been right.
    //   none    42   the codes W4 refuses: 28 ambiguous `U`, 14 unmeasured
    //                `col+T`.
    //   arc     54   what is left of the coded arcs once the 84 xG walls
    //                de-arced into `wall` and out of this population.
    expect(codedWithoutFootprint).toHaveLength(345)
    const byShape = new Map<string, number>()
    for (const record of codedWithoutFootprint) {
      byShape.set(record.foot.shape, (byShape.get(record.foot.shape) ?? 0) + 1)
    }
    expect(Object.fromEntries([...byShape.entries()].sort())).toEqual({
      arc: 54,
      column: 119,
      diag: 121,
      none: 42,
      tri: 9,
    })
  })

  /* -------------------------------------------------- the code is not a key */

  it('measures the four size codes that span more than one primitive', () => {
    // Row D4's premise, against the live corpus and in both directions: every
    // code `AMBIGUOUS_SIZE_CODES` names really does span more than one
    // primitive, and no code outside it does. The second half is the one that
    // matters — it is what fails if a corpus rebuild mints a fifth.
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
    // Requirement three of this row: assert the latency, not just the fix. The
    // old key never produced a wrong bill, and it is worth being precise about
    // why, because neither reason is a rule about codes.
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

    // **Two: the one code whose toppers span two primitives has no base at all.**
    // `O` is on 3 `tri:2` and 2 `tri:4` toppers, and zero bases, so the join it
    // would have mismatched never ran.
    expect(index.basesBySizeCode.has('O')).toBe(false)
    for (const code of Object.keys(AMBIGUOUS_SIZE_CODES)) {
      const spans = new Set(
        toppers.filter((record) => record.sizeCode === code).map((record) => footprintKey(record.foot)),
      )
      if (spans.size <= 1) continue
      expect(code).toBe('O')
      expect(index.basesBySizeCode.get(code)).toBeUndefined()
    }

    // Which leaves the coincidence in full: for the three ambiguous codes bases
    // *do* carry, no topper carrying one is a shape those bases are not — `I`
    // has 50 toppers and all of them are the `rect:1x1` its bases are, `S` has
    // 96 and all of them are `rect:1x2`, and `X` has none at all. The 24 `I`
    // columns and the 11 `X` columns are `integral` pieces, which need no base
    // and are never toppers. That is an accident of what has been published, one
    // tile away from ending, and the reason the fix is a key change rather than
    // a patch.
    const spanned = new Map<string, { basePrimitive: string | undefined; toppers: number; primitives: string[] }>()
    for (const [code, group] of baseCodes) {
      if (!Object.hasOwn(AMBIGUOUS_SIZE_CODES, code)) continue
      const carried = toppers.filter((record) => record.sizeCode === code)
      const primitives = [...new Set(carried.map((record) => footprintKey(record.foot) ?? '(none)'))].sort()
      spanned.set(code, { basePrimitive: sharedPrimitive(group), toppers: carried.length, primitives })
    }
    expect(Object.fromEntries(spanned)).toEqual({
      I: { basePrimitive: 'rect:1x1', toppers: 50, primitives: ['rect:1x1'] },
      S: { basePrimitive: 'rect:1x2', toppers: 96, primitives: ['rect:1x2'] },
      X: { basePrimitive: 'arc:4-4.5@90', toppers: 0, primitives: [] },
    })
    for (const { basePrimitive, primitives } of spanned.values()) {
      for (const primitive of primitives) expect(primitive).toBe(basePrimitive)
    }
  })

  /* ------------------------------------------------------------ the hard rule */

  it('auto-inserts a base for an openforge topper, keyed on the primitive', () => {
    // A topper that is the *only* file of its item, so rule 0 has nothing to
    // choose and rule 1 is the whole of the answer. Post-A6 that qualifier is
    // what scopes the hard rule: of the 4,363 topper files, 1,808 resolve to a
    // self-sufficient sibling under openlock and correctly get no base, and
    // others resolve to a sibling topper — so a topper picked at random is no
    // longer a test of rule 1 on its own.
    const topper = toppers.find((record) => {
      const key = footprintKey(record.foot)
      if (key === undefined || !index.basesByFootprint.has(key)) return false
      const resolution = resolveVariant(record.design, index, { lock: 'openlock' })
      return resolution?.verdict === 'with-base' && resolution.variants === 1
    })
    expect(topper).toBeDefined()

    const resolved = resolvePlacement(place(topper?.design ?? ''), index, { lock: 'openlock' })
    expect(resolved.parts.map((part) => part.role)).toEqual(['placed', 'base'])
    // Rule 0 had nothing to choose here — the item holds one file — which is why
    // rule 1 could fire at all.
    expect(resolved.resolution?.variants).toBe(1)
    expect(resolved.tile?.id).toBe(topper?.id)

    const base = resolved.parts[1]
    expect(base?.record.layer).toBe('base')
    expect(base?.match?.key).toBe('footprint')
    expect(base?.match?.on).toBe(footprintKey(topper?.foot ?? { shape: 'none' }))
    // The physical claim, and the only one that matters about a base: it is the
    // same shape as the thing standing on it.
    expect(footprintKey(base?.record.foot ?? { shape: 'none' })).toBe(footprintKey(topper?.foot ?? { shape: 'none' }))
    expect(base?.match?.lockAgrees).toBe(true)
    expect(resolved.notes.map((entry) => entry.code)).toContain('base-auto-inserted')
  })

  it('falls back to the size code for the 14 toppers with no primitive, and only those', () => {
    // The whole of the code key's remaining reach. Every one of them is coded
    // `U` — the code row W4 refused to derive a footprint from, because its 28
    // shapeless records and its 7 `rect:4x4` bases do not agree.
    const codeKeyed = toppers.filter((record) => matchBase(record, index, 'openlock')?.match.key === 'sizeCode')
    expect(codeKeyed).toHaveLength(14)
    expect(new Set(codeKeyed.map((record) => record.sizeCode))).toEqual(new Set(['U']))
    expect(codeKeyed.every((record) => footprintKey(record.foot) === undefined)).toBe(true)
    // 7 candidates, and they agree on `rect:4x4` — which is the gate, not a
    // coincidence: see 'refuses a size code whose bases disagree' above.
    for (const record of codeKeyed) {
      const match = matchBase(record, index, 'openlock')?.match
      expect(match?.candidates).toBe(7)
      expect(sharedPrimitive(index.basesBySizeCode.get('U') ?? [])).toBe('rect:4x4')
    }
  })

  it('leaves an integral tile alone — it carries its own joinery', () => {
    const integral = byLayer('integral')[0]
    const resolved = resolvePlacement(place(integral?.design ?? ''), index)
    expect(resolved.parts).toHaveLength(1)
    expect(resolved.parts[0]?.role).toBe('placed')
    expect(resolved.notes.map((entry) => entry.code)).not.toContain('base-auto-inserted')
  })

  it('does not stack a base under a base', () => {
    const base = bases[0]
    const resolved = resolvePlacement(place(base?.design ?? ''), index)
    expect(resolved.parts).toHaveLength(1)
  })

  it('resolves every tile in the corpus without throwing, and never to zero parts', () => {
    let withBase = 0
    let onePart = 0
    for (const record of records) {
      const resolved = resolvePlacement(place(record.design), index, { lock: 'openlock' })
      expect(resolved.parts.length).toBeGreaterThan(0)
      expect(resolved.resolution).toBeDefined()
      if (resolved.parts.length > 1) withBase += 1
      // Every base a part list holds is one rule 0 said was needed.
      expect(resolved.parts.length > 1).toBe(
        resolved.resolution?.verdict === 'with-base' || resolved.resolution?.verdict === 'mismatched',
      )
      if (resolved.resolution?.verdict === 'self-sufficient') onePart += 1
    }
    // Only toppers gain a part, and rule 0 is why "most of them" is now 2,250 of
    // 4,363 rather than 3,986: the other 1,736 resolve to a sibling that needs
    // no base, so the assembly is one file and the base was never needed. The
    // figure is exact rather than a floor, because a *drop* here would mean rule
    // 0 had started resolving away toppers whose items have no one-part print.
    expect(withBase).toBe(2250)
    expect(withBase).toBeLessThanOrEqual(toppers.length)
    expect(onePart).toBe(5742)
  })

  /* --------------------------------------------------------- the base tie-break */

  /**
   * The four preferences a bill can be drawn under. `undefined` is not a fourth
   * lock system, it is "no preference", and it is included because it is the
   * default the download path uses when the store has not been consulted — the
   * old ranking handed it a topless base 69.8% of the time.
   */
  const preferences: readonly (LockSystem | undefined)[] = ['openlock', 'dragonlock', 'magnetic', undefined]

  /**
   * The candidate set for a topper, by the resolver's own key rule — row D4's:
   * the resolved primitive, and the size code only where there is no primitive
   * and the code's bases agree on one.
   */
  function candidatesOf(tile: CatalogRecord): readonly CatalogRecord[] | undefined {
    const foot = footprintKey(tile.foot)
    if (foot !== undefined) return index.basesByFootprint.get(foot)
    if (tile.sizeCode === undefined) return undefined
    const records = index.basesBySizeCode.get(tile.sizeCode)
    return records === undefined || sharedPrimitive(records) === undefined ? undefined : records
  }

  /**
   * The key rule as it shipped **before row D4**: the size code first, the
   * footprint second, never both.
   *
   * Frozen deliberately, and it is the reason every D1 figure below is unmoved
   * by this row. `legacyBase` reproduces the pre-D1 *ranking*; pairing it with
   * the pre-D1 *key* reproduces the resolver that actually shipped, so D1's gain
   * stays a claim about the ranking and D4's stays a claim about the key. The
   * two are surveyed separately rather than tangled into one before-figure.
   */
  function legacyCandidatesOf(tile: CatalogRecord): readonly CatalogRecord[] | undefined {
    if (tile.sizeCode !== undefined) return index.basesBySizeCode.get(tile.sizeCode)
    const foot = footprintKey(tile.foot)
    return foot === undefined ? undefined : index.basesByFootprint.get(foot)
  }

  /**
   * The ranking as it shipped *before* this row, reproduced in full: candidates
   * ordered `bytes` ascending then `id`, scored `lock` 8 / `shape` 4 / `kind` 2 /
   * `texture` 1 with no notion of a print option, first candidate at the best
   * score wins.
   *
   * Written out rather than remembered, because every before-figure below is a
   * claim about the defect and a remembered number cannot falsify anything. The
   * re-sort is deliberate even though the index arrives in this order today: it is
   * what the old code relied on, so stating it here keeps the comparison valid
   * when the index's order changes.
   *
   * The key rule is a parameter, defaulting to the pre-D4 one, so the same
   * ranking can be surveyed over either candidate set — which is what separates
   * "the ranking chose badly" from "the key found a different set".
   */
  function legacyBase(
    tile: CatalogRecord,
    lock: LockSystem | undefined,
    key: (record: CatalogRecord) => readonly CatalogRecord[] | undefined = legacyCandidatesOf,
  ): CatalogRecord | undefined {
    const records = key(tile)
    if (records === undefined || records.length === 0) return undefined
    const ordered = [...records].sort((a, b) => (a.bytes !== b.bytes ? a.bytes - b.bytes : a.id < b.id ? -1 : 1))

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

  /**
   * The base the shipped match picks, or `undefined` when it finds none.
   *
   * `matchBase` rather than `resolvePlacement`: every survey below compares
   * *rankings over the same candidate set*, and rule 0 would silently drop the
   * 1,808 openlock toppers whose item has a one-part print from the shipped
   * column while leaving them in the legacy one. That would not be a
   * before-and-after, it would be two different populations.
   */
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

  it('collapses the topless auto-insert rate under openlock from 81.6% to zero', () => {
    const before = survey(legacyBase, 'openlock')
    const after = survey(shippedBase, 'openlock')
    // The pre-D1 ranking over row D4's key: the *ranking* held still and only
    // the key moved, which is what tells the two rows' figures apart.
    const beforeReKeyed = survey((tile, lock) => legacyBase(tile, lock, candidatesOf), 'openlock')

    // **Who gets a base at all is a property of the key, not of the ranking.**
    // Both rankings match 3,943 toppers under the pre-D4 key and 3,986 under
    // D4's, so the +43 belongs to the key and the ranking still never refuses.
    // The 43 are the `II`/`IO`/`IX` toppers — see 'gains the 43 toppers' below.
    //
    // 3,769 before row W3 gave 403 tiles a footprint and 3,978 after; row W4
    // takes 25 back and row W5 10 more, and all of those are false pairs removed
    // rather than matches lost — see 'separates the three ways a base can be
    // missing'. The denominator is the honest one.
    expect(before.matched).toBe(3943)
    expect(beforeReKeyed.matched).toBe(3986)
    expect(after.matched).toBe(3986)
    expect(after.matched - before.matched).toBe(43)

    // The defect, measured on this corpus by the old ranking written out above.
    // 81.6% of everything it matches, against 79.7% before row W5: the finding is
    // untouched and got slightly worse to look at, because sector congruence
    // split the ten arc buckets into twenty and `byCost` — bytes-ascending —
    // reaches a *different* cheapest candidate inside each of them. That is the
    // pre-D1 ranking being arbitrary, which is the whole point of this survey.
    expect(before.byOption.topless).toBe(3216)
    expect(before.byOption.topless / before.matched).toBeCloseTo(0.816, 3)
    expect(before.byOption.unsupported).toBe(256)
    expect(before.byOption.plain).toBe(471)

    // And the defect is a property of the ranking, not of the key either: give
    // the old ranking D4's wider candidate sets and it still hands out a topless
    // base 81.7% of the time. Both rows' findings are independent of each other.
    expect(beforeReKeyed.byOption.topless).toBe(3258)
    expect(beforeReKeyed.byOption.topless / beforeReKeyed.matched).toBeCloseTo(0.817, 3)

    // And after: every auto-inserted openlock base is the full base.
    expect(after.byOption).toEqual({ plain: 3986, unsupported: 0, topless: 0 })
  })

  it('collapses it under every lock preference, to the three cases the corpus forces', () => {
    const measured = preferences.map((lock) => ({
      lock: lock ?? 'none',
      before: survey(legacyBase, lock).byOption,
      after: survey(shippedBase, lock).byOption,
    }))

    // Every `before` row grew by row W3's 209 newly matchable toppers, then lost
    // row W4's 25 false pairs, and every `after` row is still all-plain but for
    // the three magnetic cases the corpus forces. The shape of the finding is
    // what is asserted; the totals moved.
    //
    // Row D4 moves the `after` rows by 43 and leaves the `before` rows alone,
    // because `legacyBase` is surveyed over the pre-D4 key it shipped with. The
    // three magnetic cases survive the re-key unchanged: their code `D+SA` and
    // their primitive `rect:1.5x3` select the same three bases either way.
    //
    // The `before` rows also shift *within* their total, by up to 151 tiles, and
    // twice for the same reason: row W4 de-arced the 36 xG bases out of the
    // `arc:2.5@90` bucket into `wall:1.991` / `wall:1.547` / `wall:3`, and row W5
    // split the ten remaining arc buckets into twenty by keying on the band pair
    // instead of the tagged radius. Either way `byCost`, ranking bytes-ascending
    // over a changed candidate list, reaches a different candidate. That is the
    // pre-D1 ranking being arbitrary, which is the defect this test exists to
    // record, and `after` is unmoved at all-plain.
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
    // Three, all magnetic, all under `size code D+SA`: the goblin-fireplace base.
    expect(forced).toBe(3)
  })

  it('widens the set of full bases the resolver can reach', () => {
    const before = survey(legacyBase, 'openlock')
    const after = survey(shippedBase, 'openlock')

    // The headline figure of the defect: 117 of 1,963 bases ever handed out by the
    // old ranking, and 97 of those 117 were print variants rather than bases.
    //
    // 110 before row W4, 111 after it, 117 after row W5, and every one of those
    // steps is the same mechanism: a congruence key that changed. W4 de-arced the
    // 36 xG bases out of `arc:2.5@90` into `wall:1.991` / `wall:1.547` /
    // `wall:3`, and W5 split the ten remaining arc buckets into twenty by keying
    // on the band pair, so `byCost` — bytes-ascending over a changed candidate
    // list — reaches six more distinct bases. That is the pre-D1 ranking being
    // arbitrary, which is the whole point of the `before` survey: the *number* of
    // bases it reaches is a function of how the buckets happen to fall.
    expect(before.reach.size).toBe(117)
    expect(before.reachByOption).toEqual({ plain: 20, unsupported: 17, topless: 80 })

    // After: D1's ranking reaches 116 distinct bases and every one of them is a
    // full base, so the reachable *product* range is 5.8 times wider. It reached
    // 111 before row W5, and the five it gains are the other half of the sector
    // key: a topper whose band now has its own bucket draws its base from that
    // bucket instead of from a pooled `arc:R@sweep` one. Both surveys move, and
    // only `before` moves for an arbitrary reason.
    expect(after.reach.size).toBe(116)
    expect(after.reachByOption).toEqual({ plain: 116, unsupported: 0, topless: 0 })
    expect(after.reachByOption.plain / before.reachByOption.plain).toBeCloseTo(5.8, 2)
    expect(after.reachByOption.plain).toBeGreaterThan(5 * before.reachByOption.plain)

    // Across the four preferences a user can actually pick, the reachable set
    // itself grows. Row W3's 403 new footprints widened both unions by 3, row W4's
    // de-arced bases widened the `before` union by 3 more, and row W5's sector key
    // widens both again — so the gain the ranking is responsible for is asserted
    // as the difference rather than as two absolute counts. It is the only part of
    // this figure D1 owns — and it comes through row W5 unmoved at 14 while both
    // absolute counts rise by 16, which is exactly what asserting the difference
    // was for.
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

  /* ----------------------------------------------------------- the disclosure */

  it('names the base, the pool it beat and the print option in the auto-insert note', () => {
    const topper = toppers.find((record) => record.sizeCode === 'A' && record.texture === 'dungeon_stone')
    expect(topper).toBeDefined()

    const resolved = resolvePlacement(place(topper?.design ?? ''), index, { lock: 'openlock' })
    const base = resolved.parts[1]?.record
    const message = resolved.notes.find((entry) => entry.code === 'base-auto-inserted')?.message ?? ''

    // Which base, out of how many, on what key, and why that one.
    expect(message).toContain(base?.name ?? '\u0000')
    // Row D4: the key it names is the primitive, not the code. `wall:2` is the
    // 101-base congruence class the code `A`'s 86 bases live inside.
    expect(message).toContain('footprint wall:2')
    expect(message).toContain('the best of 101 bases carrying')
    expect(message).toContain('offers openlock')
    expect(message).toContain('a full base')
    // And the code is still named — as the tie-break that chose this member of
    // the class, which is the honest description of what it now does.
    expect(message).toContain('same size code')

    // The old message said neither the pool nor the product.
    expect(message).not.toContain('matched on sizeCode')
  })

  it('says a base has no top surface, and names the lock that forced it', () => {
    const forced = toppers
      .map((topper) => ({ topper, resolved: resolvePlacement(place(topper.design), index, { lock: 'magnetic' }) }))
      .filter(({ resolved }) => resolved.parts[1]?.match?.option === 'topless')

    expect(forced).toHaveLength(3)
    for (const { resolved } of forced) {
      const match = resolved.parts[1]?.match
      expect(match?.lockAgrees).toBe(true)
      expect(match?.optionsOffered).toContain('plain')

      const message = resolved.notes.find((entry) => entry.code === 'base-auto-inserted')?.message ?? ''
      expect(message).toContain('no top surface')
      expect(message).toContain('every plainer base carrying footprint rect:1.5x3 lacks magnetic')
    }
  })

  it('reports the options a candidate set offered, best first', () => {
    for (const topper of toppers) {
      const match = resolvePlacement(place(topper.design), index, { lock: 'openlock' }).parts[1]?.match
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

    // The shipped resolver, on the same tiles, finds a base for nearly all of them.
    // The shipped join, on the same tiles, finds a base for 630 of them — 468
    // before row W3 gave 403 tiles a footprint, and the whole of that gain landed
    // in this population. The remainder carry neither a size code nor a footprint
    // — a topper-side data gap, reported as `base-unmatchable`, not a failure of
    // the key. The contrast is the point: 630 against the build join's 0.
    const topperSide = wallOnTile.filter((record) => record.layer === 'topper')
    const resolvedBases = topperSide.filter((record) => matchBase(record, index, 'openlock') !== undefined)
    expect(resolvedBases).toHaveLength(630)
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
    // the 129 are congruent to a base the archive does have, and under the code
    // key every one of them was reported as having nothing to sit on.
    const recovered = codeGap.filter((record) => matchBase(record, index, 'openlock') !== undefined)
    expect(recovered).toHaveLength(43)

    // The remaining 86 have no base under either key, and are warned about by
    // the code — which is the actionable half, and the index of
    // `docs/corpus-base-gap.md`.
    const stillGapped = codeGap.filter((record) => !recovered.includes(record))
    expect(stillGapped).toHaveLength(86)
    for (const record of stillGapped) {
      const gap = missingBaseNote(record, index)
      expect(gap.code).toBe('no-matching-base')
      expect(gap.message).toContain(`size code ${record.sizeCode ?? ''}`)
    }
  })

  it('gains the 43 toppers whose code the archive lacks but whose shape it covers', () => {
    // Row D5 predicted this row would shrink its first bucket and named the five
    // `O` toppers as the beneficiaries, reaching a `rect:2x2` / `rect:4x4` match.
    // The prediction was written before row W4: those tiles keyed as rectangles
    // then, and W4 reclassified them to `tri`, which the base range does not
    // cover at all. So the `O` toppers stay in the gap and three code families
    // D5 did not name are recovered instead — all of them `rect:1x1`, against 119
    // congruent bases.
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

  it('hands out the same base as the code key did, wherever the code key found one', () => {
    // The re-key is **additive on this corpus**, and that is a measurement rather
    // than a hope: for all 3,943 toppers the code key matched, the primitive key
    // hands out the identical base, and 43 more toppers gain one. Nothing is
    // taken away and nothing is swapped.
    //
    // The `code` weight is what makes that true. The code key implicitly
    // preferred a base from the topper's own size family, because that was the
    // whole candidate set; congruence pools across families, so without the
    // tie-break 434 toppers would drift to a different base — see 'keeps the
    // size code as a family tie-break' in the fixture block for the mechanism.
    const d1UnderOldKey = (tile: CatalogRecord, lock: LockSystem | undefined): CatalogRecord | undefined => {
      const records = legacyCandidatesOf(tile)
      if (records === undefined || records.length === 0) return undefined
      let best: CatalogRecord | undefined
      let bestScore = -1
      for (const base of records) {
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
        same: 3943,
        different: 0,
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
      const candidates = candidatesOf(topper)
      primitivePairs += candidates?.length ?? 0
      const match = matchBase(topper, index, 'openlock')?.match
      if (match === undefined) continue
      keysUsed.add(`${match.key}:${match.on}`)
      smallest = Math.min(smallest, match.candidates)
      largest = Math.max(largest, match.candidates)
    }
    // The cost of the fix, stated: 383,252 candidate pairs against 334,189, a
    // 14.7% wider scan for 43 more matched toppers and every match congruent.
    // Nothing here is per-frame — the scan happens once per placement per bill.
    expect(codePairs).toBe(334_189)
    expect(primitivePairs).toBe(383_252)
    // 43 of the 44 congruence classes the bases cover are reached by a topper,
    // plus the one size code that still finds a base.
    expect(keysUsed.size).toBe(43)
    expect([...keysUsed].filter((key) => key.startsWith('sizeCode:'))).toEqual(['sizeCode:U'])
    expect(smallest).toBe(2)
    expect(largest).toBe(150)
    expect(index.stats.baseFootprints).toBe(44)
  })

  it('hands every topper with a primitive a base congruent to it, under every preference', () => {
    // The assertion that replaces the "never both" comment on the corpus side:
    // not "the key is the footprint" but the consequence — no base is ever put
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

  it('separates the three ways a base can be missing', () => {
    const gaps = { 'no-matching-base': 0, 'no-congruent-base': 0, 'base-unmatchable': 0 }
    for (const record of toppers) {
      if (matchBase(record, index, 'openlock') !== undefined) continue
      const entry = missingBaseNote(record, index)
      if (entry.code in gaps) gaps[entry.code as keyof typeof gaps] += 1
    }
    // 86 bases the corpus should have and does not; 31 footprints nothing
    // supports; 260 toppers with no key at all. The third was 444 before row W3
    // and 235 after it: giving 403 tiles a footprint halved the population with
    // nothing to match on.
    //
    // Row W4 moved 25 toppers out of `matched` and into the other two causes,
    // and both moves are corrections rather than losses:
    //
    //   +13 no-congruent-base   The `ExG`/`RxG`/`SxG` curved-interface floors.
    //       Their old base match existed **only because a sweep was
    //       fabricated**: `DEFAULT_ARC_SWEEP_DEG` gave the 36 xG bases the key
    //       `arc:2.5@90`, the same key these floors carry, so a floor measuring
    //       2.487 x 2.000 was being matched to a wall base measuring
    //       3.000 x 0.500. De-arcing the bases dissolves the coincidence.
    //   +12 base-unmatchable    The `riser+…,curved+inverted.7x7+6r+{a,b,c}`
    //       toppers. Tagged 7 x 7; W1 measured them at 5 x 2, 1.685 x 1.685 and
    //       2 x 5, so the pair names the design and there is nothing to place.
    //
    // **Row D4 takes `no-matching-base` from 129 to 86 and touches nothing else.**
    // The 43 are the `II`/`IO`/`IX` toppers, and they were never an archive gap
    // at all: 119 congruent `rect:1x1` bases were in the corpus the whole time,
    // and only a code-first join could report a tile as baseless while holding
    // a base that fits it. `no-congruent-base` and `base-unmatchable` are
    // unmoved, because a topper with no primitive and a topper with an
    // unsupportable one are classified by facts the key change does not touch.
    expect(gaps).toEqual({ 'no-matching-base': 86, 'no-congruent-base': 31, 'base-unmatchable': 260 })
  })

  const GAP_CODES = ['no-matching-base', 'no-congruent-base', 'base-unmatchable']

  it('classifies every gap by the step that failed, and by exactly one of them', () => {
    // The substance of D5: the three-way split is not a heuristic over the data,
    // it is a partition of the toppers with no base by *which key was missing*.
    // Asserted as the biconditional rather than as three counts, so it survives
    // a corpus rebuild — row W3 reclassified 403 tiles out of `none` and moved
    // tiles between the second and third buckets without changing the rule.
    let gapped = 0
    for (const record of toppers) {
      if (matchBase(record, index, 'openlock') !== undefined) continue
      // One cause, never two, and never a bare "no base found" — the classifier
      // returns exactly one note and it is always one of the three.
      const gapNotes = [missingBaseNote(record, index)].filter((entry) => GAP_CODES.includes(entry.code))
      gapped += 1
      expect(gapNotes, record.id).toHaveLength(1)
      // The resolver's rule, restated: a code the base range does not answer to
      // is an archive gap whichever key failed, because naming the code is what
      // a report upstream can act on. Below that, the primitive decides.
      const codeUnanswered = record.sizeCode !== undefined && !index.basesBySizeCode.has(record.sizeCode)
      const expected = codeUnanswered
        ? 'no-matching-base'
        : footprintKey(record.foot) !== undefined
          ? 'no-congruent-base'
          : record.sizeCode !== undefined
            ? 'no-matching-base'
            : 'base-unmatchable'
      expect(gapNotes[0]?.code, record.id).toBe(expected)
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
      expect(gapNotes[0]?.tileId, record.id).toBe(record.id)
      // Each cause is `warn`: a piece with nothing under it is not a footnote.
      expect(gapNotes[0]?.severity).toBe('warn')
    }
    expect(gapped).toBeGreaterThan(0)
  })

  it('measures the same gap under every lock preference, and under none', () => {
    // The load-bearing claim of `docs/corpus-base-gap.md`: the gap is a property
    // of the corpus **and of the key**, and never of the ranking. D1 re-ranked
    // base candidates and took the topless rate under openlock from 79.1% to 0
    // without moving one tile of this; D4 changed the key and moved 43 tiles out
    // of it, in every preference identically. If a *ranking* change moves it,
    // that is a bug in the ranking — a candidate set is either empty or it is
    // not, and which member wins cannot decide whether one exists.
    //
    // The split itself is pinned by `separates the three ways a base can be
    // missing` above; what this adds is that all four preferences agree, which no
    // single-preference measurement can show.
    const preferences: (LockSystem | undefined)[] = [undefined, 'openlock', 'dragonlock', 'magnetic']
    const measured = preferences.map((lock) => {
      const gaps = { 'no-matching-base': 0, 'no-congruent-base': 0, 'base-unmatchable': 0 }
      let withBase = 0
      for (const record of toppers) {
        if (matchBase(record, index, lock) !== undefined) {
          withBase += 1
          continue
        }
        const entry = missingBaseNote(record, index)
        if (entry.code in gaps) gaps[entry.code as keyof typeof gaps] += 1
      }
      const total = Object.values(gaps).reduce((sum, count) => sum + count, 0)
      // Every topper is either matched to a base or classified into one of the
      // three gaps — no silent third outcome, which is the failure mode row D5
      // exists to remove.
      expect(withBase + total, `lock: ${lock ?? 'none'}`).toBe(toppers.length)
      return gaps
    })

    for (const gaps of measured) expect(gaps).toEqual(measured[0])
    // The size-code half of the gap is invariant under W3 as well: size codes come
    // from tags, not from footprints, so no reclassification can close it. Row D4
    // does not close it either — it stops *mistaking* 43 of the 129 coded
    // toppers for baseless ones, which is a different thing and leaves 86.
    expect(measured[0]?.['no-matching-base']).toBe(86)
    expect(toppers).toHaveLength(4363)
  })

  it('names the nine size codes the base range is missing', () => {
    // The classification's first cause, enumerated: this is the part of the 594
    // that is an archive gap somebody could close, and the codes are what a
    // report upstream would have to name. `docs/corpus-base-gap.md` lists all
    // 129 tiles behind them.
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

    // 26 codes on the base side against 27 on the topper side — the whole of the
    // gap the *code* can produce. It is no longer the whole of the base gap:
    // after row D4 three of these nine codes are answered by congruence anyway
    // (`II`, `IO`, `IX`, all `rect:1x1`) and six are not, and only the six leave
    // a topper with nothing to sit on.
    expect(index.basesBySizeCode.size).toBe(26)
    expect(new Set(toppers.map((record) => record.sizeCode).filter((code) => code !== undefined)).size).toBe(27)

    const answeredByShape = [...missing.keys()].filter((code) => {
      const shapes = new Set(
        toppers.filter((record) => record.sizeCode === code).map((record) => footprintKey(record.foot)),
      )
      return [...shapes].every((key) => key !== undefined && index.basesByFootprint.has(key))
    })
    expect(answeredByShape.sort()).toEqual(['II', 'IO', 'IX'])
    expect(['L', 'O', 'P', 'PA', 'PB', 'PC'].map((code) => missing.get(code))).toEqual([20, 5, 12, 6, 20, 23])
  })

  it('shows the 31 unsupportable shapes are geometry, not an omission', () => {
    // The classification's second cause. The distinction matters for the copy:
    // 17 of these are half a unit wide and the base range starts at a full unit,
    // so no base can carry them and telling somebody to go and find one would
    // send them after an object that does not exist. Four are a real hole in an
    // otherwise complete range. The remaining 10 are row W5's third kind: a band
    // the corpus holds no base for at all, which only became visible once
    // congruence keyed on the band pair instead of the tagged radius.
    const shapeless = toppers.filter(
      (record) =>
        matchBase(record, index, 'openlock') === undefined &&
        missingBaseNote(record, index).code === 'no-congruent-base',
    )
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

    // Row W5 changed both arc rows here, and the two changes pull opposite ways.
    //
    // The 13 `curved+interface` floors have LEFT this bucket, because they no
    // longer have a footprint to be incongruent about: W1 refused a sector fit on
    // all 27 of them and their tagged width over-states the mesh by 0.300 or
    // 1.513 units, so they are NONE and fall into `base-unmatchable` below. They
    // were never a shape the corpus had bases for — the 36 bases that used to
    // share their key were `AxG`/`BAxG`/`QxG` walls that only matched because
    // `DEFAULT_ARC_SWEEP_DEG` invented a 90-degree sweep for both sides.
    expect(
      shapeless.filter((record) => resolveTags(file, record).includes('shape|option|curved_interface')),
    ).toEqual([])
    expect(index.basesByFootprint.has('arc:2.5-4@90')).toBe(false)
    // They are in `base-unmatchable` instead, which is why it reads 260 above and
    // not 247: 13 toppers moved from "a shape with no congruent base" to "nothing
    // to match on", and the second is the truth about them.

    // And 10 `s2w_radial` toppers have ARRIVED, which is the fourth kind: a shape
    // the corpus has no base for at all, distinguishable only once congruence
    // keys on the band. `[R-1.5, R]` is the radial floor inset by 0.5 for a
    // separately printed wall, and matching it to a `[R-2, R]` base put a base
    // 0.5 units too deep under every one of them.
    const s2w = shapeless.filter((record) => footprintKey(record.foot)?.startsWith('arc:'))
    expect(s2w).toHaveLength(10)
    expect(s2w.every((record) => record.foot.shape === 'arc' && record.foot.band === 's2w_radial')).toBe(true)

    // Every one of the 31 is uncoded, which is what keeps this bucket and the
    // archive-gap bucket apart after row D4: a topper that publishes a code the
    // base range does not answer to is reported by its code, because that is the
    // half somebody can act on.
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
    // The classification's third cause, and the one that is neither an archive
    // gap nor geometry: the topper publishes no key. `foot.shape === 'none'` is
    // the only way `footprintKey` can be absent, and it is the same fact that
    // keeps these off the plan view — so there is nothing to file upstream,
    // because nothing says what shape of base to look for.
    //
    // The count is deliberately *not* pinned here. It was 444 when this row was
    // written and `separates the three ways a base can be missing` above pins
    // that; row W3 reclassified 403 corpus tiles out of `none`, and every tile
    // that gains a footprint leaves this bucket. What cannot change is which
    // bucket a keyless topper lands in.
    const unmatchable = toppers.filter((record) => {
      const resolved = resolvePlacement(place(record.design), index, { lock: 'openlock' })
      return resolved.notes.some((entry) => entry.code === 'base-unmatchable')
    })
    expect(unmatchable.length).toBeGreaterThan(0)
    expect(unmatchable.every((record) => record.foot.shape === 'none')).toBe(true)
    expect(unmatchable.every((record) => record.sizeCode === undefined)).toBe(true)
    expect(unmatchable.every((record) => footprintKey(record.foot) === undefined)).toBe(true)
  })

  /* ------------------------------------------------- the print-option disclosure */

  it('names the print option as its own note, and only when it is not the plain base', () => {
    // §5.3 item 2 of `docs/tile-aggregation.md`: "The bill must name the option:
    // `base-option-chosen` alongside `base-auto-inserted`." One code per
    // decision, so a panel can count and colour the variant without parsing the
    // auto-insert sentence.
    const preferences: (LockSystem | undefined)[] = [undefined, 'openlock', 'dragonlock', 'magnetic']
    const fired = new Map<string, number>()
    for (const lock of preferences) {
      let count = 0
      for (const record of toppers) {
        const resolved = resolvePlacement(place(record.design), index, lock === undefined ? {} : { lock })
        const match = resolved.parts[1]?.match
        const notes = resolved.notes.filter((entry) => entry.code === 'base-option-chosen')
        // The biconditional, on every topper: the note fires exactly when the
        // chosen base is a print variant.
        expect(notes).toHaveLength(match !== undefined && match.option !== 'plain' ? 1 : 0)
        if (notes.length === 1) {
          count += 1
          expect(notes[0]?.message).toContain(String(match?.option))
          expect(notes[0]?.tileId).toBe(resolved.parts[1]?.record.id)
        }
      }
      fired.set(lock ?? 'none', count)
    }
    // Post-D1 the plain base wins unless the lock forces otherwise, so this is
    // near-silent: 3 toppers under magnetic whose only magnetic base is topless.
    // Pre-D1 the same measurement over openlock was 3,179.
    expect(Object.fromEntries(fired)).toEqual({ none: 0, openlock: 0, dragonlock: 0, magnetic: 3 })
  })

  it('says which print and why in the option note', () => {
    const forced = toppers
      .map((topper) => resolvePlacement(place(topper.design), index, { lock: 'magnetic' }))
      .filter((resolved) => resolved.parts[1]?.match?.option === 'topless')
    expect(forced).toHaveLength(3)

    for (const resolved of forced) {
      const message = resolved.notes.find((entry) => entry.code === 'base-option-chosen')?.message ?? ''
      expect(message).toContain('is the topless print of this base')
      expect(message).toContain('no top surface')
      // The cause, and it is the actionable half: a plainer base exists and does
      // not carry magnetic, so the lock preference is what to change.
      expect(message).toContain('every plainer base carrying footprint rect:1.5x3 lacks magnetic')
    }
  })

  it('reaches 87.7% of the code-less toppers, on what is now the primary key', () => {
    const codeless = toppers.filter((record) => record.sizeCode === undefined)
    const matched = codeless.filter((record) => matchBase(record, index, 'openlock') !== undefined)
    // 1,899 of 2,364 before row W3 and 2,108 after it: 209 more code-less toppers
    // had a footprint to key on. Row W4 takes 25 back — 13 `curved+interface`
    // floors whose base match rested on a fabricated sweep, and 12
    // `curved+inverted` riser fragments whose tagged 7 x 7 the mesh contradicts.
    // Both were false pairs, so 2,073 is a more honest 87.7% than the 89.2% it
    // replaces.
    //
    // Row D4 leaves this population **exactly** where it was, which is the point
    // of measuring it here: these toppers have no code, so the primitive was
    // already the only key they ever had. Everything D4 moved is on the coded
    // side.
    expect(codeless).toHaveLength(2364)
    expect(matched).toHaveLength(2073)
  })

  /* --------------------------------------------------------------- md5 dedupe */

  it('collapses a shared-md5 pair to one line while naming both tiles', () => {
    // Both records have to be ones rule 0 leaves alone, or the bill would be
    // deduping files the resolution substituted rather than the pair under test.
    const shared = [...index.byBlob.values()].find(
      (group) => group.length === 2 && group.every((record) => resolvesToItself(record)),
    )
    expect(shared).toBeDefined()
    const [first, second] = shared ?? []
    expect(first?.id).not.toBe(second?.id)
    expect(first?.blob).toBe(second?.blob)

    const bill = buildBillOfTiles([place(first?.design ?? ''), place(second?.design ?? '', 1)], index)

    // One file to download, two copies to print, both tiles named.
    expect(bill.files).toBe(1)
    expect(bill.lines[0]?.quantity).toBe(2)
    expect(bill.lines[0]?.tileIds).toHaveLength(2)
    expect(bill.download.bytes).toBe(first?.bytes)

    // Deduping by id instead would have produced two lines and twice the bytes.
    const byId = new Set([first?.id, second?.id])
    expect(byId.size).toBe(2)
  })

  it('counts a tile placed twice as two copies of one file', () => {
    const tile = byLayer('integral').find((record) => resolvesToItself(record))
    const bill = buildBillOfTiles([place(tile?.design ?? ''), place(tile?.design ?? '', 2)], index)
    expect(bill.files).toBe(1)
    expect(bill.copies).toBe(2)
    expect(bill.download.bytes).toBe(tile?.bytes)
  })

  /* --------------------------------------------------------- filename collisions */

  it('surfaces a filename that two different meshes share', () => {
    const collided = [...index.blobsByFilename.entries()].find(
      ([, blobs]) =>
        blobs.length > 1 &&
        blobs.every((blob) => {
          const record = index.byBlob.get(blob)?.[0]
          return record !== undefined && resolvesToItself(record)
        }),
    )
    expect(collided).toBeDefined()
    const [filename, blobs] = collided ?? ['', []]
    const picks = blobs.map((blob) => index.byBlob.get(blob)?.[0]).filter((record) => record !== undefined)
    expect(picks.length).toBeGreaterThan(1)

    const bill = buildBillOfTiles(
      picks.map((record, i) => place(record.design, i)),
      index,
    )
    const lines = bill.lines.filter((line) => line.filename === filename)
    expect(lines.length).toBe(picks.length)
    for (const line of lines) {
      expect(line.filenameCollides).toBe(true)
      // The disambiguator is the full catalog path, which already exists in the data.
      expect(line.entryName).toBe(line.tile.id)
      expect(line.entryName).toContain(line.filename)
    }
    expect(new Set(lines.map((line) => line.entryName)).size).toBe(lines.length)

    const collision = bill.collisions.find((entry) => entry.filename === filename)
    expect(collision?.blobs.length).toBe(picks.length)
    expect(new Set(collision?.entryNames).size).toBe(picks.length)
  })

  it('leaves a non-colliding filename on its bare name', () => {
    const unique = records.find(
      (record) => (index.blobsByFilename.get(record.file)?.length ?? 0) === 1 && resolvesToItself(record),
    )
    const bill = buildBillOfTiles([place(unique?.design ?? '')], index)
    expect(bill.lines[0]?.filenameCollides).toBe(false)
    expect(bill.lines[0]?.entryName).toBe(unique?.file)
    expect(bill.collisions).toEqual([])
  })

  it('names the three-mesh filename three different ways', () => {
    const threeWay = [...index.blobsByFilename.entries()].find(([, blobs]) => blobs.length === 3)
    expect(threeWay).toBeDefined()
    const [, blobs] = threeWay ?? ['', []]
    const picks = blobs.map((blob) => index.byBlob.get(blob)?.[0]).filter((record) => record !== undefined)
    const bill = buildBillOfTiles(
      picks.map((record, i) => place(record.design, i)),
      index,
    )
    expect(new Set(bill.lines.map((line) => line.entryName)).size).toBe(bill.lines.length)
  })

  /* ------------------------------------------------------------- bill totals */

  it('totals match a brute-force sum over a realistic room', () => {
    const room = realisticRoom(records, 50)
    expect(room).toHaveLength(50)

    const placements = room.map((record, i) => place(record.design, i % 10, Math.floor(i / 10)))
    const bill = buildBillOfTiles(placements, index, { lock: 'openlock' })

    // Brute force, computed a different way: resolve each placement, flatten the
    // parts, then group with a plain Map keyed on md5.
    const parts = placements.flatMap((placement) =>
      resolvePlacement(placement, index, { lock: 'openlock' }).parts.map((part) => part.record),
    )
    const bytesByBlob = new Map<string, number>()
    const copiesByBlob = new Map<string, number>()
    for (const record of parts) {
      bytesByBlob.set(record.blob, record.bytes)
      copiesByBlob.set(record.blob, (copiesByBlob.get(record.blob) ?? 0) + 1)
    }

    expect(bill.placements).toBe(50)
    expect(bill.parts).toBe(parts.length)
    expect(bill.files).toBe(bytesByBlob.size)
    expect(bill.copies).toBe(parts.length)
    expect(bill.download.bytes).toBe([...bytesByBlob.values()].reduce((a, b) => a + b, 0))
    for (const line of bill.lines) {
      expect(line.quantity).toBe(copiesByBlob.get(line.blob))
    }
  })

  it('resolves a realistic room to more parts than placements', () => {
    const room = realisticRoom(records, 50)
    const bill = buildBillOfTiles(
      room.map((record, i) => place(record.design, i)),
      index,
      { lock: 'openlock' },
    )
    const expanded = bill.resolved.filter((entry) => entry.parts.length > 1)

    // 25 of the 50 placements are openforge topper *files*, and before row A6
    // all 25 expanded: 50 placements, 75 parts. Rule 0 now resolves 14 of those
    // 25 items to a variant that carries openlock on its own underside, so only
    // 11 still need a base and the room is **61 parts, not 75**. Fourteen fewer
    // objects on the print bed for the same room, which is the whole of what
    // aggregation buys a user.
    expect(bill.placements).toBe(50)
    expect(bill.parts).toBe(61)
    expect(expanded).toHaveLength(11)
    expect(bill.baseCopies).toBe(11)
    expect(expanded.every((entry) => entry.tile?.layer === 'topper')).toBe(true)
    // Every expansion is a base the user never placed, and every non-expansion
    // is a one-part print rather than a base silently gone missing.
    expect(expanded.every((entry) => entry.resolution?.verdict === 'with-base')).toBe(true)
    expect(
      bill.resolved.filter((entry) => entry.resolution?.verdict === 'self-sufficient'),
    ).toHaveLength(39)

    // And md5 dedupe collapses those 61 copies onto 32 files, against 50 before
    // this row: the integrated variant a topper resolves to is often a file the
    // room already holds for another placement, so substitution deduplicates as
    // well as it shortens.
    expect(bill.copies).toBe(61)
    expect(bill.files).toBe(32)

    // Which takes the download from **547 MB to 361 MB** — a third off, and back
    // under the 512 MB line the same fifty-tile room used to cross. The
    // threshold itself is asserted by `warns before an unshippable download`
    // below and by `downloadSize`'s own tests; what is worth pinning here is
    // that the figure moved and in which direction.
    expect(bill.download.bytes).toBe(360_753_338)
    expect(bill.download.verdict).toBe('ok')
  })

  it('warns before an unshippable download', () => {
    const biggest = [...records].sort((a, b) => b.bytes - a.bytes).slice(0, 60)
    const bill = buildBillOfTiles(
      biggest.map((record, i) => place(record.design, i)),
      index,
      { lock: 'openlock' },
    )
    expect(bill.download.bytes).toBeGreaterThan(DOWNLOAD_LARGE_BYTES)
    expect(bill.download.verdict).not.toBe('ok')
  })

  /* --------------------------------------------------------------- edge cases */

  it('returns an empty bill for an empty scene rather than throwing', () => {
    const bill = buildBillOfTiles([], index)
    expect(bill.lines).toEqual([])
    expect(bill.placements).toBe(0)
    expect(bill.parts).toBe(0)
    expect(bill.files).toBe(0)
    expect(bill.copies).toBe(0)
    expect(bill.baseCopies).toBe(0)
    expect(bill.download).toEqual({ bytes: 0, verdict: 'ok', threshold: DOWNLOAD_LARGE_BYTES })
    expect(bill.notes).toEqual([])
    expect(bill.collisions).toEqual([])
    expect(bill.resolved).toEqual([])
  })

  it('notes an unknown tile instead of throwing or dropping the scene', () => {
    const known = byLayer('integral')[0]
    const bill = buildBillOfTiles([place('d-not-a-design'), place(known?.design ?? '', 1)], index)
    expect(bill.placements).toBe(2)
    expect(bill.files).toBe(1)
    expect(bill.notes.map((entry) => entry.code)).toContain('unknown-tile')
    expect(bill.resolved[0]?.tile).toBeUndefined()
    expect(bill.resolved[0]?.parts).toEqual([])
  })

  it('never refuses a placement — not a shapeless tile, not an insert', () => {
    const shapeless = records.find((record) => record.foot.shape === 'none')
    const insert = byLayer('insert')[0]
    const bill = buildBillOfTiles([place(shapeless?.design ?? ''), place(insert?.design ?? '', 1)], index)
    expect(bill.placements).toBe(2)
    expect(bill.parts).toBeGreaterThanOrEqual(2)
    const codes = bill.notes.map((entry) => entry.code)
    expect(codes).toContain('no-footprint')
    expect(codes).toContain('insert-on-grid')
  })

  it('warns when the whole item cannot offer the preferred lock — and not merely the placed file', () => {
    // Row A6 split this in two, and the split is the row's user-visible point.
    // `lock-unavailable` used to fire on the *file*: place the dragonlock print
    // of an item in an openlock build and it warned, while the openlock print of
    // the same item sat in the archive unused. Now rule 0 hands over that print
    // and there is nothing to warn about.
    const withOpenlock = records.find((record) => {
      if (!record.conn.includes('dragonlock') || record.conn.includes('openlock')) return false
      return resolveVariant(record.design, index, { lock: 'openlock' })?.verdict === 'self-sufficient'
    })
    expect(withOpenlock).toBeDefined()
    const swapped = resolvePlacement(place(withOpenlock?.design ?? ''), index, { lock: 'openlock' })
    // The item holds more than one file and the preference took the openlock one
    // — not the dragonlock-only record the search started from, which is the
    // whole of what used to be reported as a substitution.
    expect(swapped.resolution?.variants).toBeGreaterThan(1)
    expect(swapped.resolution?.resolved).not.toBe(withOpenlock?.id)
    expect(swapped.tile?.conn).toContain('openlock')
    expect(swapped.notes.map((entry) => entry.code)).not.toContain('lock-unavailable')

    // The warning survives for the case it was written for: an item **no**
    // variant of which carries openlock. 214 aggregates under dragonlock and 312
    // under magnetic are in that position, against 1 under openlock.
    const dragonOnly = records.find(
      (record) => resolveVariant(record.design, index, { lock: 'openlock' })?.verdict === 'wrong-system',
    )
    expect(dragonOnly).toBeDefined()
    const resolved = resolvePlacement(place(dragonOnly?.design ?? ''), index, { lock: 'openlock' })
    expect(resolved.notes.map((entry) => entry.code)).toContain('lock-unavailable')
  })

  it('prefers a base that offers the chosen lock over one that matches the texture', () => {
    // Every base in the corpus carries a lock system, so the preference always
    // discriminates. Checked across all three systems rather than just openlock.
    for (const lock of ['openlock', 'dragonlock', 'magnetic'] as const) {
      let disagreed = 0
      for (const topper of toppers) {
        const matched = matchBase(topper, index, lock)
        if (matched === undefined) continue
        if (!matched.match.lockAgrees) {
          disagreed += 1
          // A mismatch is only permitted when no candidate could have agreed.
          const candidates = candidatesOf(topper) ?? []
          expect(candidates.some((candidate) => candidate.conn.includes(lock))).toBe(false)
        }
      }
      // dragonlock has the thinnest base coverage (570 of 1,963), so it is the
      // system where this compromise actually happens.
      expect(disagreed).toBeGreaterThanOrEqual(0)
    }
  })

  /**
   * Row X10's item 2: the double base, reproduced and then bounded.
   *
   * Row S5 flagged that a hand-placed base under a topper still gets an
   * auto-inserted base beside it, and row X9 found the same true of a generated
   * base, structurally — `buildBillOfTiles` never sees the generated map. Both
   * reproduce here, against the real corpus, and the numbers are the reason the
   * insert is **disclosed rather than suppressed**; see
   * `notes.ts#base-already-on-plan`.
   */
  describe("a base already on the topper's cell", () => {
    /** A topper that still receives an auto-inserted base after rule 0. */
    function topperWithAutoBase(lock: LockSystem): { topper: CatalogRecord; base: CatalogRecord } | undefined {
      for (const record of toppers) {
        const resolved = resolvePlacement(place(record.design), index, { lock })
        const inserted = resolved.parts.find((part) => part.role === 'base')
        if (inserted !== undefined && resolved.tile !== undefined) {
          return { topper: resolved.tile, base: inserted.record }
        }
      }
      return undefined
    }

    it('counts how many placed toppers can reach the state at all', () => {
      // Rule 0 substitutes a self-sufficient sibling wherever the item has one,
      // so this is well below the 4,363 toppers in the corpus — and it is the
      // real population, not the 3,986 that `matchBase` alone would suggest.
      let withAuto = 0
      for (const record of toppers) {
        if (resolvePlacement(place(record.design), index, { lock: 'openlock' }).parts.some((p) => p.role === 'base')) {
          withAuto += 1
        }
      }
      expect(withAuto).toBe(2250)
      // And the bases are reachable: the palette does not filter by layer, so a
      // user can search for one and place it.
      expect(bases).toHaveLength(1963)
      expect(index.stats.basesByPrintOption).toEqual({ plain: 1379, unsupported: 206, topless: 378 })
    })

    it('reproduces the double for a hand-placed catalog base, and prices it', () => {
      const found = topperWithAutoBase('openlock')
      expect(found).toBeDefined()
      if (found === undefined) return

      const alone = buildBillOfTiles([place(found.topper.design)], index, { lock: 'openlock' })
      const stacked = buildBillOfTiles([place(found.topper.design), place(found.base.design)], index, { lock: 'openlock' })

      // Two placements, three parts: the topper, the base the user placed, and
      // the base the rule inserted.
      expect(stacked.placements).toBe(2)
      expect(stacked.parts).toBe(3)
      const line = stacked.lines.find((entry) => entry.tile.blob === found.base.blob)
      expect(line?.quantity).toBe(2)
      expect(line?.baseQuantity).toBe(1)

      // **The download is unchanged**, which is the half both earlier reports had
      // wrong: the bill folds by md5, so the second copy is the same file and it
      // is fetched once. What doubles is the print count.
      expect(stacked.download.bytes).toBe(alone.download.bytes)
      expect(stacked.copies).toBe(alone.copies + 1)

      expect(stacked.notes.map((entry) => entry.code)).toContain('base-already-on-plan')
    })

    it('reproduces it for a generated base, through the anchors the builder passes', () => {
      const found = topperWithAutoBase('openlock')
      expect(found).toBeDefined()
      if (found === undefined) return

      const withGenerated = buildBillOfTiles([place(found.topper.design, 2, 3)], index, {
        lock: 'openlock',
        generatedBases: [{ x: 2, z: 3 }],
      })
      expect(withGenerated.notes.map((entry) => entry.code)).toContain('base-already-on-plan')
      // The catalog base is still billed — the note discloses, it does not remove.
      expect(withGenerated.parts).toBe(2)
    })

    it.each([
      ['the base is one unit away', 1, 0],
      ['the base is half a unit away, the finest snap', 0.5, 0],
      ['the base is diagonal to it', 1, 1],
    ])('stays quiet when %s', (_label, dx, dz) => {
      const found = topperWithAutoBase('openlock')
      expect(found).toBeDefined()
      if (found === undefined) return
      const bill = buildBillOfTiles([place(found.topper.design, 0, 0), place(found.base.design, dx, dz)], index, {
        lock: 'openlock',
      })
      expect(bill.notes.map((entry) => entry.code)).not.toContain('base-already-on-plan')
      // The double is still there in this case and the note cannot see it. That
      // is the stated limit of an anchor test rather than a bug in it: a base
      // offset from its topper needs the overlap geometry, which lives above
      // this module and imports it.
      const line = bill.lines.find((entry) => entry.tile.blob === found.base.blob)
      expect(line?.quantity).toBe(2)
    })

    it('stays quiet for a bare base, and for two toppers sharing one cell', () => {
      const found = topperWithAutoBase('openlock')
      expect(found).toBeDefined()
      if (found === undefined) return

      // A base placed as a piece in its own right is the normal case and must not
      // warn: 1,963 bases are placeable and a user may want one bare.
      const bare = buildBillOfTiles([place(found.base.design)], index, { lock: 'openlock' })
      expect(bare.notes.map((entry) => entry.code)).not.toContain('base-already-on-plan')

      // Two toppers on one cell each get their own inserted base, and an inserted
      // base has no anchor, so the note must not fire on the pair.
      const pair = buildBillOfTiles([place(found.topper.design), place(found.topper.design)], index, { lock: 'openlock' })
      expect(pair.parts).toBe(4)
      expect(pair.notes.map((entry) => entry.code)).not.toContain('base-already-on-plan')
    })

    it('measures the pool a suppression rule would have accepted', () => {
      // The reason the insert is not suppressed. If the rule accepted whatever
      // base is under the topper, this is what it would be accepting from.
      const pools: number[] = []
      for (const topper of toppers) {
        if (topper.sizeCode === undefined) continue
        pools.push(bases.filter((entry) => entry.sizeCode === topper.sizeCode).length)
      }
      pools.sort((a, b) => a - b)
      expect(pools).toHaveLength(1999)
      expect(pools[Math.floor(pools.length / 2)]).toBe(79)
      expect(pools[pools.length - 1]).toBe(132)
      // 584 of those 1,963 are a print variant rather than the base itself, and a
      // topless base has no top surface. That is a 29.75% chance of silently
      // accepting a different product — the door row D1 measured at 79.1% and
      // closed from the ranking side. `assemblyIndex.ts` and D1 both round it to
      // 29.7%; the unrounded figure is asserted so a change in either count is
      // caught rather than absorbed by the rounding.
      const variants = index.stats.basesByPrintOption.topless + index.stats.basesByPrintOption.unsupported
      expect(variants).toBe(584)
      expect(variants / index.stats.bases).toBeCloseTo(0.2975, 4)
    })
  })
})

/* -------------------------------------------------- row A6: variant resolution */

/**
 * Rule 0, over the emitted corpus.
 *
 * Every figure here is a measurement of a build artefact, not a constant. The
 * point of asserting them is that a *drift* is a decision somebody has to look
 * at: rule 0 changes which file a user prints, so a silent change in how often
 * it fires is the one regression this row could ship without a symptom.
 */
const a6Corpus = catalog === undefined ? describe.skip : describe

a6Corpus('variant resolution', () => {
  // Safe under `describe.skip`, whose body still evaluates: the same empty
  // stand-in the corpus block above uses.
  const file = catalog ?? ({ records: [], tags: [] } as unknown as CatalogFile)
  const aggregates = corpusAggregates ?? buildAggregateIndex(file)
  const index = buildAssemblyIndex(file, aggregates)
  const records = file.records
  const toppers = records.filter((record) => record.layer === 'topper')

  const verdictsOver = (lock: LockSystem | undefined): Record<string, number> => {
    const tally: Record<string, number> = {}
    for (const aggregate of aggregates.aggregates) {
      const resolution = resolveVariant(aggregate.design, index, lock === undefined ? {} : { lock })
      const verdict = resolution?.verdict ?? 'missing'
      tally[verdict] = (tally[verdict] ?? 0) + 1
    }
    return tally
  }

  it('completes §5.2 — the three verdicts A1 could not reach without a base index', () => {
    // `selectVariant` returns `needs-base` and stops, because `src/catalog` sits
    // below `src/assembly` and cannot see the base index. These are the three it
    // deferred, and they only exist here.
    expect(verdictsOver('openlock')).toEqual({
      'self-sufficient': 1497,
      'with-base': 1878,
      'no-base': 259,
      'wrong-system': 1,
      'unknown-joinery': 93,
      insert: 94,
    })
    expect(verdictsOver('dragonlock')).toEqual({
      'self-sufficient': 359,
      'with-base': 2759,
      mismatched: 2,
      'no-base': 301,
      'wrong-system': 214,
      'unknown-joinery': 93,
      insert: 94,
    })
    expect(verdictsOver('magnetic')).toEqual({
      'self-sufficient': 255,
      'with-base': 2753,
      mismatched: 12,
      'no-base': 303,
      'wrong-system': 312,
      'unknown-joinery': 93,
      insert: 94,
    })
    // Without a preference nothing can be in the wrong system and nothing is
    // unknown — there is nothing to disagree with. The 93 `joineryUntagged`
    // aggregates and the 1 wrong-system one become `self-sufficient`.
    expect(verdictsOver(undefined)).toEqual({
      'self-sufficient': 1591,
      'with-base': 1878,
      'no-base': 259,
      insert: 94,
    })
    for (const lock of [undefined, 'openlock', 'dragonlock', 'magnetic'] as const) {
      const total = Object.values(verdictsOver(lock)).reduce((sum, count) => sum + count, 0)
      expect(total).toBe(aggregates.aggregates.length)
    }
  })

  it('reproduces row A7 buildability by composition rather than by a second implementation', () => {
    // A7 measures buildability with its own probe: tier 1 is
    // `selfSufficientConn.includes(system)` and tier 2 walks the topper variants
    // calling `resolvePlacement` on a synthetic placement to read
    // `BaseMatch.lockAgrees`. This asserts the composed verdict agrees with it
    // exactly — which is what says `resolveVariant` can replace that probe, and
    // is the reason `matchBase` did not need to be exported *for A7*.
    const buildable = (lock: LockSystem): number => {
      const tally = verdictsOver(lock)
      return (tally['self-sufficient'] ?? 0) + (tally['with-base'] ?? 0)
    }
    expect(buildable('openlock')).toBe(3375)
    expect(buildable('dragonlock')).toBe(3118)
    expect(buildable('magnetic')).toBe(3008)

    const total = aggregates.aggregates.length
    const shares = (['openlock', 'dragonlock', 'magnetic'] as const).map((lock) => buildable(lock) / total)
    expect(shares.map((share) => Number((share * 100).toFixed(1)))).toEqual([88.3, 81.6, 78.7])
    // A7's headline: the spread collapses from reachability's 40.2 points to 9.6.
    expect(Number(((Math.max(...shares) - Math.min(...shares)) * 100).toFixed(1))).toBe(9.6)
  })

  it('changes which file a placement resolves to, and measures how often', () => {
    // The row's own measurement, and the one a reviewer should ask for: rule 0 is
    // only worth its complexity if the lock preference actually moves the answer.
    const under = (lock: LockSystem): Map<string, string> =>
      new Map(
        aggregates.aggregates.map((aggregate) => [
          aggregate.design as string,
          resolveVariant(aggregate.design, index, { lock })?.resolved as string,
        ]),
      )
    const openlock = under('openlock')
    const moved = (lock: LockSystem): number =>
      [...under(lock).entries()].filter(([design, id]) => openlock.get(design) !== id).length

    // Against the default preference: dragonlock prints a different file for 37.0%
    // of items, magnetic for 30.5%.
    expect(moved('dragonlock')).toBe(1414)
    expect(moved('magnetic')).toBe(1164)

    // And 1,419 items — 37.1% of all 3,822, 83.2% of the 1,705 that hold more
    // than one file — do not resolve to the same file under all three.
    let differs = 0
    for (const aggregate of aggregates.aggregates) {
      const files = new Set(
        (['openlock', 'dragonlock', 'magnetic'] as const).map(
          (lock) => resolveVariant(aggregate.design, index, { lock })?.resolved,
        ),
      )
      if (files.size > 1) differs += 1
    }
    expect(differs).toBe(1419)
    expect(aggregates.aggregates.filter((aggregate) => aggregate.variants.length > 1)).toHaveLength(1705)
  })

  it('turns 1,808 of the 4,363 topper files into a one-part print under openlock', () => {
    // Rule 1's scope, measured from the other end. This is the number that makes
    // base auto-insertion a *fallback*: placing one of these used to put two
    // objects on the print bed and now puts one.
    const onePart = (lock: LockSystem): number =>
      toppers.filter((record) => resolveVariant(record.design, index, { lock })?.verdict === 'self-sufficient').length
    expect(onePart('openlock')).toBe(1808)
    // Almost entirely an openlock effect, because that is where the archive's
    // integrated variants are: 1,497 aggregates against dragonlock's 359 and
    // magnetic's 255, and a magnetic tile essentially always needs its base.
    expect(onePart('dragonlock')).toBe(8)
    expect(onePart('magnetic')).toBe(0)
  })

  it('shrinks the missing-base gap a user actually meets, without moving the archive gap', () => {
    // Two different claims, and row A6 is where they came apart. The **archive**
    // gap is 86 / 31 / 260 and no lock preference moves it — `measures the same
    // gap under every lock preference` above pins that against `matchBase`.
    // What a user meets is smaller, because a topper whose item has a one-part
    // print in their lock is not a gap for them at all.
    const notesFor = (lock: LockSystem): Record<string, number> => {
      const gaps: Record<string, number> = { 'no-matching-base': 0, 'no-congruent-base': 0, 'base-unmatchable': 0 }
      for (const record of toppers) {
        for (const entry of resolvePlacement(place(record.design), index, { lock }).notes) {
          if (entry.code in gaps) gaps[entry.code] = (gaps[entry.code] ?? 0) + 1
        }
      }
      return gaps
    }
    // 305 warnings instead of 377 under openlock — 72 toppers whose items the
    // app can now build after all.
    expect(notesFor('openlock')).toEqual({
      'no-matching-base': 29,
      'no-congruent-base': 29,
      'base-unmatchable': 247,
    })
    // And essentially none of that relief under magnetic, for the same reason
    // the one-part figure is zero there: the archive has no magnetic integrated
    // variants to substitute in.
    expect(notesFor('magnetic')).toEqual({
      'no-matching-base': 86,
      'no-congruent-base': 31,
      'base-unmatchable': 260,
    })
  })

  it('does not walk the topper pool, because A1 proves it never needs to', () => {
    // The simplification `chooseVariant` rests on. 760 aggregates hold two or
    // more toppers, and `matchBase` hands every one of them the same base —
    // necessarily, because it reads only `foot`, `sizeCode`, `kinds` and
    // `texture` off the topper and A1 measures zero aggregates holding two
    // distinct values of any of the four.
    let multiTopper = 0
    for (const aggregate of aggregates.aggregates) {
      const tops = aggregate.variants.filter((variant) => variant.needsBase)
      if (tops.length < 2) continue
      multiTopper += 1
      const chosen = new Set(
        tops.map((variant) => {
          const record = index.byId.get(variant.id)
          return record === undefined ? 'missing' : (matchBase(record, index, 'openlock')?.base.id ?? 'none')
        }),
      )
      expect(chosen.size, aggregate.design as string).toBe(1)
      // The invariant that makes it a theorem rather than a coincidence.
      const first = tops[0] === undefined ? undefined : index.byId.get(tops[0].id)
      for (const variant of tops) {
        const record = index.byId.get(variant.id)
        expect(record?.foot).toEqual(first?.foot)
        expect(record?.sizeCode).toBe(first?.sizeCode)
      }
    }
    expect(multiTopper).toBe(760)
  })

  it('is idempotent, and never changes anything the card or the canvas shows', () => {
    // **Row V4 makes idempotence structural rather than measured.** Resolution
    // used to take a file and could return a different one, so "resolve the
    // result again" was a real second question and a drifting answer would have
    // moved a saved scene every time it was reopened. Now it takes a design, and
    // a design is not a possible output — so the loop below asserts the property
    // the *record* substitution had, which is the one every consumer relies on:
    // whichever file an item resolves to, everything the card and the canvas
    // read off it is identical.
    let moved = 0
    for (const record of records) {
      const first = resolveVariant(record.design, index, { lock: 'openlock' })
      expect(first).toBeDefined()
      if (first === undefined) continue
      // The design is carried through unchanged, which is what makes a second
      // resolution the same question rather than a new one.
      expect(first.design).toBe(record.design)
      expect(resolveVariant(first.design, index, { lock: 'openlock' })?.resolved).toBe(first.resolved)
      if (first.resolved === record.id) continue
      moved += 1
      // A1's hoisting invariant, asserted through the resolution rather than
      // over the aggregate: this is what lets `ResolvedPlacement.tile` be the
      // resolved record without the canvas or the palette being told, and what
      // lets `builder/canvas/catalog.ts` resolve the same design independently
      // and still draw the same outline.
      const to = index.byId.get(first.resolved)
      expect(to?.name).toBe(record.name)
      expect(to?.foot).toEqual(record.foot)
      expect(to?.sizeCode).toBe(record.sizeCode)
      expect(to?.texture).toBe(record.texture)
      expect(to?.kinds).toEqual(record.kinds)
    }
    // The same 4,880 records A6 measured: files whose item resolves, under
    // openlock, to a sibling rather than to them.
    expect(moved).toBe(4880)
  })

  it('carries the print-option tie, which is reachable and is mostly about bases', () => {
    // `VariantSelection.optionTie` is A1's disclosure for §5.3's failure: two
    // variants tied on every stated criterion, offering **different products**,
    // separated only by file size. It is not vacuous even with `PRINT_OPTIONS`
    // supplied — and 1,597 of the 1,599 openlock cases are `base` records, which
    // a user places directly, so `billView.ts#rowResolutionCopy` says so on the
    // row rather than letting the smaller file win in silence.
    const ties = (lock: LockSystem): { total: number; bases: number } => {
      let total = 0
      let bases = 0
      for (const record of records) {
        if (resolveVariant(record.design, index, { lock })?.optionTie !== true) continue
        total += 1
        if (record.layer === 'base') bases += 1
      }
      return { total, bases }
    }
    expect(ties('openlock')).toEqual({ total: 1599, bases: 1597 })
    expect(ties('dragonlock')).toEqual({ total: 1587, bases: 1585 })
    // Magnetic reaches almost none, because `flex` is on all 1,141 magnetic
    // bases and on none without — so within one item it never discriminates.
    expect(ties('magnetic')).toEqual({ total: 2, bases: 0 })
  })

  it('agrees with resolvePlacement, and needs no placement to be asked', () => {
    // The probe row A7 asked for. Same answer as the full resolution, without
    // fabricating an `x`, a `z` and a `rotation` that nothing reads.
    for (const record of records.slice(0, 400)) {
      const probe = resolveVariant(record.design, index, { lock: 'magnetic' })
      const full = resolvePlacement(place(record.design), index, { lock: 'magnetic' })
      expect(probe).toEqual(full.resolution)
      expect(full.tile?.id).toBe(probe?.resolved)
      // A base is in the part list exactly when the verdict says one was found.
      const hasBase = full.parts.some((part) => part.role === 'base')
      expect(hasBase).toBe(probe?.verdict === 'with-base' || probe?.verdict === 'mismatched')
    }
    expect(resolveVariant(DesignId.parse('d-nothing-here'), index)).toBeUndefined()
    // A `TileId` in the design slot does not resolve either, and the brands make
    // it a compile error rather than a lookup that misses — this is the runtime
    // half of the same claim, for the `unknown` path a share link can produce.
    expect(resolveVariant(records[0]?.id as unknown as DesignId, index)).toBeUndefined()
  })

  it('resolves nothing at all when handed an aggregate layer from another catalog', () => {
    // `buildAssemblyIndex`' optional second argument makes this reachable, and
    // **row V4 changed the answer**. The old degraded path kept the placed file
    // as the resolved file and claimed only the verdicts a lone record can
    // support (`withoutAggregate`, now deleted, with a long note on why it
    // refused to guess `wrong-system` from the flattened `conn` list). A
    // placement names a design now, so there is no placed file to fall back to
    // and no way to reach a record without the aggregate layer: the honest
    // answer is the one an unknown item already gets.
    const foreign = buildAssemblyIndex(file, buildAggregateIndex({ records: [], tags: [] } as unknown as CatalogFile))
    for (const record of records.slice(0, 200)) {
      expect(resolveVariant(record.design, index, { lock: 'openlock' })).toBeDefined()
      expect(resolveVariant(record.design, foreign, { lock: 'openlock' })).toBeUndefined()

      // And through the full resolver: no parts, no resolution, one named note.
      const resolved = resolvePlacement(place(record.design), foreign, { lock: 'openlock' })
      expect(resolved.parts).toEqual([])
      expect(resolved.resolution).toBeUndefined()
      expect(resolved.notes.map((entry) => entry.code)).toEqual(['unknown-tile'])
      expect(resolved.notes[0]?.message).toContain(record.design)
    }
  })
})

/**
 * A room a person might actually build: one texture, one lock system, tiles the
 * plan view can draw.
 *
 * Deterministic — ordered by manifest ordinal, which is append-only, so the
 * selection does not shift when the corpus grows. Toppers and self-sufficient
 * tiles are **interleaved** rather than concatenated: taking toppers first would
 * make every placement expand and turn "more parts than placements" into a
 * tautology, and taking them last would hide the rule entirely.
 */
function realisticRoom(records: readonly CatalogRecord[], size: number): CatalogRecord[] {
  const placeable = records
    .filter((record) => record.texture === 'dungeon_stone')
    .filter((record) => record.conn.includes('openlock'))
    .filter((record) => record.foot.shape === 'rect' || record.foot.shape === 'wall')
    .sort((a, b) => a.ord - b.ord)

  const toppers = placeable.filter((record) => record.layer === 'topper')
  const rest = placeable.filter((record) => record.layer !== 'topper')

  const room: CatalogRecord[] = []
  for (let i = 0; room.length < size && i < Math.max(toppers.length, rest.length); i += 1) {
    const topper = toppers[i]
    const other = rest[i]
    if (topper !== undefined) room.push(topper)
    if (other !== undefined && room.length < size) room.push(other)
  }
  return room
}
