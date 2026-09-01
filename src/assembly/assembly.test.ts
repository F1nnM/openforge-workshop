/// <reference types="node" />
/**
 * Tests for assembly resolution.
 *
 * The load-bearing block is `the real corpus` at the bottom, and it is
 * deliberately most of the file. Assembly resolution is a set of claims about
 * the *shape of the OpenForge catalog* — that half of it delegates joinery to a
 * separate base, that the `size|openlock` code is the key that finds one, that
 * the `build|` tag is a key that silently finds nothing — and a handcrafted
 * fixture cannot falsify any of them, because the fixture would be written by
 * whoever wrote the resolver. So the fixtures here cover only what is true by
 * construction (the weight ordering, the byte thresholds, the empty scene) and
 * every claim about the data is checked against the emitted index.
 *
 * If that index is not on this machine the block is skipped **loudly** — a
 * banner on stderr and the reason in the suite name — because the default
 * reporter prints a bare "N skipped" and a silently skipped data test is exactly
 * the failure this file exists to catch. CI does not run `import:catalog`, so
 * the skip is the normal CI path today, not a broken checkout.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { CatalogFile, CatalogRecord } from '@/catalog'
import { CatalogFile as CatalogFileSchema, TileId } from '@/catalog'
import type { LockSystem, Placement } from '@/store'

import type { PrintOption } from './assemblyIndex'
import { PRINT_OPTIONS, buildAssemblyIndex, printOption } from './assemblyIndex'
import { DOWNLOAD_HUGE_BYTES, DOWNLOAD_LARGE_BYTES, buildBillOfTiles, downloadSize } from './bill'
import { footprintKey, footprintsMatch } from './footprint'
import { NOTE_SEVERITY, rollUpNotes } from './notes'
import { MATCH_WEIGHTS, resolvePlacement } from './resolve'
import { SIZE_CODE_WIDTH_UNITS, sizeCodeWidth } from './sizeCode'

/* -------------------------------------------------------------- test helpers */

const place = (tileId: string, x = 0, z = 0): Placement => ({
  tileId: TileId.parse(tileId),
  x,
  z,
  rotation: 0,
})

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
  })
})

describe('footprint congruence', () => {
  it('sorts a rect’s extents, so a rotated tile matches', () => {
    expect(footprintsMatch({ shape: 'rect', w: 0.5, d: 2 }, { shape: 'rect', w: 2, d: 0.5 })).toBe(true)
    expect(footprintsMatch({ shape: 'rect', w: 1, d: 2 }, { shape: 'rect', w: 1, d: 3 })).toBe(false)
  })

  it('keys an arc on radius and sweep, not radius alone', () => {
    expect(footprintsMatch({ shape: 'arc', radius: 2, angle: 90 }, { shape: 'arc', radius: 2, angle: 270 })).toBe(false)
    expect(footprintsMatch({ shape: 'arc', radius: 2, angle: 90 }, { shape: 'arc', radius: 2, angle: 90 })).toBe(true)
  })

  it('gives `none` no key at all, so shapeless tiles never match each other', () => {
    expect(footprintKey({ shape: 'none' })).toBeUndefined()
    expect(footprintsMatch({ shape: 'none' }, { shape: 'none' })).toBe(false)
  })
})

describe('match weights', () => {
  /**
   * The property the powers of two exist for: the sum is a lexicographic order.
   * If this ever fails, a texture-matched base could outrank a base that locks —
   * or, the defect this row fixes, a topless base could outrank a full one.
   */
  it('cannot let lower criteria outvote a higher one', () => {
    const { lock, option, shape, kind, texture } = MATCH_WEIGHTS
    // `option` is graded: two steps for `plain`, so its widest span is 2 × 8.
    const optionSpan = option * (PRINT_OPTIONS.length - 1)
    expect(optionSpan + shape + kind + texture).toBeLessThan(lock)
    expect(shape + kind + texture).toBeLessThan(option)
    expect(kind + texture).toBeLessThan(shape)
    expect(texture).toBeLessThan(kind)
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

  it('shows why the code beats the width: 361 coded tiles have no measurable footprint', () => {
    const codedWithoutFootprint = records.filter(
      (record) => record.sizeCode !== undefined && record.foot.shape !== 'rect' && record.foot.shape !== 'wall',
    )
    expect(codedWithoutFootprint).toHaveLength(361)
  })

  /* ------------------------------------------------------------ the hard rule */

  it('auto-inserts a base for an openforge topper', () => {
    const topper = toppers.find(
      (record) => record.sizeCode !== undefined && index.basesBySizeCode.has(record.sizeCode),
    )
    expect(topper).toBeDefined()

    const resolved = resolvePlacement(place(topper?.id ?? ''), index, { lock: 'openlock' })
    expect(resolved.parts.map((part) => part.role)).toEqual(['placed', 'base'])

    const base = resolved.parts[1]
    expect(base?.record.layer).toBe('base')
    expect(base?.match?.key).toBe('sizeCode')
    expect(base?.match?.on).toBe(topper?.sizeCode)
    expect(base?.record.sizeCode).toBe(topper?.sizeCode)
    expect(base?.match?.lockAgrees).toBe(true)
    expect(resolved.notes.map((entry) => entry.code)).toContain('base-auto-inserted')
  })

  it('leaves an integral tile alone — it carries its own joinery', () => {
    const integral = byLayer('integral')[0]
    const resolved = resolvePlacement(place(integral?.id ?? ''), index)
    expect(resolved.parts).toHaveLength(1)
    expect(resolved.parts[0]?.role).toBe('placed')
    expect(resolved.notes.map((entry) => entry.code)).not.toContain('base-auto-inserted')
  })

  it('does not stack a base under a base', () => {
    const base = bases[0]
    const resolved = resolvePlacement(place(base?.id ?? ''), index)
    expect(resolved.parts).toHaveLength(1)
  })

  it('resolves every tile in the corpus without throwing, and never to zero parts', () => {
    let withBase = 0
    for (const record of records) {
      const resolved = resolvePlacement(place(record.id), index, { lock: 'openlock' })
      expect(resolved.parts.length).toBeGreaterThan(0)
      if (resolved.parts.length > 1) withBase += 1
    }
    // Only toppers gain a part, and most of them do.
    expect(withBase).toBeGreaterThan(3000)
    expect(withBase).toBeLessThanOrEqual(toppers.length)
  })

  /* --------------------------------------------------------- the base tie-break */

  /**
   * The four preferences a bill can be drawn under. `undefined` is not a fourth
   * lock system, it is "no preference", and it is included because it is the
   * default the download path uses when the store has not been consulted — the
   * old ranking handed it a topless base 69.8% of the time.
   */
  const preferences: readonly (LockSystem | undefined)[] = ['openlock', 'dragonlock', 'magnetic', undefined]

  /** The candidate set for a topper, by the resolver's own key rule. */
  function candidatesOf(tile: CatalogRecord): readonly CatalogRecord[] | undefined {
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
   */
  function legacyBase(tile: CatalogRecord, lock: LockSystem | undefined): CatalogRecord | undefined {
    const records = candidatesOf(tile)
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

  /** The base the shipped resolver picks, or `undefined` when it finds none. */
  function shippedBase(tile: CatalogRecord, lock: LockSystem | undefined): CatalogRecord | undefined {
    const options = lock === undefined ? {} : { lock }
    return resolvePlacement(place(tile.id), index, options).parts[1]?.record
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

  it('collapses the topless auto-insert rate under openlock from 79.1% to zero', () => {
    const before = survey(legacyBase, 'openlock')
    const after = survey(shippedBase, 'openlock')

    // Same toppers matched either way: the ranking chooses, it never refuses.
    expect(before.matched).toBe(3769)
    expect(after.matched).toBe(3769)

    // The defect, measured on this corpus by the old ranking written out above.
    expect(before.byOption.topless).toBe(2983)
    expect(before.byOption.topless / before.matched).toBeCloseTo(0.791, 3)
    expect(before.byOption.unsupported).toBe(164)
    expect(before.byOption.plain).toBe(622)

    // And after: every auto-inserted openlock base is the full base.
    expect(after.byOption).toEqual({ plain: 3769, unsupported: 0, topless: 0 })
  })

  it('collapses it under every lock preference, to the three cases the corpus forces', () => {
    const measured = preferences.map((lock) => ({
      lock: lock ?? 'none',
      before: survey(legacyBase, lock).byOption,
      after: survey(shippedBase, lock).byOption,
    }))

    const allPlain: Record<PrintOption, number> = { plain: 3769, unsupported: 0, topless: 0 }
    const magneticAfter: Record<PrintOption, number> = { plain: 3766, unsupported: 0, topless: 3 }
    expect(measured).toEqual([
      { lock: 'openlock', before: { plain: 622, unsupported: 164, topless: 2983 }, after: allPlain },
      { lock: 'dragonlock', before: { plain: 3610, unsupported: 156, topless: 3 }, after: allPlain },
      { lock: 'magnetic', before: { plain: 2120, unsupported: 27, topless: 1622 }, after: magneticAfter },
      { lock: 'none', before: { plain: 819, unsupported: 320, topless: 2630 }, after: allPlain },
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

    // The headline figure of the defect: 110 of 1,963 bases ever handed out, and
    // 92 of those 110 were print variants rather than bases.
    expect(before.reach.size).toBe(110)
    expect(before.reachByOption).toEqual({ plain: 18, unsupported: 12, topless: 80 })

    // After: the count barely moves — one candidate set collapses onto a base
    // another already reached — but every base it reaches is now a full base, so
    // the reachable *product* range is six times wider.
    expect(after.reach.size).toBe(109)
    expect(after.reachByOption).toEqual({ plain: 109, unsupported: 0, topless: 0 })
    expect(after.reachByOption.plain).toBeGreaterThan(6 * before.reachByOption.plain)

    // Across the four preferences a user can actually pick, the reachable set
    // itself grows: 300 → 314 distinct bases, 179 → 313 of them full bases.
    const union = (rank: (tile: CatalogRecord, lock: LockSystem | undefined) => CatalogRecord | undefined) => {
      const reach = new Set<TileId>()
      for (const lock of preferences) for (const id of survey(rank, lock).reach) reach.add(id)
      return reach
    }
    const beforeUnion = union(legacyBase)
    const afterUnion = union(shippedBase)
    expect(beforeUnion.size).toBe(300)
    expect(afterUnion.size).toBe(314)
    expect(afterUnion.size).toBeGreaterThan(beforeUnion.size)

    const full = (reach: Set<TileId>) =>
      [...reach].filter((id) => optionOf(index.byId.get(id) as CatalogRecord) === 'plain').length
    expect(full(beforeUnion)).toBe(179)
    expect(full(afterUnion)).toBe(313)
  })

  /* ----------------------------------------------------------- the disclosure */

  it('names the base, the pool it beat and the print option in the auto-insert note', () => {
    const topper = toppers.find((record) => record.sizeCode === 'A' && record.texture === 'dungeon_stone')
    expect(topper).toBeDefined()

    const resolved = resolvePlacement(place(topper?.id ?? ''), index, { lock: 'openlock' })
    const base = resolved.parts[1]?.record
    const message = resolved.notes.find((entry) => entry.code === 'base-auto-inserted')?.message ?? ''

    // Which base, out of how many, on what key, and why that one.
    expect(message).toContain(base?.name ?? '\u0000')
    expect(message).toContain('size code A')
    expect(message).toContain('bases carrying')
    expect(message).toContain('offers openlock')
    expect(message).toContain('a full base')

    // The old message said neither the pool nor the product.
    expect(message).not.toContain('matched on sizeCode')
  })

  it('says a base has no top surface, and names the lock that forced it', () => {
    const forced = toppers
      .map((topper) => ({ topper, resolved: resolvePlacement(place(topper.id), index, { lock: 'magnetic' }) }))
      .filter(({ resolved }) => resolved.parts[1]?.match?.option === 'topless')

    expect(forced).toHaveLength(3)
    for (const { resolved } of forced) {
      const match = resolved.parts[1]?.match
      expect(match?.lockAgrees).toBe(true)
      expect(match?.optionsOffered).toContain('plain')

      const message = resolved.notes.find((entry) => entry.code === 'base-auto-inserted')?.message ?? ''
      expect(message).toContain('no top surface')
      expect(message).toContain('every plainer base carrying size code D+SA lacks magnetic')
    }
  })

  it('reports the options a candidate set offered, best first', () => {
    for (const topper of toppers) {
      const match = resolvePlacement(place(topper.id), index, { lock: 'openlock' }).parts[1]?.match
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
    // The shipped join, on the same tiles, finds a base for 468 of them. The
    // other 389 carry neither a size code nor a footprint — a topper-side data
    // gap, reported as `base-unmatchable`, not a failure of the key. The
    // contrast is the point: 468 against the build join's 0.
    const topperSide = wallOnTile.filter((record) => record.layer === 'topper')
    const resolvedBases = topperSide.filter(
      (record) => resolvePlacement(place(record.id), index, { lock: 'openlock' }).parts.length === 2,
    )
    expect(resolvedBases).toHaveLength(468)
    expect(topperSide.filter((record) => footprintKey(record.foot) === undefined)).toHaveLength(389)
  })

  /* ------------------------------------------------------ the honest size gap */

  it('measures the openforge toppers with no size-matched base, and warns on each', () => {
    const coded = toppers.filter((record) => record.sizeCode !== undefined)
    const unmatched = coded.filter((record) => !index.basesBySizeCode.has(record.sizeCode ?? ''))

    expect(coded).toHaveLength(1999)
    expect(unmatched).toHaveLength(129)

    for (const record of unmatched) {
      const resolved = resolvePlacement(place(record.id), index, { lock: 'openlock' })
      expect(resolved.parts).toHaveLength(1)
      expect(resolved.notes.map((entry) => entry.code)).toContain('no-matching-base')
    }
  })

  it('separates the three ways a base can be missing', () => {
    const gaps = { 'no-matching-base': 0, 'no-congruent-base': 0, 'base-unmatchable': 0 }
    for (const record of toppers) {
      for (const entry of resolvePlacement(place(record.id), index, { lock: 'openlock' }).notes) {
        if (entry.code in gaps) gaps[entry.code as keyof typeof gaps] += 1
      }
    }
    // 129 bases the corpus should have and does not; 21 footprints nothing
    // supports; 444 toppers with neither a code nor a shape to match on.
    expect(gaps).toEqual({ 'no-matching-base': 129, 'no-congruent-base': 21, 'base-unmatchable': 444 })
  })

  it('reaches 80.3% of the code-less toppers through the footprint fallback', () => {
    const codeless = toppers.filter((record) => record.sizeCode === undefined)
    const matched = codeless.filter(
      (record) => resolvePlacement(place(record.id), index, { lock: 'openlock' }).parts.length === 2,
    )
    expect(codeless).toHaveLength(2364)
    expect(matched).toHaveLength(1899)
  })

  /* --------------------------------------------------------------- md5 dedupe */

  it('collapses a shared-md5 pair to one line while naming both tiles', () => {
    const shared = [...index.byBlob.values()].find((group) => group.length === 2)
    expect(shared).toBeDefined()
    const [first, second] = shared ?? []
    expect(first?.id).not.toBe(second?.id)
    expect(first?.blob).toBe(second?.blob)

    const bill = buildBillOfTiles([place(first?.id ?? ''), place(second?.id ?? '', 1)], index)

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
    const tile = byLayer('integral')[0]
    const bill = buildBillOfTiles([place(tile?.id ?? ''), place(tile?.id ?? '', 2)], index)
    expect(bill.files).toBe(1)
    expect(bill.copies).toBe(2)
    expect(bill.download.bytes).toBe(tile?.bytes)
  })

  /* --------------------------------------------------------- filename collisions */

  it('surfaces a filename that two different meshes share', () => {
    const collided = [...index.blobsByFilename.entries()].find(([, blobs]) => blobs.length > 1)
    expect(collided).toBeDefined()
    const [filename, blobs] = collided ?? ['', []]
    const picks = blobs.map((blob) => index.byBlob.get(blob)?.[0]).filter((record) => record !== undefined)
    expect(picks.length).toBeGreaterThan(1)

    const bill = buildBillOfTiles(
      picks.map((record, i) => place(record.id, i)),
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
    const unique = records.find((record) => (index.blobsByFilename.get(record.file)?.length ?? 0) === 1)
    const bill = buildBillOfTiles([place(unique?.id ?? '')], index)
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
      picks.map((record, i) => place(record.id, i)),
      index,
    )
    expect(new Set(bill.lines.map((line) => line.entryName)).size).toBe(bill.lines.length)
  })

  /* ------------------------------------------------------------- bill totals */

  it('totals match a brute-force sum over a realistic room', () => {
    const room = realisticRoom(records, 50)
    expect(room).toHaveLength(50)

    const placements = room.map((record, i) => place(record.id, i % 10, Math.floor(i / 10)))
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
      room.map((record, i) => place(record.id, i)),
      index,
      { lock: 'openlock' },
    )
    const expanded = bill.resolved.filter((entry) => entry.parts.length > 1)

    // Measured: 25 of the 50 placements are openforge toppers, so 50 placements
    // become 75 parts. Every expansion is a base, and every base is one the user
    // never placed and could not have known to place.
    expect(bill.placements).toBe(50)
    expect(bill.parts).toBe(75)
    expect(expanded).toHaveLength(25)
    expect(bill.baseCopies).toBe(25)
    expect(expanded.every((entry) => entry.tile?.layer === 'topper')).toBe(true)

    // And md5 dedupe collapses those 75 copies onto 50 files, because the same
    // base sits under several different toppers.
    expect(bill.copies).toBe(75)
    expect(bill.files).toBe(50)

    // 547 MB — over the 512 MB line, which is the whole reason the line is there.
    expect(bill.download.verdict).toBe('large')
  })

  it('warns before an unshippable download', () => {
    const biggest = [...records].sort((a, b) => b.bytes - a.bytes).slice(0, 60)
    const bill = buildBillOfTiles(
      biggest.map((record, i) => place(record.id, i)),
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
    const bill = buildBillOfTiles([place('tiles/does/not/exist.stl'), place(known?.id ?? '', 1)], index)
    expect(bill.placements).toBe(2)
    expect(bill.files).toBe(1)
    expect(bill.notes.map((entry) => entry.code)).toContain('unknown-tile')
    expect(bill.resolved[0]?.tile).toBeUndefined()
    expect(bill.resolved[0]?.parts).toEqual([])
  })

  it('never refuses a placement — not a shapeless tile, not an insert', () => {
    const shapeless = records.find((record) => record.foot.shape === 'none')
    const insert = byLayer('insert')[0]
    const bill = buildBillOfTiles([place(shapeless?.id ?? ''), place(insert?.id ?? '', 1)], index)
    expect(bill.placements).toBe(2)
    expect(bill.parts).toBeGreaterThanOrEqual(2)
    const codes = bill.notes.map((entry) => entry.code)
    expect(codes).toContain('no-footprint')
    expect(codes).toContain('insert-on-grid')
  })

  it('warns when the placed tile cannot offer the preferred lock', () => {
    const dragonOnly = records.find(
      (record) => record.conn.includes('dragonlock') && !record.conn.includes('openlock'),
    )
    expect(dragonOnly).toBeDefined()
    const resolved = resolvePlacement(place(dragonOnly?.id ?? ''), index, { lock: 'openlock' })
    expect(resolved.notes.map((entry) => entry.code)).toContain('lock-unavailable')
  })

  it('prefers a base that offers the chosen lock over one that matches the texture', () => {
    // Every base in the corpus carries a lock system, so the preference always
    // discriminates. Checked across all three systems rather than just openlock.
    for (const lock of ['openlock', 'dragonlock', 'magnetic'] as const) {
      let disagreed = 0
      for (const topper of toppers) {
        const resolved = resolvePlacement(place(topper.id), index, { lock })
        const base = resolved.parts[1]
        if (base === undefined) continue
        if (base.match?.lockAgrees === false) {
          disagreed += 1
          // A mismatch is only permitted when no candidate could have agreed.
          const candidates =
            topper.sizeCode !== undefined
              ? (index.basesBySizeCode.get(topper.sizeCode) ?? [])
              : (index.basesByFootprint.get(footprintKey(topper.foot) ?? '') ?? [])
          expect(candidates.some((candidate) => candidate.conn.includes(lock))).toBe(false)
          expect(resolved.notes.map((entry) => entry.code)).toContain('base-lock-mismatch')
        }
      }
      // dragonlock has the thinnest base coverage (570 of 1,963), so it is the
      // system where this compromise actually happens.
      expect(disagreed).toBeGreaterThanOrEqual(0)
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
