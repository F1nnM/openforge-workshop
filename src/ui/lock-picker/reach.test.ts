/// <reference types="node" />
/**
 * Lock reachability.
 *
 * Two groups, and the split is the point of the file:
 *
 *   1. **The derivation, over a seven-design fixture.** Every figure the picker
 *      shows comes out of the index it was handed, so the assertions here are
 *      about the *rule*, not about the archive. The fixture's numbers are
 *      deliberately nothing like the real corpus's — 7 designs, 71.4 / 57.1 /
 *      42.9 — so if `3,822`, `99.9%`, `74.7%` or `59.7%` ever shows up in a
 *      component test, something is reading a constant.
 *   2. **The real corpus, as a cross-check.** One block, skipped when the
 *      emitted index is absent, asserting that this TypeScript derivation
 *      reproduces `docs/verify-catalog-facts.py` exactly. That script is the
 *      reference implementation and CI runs it; two implementations of one
 *      definition that are never compared will drift, and the position-parsing
 *      bug the plan documents (worth up to 8 percentage points) is precisely the
 *      kind that reproduces plausible-looking wrong numbers.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CatalogFile as CatalogFileSchema } from '@/catalog'

import type { LockReachRecord } from './reach'
import {
  ALL_LOCK_SYSTEMS,
  countLabel,
  deriveLockReach,
  lockLabel,
  lockNote,
  pointsLabel,
  reachOf,
  shareLabel,
} from './reach'

/* ------------------------------------------------------------------ fixture */

/**
 * Seven designs across ten files, one per branch the rule has to handle.
 *
 * | design    | locks offered            | why it is here |
 * | --------- | ------------------------ | -------------- |
 * | `d-all`   | openlock + dragonlock    | two files, one design — the collapse |
 * | `d-open`  | openlock                 | a plain single-system design, and a base |
 * | `d-mag`   | magnetic                 | a base on the other side |
 * | `d-mag2`  | magnetic                 | makes magnetic outrank dragonlock, so ordering is tested |
 * | `d-none`  | *(none)* — `openforge`   | delegates joinery: reachable under **all three** |
 * | `d-empty` | *(no `conn` at all)*     | 4.0% of the corpus; also reachable under all three |
 * | `d-side`  | `side\|openlock`         | a **position** in segment one — must still count as openlock |
 *
 * Reachable, therefore: openlock 5, magnetic 4, dragonlock 3, of 7.
 */
const FIXTURE: readonly LockReachRecord[] = [
  { design: 'd-all', conn: ['openlock'], layer: 'topper' },
  { design: 'd-all', conn: ['dragonlock'], layer: 'topper' },
  { design: 'd-open', conn: ['openlock'], layer: 'base' },
  { design: 'd-mag', conn: ['magnetic'], layer: 'base' },
  { design: 'd-mag2', conn: ['magnetic'], layer: 'base' },
  { design: 'd-none', conn: ['openforge'], layer: 'base' },
  { design: 'd-empty', conn: [], layer: 'integral' },
  { design: 'd-side', conn: ['side|openlock'], layer: 'integral' },
]

/* --------------------------------------------------------------- derivation */

describe('deriveLockReach', () => {
  const reach = deriveLockReach(FIXTURE)

  it('counts designs, not files', () => {
    // Ten records above, seven designs. Counting files would put openlock at 4
    // of 8 and every share on this screen would be wrong.
    expect(reach.totalDesigns).toBe(7)
  })

  it('reaches a design that offers the lock, or offers none at all', () => {
    expect(reachOf(reach, 'openlock')?.designs).toBe(5)
    expect(reachOf(reach, 'magnetic')?.designs).toBe(4)
    expect(reachOf(reach, 'dragonlock')?.designs).toBe(3)
  })

  it('counts a design with no lock system for every option', () => {
    // `d-none` delegates to a base and `d-empty` has no connection tag. Both are
    // printable whatever the user picked, and dropping that clause would
    // understate every system by roughly half on the real corpus.
    const single = deriveLockReach([
      { design: 'd-none', conn: ['openforge'], layer: 'topper' },
      { design: 'd-empty', conn: [], layer: 'topper' },
    ])
    for (const system of ALL_LOCK_SYSTEMS) {
      expect(reachOf(single, system)?.designs).toBe(2)
      expect(reachOf(single, system)?.hidden).toBe(0)
    }
  })

  it('reads a position segment as a position, not as a system', () => {
    // `connection|side|openlock` is openlock mounted on the side. Taking segment
    // one blindly invents a `side` system and hides openlock from the 2,079
    // corpus tiles that use it — a bug worth up to 8 percentage points.
    const positioned = deriveLockReach([{ design: 'd', conn: ['side|openlock'], layer: 'topper' }])
    expect(reachOf(positioned, 'openlock')?.designs).toBe(1)
    expect(reachOf(positioned, 'dragonlock')?.designs).toBe(0)
    expect(reachOf(positioned, 'magnetic')?.designs).toBe(0)
  })

  it('reads a modifier segment as still the same system', () => {
    const modified = deriveLockReach([{ design: 'd', conn: ['openlock|topless'], layer: 'topper' }])
    expect(reachOf(modified, 'openlock')?.designs).toBe(1)
  })

  it('reports the shortfall as well as the reach', () => {
    expect(reachOf(reach, 'openlock')?.hidden).toBe(2)
    expect(reachOf(reach, 'dragonlock')?.hidden).toBe(4)
  })

  it('orders the options by reach, not by declaration', () => {
    // magnetic beats dragonlock in this fixture and loses to it in the real
    // corpus, so an order hard-coded anywhere would be wrong in one of the two.
    expect(reach.entries.map((entry) => entry.system)).toEqual(['openlock', 'magnetic', 'dragonlock'])
  })

  it('breaks a tie by name, so the order is stable across runs', () => {
    const tied = deriveLockReach([
      { design: 'd1', conn: ['dragonlock'], layer: 'topper' },
      { design: 'd2', conn: ['magnetic'], layer: 'topper' },
    ])
    expect(tied.entries.map((entry) => entry.system)).toEqual(['dragonlock', 'magnetic', 'openlock'])
  })

  it('measures the spread between best and worst', () => {
    expect(reach.spreadPoints).toBeCloseTo((100 * (5 - 3)) / 7, 6)
  })

  it('counts the bases each system offers, and the ones offering none', () => {
    // The figure that makes the preference consequential: a base with no lock
    // would be a neutral fallback, and the corpus has none.
    expect(reach.totalBases).toBe(4)
    expect(reach.basesWithoutLock).toBe(1)
    expect(reachOf(reach, 'openlock')?.bases).toBe(1)
    expect(reachOf(reach, 'magnetic')?.bases).toBe(2)
    expect(reachOf(reach, 'dragonlock')?.bases).toBe(0)
  })

  it('ignores a lock system on a non-base when counting bases', () => {
    const toppersOnly = deriveLockReach([{ design: 'd', conn: ['openlock'], layer: 'topper' }])
    expect(toppersOnly.totalBases).toBe(0)
    expect(reachOf(toppersOnly, 'openlock')?.bases).toBe(0)
  })

  it('survives an empty catalog rather than dividing by zero', () => {
    // What a component renders before its stubbed fetch resolves.
    const empty = deriveLockReach([])
    expect(empty.totalDesigns).toBe(0)
    expect(empty.spreadPoints).toBe(0)
    expect(empty.entries).toHaveLength(ALL_LOCK_SYSTEMS.length)
    for (const entry of empty.entries) {
      expect(entry.share).toBe(0)
      expect(Number.isNaN(entry.share)).toBe(false)
    }
  })

  it('ignores connection systems that are not lock systems', () => {
    const other = deriveLockReach([{ design: 'd', conn: ['pegs', 'dual', 'filament'], layer: 'topper' }])
    // No lock offered at all, so the design is reachable under every option —
    // the same treatment as `connection|openforge`.
    for (const system of ALL_LOCK_SYSTEMS) expect(reachOf(other, system)?.designs).toBe(1)
  })
})

/* --------------------------------------------------------------- formatting */

describe('formatting', () => {
  it('rounds a share the way verify-catalog-facts.py does', () => {
    // These three are the plan's own table. A formatter that disagreed in the
    // last digit would make the screen and the document look out of step.
    expect(shareLabel(3817 / 3822)).toBe('99.9%')
    expect(shareLabel(2854 / 3822)).toBe('74.7%')
    expect(shareLabel(2282 / 3822)).toBe('59.7%')
    expect(shareLabel(0)).toBe('0.0%')
  })

  it('never says 100% while anything is out of reach', () => {
    // The one place rounding is not allowed to win. 99.96% is not everything.
    expect(shareLabel(0.9996)).toBe('99.9%')
    expect(shareLabel(3821 / 3822)).toBe('99.9%')
    // Genuinely everything still reads as everything.
    expect(shareLabel(1)).toBe('100.0%')
  })

  it('formats a count with thousands separators', () => {
    expect(countLabel(3817)).toBe('3,817')
    expect(countLabel(0)).toBe('0')
  })

  it('spells the unit on a spread, and matches the plan’s 40.2 pp', () => {
    expect(pointsLabel(100 * (3817 / 3822 - 2282 / 3822))).toBe('40.2 pp')
  })

  it('names each system as its project spells it', () => {
    expect(lockLabel('openlock')).toBe('OpenLOCK')
    expect(lockLabel('dragonlock')).toBe('DragonLock')
    expect(lockLabel('magnetic')).toBe('Magnetic')
  })

  it('has a physical note for every system', () => {
    for (const system of ALL_LOCK_SYSTEMS) expect(lockNote(system).length).toBeGreaterThan(20)
  })
})

/* ------------------------------------------------------------- the real index */

/**
 * The emitted index, if it has been built. Matches the convention in
 * `src/screens/detail/corpus.test.ts`, `src/materials` and `src/assembly`.
 */
const CATALOG_PATH = process.env.OPENFORGE_CATALOG ?? join(process.cwd(), 'public', 'catalog', 'catalog.json')
const corpus = existsSync(CATALOG_PATH)
  ? CatalogFileSchema.parse(JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as unknown)
  : undefined

if (corpus === undefined) {
  process.stderr.write(
    [
      '',
      `  reach.test.ts: no catalog index at ${CATALOG_PATH};`,
      '  skipping the cross-check against verify-catalog-facts.py.',
      '  Build one with: npm run import:catalog',
      '',
      '',
    ].join('\n'),
  )
}

describe.skipIf(corpus === undefined)('agreeing with verify-catalog-facts.py', () => {
  /**
   * The figures `docs/verify-catalog-facts.py` prints and
   * `docs/architecture-plan.md` §2 quotes.
   *
   * These are **assertions about the corpus**, not values the app reads — the app
   * derives its own and never sees this table. They are here so that a change to
   * `deriveLockReach` that quietly disagrees with the Python reference fails,
   * rather than shipping numbers that look plausible. If the fixtures are
   * rescanned and these move, update the plan, the script's output and this
   * table together; that is the point of it being a single visible list.
   */
  const PLAN = {
    designs: 3822,
    bases: 1963,
    reachable: { openlock: 3817, dragonlock: 2854, magnetic: 2282 },
    baseCounts: { openlock: 1168, magnetic: 1141, dragonlock: 570 },
  } as const

  it('reproduces the plan’s reachability table', () => {
    const reach = deriveLockReach(corpus?.records ?? [])
    expect(reach.totalDesigns).toBe(PLAN.designs)
    for (const [system, designs] of Object.entries(PLAN.reachable)) {
      expect(reachOf(reach, system as never)?.designs, system).toBe(designs)
    }
    // 40.2 percentage points — the figure the whole screen exists to show.
    expect(reach.spreadPoints).toBeCloseTo(100 * ((PLAN.reachable.openlock - PLAN.reachable.magnetic) / PLAN.designs), 6)
  })

  it('reproduces the plan’s base counts, including the zero', () => {
    const reach = deriveLockReach(corpus?.records ?? [])
    expect(reach.totalBases).toBe(PLAN.bases)
    // Zero bases carry no lock system, which is why the preference always
    // discriminates. A future import adding one should fail here and be thought
    // about, not slip through.
    expect(reach.basesWithoutLock).toBe(0)
    for (const [system, bases] of Object.entries(PLAN.baseCounts)) {
      expect(reachOf(reach, system as never)?.bases, system).toBe(bases)
    }
  })
})
