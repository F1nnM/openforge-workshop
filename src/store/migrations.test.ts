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
 *      `migrations.ts` for the owner decision that licensed it, and for why row
 *      A1's 5 → 6 rung would have to *fabricate* rather than convert — so the
 *      obligation is that every shape that never reached a user is *discarded*,
 *      wholly and audibly, rather than half-read into the current shape, and
 *      that the one shape which **did** reach a user is climbed instead.
 *   2. **The expiry, which has happened.** The licence to discard was a fact
 *      about deployment and the deployment exists, so the guard here is no
 *      longer a reminder but a mechanism: this build must read both the version
 *      it writes and the one below it, and neither claim can be satisfied by a
 *      readable set that follows the stamp around.
 *   3. **Garbage.** Every input below reached this list because it is something
 *      a browser can actually hand back. None may throw; all must produce a
 *      valid state.
 *   4. **Salvage detail.** What a *current-version* blob keeps and loses, which
 *      is the part of this module the ladder's removal did not touch — and which
 *      row A1 extended one level down, into a placement's `fills`, and this row
 *      one level further, into a fill's `holds`.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ANOTHER_TILE, A_TEMPLATE, A_TILE, aGeneratedBase } from './fixture'
import { READABLE_VERSIONS, STORE_VERSION, readPersistedState, salvageWorkshopState } from './migrations'
import {
  DEFAULT_LOCK_SYSTEM,
  HoldName,
  PlacementId,
  SlotName,
  WorkshopState as WorkshopStateSchema,
  defaultWorkshopState,
} from './schema'

/* -------------------------------------------------------------- test fixtures */

const TILE_A = A_TILE
const TILE_B = ANOTHER_TILE

/**
 * Two items, spelled the way `pipeline/design.ts` mints one — `d` plus twelve
 * hex characters, and `d4c2a57740b65` is a real one (the `aztlan col+T` column
 * whose openlock variant owns the sprite sheet).
 *
 * These are no longer an identity this store holds; they are the identity
 * **version 5 held**, kept as strings so the reader can be shown refusing them.
 * They are deliberately not `DesignId.parse`d: nothing in `schema.ts` imports
 * `DesignId` any more, and a fixture that reached for the brand would suggest
 * the store still has a use for it.
 */
const DESIGN_A = 'd4c2a57740b65'
const DESIGN_B = 'd0f1a2b3c4d5e'

const PLACEMENT_A = PlacementId.parse('9f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f')
const PLACEMENT_B = PlacementId.parse('b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091')
const PLACEMENT_C = PlacementId.parse('c3d4e5f6-7081-4923-ab4c-5d6e7f809123')

const FLOOR = SlotName.parse('floor')
const WALL = SlotName.parse('right wall')

/** One hold of the wall's file — the socket an accessory goes into. */
const TORCH = HoldName.parse('torch')

/** One generated base, through `placeRecipe`. See `fixture.ts`. */
const GENERATED_BASE = aGeneratedBase({ x: 4, z: 0, rotation: 90 })

/**
 * A scene exactly as **this** version writes it: two template instances, one
 * fully filled and one with a slot still open.
 *
 * The open slot is not an edge case dressed up as a fixture — §3.2 places a
 * template with a slot nothing can fill, so a "normal" scene has them, and a
 * fixture that was always complete would let the reader's handling of an absent
 * fill go untested on the main path.
 *
 * **All three hold states are in it**, because they are three and not two: the
 * wall carries one hold, the floor of the second instance is *solved and empty*
 * (`{}`), and every other fill was *never solved* (no key at all). A fixture
 * carrying only the first would let the reader collapse the other two — which is
 * the one mistake that survives a round trip looking like success.
 */
const SCENE = {
  placements: {
    [PLACEMENT_A]: {
      id: PLACEMENT_A,
      template: A_TEMPLATE,
      x: 0,
      z: 0,
      rotation: 0,
      fills: {
        [FLOOR]: { tile: TILE_A, pinned: false },
        [WALL]: { tile: TILE_B, pinned: true, holds: { [TORCH]: { tile: TILE_A, pinned: true } } },
      },
      filters: ['component|door|arched', 'size|width|2', 'size|depth|2'],
    },
    [PLACEMENT_B]: {
      id: PLACEMENT_B,
      template: A_TEMPLATE,
      x: 2.5,
      z: -1.5,
      rotation: 270,
      fills: { [FLOOR]: { tile: TILE_A, pinned: false, holds: {} } },
      /* `[]` is *any* on every axis — a real choice, and the one every instance
         placed before the field existed was in. */
      filters: [],
    },
  },
  generated: { [PLACEMENT_C]: GENERATED_BASE },
  lock: 'magnetic',
  lockChosen: false,
} as const

/**
 * {@link SCENE} as an older version wrote it: with `filters`, with `holds`, or
 * with neither.
 *
 * One helper for both fields rather than two composed ones, because they sit at
 * different depths — `filters` on the instance and `holds` inside each fill — and
 * a composition would have to agree about the type of the half-stripped shape in
 * between. It works on a JSON clone so no fixture is mutated, which is the same
 * round trip `localStorage` performs anyway.
 */
function asWrittenWithout(fields: { readonly filters?: true; readonly holds?: true }): Record<string, unknown> {
  const clone = throughJSON(SCENE) as { placements: Record<string, Record<string, unknown>> }
  for (const instance of Object.values(clone.placements)) {
    if (fields.filters === true) delete instance.filters
    if (fields.holds !== true) continue
    for (const fill of Object.values(instance.fills as Record<string, Record<string, unknown>>)) {
      delete fill.holds
    }
  }
  return clone
}

/**
 * The placement map as versions 1–4 wrote it: keyed by **file**.
 *
 * Spelled out rather than derived from {@link SCENE}, because it is a shape the
 * reader must refuse and a derivation would go stale the moment a placement
 * changes again — which is exactly what happened to the version 1–3 entries when
 * row V4 landed and they silently started carrying designs.
 */
const FILE_PLACEMENTS = {
  [PLACEMENT_A]: { tileId: TILE_A, x: 0, z: 0, rotation: 0 },
  [PLACEMENT_B]: { tileId: TILE_B, x: 2.5, z: -1.5, rotation: 270 },
} as const

/** The placement map as version 5 wrote it: keyed by **design**. */
const DESIGN_PLACEMENTS = {
  [PLACEMENT_A]: { design: DESIGN_A, x: 0, z: 0, rotation: 0 },
  [PLACEMENT_B]: { design: DESIGN_B, x: 2.5, z: -1.5, rotation: 270 },
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
 * keyed `library` by file, versions 1 to 4 put a file in every placement,
 * version 5 put a design there, and none of the five has a template or a fill
 * anywhere. Reading any of them as a version 6 state would produce a room of
 * pieces that name nothing: they would render nowhere, count towards the
 * header's tally, and be unremovable through any button in the app.
 */
const HISTORICAL_BLOBS: readonly (readonly [version: number, label: string, blob: unknown])[] = [
  [
    1,
    'no lockChosen and no generated',
    {
      library: { [TILE_A]: true, [TILE_B]: true },
      placements: FILE_PLACEMENTS,
      lock: 'dragonlock',
    },
  ],
  [
    2,
    'lockChosen, still no generated',
    {
      library: { [TILE_A]: true, [TILE_B]: true },
      placements: FILE_PLACEMENTS,
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
  [
    5,
    'a placement holds one design on one cell, and there is still a library (row V4, before A1)',
    {
      library: { [DESIGN_A]: true, [DESIGN_B]: true },
      placements: DESIGN_PLACEMENTS,
      generated: { [PLACEMENT_C]: GENERATED_BASE },
      lock: 'magnetic',
      lockChosen: false,
    },
  ],
  [
    6,
    'template instances with fills, and no room design (row A1, before D6)',
    /* The **current** scene minus `design`, which is exactly what makes this
       version the interesting one in the table: it is the first historical blob
       whose placements the current reader could in fact read, so the gate is the
       *only* thing discarding it. Every earlier entry is refused twice over,
       once by the stamp and again by `salvageTemplate`. `migrations.ts` states
       why an additive field bumps the stamp anyway — one version number must
       name one shape — and this entry is what makes the claim testable. */
    { ...asWrittenWithout({ filters: true, holds: true }), design: undefined },
  ],
  [
    7,
    'template instances with no control position (row D6, before the fold)',
    /* The current scene minus `position`, which makes it the second entry the
       current reader could in fact read: the field defaults to `[]` and `[]` is
       what every instance here meant. So the **gate** is the only thing
       discarding it, which is the claim `migrations.ts` makes about an additive
       bump and this entry is what makes it testable. */
    asWrittenWithout({ filters: true, holds: true }),
  ],
  [
    8,
    'the shape that shipped: fills with no holds',
    /* **The one entry in this table that is not discarded**, and the reason is
       deployment rather than shape: version 8 is what a real user's browser
       holds, so `readPersistedState` climbs from it. See the identity-rung tests
       below, and `migrations.ts` for why versions 1–7 stay discarded. */
    asWrittenWithout({ holds: true }),
  ],
]

/**
 * The historical shapes that are still *discarded*, which is all of them but the
 * last.
 *
 * Version 8 is the exception because it is the only one a browser outside this
 * repo can be holding: it is the shape that was served at the app's public URL,
 * so discarding it would throw away a stranger's room. Versions 1–7 never
 * reached anyone, which is what the owner's licence was about, so their discard
 * is unchanged — see `migrations.ts`, including why a 5 → 6 rung would have to
 * *fabricate* a room rather than convert one.
 *
 * Derived from the reader's **own** list rather than from `STORE_VERSION - 1`,
 * which would exempt whatever version happened to be one below the stamp and so
 * would keep agreeing with the reader no matter how wrong the reader was. This
 * asks the module which versions it climbs and holds every other one to the
 * discard.
 */
const DISCARDED_BLOBS = HISTORICAL_BLOBS.filter(([version]) => !READABLE_VERSIONS.includes(version))

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

  it.each(DISCARDED_BLOBS)('discards a version %i payload (%s) and says so', (version, _label, blob) => {
    const recovered = readPersistedState(blob, version)

    expect(recovered.state).toEqual(defaultWorkshopState())
    // Audibly: `workshopStore.ts` turns `dropped` into one console warning per
    // hydration, and a discard that said nothing would be indistinguishable
    // from a browser that had never stored anything.
    expect(recovered.dropped).toHaveLength(1)
    expect(recovered.dropped[0]).toContain(`version ${String(version)}`)
    expect(recovered.dropped[0]).toContain('discarded')
  })

  it.each(DISCARDED_BLOBS)('discards a version %i payload (%s) through JSON too', (version, _label, blob) => {
    expect(readPersistedState(throughJSON(blob), version).state).toEqual(defaultWorkshopState())
  })

  it('climbs the one rung there is: a version 8 blob keeps its fills and has no holds', () => {
    // Version 8 is the shape that shipped, so it is the first blob this reader
    // may not throw away — the licence to discard ended when the app got its
    // public URL. The rung is the identity, and that is a fact about the change
    // rather than laziness: `holds` is additive and an absent one means *never
    // solved*, which is exactly what every version 8 fill is.
    const recovered = readPersistedState(asWrittenWithout({ holds: true }), STORE_VERSION - 1)

    expect(recovered.dropped).toEqual([])
    expect(recovered.state).toEqual(WorkshopStateSchema.parse(asWrittenWithout({ holds: true })))
    const wall = recovered.state.placements[PLACEMENT_A]?.fills[WALL]
    expect(wall).toEqual({ tile: TILE_B, pinned: true })
    expect(wall?.holds).toBeUndefined()
    // The rest of the scene arrives whole, which is the half a discard loses.
    expect(Object.keys(recovered.state.placements).sort()).toEqual([PLACEMENT_A, PLACEMENT_B].sort())
    expect(recovered.state.lock).toBe('magnetic')
  })

  it('round-trips a version 9 blob with its holds, including the empty one', () => {
    // The three hold states have to survive as three. `{}` coming back as
    // absent would be the failure that looks like success: a later default-hold
    // pass would refit a socket the user had deliberately emptied.
    const recovered = readPersistedState(throughJSON(SCENE), STORE_VERSION)

    expect(recovered.dropped).toEqual([])
    expect(recovered.state.placements[PLACEMENT_A]?.fills[WALL]?.holds).toEqual({
      [TORCH]: { tile: TILE_A, pinned: true },
    })
    expect(recovered.state.placements[PLACEMENT_B]?.fills[FLOOR]?.holds).toEqual({})
    expect(recovered.state.placements[PLACEMENT_A]?.fills[FLOOR]?.holds).toBeUndefined()
  })

  it('does not half-read an old scene into the new one', () => {
    // The sharpest claim in the file. Every version 1-5 placement named exactly
    // one thing — a file, then a design — and neither is a template with slots,
    // so a reader that shrugged and kept the coordinates would hand the app a
    // room of pieces made of nothing. The gate is what stops that, and
    // `salvageTemplate` is the second line if a hand edit gets past it.
    for (const [version, , blob] of DISCARDED_BLOBS) {
      expect(readPersistedState(blob, version).state.placements).toEqual({})
    }
    expect(salvageWorkshopState({ placements: FILE_PLACEMENTS }).state.placements).toEqual({})
    expect(salvageWorkshopState({ placements: DESIGN_PLACEMENTS }).state.placements).toEqual({})
  })

  it('names the old identity field it found, per entry', () => {
    // Three shapes are reachable through the unstamped path and they get three
    // sentences: the version 1-4 field name, the version 5 field name, and a
    // `gen:` recipe key in the template slot (a generated base in the catalog
    // map).
    expect(salvageWorkshopState({ placements: FILE_PLACEMENTS }).dropped).toEqual([
      `placements.${PLACEMENT_A}: names a file in the old tileId field — a placement holds a template now`,
      `placements.${PLACEMENT_B}: names a file in the old tileId field — a placement holds a template now`,
    ])
    expect(salvageWorkshopState({ placements: DESIGN_PLACEMENTS }).dropped).toEqual([
      `placements.${PLACEMENT_A}: names an item in the old design field — a placement holds a template now`,
      `placements.${PLACEMENT_B}: names an item in the old design field — a placement holds a template now`,
    ])
    expect(
      salvageWorkshopState({
        placements: { [PLACEMENT_A]: { template: 'gen:base-square', x: 0, z: 0, rotation: 0 } },
      }).dropped,
    ).toEqual([`placements.${PLACEMENT_A}: template is a generated base id, which belongs in the generated map`])
  })

  it('refuses a file id in the template slot, which no pattern-free brand would have', () => {
    // `TemplateId` is a lowercase hyphen-separated slug, so a `tiles/…` path
    // fails it outright. Under `z.string().min(1)` — which is what `DesignId`
    // still is — this would have parsed and produced an instance naming no
    // template at all.
    expect(
      salvageWorkshopState({ placements: { [PLACEMENT_A]: { template: TILE_A, x: 0, z: 0, rotation: 0 } } }).dropped,
    ).toEqual([`placements.${PLACEMENT_A}: template is not a template id (${JSON.stringify(TILE_A.slice(0, 40))})`])
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
    // wrong side of a shape mismatch is a screen full of pieces that resolve to
    // nothing. The previous reader read a *newer* blob best-effort, which was
    // right while the shared fields were stable and is not right across the
    // change row A1 made to a placement.
    const recovered = readPersistedState(SCENE, version)
    expect(recovered.state).toEqual(defaultWorkshopState())
    expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
    expect(recovered.dropped).toHaveLength(1)
  })

  it('reports the version it found, whatever it was', () => {
    // The message is the only thing the user or a bug report will ever see, so
    // it has to distinguish "written by an older build" from "unreadable".
    expect(readPersistedState(SCENE, 5).dropped[0]).toContain('version 5')
    expect(readPersistedState(SCENE, 'one').dropped[0]).toContain('"one"')
    expect(readPersistedState(SCENE, undefined).dropped[0]).toContain('undefined')
  })
})

/* ------------------------------------------------------------------ the expiry */

/**
 * The licence to discard — **which has expired** — and the guard that makes the
 * next author notice.
 *
 * `migrations.ts` said plainly when discarding would stop being allowed: the
 * moment a build is served to a user who is not a developer. That moment has
 * passed: the app is served at its public URL, so a blob under `STORAGE_KEY` can
 * belong to a stranger and their room is not disposable.
 *
 * The `package.json` guard that used to stand here has gone with it. It was a
 * proxy for an event, the event has happened, and a reminder about something
 * that already occurred is the no-op this repo cleans up rather than keeps. What
 * replaces it is a guard with an actual mechanism, and the mechanism is that
 * `READABLE_VERSIONS` holds **literal** numbers rather than arithmetic on
 * {@link STORE_VERSION}:
 *
 *   - Bump the stamp to 10 and leave the list at `[8, 9]` and the *current*
 *     version is no longer readable, so the first test below fails — along with
 *     every test in this file that reads a payload at the current version, and
 *     the whole of `workshopStore.test.ts`' persistence block, because the app
 *     now discards its own writes.
 *   - Add 10 to the list without converting anything and the second test still
 *     holds only if 9 is still there, which is the rung.
 *
 * A derived `[STORE_VERSION - 1, STORE_VERSION]` would pass both of those
 * forever, which is exactly the shape of guard that reads as protection and is
 * none: it agrees with the reader by construction, however wrong the reader is.
 *
 * **Measured rather than asserted:** editing `STORE_VERSION` to 10 and touching
 * nothing else turns 13 tests red across three files — this one first, then the
 * current-version reads in the gate block and the persistence block of
 * `workshopStore.test.ts`. That is what the claim in `migrations.ts` rests on.
 */
describe('the licence to discard persisted state', () => {
  it('has expired, so this build reads the version it writes', () => {
    // The half a bump breaks first. `READABLE_VERSIONS` does not follow
    // `STORE_VERSION`, so moving the stamp without editing the list leaves the
    // app unable to read its own blob, and this line is where that lands.
    expect(
      READABLE_VERSIONS,
      'STORE_VERSION moved and READABLE_VERSIONS did not, so this build discards its own ' +
        'writes. Read the "the licence has expired" section of src/store/migrations.ts: a bump ' +
        'needs a rung, which means adding the new version to that list and converting the old one.',
    ).toContain(STORE_VERSION)
    expect(readPersistedState(throughJSON(SCENE), STORE_VERSION).state).not.toEqual(defaultWorkshopState())
  })

  it('has expired, so the version below the current one is still readable', () => {
    // And the other half: the rung itself. A real user's browser holds the
    // previous shape — the app is served at its public URL — so discarding it
    // throws away their room.
    const recovered = readPersistedState(asWrittenWithout({ holds: true }), STORE_VERSION - 1)

    expect(
      recovered.state,
      'STORE_VERSION moved without a rung for the version below it: add it to READABLE_VERSIONS ' +
        'and convert it. See the "the licence has expired" section of src/store/migrations.ts.',
    ).not.toEqual(defaultWorkshopState())
  })

  it('is recorded where the code that relies on it lives', () => {
    // Not a spelling check on a docblock: what a future shape change owes a
    // user's saved room cannot be enforced by a type, so the sentence *is* the
    // mechanism, and a refactor that dropped it would leave the next author
    // guessing. Asserted on the source text because there is nowhere else for it
    // to be.
    const source = readFileSync('src/store/migrations.ts', 'utf8')
    expect(source).toContain('served at its public URL')
    expect(source).toContain('served to a user who is not a developer')
  })

  it('records that a 5 → 6 rung would have to fabricate a room rather than convert one', () => {
    // The one thing A1 adds to the notice, and the reason it has to be written
    // down: V1's and V4's rung was merely unwritable at hydrate time, which
    // reads as a scheduling problem. A1's is underdetermined — 52 families, and
    // nothing in a design says which one a user meant — so a future author who
    // treated it as the same kind of problem would ship a plausible room nobody
    // chose. §3.4 already names that failure class.
    const source = readFileSync('src/store/migrations.ts', 'utf8')
    expect(source).toContain('underdetermined')
    expect(source).toContain('discard, or fabricate')
  })
})

/* -------------------------------------------------------------------- garbage */

/**
 * Every entry is something a browser can hand back: a `null` written by a
 * previous library, an object truncated by a tab killed mid-write, a hand edit
 * in devtools, an export format that used an array, a field whose type changed.
 */
/* `filters: []` because the salvager defaults an absent one to it, so an
   expectation written without the field would compare a 6-key object to a
   7-key one. `[]` is *any* on every axis, which is what an instance with no
   position means. */
const AN_INSTANCE = {
  id: PLACEMENT_A,
  template: A_TEMPLATE,
  x: 0,
  z: 0,
  rotation: 0,
  fills: {},
  filters: [],
}

const GARBAGE: readonly (readonly [string, unknown])[] = [
  ['null', null],
  ['undefined', undefined],
  ['an empty object', {}],
  ['an array where the state belongs', []],
  ['an array of plausible placements', [AN_INSTANCE]],
  ['a string', 'openforge'],
  ['a number', 42],
  ['a boolean', true],
  ['a truncated object', { placements: { [PLACEMENT_A]: AN_INSTANCE } }],
  ['an object with only a lock', { lock: 'magnetic' }],
  ['a half-written placement', { placements: { [PLACEMENT_A]: { template: A_TEMPLATE, x: 1 } } }],
  ['an array where placements belong', { placements: [AN_INSTANCE] }],
  ['a null placement', { placements: { [PLACEMENT_A]: null } }],
  ['a wrong-typed coordinate', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, x: '3' } } }],
  ['a NaN coordinate', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, x: Number.NaN } } }],
  ['an infinite coordinate', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, x: Number.POSITIVE_INFINITY } } }],
  ['a null rotation', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, rotation: null } } }],
  ['a numeric template id', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, template: 42 } } }],
  ['an empty template id', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, template: '' } } }],
  ['an uppercase template id', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, template: 'S2W-Corner' } } }],
  // The shape every version 1-5 blob wrote, and the shape a hand edit still
  // produces.
  ['a file id where the template goes', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, template: TILE_A } } }],
  ['the version 1-4 field name', { placements: { [PLACEMENT_A]: { tileId: TILE_A, x: 0, z: 0, rotation: 0 } } }],
  ['the version 5 field name', { placements: { [PLACEMENT_A]: { design: DESIGN_A, x: 0, z: 0, rotation: 0 } } }],
  ['an id that disagrees with its key', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, id: PLACEMENT_B } } }],
  // Fills, which are the population row A1 added.
  ['a string where fills belong', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: 'floor' } } }],
  ['an array where fills belong', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: [] } } }],
  ['a null fill', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { floor: null } } } }],
  ['a fill with no tile', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { floor: { pinned: true } } } } }],
  [
    'a fill whose tile is a design id',
    { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { floor: { tile: DESIGN_A, pinned: false } } } } },
  ],
  [
    'a fill with no pinned bit',
    { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { floor: { tile: TILE_A } } } } },
  ],
  [
    'a fill whose pinned bit is a string',
    { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { floor: { tile: TILE_A, pinned: 'yes' } } } } },
  ],
  ['an empty slot name', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { '': { tile: TILE_A } } } } }],
  // Holds, which are the population this row added one level further down.
  [
    'a string where holds belong',
    { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { floor: { tile: TILE_A, pinned: false, holds: 'torch' } } } } },
  ],
  [
    'a null hold',
    { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { floor: { tile: TILE_A, pinned: false, holds: { torch: null } } } } } },
  ],
  [
    'a hold that holds holds',
    {
      placements: {
        [PLACEMENT_A]: {
          ...AN_INSTANCE,
          fills: {
            floor: { tile: TILE_A, pinned: false, holds: { torch: { tile: TILE_A, pinned: false, holds: {} } } },
          },
        },
      },
    },
  ],
  [
    'a prototype payload among the holds',
    {
      placements: {
        [PLACEMENT_A]: {
          ...AN_INSTANCE,
          fills: {
            floor: { tile: TILE_A, pinned: false, holds: JSON.parse(`{"__proto__":{"polluted":true}}`) as unknown },
          },
        },
      },
    },
  ],
  [
    'a prototype payload among the fills',
    {
      placements: {
        [PLACEMENT_A]: { ...AN_INSTANCE, fills: JSON.parse(`{"__proto__":{"polluted":true}}`) as unknown },
      },
    },
  ],
  ['an unknown lock system', { lock: 'openlok' }],
  ['a string where the chosen flag belongs', { lockChosen: 'yes' }],
  ['a numeric chosen flag', { lockChosen: 1 }],
  ['a null chosen flag', { lockChosen: null }],
  ['a numeric lock system', { lock: 3 }],
  ['an empty room design', { design: '' }],
  ['a numeric room design', { design: 7 }],
  ['a null room design', { design: null }],
  ['an object room design', { design: { root: 'dungeon_stone' } }],
  ['a leftover library, which no longer has a reader', { library: { [DESIGN_A]: true } }],
  ['a state-level prototype payload', JSON.parse(`{"__proto__":{"polluted":true},"lock":"magnetic"}`) as unknown],
  ['a very long template id', { placements: { [PLACEMENT_A]: { ...AN_INSTANCE, template: 'a'.repeat(5000) } } }],
  ['a function-valued field', { placements: { [PLACEMENT_A]: () => null } }],
]

describe('garbage input', () => {
  it.each(GARBAGE)('salvages %s without throwing', (_label, input) => {
    const recovered = salvageWorkshopState(input)
    expect(WorkshopStateSchema.safeParse(recovered.state).success).toBe(true)
  })

  it.each(GARBAGE)('reads %s without throwing, at every version stamp', (_label, input) => {
    for (const version of [0, 1, 5, STORE_VERSION, STORE_VERSION + 1, undefined, 'four']) {
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
  it('drops only the corrupt instance, not the whole scene', () => {
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: { ...AN_INSTANCE, x: 1, z: 2, rotation: 90 },
        [PLACEMENT_B]: { ...AN_INSTANCE, id: PLACEMENT_B, x: 'over there', z: 2, rotation: 90 },
      },
      lock: 'magnetic',
    })
    expect(Object.keys(recovered.state.placements)).toEqual([PLACEMENT_A])
    expect(recovered.state.lock).toBe('magnetic')
    expect(recovered.dropped).toHaveLength(1)
    expect(recovered.dropped[0]).toContain(PLACEMENT_B)
  })

  it('keeps an instance whose rotation is unreadable, resetting it to zero', () => {
    // Position has no safe default — a fallback of 0 would stack every corrupt
    // piece on the origin — but 0 is a perfectly legal rotation, so an instance
    // is worth keeping when only its angle is lost.
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, x: 1, z: 2, rotation: 'sideways' } },
    })
    expect(recovered.state.placements[PLACEMENT_A]).toEqual({ ...AN_INSTANCE, x: 1, z: 2, rotation: 0 })
    expect(recovered.dropped[0]).toContain('rotation')
  })

  it('folds an out-of-range rotation into [0, 360)', () => {
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: { ...AN_INSTANCE, rotation: 450 },
        [PLACEMENT_B]: { ...AN_INSTANCE, id: PLACEMENT_B, rotation: -90 },
      },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.rotation).toBe(90)
    expect(recovered.state.placements[PLACEMENT_B]?.rotation).toBe(270)
    expect(recovered.dropped).toEqual([])
  })

  it('folds a negative zero coordinate, which does not survive JSON, to positive zero', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, x: -0, z: -0, rotation: -0 } },
    })
    const instance = recovered.state.placements[PLACEMENT_A]
    expect(Object.is(instance?.x, 0)).toBe(true)
    expect(Object.is(instance?.z, 0)).toBe(true)
    expect(Object.is(instance?.rotation, 0)).toBe(true)
    expect(recovered.dropped).toEqual([])
  })

  it('resets an unreadable lock system to the default rather than dropping the scene', () => {
    const recovered = salvageWorkshopState({ placements: { [PLACEMENT_A]: AN_INSTANCE }, lock: 'padlock' })
    expect(recovered.state.lock).toBe(DEFAULT_LOCK_SYSTEM)
    expect(Object.keys(recovered.state.placements)).toEqual([PLACEMENT_A])
    expect(recovered.dropped[0]).toContain('lock')
  })

  it('reads an absent chosen flag as not chosen, silently', () => {
    // Absence is the normal case for every blob written before version 2, so it
    // is not corruption and must not be reported as such.
    const recovered = salvageWorkshopState({ placements: {}, lock: 'openlock' })
    expect(recovered.state.lockChosen).toBe(false)
    expect(recovered.dropped).toEqual([])
  })

  it('reads an absent room design as no preference, silently', () => {
    // Row D6. Absence is the shipped default — `defaultWorkshopState` sets out
    // why the app does not start on the largest family — so it is the ordinary
    // state and must not be reported as a drop.
    const recovered = salvageWorkshopState({ placements: {}, lock: 'openlock' })
    expect(recovered.state.design).toBeUndefined()
    expect('design' in recovered.state).toBe(false)
    expect(recovered.dropped).toEqual([])
  })

  it('keeps a room design the archive has never heard of, and says nothing', () => {
    /* Deliberate, and the argument is in `salvageDesign`: checking the value
       against the 36 reachable roots needs `catalog.json`, which `schema.ts`
       keeps out of the store's closure — and the check would buy nothing,
       because `FillContext.family` is a preference and never a filter. An
       unknown design is honoured on no slot and every slot still fills. */
    const recovered = salvageWorkshopState({ placements: {}, lock: 'openlock', design: 'cut_stone' })
    expect(recovered.state.design).toBe('cut_stone')
    expect(recovered.dropped).toEqual([])
  })

  it('resets an unreadable room design to no preference and keeps the scene', () => {
    const recovered = salvageWorkshopState({ placements: { [PLACEMENT_A]: AN_INSTANCE }, design: 42 })
    expect(recovered.state.design).toBeUndefined()
    expect(Object.keys(recovered.state.placements)).toEqual([PLACEMENT_A])
    expect(recovered.dropped[0]).toContain('design')
  })

  it('resets a wrong-typed chosen flag to false and says so', () => {
    const recovered = salvageWorkshopState({ lock: 'magnetic', lockChosen: 'yes' })
    expect(recovered.state.lockChosen).toBe(false)
    expect(recovered.state.lock).toBe('magnetic')
    expect(recovered.dropped[0]).toContain('lockChosen')
  })

  it('refuses keys that are not placement ids', () => {
    const recovered = salvageWorkshopState({ placements: { '': AN_INSTANCE } })
    expect(recovered.state.placements).toEqual({})
    expect(recovered.dropped).toEqual(['placements.: not a placement id'])
  })

  it('says nothing at all about a leftover library', () => {
    // Not corruption of the current shape: a field this build has dropped. On
    // the unstamped path — the only one that reaches here with an old blob — it
    // has no reader and no effect, and a message would tell the user about a
    // feature that is gone.
    const recovered = salvageWorkshopState({ library: { [DESIGN_A]: true }, placements: {}, lock: 'magnetic' })
    expect(recovered.dropped).toEqual([])
    expect(recovered.state).toEqual({ ...defaultWorkshopState(), lock: 'magnetic' })
  })

  it('is idempotent, so validating twice on the read path reports nothing twice', () => {
    const once = salvageWorkshopState(SCENE)
    const twice = salvageWorkshopState(once.state)
    expect(twice.state).toEqual(once.state)
    expect(twice.dropped).toEqual([])
  })
})

/* ---------------------------------------------------------------------- fills */

describe('salvaging an instance’s fills', () => {
  it('keeps the instance and loses only the unreadable fill', () => {
    // The granularity that matters most in this row. A slot with no fill is a
    // state §3.2 already requires the app to draw — needs a choice — so losing
    // one costs a choice the user has to make again, while dropping the instance
    // would cost the whole piece and its position.
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: {
          ...AN_INSTANCE,
          fills: { [FLOOR]: { tile: TILE_A, pinned: true }, [WALL]: { tile: 'nonsense', pinned: false } },
        },
      },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills).toEqual({ [FLOOR]: { tile: TILE_A, pinned: true } })
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${WALL}: tile is not a file id ("nonsense")`,
    ])
  })

  it('reads an absent fills map as nothing filled, silently — contract C-g', () => {
    // §3.2 places a template with slots still open, so "no fills" is a legal
    // state of a *current* instance and not a shape a reader should complain
    // about. There is no threshold of unfilled slots at which an instance stops
    // being one.
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { id: PLACEMENT_A, template: A_TEMPLATE, x: 1, z: 1, rotation: 0 } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills).toEqual({})
    expect(recovered.dropped).toEqual([])
  })

  it('reads an unreadable fills map as nothing filled, and says so', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: ['floor'] } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills).toEqual({})
    expect(recovered.dropped).toEqual([`placements.${PLACEMENT_A}: fills is not an object (array), read as unfilled`])
  })

  it('falls back to auto for a missing pinned bit, which the next lock change repairs', () => {
    // The direction is the whole content of the assertion. `false` means the
    // solver chose it, so C2's re-solve rewrites the slot and the damage heals;
    // `true` would freeze a choice the user never made, permanently and
    // invisibly. Contract C-k is about that bit staying honest.
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { [FLOOR]: { tile: TILE_A } } } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills[FLOOR]).toEqual({ tile: TILE_A, pinned: false })
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${FLOOR}: pinned is not a boolean (undefined), read as auto`,
    ])
  })

  it('keeps a pinned bit that is there', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { [FLOOR]: { tile: TILE_A, pinned: true } } } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills[FLOOR]?.pinned).toBe(true)
    expect(recovered.dropped).toEqual([])
  })

  it('refuses a prototype key among the fills, which is the loosest key space in the store', () => {
    // A slot name is `z.string().min(1)`, because the authority on what a slot
    // is called is the template. So `fills` is the one map whose key shape rules
    // nothing out, and the `__proto__` check is load bearing rather than
    // belt-and-braces the way it is on a UUID-keyed map.
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: {
          ...AN_INSTANCE,
          fills: JSON.parse(`{"__proto__":{"tile":"tiles/x.stl","pinned":true}}`) as unknown,
        },
      },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills).toEqual({})
    expect(recovered.dropped).toEqual([`placements.${PLACEMENT_A}.fills.__proto__: unsafe key`])
    const probe: Record<string, unknown> = {}
    expect(probe.tile).toBeUndefined()
  })

  it('refuses an empty slot name', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { '': { tile: TILE_A, pinned: false } } } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills).toEqual({})
    expect(recovered.dropped).toEqual([`placements.${PLACEMENT_A}.fills.: not a slot name`])
  })

  it('keeps a slot name with a space in it, because five of the 128 have one', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { 'right wall': { tile: TILE_A, pinned: false } } } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.fills[WALL]).toEqual({ tile: TILE_A, pinned: false })
    expect(recovered.dropped).toEqual([])
  })

  it('lets two slots name the same file — contract C-c', () => {
    // Not deduped here, and it must not be: A3 and A4b are entitled to two
    // slots resolving to one STL (`bill.ts` groups on md5 and counts both), and
    // a store that collapsed them would silently print one piece where two are
    // needed.
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: {
          ...AN_INSTANCE,
          fills: { [FLOOR]: { tile: TILE_A, pinned: false }, [WALL]: { tile: TILE_A, pinned: false } },
        },
      },
    })
    expect(Object.keys(recovered.state.placements[PLACEMENT_A]?.fills ?? {})).toHaveLength(2)
    expect(recovered.dropped).toEqual([])
  })
})

/* ---------------------------------------------------------------------- holds */

/**
 * A hold is a fill of a fill, so its salvage is the fill's own shape check one
 * level down — and the two things that are *not* shared are the whole content of
 * this block: the tri-state (`undefined` is never solved, `{}` is solved) and the
 * refusal to nest.
 */
describe('salvaging a fill’s holds', () => {
  const fillWith = (holds: unknown) => ({
    placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { [WALL]: { tile: TILE_A, pinned: false, holds } } } },
  })
  const holdsOf = (recovered: ReturnType<typeof salvageWorkshopState>) =>
    recovered.state.placements[PLACEMENT_A]?.fills[WALL]?.holds

  it('reads an absent holds map as never solved, silently', () => {
    // Every version 8 fill is in this state and so is every fresh one, so it is
    // the ordinary reading rather than a drop.
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, fills: { [WALL]: { tile: TILE_A, pinned: false } } } },
    })
    expect(holdsOf(recovered)).toBeUndefined()
    expect('holds' in (recovered.state.placements[PLACEMENT_A]?.fills[WALL] ?? {})).toBe(false)
    expect(recovered.dropped).toEqual([])
  })

  it('keeps an empty holds map, because solved-and-empty is not never-solved', () => {
    const recovered = salvageWorkshopState(fillWith({}))
    expect(holdsOf(recovered)).toEqual({})
    expect(recovered.dropped).toEqual([])
  })

  it('keeps a hold and its pin', () => {
    const recovered = salvageWorkshopState(fillWith({ [TORCH]: { tile: TILE_B, pinned: true } }))
    expect(holdsOf(recovered)).toEqual({ [TORCH]: { tile: TILE_B, pinned: true } })
    expect(recovered.dropped).toEqual([])
  })

  it('drops a hold whose value is not a fill, and names it', () => {
    // Per-entry, for the same reason a fill is: one unreadable accessory costs
    // that socket and not the wall it is in.
    const recovered = salvageWorkshopState(
      fillWith({ [TORCH]: { tile: TILE_B, pinned: true }, brazier: 'a torch, obviously' }),
    )
    expect(holdsOf(recovered)).toEqual({ [TORCH]: { tile: TILE_B, pinned: true } })
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${WALL}.holds.brazier: expected an object, found "a torch, obviously"`,
    ])
  })

  it('drops a hold whose file is unreadable, and keeps the slot’s own fill', () => {
    const recovered = salvageWorkshopState(fillWith({ [TORCH]: { tile: 'nonsense', pinned: false } }))
    expect(recovered.state.placements[PLACEMENT_A]?.fills[WALL]?.tile).toBe(TILE_A)
    expect(holdsOf(recovered)).toEqual({})
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${WALL}.holds.${TORCH}: tile is not a file id ("nonsense")`,
    ])
  })

  it('falls back to auto for a hold with no pinned bit, which the next pass repairs', () => {
    const recovered = salvageWorkshopState(fillWith({ [TORCH]: { tile: TILE_B } }))
    expect(holdsOf(recovered)).toEqual({ [TORCH]: { tile: TILE_B, pinned: false } })
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${WALL}.holds.${TORCH}: pinned is not a boolean (undefined), read as auto`,
    ])
  })

  it('refuses a hold that holds holds, which the shape cannot express', () => {
    // The schema closes this by construction — `HoldFill` has no `holds` field —
    // and a blob can still carry one, so the reader says what it found rather
    // than stripping it in silence. Silence would hide a build that had started
    // writing a shape this one cannot read.
    const recovered = salvageWorkshopState(
      fillWith({ [TORCH]: { tile: TILE_B, pinned: false, holds: { candle: { tile: TILE_A, pinned: false } } } }),
    )
    expect(holdsOf(recovered)).toEqual({})
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${WALL}.holds.${TORCH}: a hold cannot carry holds of its own`,
    ])
  })

  it('reads an unreadable holds map as never solved rather than as solved-and-empty', () => {
    // The direction is the whole assertion, and it is `pinned`'s argument in a
    // second place: *never solved* is repaired by the next default-hold pass,
    // where *solved and empty* would freeze an answer nobody gave.
    const recovered = salvageWorkshopState(fillWith(['torch']))
    expect(holdsOf(recovered)).toBeUndefined()
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${WALL}: holds is not an object (array), read as never solved`,
    ])
  })

  it('refuses a prototype key among the holds', () => {
    // A hold name is `z.string().min(1)` for the reason a slot name is, so this
    // map's keys rule nothing out either and the check is load bearing.
    const recovered = salvageWorkshopState(
      fillWith(JSON.parse(`{"__proto__":{"tile":"tiles/x.stl","pinned":true}}`) as unknown),
    )
    expect(holdsOf(recovered)).toEqual({})
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}.fills.${WALL}.holds.__proto__: unsafe key`,
    ])
    const probe: Record<string, unknown> = {}
    expect(probe.tile).toBeUndefined()
  })

  it('refuses an empty hold name', () => {
    const recovered = salvageWorkshopState(fillWith({ '': { tile: TILE_B, pinned: false } }))
    expect(holdsOf(recovered)).toEqual({})
    expect(recovered.dropped).toEqual([`placements.${PLACEMENT_A}.fills.${WALL}.holds.: not a hold name`])
  })

  it('is idempotent, so a re-read of a salvaged scene reports nothing', () => {
    const once = salvageWorkshopState(SCENE)
    const twice = salvageWorkshopState(once.state)
    expect(twice.state).toEqual(once.state)
    expect(twice.dropped).toEqual([])
  })
})

/* ------------------------------------------------------------------- identity */

describe('the map key and the id field', () => {
  it('rewrites the field from the key and names the disagreement', () => {
    // `schema.ts` puts `id` inside the instance because one travels detached
    // from the map; the price is a disagreement that a blob can express. The key
    // wins, because `state.placements[id]` is the lookup the whole app makes and
    // trusting the field would produce an instance that cannot be found by its
    // own id.
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { ...AN_INSTANCE, id: PLACEMENT_B } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.id).toBe(PLACEMENT_A)
    expect(recovered.dropped).toEqual([
      `placements.${PLACEMENT_A}: id field says ${JSON.stringify(PLACEMENT_B)}; the map key wins`,
    ])
  })

  it('fills in a missing id field silently, because the key is the whole answer', () => {
    const recovered = salvageWorkshopState({
      placements: { [PLACEMENT_A]: { template: A_TEMPLATE, x: 0, z: 0, rotation: 0, fills: {} } },
    })
    expect(recovered.state.placements[PLACEMENT_A]?.id).toBe(PLACEMENT_A)
    expect(recovered.dropped).toEqual([])
  })

  it('leaves every surviving instance addressable by its own id', () => {
    // The invariant the two tests above exist for, asserted over a whole scene
    // including the deliberately mismatched entry.
    const recovered = salvageWorkshopState({
      placements: {
        [PLACEMENT_A]: { ...AN_INSTANCE, id: PLACEMENT_B },
        [PLACEMENT_B]: { ...AN_INSTANCE, id: PLACEMENT_B },
      },
    })
    for (const [key, instance] of Object.entries(recovered.state.placements)) {
      expect(instance.id).toBe(key)
    }
  })
})
