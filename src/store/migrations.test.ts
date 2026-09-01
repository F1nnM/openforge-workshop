/**
 * The migration harness.
 *
 * This suite is the deliverable, not a check on one. `migrate()` is the only
 * function in the app whose input is genuinely arbitrary — it reads whatever
 * happens to be under a `localStorage` key — and the failure it guards against
 * is not a wrong answer but a **throw during hydration**, which white-screens
 * the app with the poison still in storage so that every reload reproduces it.
 *
 * Three groups, in order of how much they matter:
 *
 *   1. **Harness completeness.** Bumping `STORE_VERSION` without adding a
 *      migration step or a fixture fails here. That is what makes adding
 *      version 2 a matter of filling in two blanks rather than remembering an
 *      unwritten procedure.
 *   2. **Every prior version migrates to current**, and every version's blob
 *      round-trips through JSON on the way.
 *   3. **Garbage.** Every input below reached this list because it is something
 *      a browser can actually hand back. None may throw; all must produce a
 *      valid state.
 */
import { describe, expect, it } from 'vitest'

import { TileId } from '@/catalog'

import type { MigrationStep } from './migrations'
import { MIGRATION_STEPS, STORE_VERSION, migrateWorkshopState, salvageWorkshopState } from './migrations'
import type { WorkshopState } from './schema'
import {
  DEFAULT_LOCK_SYSTEM,
  PlacementId,
  WorkshopState as WorkshopStateSchema,
  defaultWorkshopState,
} from './schema'

/* -------------------------------------------------------------- test fixtures */

const TILE_A = TileId.parse('tiles/dungeon_stone/floor/2x2/openlock/dungeon_stone%2x2.openlock.stl')
const TILE_B = TileId.parse('tiles/cave/thick_wall/wall/corner/openlock/cave%aggregate+2#corner.IL.openlock.stl')
const PLACEMENT_A = PlacementId.parse('9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f')
const PLACEMENT_B = PlacementId.parse('b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091')

/**
 * One shipped version's persisted payload, and what it must become.
 *
 * **Adding version N:** add an `N:` entry whose `blob` is a scene exactly as
 * version N writes it, update every `expected` to the version N shape, and add
 * the `N:` step to `MIGRATION_STEPS`. The completeness tests below fail until
 * all three exist, and the migration tests then cover (N-1)→N and N→N for free.
 * That is exactly what version 2 did, and the two `expected` shapes below are
 * the receipt: the version 1 blob's `lock: 'dragonlock'` is what makes its
 * `lockChosen` come out `true`.
 */
interface VersionFixture {
  /** A payload byte-for-byte as that version wrote it. */
  readonly blob: unknown
  /** What migrating it to {@link STORE_VERSION} must produce. */
  readonly expected: WorkshopState
}

const SCENE = {
  library: { [TILE_A]: true, [TILE_B]: true },
  placements: {
    [PLACEMENT_A]: { tileId: TILE_A, x: 0, z: 0, rotation: 0 },
    [PLACEMENT_B]: { tileId: TILE_B, x: 2.5, z: -1.5, rotation: 270 },
  },
} as const

const VERSION_FIXTURES: Readonly<Record<number, VersionFixture>> = {
  1: {
    // No `lockChosen`: version 1 had no such field. `lock: 'dragonlock'` is not
    // the default, so version 1 can only have written it through
    // `setLockSystem` — a deliberate change — and the rung infers `true`.
    blob: { ...SCENE, lock: 'dragonlock' },
    expected: WorkshopStateSchema.parse({ ...SCENE, lock: 'dragonlock', lockChosen: true }),
  },
  2: {
    // As version 2 writes it: the flag is explicit, and `false` beside a
    // non-default lock is a shape only version 2 can produce (an import of
    // someone else's exported scene). It must survive, not be re-inferred.
    blob: { ...SCENE, lock: 'magnetic', lockChosen: false },
    expected: WorkshopStateSchema.parse({ ...SCENE, lock: 'magnetic', lockChosen: false }),
  },
}

const shippedVersions = Object.keys(VERSION_FIXTURES)
  .map(Number)
  .sort((a, b) => a - b)

/** Deep clone through JSON, the way `localStorage` round-trips a payload. */
function throughJSON(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

/* --------------------------------------------------------------- completeness */

describe('migration harness', () => {
  it('has a fixture for every version that has ever shipped', () => {
    const expected = Array.from({ length: STORE_VERSION }, (_, index) => index + 1)
    expect(shippedVersions).toEqual(expected)
  })

  it('has a migration step for every version above the first', () => {
    for (let version = 2; version <= STORE_VERSION; version += 1) {
      expect(MIGRATION_STEPS[version], `no migration step produces version ${String(version)}`).toBeTypeOf('function')
    }
  })

  it('declares no step for a version that does not exist yet', () => {
    for (const key of Object.keys(MIGRATION_STEPS).map(Number)) {
      expect(key).toBeLessThanOrEqual(STORE_VERSION)
      expect(key).toBeGreaterThan(1)
    }
  })

  it('recovers rather than propagating a throw from a step', () => {
    // Installed on the ladder for the duration of one test, then removed. This
    // exercises the real catch in `migrateWorkshopState` — the alternative is a
    // production seam that exists only for tests.
    const steps = MIGRATION_STEPS as Record<number, MigrationStep>
    steps[1] = () => {
      throw new Error('boom')
    }
    try {
      const recovered = migrateWorkshopState(VERSION_FIXTURES[1]?.blob, 0)
      expect(recovered.state).toEqual(defaultWorkshopState())
      expect(recovered.dropped.join(' ')).toContain('threw')
    } finally {
      delete steps[1]
    }
    expect(MIGRATION_STEPS[1]).toBeUndefined()
  })
})

/* ----------------------------------------------------------------- migrations */

describe('migrating every prior version to current', () => {
  for (const version of shippedVersions) {
    const fixture = VERSION_FIXTURES[version]
    if (fixture === undefined) throw new Error(`missing fixture for version ${String(version)}`)

    it(`migrates a version ${String(version)} payload`, () => {
      const recovered = migrateWorkshopState(fixture.blob, version)
      expect(recovered.dropped).toEqual([])
      expect(recovered.state).toEqual(fixture.expected)
      expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
    })

    it(`round-trips a version ${String(version)} payload through JSON`, () => {
      const recovered = migrateWorkshopState(throughJSON(fixture.blob), version)
      expect(recovered.state).toEqual(fixture.expected)
    })
  }

  it('treats a payload with no version stamp as pre-versioning and walks the whole ladder', () => {
    const fixture = VERSION_FIXTURES[1]
    expect(migrateWorkshopState(fixture?.blob, undefined).state).toEqual(fixture?.expected)
    expect(migrateWorkshopState(fixture?.blob, 0).state).toEqual(fixture?.expected)
  })

  it('reads a payload from a future version best-effort instead of discarding it', () => {
    // The **current** version's fixture, not version 1's: a future blob climbs
    // no rungs, so it is read exactly as a current-shaped one would be.
    const fixture = VERSION_FIXTURES[STORE_VERSION]
    const recovered = migrateWorkshopState(fixture?.blob, STORE_VERSION + 5)
    // A stale tab or a rolled-back deploy is the common cause, and emptying
    // someone's library over it is worse than showing them a scene that is
    // missing whatever the newer version had added.
    expect(recovered.state).toEqual(fixture?.expected)
    expect(recovered.dropped.join(' ')).toContain('newer than')
  })

  it.each([
    ['a string version', 'one'],
    ['a fractional version', 1.5],
    ['NaN', Number.NaN],
    ['a negative version', -3],
    ['null', null],
  ])('survives %s in the version slot', (_label, version) => {
    const recovered = migrateWorkshopState(VERSION_FIXTURES[1]?.blob, version)
    expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
  })
})

/* ------------------------------------------------------- the 1 -> 2 rung */

/**
 * The rung that added `lockChosen`, tested on its own.
 *
 * Two separate obligations, and the fixture table above only covers the first:
 *
 *   1. **It upgrades a well-formed version 1 blob**, inferring the flag from
 *      `lock` — the fixtures do that.
 *   2. **It tolerates garbage stamped version 1.** A step is reached with
 *      whatever `localStorage` held, and a step that reads `input.lock` off a
 *      `null` throws a `TypeError` that white-screens the app on its own home
 *      page. The rung is called directly here rather than through
 *      `migrateWorkshopState`, because that function catches a throw and would
 *      report the bug as a successful reset.
 */
describe('the lockChosen rung', () => {
  const step = MIGRATION_STEPS[2]

  it('exists', () => {
    expect(step).toBeTypeOf('function')
  })

  it.each([
    ['openlock, which is the default', 'openlock', false],
    ['dragonlock', 'dragonlock', true],
    ['magnetic', 'magnetic', true],
  ])('reads a version 1 lock of %s as chosen=%s', (_label, lock, chosen) => {
    const recovered = migrateWorkshopState({ ...SCENE, lock }, 1)
    expect(recovered.state.lock).toBe(lock)
    expect(recovered.state.lockChosen).toBe(chosen)
    expect(recovered.dropped).toEqual([])
  })

  it.each([
    ['no lock field at all', {}],
    ['an unreadable lock', { lock: 'padlock' }],
    ['a numeric lock', { lock: 3 }],
    ['a null lock', { lock: null }],
  ])('treats a version 1 blob with %s as not yet chosen', (_label, blob) => {
    // Not `true`: an unreadable lock resolves to openlock, and pretending the
    // user picked openlock would hide the choice from someone who never made it.
    expect(migrateWorkshopState(blob, 1).state.lockChosen).toBe(false)
  })

  it('keeps a flag the blob already carries rather than re-inferring it', () => {
    // A preview build on the same origin can write a version 2 shape under a
    // version 1 stamp. Re-inferring would flip an explicit `false` beside a
    // non-default lock to `true`.
    expect(migrateWorkshopState({ lock: 'magnetic', lockChosen: false }, 1).state.lockChosen).toBe(false)
    expect(migrateWorkshopState({ lock: 'openlock', lockChosen: true }, 1).state.lockChosen).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['an array of placements', [{ tileId: TILE_A, x: 0, z: 0, rotation: 0 }]],
    ['a string', 'openforge'],
    ['a number', 42],
    ['a boolean', false],
    ['a wrong-typed flag', { lockChosen: 'yes' }],
    ['a numeric flag', { lockChosen: 1 }],
    ['a function-valued lock', { lock: () => 'magnetic' }],
    ['a prototype payload', JSON.parse('{"__proto__":{"polluted":true},"lock":"magnetic"}') as unknown],
  ])('does not throw on %s, and the result still salvages', (_label, input) => {
    expect(() => step?.(input)).not.toThrow()
    const recovered = salvageWorkshopState(step?.(input))
    expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
    const probe: Record<string, unknown> = {}
    expect(probe.polluted).toBeUndefined()
  })

  it('leaves a non-object blob for the salvage pass rather than inventing one', () => {
    // The rung is not the place to decide what an unreadable blob becomes —
    // `salvageWorkshopState` owns that, and duplicating the decision here is how
    // the two drift apart.
    expect(step?.(null)).toBeNull()
    expect(step?.('nonsense')).toBe('nonsense')
  })
})

/* -------------------------------------------------------------------- garbage */

/**
 * Every entry is something a browser can hand back: a `null` written by a
 * previous library, an object truncated by a tab killed mid-write, a hand edit
 * in devtools, an export format that used an array, a field whose type changed.
 */
const GARBAGE: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['undefined', undefined],
  ['an empty object', {}],
  ['an array where the state belongs', []],
  ['an array of plausible placements', [{ tileId: TILE_A, x: 0, z: 0, rotation: 0 }]],
  ['a string', 'openforge'],
  ['a number', 42],
  ['a boolean', true],
  ['a truncated object', { library: { [TILE_A]: true } }],
  ['an object with only a lock', { lock: 'magnetic' }],
  ['a half-written placement', { placements: { [PLACEMENT_A]: { tileId: TILE_A, x: 1 } } }],
  ['an array where placements belong', { placements: [{ tileId: TILE_A, x: 0, z: 0, rotation: 0 }] }],
  ['an array where the library belongs', { library: [TILE_A] }],
  ['a string where the library belongs', { library: TILE_A }],
  ['a null placement', { placements: { [PLACEMENT_A]: null } }],
  ['a wrong-typed coordinate', { placements: { [PLACEMENT_A]: { tileId: TILE_A, x: '3', z: 0, rotation: 0 } } }],
  ['a NaN coordinate', { placements: { [PLACEMENT_A]: { tileId: TILE_A, x: Number.NaN, z: 0, rotation: 0 } } }],
  [
    'an infinite coordinate',
    { placements: { [PLACEMENT_A]: { tileId: TILE_A, x: Number.POSITIVE_INFINITY, z: 0, rotation: 0 } } },
  ],
  ['a null rotation', { placements: { [PLACEMENT_A]: { tileId: TILE_A, x: 0, z: 0, rotation: null } } }],
  ['a numeric tile id', { placements: { [PLACEMENT_A]: { tileId: 42, x: 0, z: 0, rotation: 0 } } }],
  ['an empty tile id', { placements: { [PLACEMENT_A]: { tileId: '', x: 0, z: 0, rotation: 0 } } }],
  ['an unknown lock system', { lock: 'openlok' }],
  ['a string where the chosen flag belongs', { lockChosen: 'yes' }],
  ['a numeric chosen flag', { lockChosen: 1 }],
  ['a null chosen flag', { lockChosen: null }],
  ['a numeric lock system', { lock: 3 }],
  ['a library value that is not true', { library: { [TILE_A]: 1 } }],
  ['a nested prototype payload', { library: JSON.parse(`{"__proto__":{"polluted":true}}`) as unknown }],
  ['a state-level prototype payload', JSON.parse(`{"__proto__":{"polluted":true},"lock":"magnetic"}`) as unknown],
  ['a very long key', { library: { [`tiles/${'x'.repeat(5000)}`]: true } }],
  ['a function-valued field', { placements: { [PLACEMENT_A]: () => null } }],
]

describe('garbage input', () => {
  it.each(GARBAGE)('salvages %s without throwing', (_label, input) => {
    const recovered = salvageWorkshopState(input)
    expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
  })

  it.each(GARBAGE)('migrates %s without throwing', (_label, input) => {
    for (const version of [0, 1, STORE_VERSION, STORE_VERSION + 1, undefined]) {
      const recovered = migrateWorkshopState(input, version)
      expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
    }
  })

  it('never mutates Object.prototype', () => {
    for (const [, input] of GARBAGE) salvageWorkshopState(input)
    const probe: Record<string, unknown> = {}
    expect(probe.polluted).toBeUndefined()
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
  })

  it('survives a self-referential object', () => {
    const circular: Record<string, unknown> = { lock: 'magnetic' }
    circular.self = circular
    circular.placements = circular
    expect(salvageWorkshopState(circular).state.lock).toBe('magnetic')
  })

  it('falls back to defaults when nothing is readable', () => {
    expect(salvageWorkshopState(null).state).toEqual(defaultWorkshopState())
    expect(salvageWorkshopState('nonsense').state).toEqual(defaultWorkshopState())
    expect(salvageWorkshopState([]).state).toEqual(defaultWorkshopState())
  })
})

/* ------------------------------------------------------------ salvage details */

describe('salvaging keeps what it can', () => {
  it('drops only the corrupt placement, not the whole scene', () => {
    const recovered = salvageWorkshopState({
      library: { [TILE_A]: true },
      placements: {
        [PLACEMENT_A]: { tileId: TILE_A, x: 1, z: 2, rotation: 90 },
        [PLACEMENT_B]: { tileId: TILE_B, x: 'over there', z: 2, rotation: 90 },
      },
      lock: 'magnetic',
    })
    expect(Object.keys(recovered.state.placements)).toEqual([PLACEMENT_A])
    expect(recovered.state.library).toEqual({ [TILE_A]: true })
    expect(recovered.state.lock).toBe('magnetic')
    expect(recovered.dropped).toHaveLength(1)
    expect(recovered.dropped[0]).toContain(PLACEMENT_B)
  })

  it('keeps a placement whose rotation is unreadable, resetting it to zero', () => {
    // Position has no safe default — a fallback of 0 would stack every corrupt
    // tile on the origin — but 0 is a perfectly legal rotation, so a placement
    // is worth keeping when only its angle is lost.
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { tileId: TILE_A, x: 1, z: 2, rotation: 'sideways' } },
    })
    expect(recovered.state.placements[PLACEMENT_A]).toEqual({ tileId: TILE_A, x: 1, z: 2, rotation: 0 })
    expect(recovered.dropped[0]).toContain('rotation')
  })

  it('folds an out-of-range rotation into [0, 360)', () => {
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: { tileId: TILE_A, x: 0, z: 0, rotation: 450 },
        [PLACEMENT_B]: { tileId: TILE_B, x: 0, z: 0, rotation: -90 },
      },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.rotation).toBe(90)
    expect(recovered.state.placements[PLACEMENT_B]?.rotation).toBe(270)
    expect(recovered.dropped).toEqual([])
  })

  it('folds a negative zero coordinate, which does not survive JSON, to positive zero', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { tileId: TILE_A, x: -0, z: -0, rotation: -0 } },
    })
    const placement = recovered.state.placements[PLACEMENT_A]
    expect(Object.is(placement?.x, 0)).toBe(true)
    expect(Object.is(placement?.z, 0)).toBe(true)
    expect(Object.is(placement?.rotation, 0)).toBe(true)
    expect(recovered.dropped).toEqual([])
  })

  it('reads a library entry of false as absence, not as corruption', () => {
    const recovered = salvageWorkshopState({ library: { [TILE_A]: true, [TILE_B]: false } })
    expect(recovered.state.library).toEqual({ [TILE_A]: true })
    expect(recovered.dropped).toEqual([])
  })

  it('resets an unreadable lock system to the default rather than dropping the scene', () => {
    const recovered = salvageWorkshopState({ library: { [TILE_A]: true }, lock: 'padlock' })
    expect(recovered.state.lock).toBe(DEFAULT_LOCK_SYSTEM)
    expect(recovered.state.library).toEqual({ [TILE_A]: true })
    expect(recovered.dropped[0]).toContain('lock')
  })

  it('reads an absent chosen flag as not chosen, silently', () => {
    // Absence is the normal case for every blob written before version 2, so it
    // is not corruption and must not be reported as such.
    const recovered = salvageWorkshopState({ library: { [TILE_A]: true }, lock: 'openlock' })
    expect(recovered.state.lockChosen).toBe(false)
    expect(recovered.dropped).toEqual([])
  })

  it('resets a wrong-typed chosen flag to false and says so', () => {
    const recovered = salvageWorkshopState({ lock: 'magnetic', lockChosen: 'yes' })
    expect(recovered.state.lockChosen).toBe(false)
    expect(recovered.state.lock).toBe('magnetic')
    expect(recovered.dropped[0]).toContain('lockChosen')
  })

  it('refuses keys that are not tile or placement ids', () => {
    const recovered = salvageWorkshopState({
      library: { '': true },
      placements: { '': { tileId: TILE_A, x: 0, z: 0, rotation: 0 } },
    })
    expect(recovered.state.library).toEqual({})
    expect(recovered.state.placements).toEqual({})
    expect(recovered.dropped).toHaveLength(2)
  })

  it('is idempotent, so validating twice on the migrate path reports nothing twice', () => {
    const once = salvageWorkshopState(VERSION_FIXTURES[1]?.blob)
    const twice = salvageWorkshopState(once.state)
    expect(twice.state).toEqual(once.state)
    expect(twice.dropped).toEqual([])
  })
})
