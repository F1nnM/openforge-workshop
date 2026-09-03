/**
 * The reader's harness.
 *
 * This suite is the deliverable, not a check on one. {@link readPersistedState}
 * is the only function in the app whose input is genuinely arbitrary — it reads
 * whatever happens to be under a `localStorage` key — and the failure it guards
 * against is not a wrong answer but a **throw during hydration**, which
 * white-screens the app with the poison still in storage so that every reload
 * reproduces it.
 *
 * Four groups, in order of how much they matter:
 *
 *   1. **The version gate.** Row V1 deleted the migration ladder — see
 *      `migrations.ts` for the owner decision that licensed it — so the first
 *      obligation is that every shape that ever shipped is *discarded*, wholly
 *      and audibly, rather than half-read into the current shape.
 *   2. **The expiry.** The licence to discard is a fact about deployment, and it
 *      will pass silently. One guard here is the closest in-repo proxy for it.
 *   3. **Garbage.** Every input below reached this list because it is something
 *      a browser can actually hand back. None may throw; all must produce a
 *      valid state.
 *   4. **Salvage detail.** What a *current-version* blob keeps and loses, which
 *      is the part of this module the ladder's removal did not touch.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { DesignId, TileId } from '@/catalog'

import { aGeneratedBase } from './fixture'
import { STORE_VERSION, readPersistedState, salvageWorkshopState } from './migrations'
import {
  DEFAULT_LOCK_SYSTEM,
  PlacementId,
  WorkshopState as WorkshopStateSchema,
  defaultWorkshopState,
} from './schema'

/* -------------------------------------------------------------- test fixtures */

const TILE_A = TileId.parse('tiles/dungeon_stone/floor/2x2/openlock/dungeon_stone%2x2.openlock.stl')
const TILE_B = TileId.parse('tiles/cave/thick_wall/wall/corner/openlock/cave%aggregate+2#corner.IL.openlock.stl')

/**
 * Two items, spelled the way `pipeline/design.ts` mints one — `d` plus twelve
 * hex characters, and `d4c2a57740b65` is a real one (the `aztlan col+T` column
 * whose openlock variant owns the sprite sheet). The shape matters: it is what
 * makes a design id and a tile id lexically disjoint, which is the whole basis
 * of `salvageLibrary`'s ability to recognise a file id sitting in the library.
 */
const DESIGN_A = DesignId.parse('d4c2a57740b65')
const DESIGN_B = DesignId.parse('d0f1a2b3c4d5e')

const PLACEMENT_A = PlacementId.parse('9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f')
const PLACEMENT_B = PlacementId.parse('b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091')
const PLACEMENT_C = PlacementId.parse('c3d4e5f6-7081-4923-ab4c-5d6e7f809123')

/** One generated base, through `placeRecipe`. See `fixture.ts`. */
const GENERATED_BASE = aGeneratedBase({ x: 4, z: 0, rotation: 90 })

/** A scene exactly as **this** version writes it: the library and the placements hold designs. */
const SCENE = {
  library: { [DESIGN_A]: true, [DESIGN_B]: true },
  placements: {
    [PLACEMENT_A]: { design: DESIGN_A, x: 0, z: 0, rotation: 0 },
    [PLACEMENT_B]: { design: DESIGN_B, x: 2.5, z: -1.5, rotation: 270 },
  },
  generated: { [PLACEMENT_C]: GENERATED_BASE },
  lock: 'magnetic',
  lockChosen: false,
} as const

/**
 * The placement map as versions 1-4 wrote it: keyed by **file**.
 *
 * Spelled out rather than derived from {@link SCENE}, because it is the shape
 * the reader must refuse and a derivation would go stale the moment `Placement`
 * changes again — which is exactly what happened to the version 1-3 entries when
 * row V4 landed and they silently started carrying designs.
 */
const FILE_PLACEMENTS = {
  [PLACEMENT_A]: { tileId: TILE_A, x: 0, z: 0, rotation: 0 },
  [PLACEMENT_B]: { tileId: TILE_B, x: 2.5, z: -1.5, rotation: 270 },
} as const

/**
 * Every persisted shape that has ever existed, as that version wrote it.
 *
 * **This table used to be the fixture set a migration ladder was verified
 * against, and it is kept for the opposite purpose:** each entry is now a shape
 * the reader must *refuse*, and it is also the record a future rung author will
 * need — `migrations.ts`'s history table says what changed at each step, and
 * these are the blobs.
 *
 * The load-bearing detail is the **identity in every slot**. Versions 1 to 3
 * keyed `library` by {@link TileId} and versions 1 to 4 put one in every
 * placement, so reading either as a version 5 state would produce keys and
 * placements that name no item: they would render nowhere, count towards the
 * header's tally, and be unremovable through any button in the app. The
 * placement case is the worse of the two — a stale library row is one the
 * library screen offers to clear, while a stale placement is a piece of
 * somebody's *room*.
 */
const HISTORICAL_BLOBS: readonly (readonly [version: number, label: string, blob: unknown])[] = [
  [
    1,
    'no lockChosen and no generated',
    {
      library: { [TILE_A]: true, [TILE_B]: true },
      placements: SCENE.placements,
      lock: 'dragonlock',
    },
  ],
  [
    2,
    'lockChosen, still no generated',
    {
      library: { [TILE_A]: true, [TILE_B]: true },
      placements: SCENE.placements,
      lock: 'magnetic',
      lockChosen: false,
    },
  ],
  [
    3,
    'a generated base beside the placements, library still keyed by file',
    {
      library: { [TILE_A]: true, [TILE_B]: true },
      placements: FILE_PLACEMENTS,
      generated: { [PLACEMENT_C]: GENERATED_BASE },
      lock: 'magnetic',
      lockChosen: false,
    },
  ],
  [
    4,
    'library keyed by design, placements still keyed by file (row V1, before V4)',
    {
      library: { [DESIGN_A]: true, [DESIGN_B]: true },
      placements: FILE_PLACEMENTS,
      generated: { [PLACEMENT_C]: GENERATED_BASE },
      lock: 'magnetic',
      lockChosen: false,
    },
  ],
]

/** Deep clone through JSON, the way `localStorage` round-trips a payload. */
function throughJSON(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

/* --------------------------------------------------------------- the version gate */

describe('the version gate', () => {
  it('has a historical blob for every version below the current one', () => {
    // The table is the record a future rung author reads. If a version ships
    // without an entry here, the shape it wrote is undocumented and the ladder
    // that has to climb it one day cannot be written.
    expect(HISTORICAL_BLOBS.map(([version]) => version)).toEqual(
      Array.from({ length: STORE_VERSION - 1 }, (_, index) => index + 1),
    )
  })

  it.each(HISTORICAL_BLOBS)('discards a version %i payload (%s) and says so', (version, _label, blob) => {
    const recovered = readPersistedState(blob, version)

    expect(recovered.state).toEqual(defaultWorkshopState())
    // Audibly: `workshopStore.ts` turns `dropped` into one console warning per
    // hydration, and a discard that said nothing would be indistinguishable
    // from a browser that had never stored anything.
    expect(recovered.dropped).toHaveLength(1)
    expect(recovered.dropped[0]).toContain(`version ${String(version)}`)
    expect(recovered.dropped[0]).toContain('discarded')
  })

  it.each(HISTORICAL_BLOBS)('discards a version %i payload (%s) through JSON too', (version, _label, blob) => {
    expect(readPersistedState(throughJSON(blob), version).state).toEqual(defaultWorkshopState())
  })

  it('does not half-read an old library or an old scene into the new one', () => {
    // The sharpest claim in the file. Every version 1-3 library was a map of
    // *files* and every version 1-4 placement named one, and `DesignId` is
    // `z.string().min(1)` — so a reader that only parsed the values would accept
    // every one of them and hand the app a library and a room of items that do
    // not exist. The gate is what stops that, and `salvageLibrary` /
    // `salvageDesign` are the second line if a hand edit gets past it.
    for (const [version, , blob] of HISTORICAL_BLOBS) {
      const recovered = readPersistedState(blob, version).state
      expect(recovered.library).toEqual({})
      expect(recovered.placements).toEqual({})
    }
    expect(salvageWorkshopState({ library: { [TILE_A]: true } }).state.library).toEqual({})
    expect(salvageWorkshopState({ placements: FILE_PLACEMENTS }).state.placements).toEqual({})
    // And it names the shape it met, per entry. Three shapes are reachable and
    // they get three sentences: the historical field name (this), a file id
    // under the *new* field name (a hand edit that renamed the key and not the
    // value), and a `gen:` recipe key (a generated base in the catalog map).
    expect(salvageWorkshopState({ placements: FILE_PLACEMENTS }).dropped).toEqual([
      `placements.${PLACEMENT_A}: names a file in the old tileId field — a placement holds an item now`,
      `placements.${PLACEMENT_B}: names a file in the old tileId field — a placement holds an item now`,
    ])
    expect(
      salvageWorkshopState({ placements: { [PLACEMENT_A]: { design: TILE_A, x: 0, z: 0, rotation: 0 } } }).dropped,
    ).toEqual([`placements.${PLACEMENT_A}: design is a file id, not a design id — a placement holds an item now`])
    expect(
      salvageWorkshopState({
        placements: { [PLACEMENT_A]: { design: 'gen:base-square', x: 0, z: 0, rotation: 0 } },
      }).dropped,
    ).toEqual([
      `placements.${PLACEMENT_A}: design is a generated base id, which belongs in the generated map`,
    ])
  })

  it('reads a payload stamped with the current version', () => {
    const recovered = readPersistedState(SCENE, STORE_VERSION)
    expect(recovered.dropped).toEqual([])
    expect(recovered.state).toEqual(WorkshopStateSchema.parse(SCENE))
  })

  it('round-trips the current shape through JSON', () => {
    expect(readPersistedState(throughJSON(SCENE), STORE_VERSION).state).toEqual(WorkshopStateSchema.parse(SCENE))
  })

  it.each([
    ['a future version', STORE_VERSION + 5],
    ['no version stamp at all', undefined],
    ['zero', 0],
    ['a string version', 'one'],
    ['a fractional version', 1.5],
    ['NaN', Number.NaN],
    ['a negative version', -3],
    ['null', null],
    ['a version-shaped object', { version: STORE_VERSION }],
    ['a stringified current version', String(STORE_VERSION)],
  ])('discards %s rather than guessing', (_label, version) => {
    // Symmetric on purpose: a gate with a direction has a wrong side, and the
    // wrong side of a shape mismatch is a screen full of items that resolve to
    // nothing. The previous reader read a *newer* blob best-effort, which was
    // right while the shared fields were stable and is not right across the
    // change row V1 made to `library`.
    const recovered = readPersistedState(SCENE, version)
    expect(recovered.state).toEqual(defaultWorkshopState())
    expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
    expect(recovered.dropped).toHaveLength(1)
  })

  it('reports the version it found, whatever it was', () => {
    // The message is the only thing the user or a bug report will ever see, so
    // it has to distinguish "written by an older build" from "unreadable".
    expect(readPersistedState(SCENE, 3).dropped[0]).toContain('version 3')
    expect(readPersistedState(SCENE, 'one').dropped[0]).toContain('"one"')
    expect(readPersistedState(SCENE, undefined).dropped[0]).toContain('undefined')
  })
})

/* ------------------------------------------------------------------ the expiry */

/**
 * The licence to discard, and the guard that makes its expiry arrive.
 *
 * `migrations.ts` says plainly when discarding stops being allowed: **the moment
 * a build is served to a user who is not a developer.** That is a fact about
 * deployment and nothing in the process can observe it, so this guard uses the
 * closest in-repo proxy — a pre-1.0 version number — and its failure message,
 * not its assertion, is the deliverable.
 *
 * **What makes it capable of failing:** it reads `package.json` off disk and
 * asserts the major version is 0. Editing `"version": "0.1.0"` to `"1.0.0"`
 * turns it red, which was checked rather than assumed. What it cannot prove is
 * the thing it stands in for: a deploy from a 0.x tree is entirely possible, and
 * this test would pass through it. It is a reminder with teeth, not a gate.
 */
describe('the licence to discard persisted state', () => {
  it('is still valid, because this repo has not called itself 1.0.0', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: unknown; private?: unknown }
    expect(typeof manifest.version).toBe('string')
    const major = Number.parseInt(String(manifest.version).split('.')[0] ?? '', 10)

    expect(
      major,
      'package.json has left 0.x, which means this is about to ship or has shipped. ' +
        'Discarding a user\'s saved library and room is no longer allowed: read the ' +
        '"When this licence expires" section of src/store/migrations.ts and write a ' +
        'migration rung before bumping STORE_VERSION again.',
    ).toBe(0)
  })

  it('is recorded where the code that relies on it lives', () => {
    // Not a spelling check on a docblock: the expiry cannot be enforced, so the
    // sentence *is* the mechanism, and a refactor that dropped it would leave
    // the next author with a discard and no idea it was conditional. Asserted on
    // the source text because there is nowhere else for it to be.
    const source = readFileSync('src/store/migrations.ts', 'utf8')
    expect(source).toContain('When this licence expires')
    expect(source).toContain('served to a user who is not a developer')
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
  ['an array of plausible placements', [{ design: DESIGN_A, x: 0, z: 0, rotation: 0 }]],
  ['a string', 'openforge'],
  ['a number', 42],
  ['a boolean', true],
  ['a truncated object', { library: { [DESIGN_A]: true } }],
  ['an object with only a lock', { lock: 'magnetic' }],
  ['a half-written placement', { placements: { [PLACEMENT_A]: { design: DESIGN_A, x: 1 } } }],
  ['an array where placements belong', { placements: [{ design: DESIGN_A, x: 0, z: 0, rotation: 0 }] }],
  ['an array where the library belongs', { library: [DESIGN_A] }],
  ['a string where the library belongs', { library: DESIGN_A }],
  ['a null placement', { placements: { [PLACEMENT_A]: null } }],
  ['a wrong-typed coordinate', { placements: { [PLACEMENT_A]: { design: DESIGN_A, x: '3', z: 0, rotation: 0 } } }],
  ['a NaN coordinate', { placements: { [PLACEMENT_A]: { design: DESIGN_A, x: Number.NaN, z: 0, rotation: 0 } } }],
  [
    'an infinite coordinate',
    { placements: { [PLACEMENT_A]: { design: DESIGN_A, x: Number.POSITIVE_INFINITY, z: 0, rotation: 0 } } },
  ],
  ['a null rotation', { placements: { [PLACEMENT_A]: { design: DESIGN_A, x: 0, z: 0, rotation: null } } }],
  ['a numeric design id', { placements: { [PLACEMENT_A]: { design: 42, x: 0, z: 0, rotation: 0 } } }],
  ['an empty design id', { placements: { [PLACEMENT_A]: { design: '', x: 0, z: 0, rotation: 0 } } }],
  // The shape every version 1-4 blob wrote, and the shape a hand edit still
  // produces. `DesignId` is `min(1)` and would accept it, so this is the
  // recognition `salvageDesign` adds.
  ['a file id where the design goes', { placements: { [PLACEMENT_A]: { design: TILE_A, x: 0, z: 0, rotation: 0 } } }],
  ['the old field name', { placements: { [PLACEMENT_A]: { tileId: TILE_A, x: 0, z: 0, rotation: 0 } } }],
  ['an unknown lock system', { lock: 'openlok' }],
  ['a string where the chosen flag belongs', { lockChosen: 'yes' }],
  ['a numeric chosen flag', { lockChosen: 1 }],
  ['a null chosen flag', { lockChosen: null }],
  ['a numeric lock system', { lock: 3 }],
  ['a library value that is not true', { library: { [DESIGN_A]: 1 } }],
  ['a library keyed by file, which is what every version 1-3 blob held', { library: { [TILE_A]: true } }],
  ['a nested prototype payload', { library: JSON.parse(`{"__proto__":{"polluted":true}}`) as unknown }],
  ['a state-level prototype payload', JSON.parse(`{"__proto__":{"polluted":true},"lock":"magnetic"}`) as unknown],
  ['a very long key', { library: { [`d${'f'.repeat(5000)}`]: true } }],
  ['a function-valued field', { placements: { [PLACEMENT_A]: () => null } }],
]

describe('garbage input', () => {
  it.each(GARBAGE)('salvages %s without throwing', (_label, input) => {
    const recovered = salvageWorkshopState(input)
    expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
  })

  it.each(GARBAGE)('reads %s without throwing, at every version stamp', (_label, input) => {
    for (const version of [0, 1, 3, STORE_VERSION, STORE_VERSION + 1, undefined, 'four']) {
      const recovered = readPersistedState(input, version)
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
      library: { [DESIGN_A]: true },
      placements: {
        [PLACEMENT_A]: { design: DESIGN_A, x: 1, z: 2, rotation: 90 },
        [PLACEMENT_B]: { design: DESIGN_B, x: 'over there', z: 2, rotation: 90 },
      },
      lock: 'magnetic',
    })
    expect(Object.keys(recovered.state.placements)).toEqual([PLACEMENT_A])
    expect(recovered.state.library).toEqual({ [DESIGN_A]: true })
    expect(recovered.state.lock).toBe('magnetic')
    expect(recovered.dropped).toHaveLength(1)
    expect(recovered.dropped[0]).toContain(PLACEMENT_B)
  })

  it('keeps a placement whose rotation is unreadable, resetting it to zero', () => {
    // Position has no safe default — a fallback of 0 would stack every corrupt
    // tile on the origin — but 0 is a perfectly legal rotation, so a placement
    // is worth keeping when only its angle is lost.
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { design: DESIGN_A, x: 1, z: 2, rotation: 'sideways' } },
    })
    expect(recovered.state.placements[PLACEMENT_A]).toEqual({ design: DESIGN_A, x: 1, z: 2, rotation: 0 })
    expect(recovered.dropped[0]).toContain('rotation')
  })

  it('folds an out-of-range rotation into [0, 360)', () => {
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: { design: DESIGN_A, x: 0, z: 0, rotation: 450 },
        [PLACEMENT_B]: { design: DESIGN_B, x: 0, z: 0, rotation: -90 },
      },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.rotation).toBe(90)
    expect(recovered.state.placements[PLACEMENT_B]?.rotation).toBe(270)
    expect(recovered.dropped).toEqual([])
  })

  it('folds a negative zero coordinate, which does not survive JSON, to positive zero', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { design: DESIGN_A, x: -0, z: -0, rotation: -0 } },
    })
    const placement = recovered.state.placements[PLACEMENT_A]
    expect(Object.is(placement?.x, 0)).toBe(true)
    expect(Object.is(placement?.z, 0)).toBe(true)
    expect(Object.is(placement?.rotation, 0)).toBe(true)
    expect(recovered.dropped).toEqual([])
  })

  it('reads a library entry of false as absence, not as corruption', () => {
    const recovered = salvageWorkshopState({ library: { [DESIGN_A]: true, [DESIGN_B]: false } })
    expect(recovered.state.library).toEqual({ [DESIGN_A]: true })
    expect(recovered.dropped).toEqual([])
  })

  it('resets an unreadable lock system to the default rather than dropping the scene', () => {
    const recovered = salvageWorkshopState({ library: { [DESIGN_A]: true }, lock: 'padlock' })
    expect(recovered.state.lock).toBe(DEFAULT_LOCK_SYSTEM)
    expect(recovered.state.library).toEqual({ [DESIGN_A]: true })
    expect(recovered.dropped[0]).toContain('lock')
  })

  it('reads an absent chosen flag as not chosen, silently', () => {
    // Absence is the normal case for every blob written before version 2, so it
    // is not corruption and must not be reported as such.
    const recovered = salvageWorkshopState({ library: { [DESIGN_A]: true }, lock: 'openlock' })
    expect(recovered.state.lockChosen).toBe(false)
    expect(recovered.dropped).toEqual([])
  })

  it('resets a wrong-typed chosen flag to false and says so', () => {
    const recovered = salvageWorkshopState({ lock: 'magnetic', lockChosen: 'yes' })
    expect(recovered.state.lockChosen).toBe(false)
    expect(recovered.state.lock).toBe('magnetic')
    expect(recovered.dropped[0]).toContain('lockChosen')
  })

  it('refuses keys that are not design or placement ids', () => {
    const recovered = salvageWorkshopState({
      library: { '': true },
      placements: { '': { design: DESIGN_A, x: 0, z: 0, rotation: 0 } },
    })
    expect(recovered.state.library).toEqual({})
    expect(recovered.state.placements).toEqual({})
    expect(recovered.dropped).toHaveLength(2)
  })

  it('names a file id in the library rather than keeping it or dropping it silently', () => {
    // The one corruption row V1 made possible, and the reason `salvageLibrary`
    // checks `TileId` before `DesignId` rather than after: a catalog path passes
    // `DesignId`'s `min(1)`, so parse order is the whole defence. Keeping it
    // would put an unremovable phantom in the library; dropping it without a
    // word would be the same loss with no message.
    const recovered = salvageWorkshopState({
      library: { [DESIGN_A]: true, [TILE_A]: true, [TILE_B]: true },
    })
    expect(recovered.state.library).toEqual({ [DESIGN_A]: true })
    expect(recovered.dropped).toHaveLength(2)
    expect(recovered.dropped[0]).toContain('a file id, not a design id')
  })

  it('is idempotent, so validating twice on the read path reports nothing twice', () => {
    const once = salvageWorkshopState(SCENE)
    const twice = salvageWorkshopState(once.state)
    expect(twice.state).toEqual(once.state)
    expect(twice.dropped).toEqual([])
  })
})
