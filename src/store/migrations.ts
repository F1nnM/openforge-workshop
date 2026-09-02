/**
 * OpenForge Workshop — reading persisted state that may be anything at all.
 *
 * `migrate()` is the one function in the app whose input is genuinely arbitrary.
 * Everything else reads either the build-time catalog (validated once by CI) or
 * data the app itself just produced. This reads whatever is sitting under a
 * `localStorage` key, which can be:
 *
 *   - a scene written by a version that shipped months ago;
 *   - a scene written by a version that **never** shipped, because a preview
 *     deploy or a local dev build shared the same origin;
 *   - half a scene, because the tab was killed mid-write;
 *   - a scene from a *newer* build, when the user opens an older cached tab;
 *   - something hand-edited in devtools;
 *   - a JSON document that has nothing to do with this app.
 *
 * A migration that assumes well-formed input throws during hydration, and a
 * throw during hydration is a white screen on the app's own home page with the
 * poison still in storage — every reload reproduces it. So the contract for
 * everything in this file is: **total function, never throws, always returns a
 * valid {@link WorkshopState}.** `migrations.test.ts` is the proof, and it is
 * the point of this module rather than an accessory to it.
 *
 * Recovery is *salvaging*, not all-or-nothing. One placement with a corrupt
 * coordinate drops that placement and keeps the other forty; it does not empty
 * the room. `RecoveredState.dropped` names everything discarded so the caller
 * can say so out loud instead of silently losing a tile.
 */
import { TileId } from '@/catalog'
import { GeneratedPlacement as GeneratedPlacementSchema } from '@/generator/placement/scene'

import type { LockSystem, Placement, WorkshopState } from './schema'
import {
  DEFAULT_LOCK_SYSTEM,
  LockSystem as LockSystemSchema,
  PlacementId,
  defaultWorkshopState,
  normalizeRotation,
} from './schema'

/**
 * Version of the persisted shape.
 *
 * Set from the first commit, together with {@link migrateWorkshopState}, because
 * retrofitting a version stamp is far harder than starting with one: without it,
 * the first breaking change has to guess at the shape of every blob already in
 * every user's browser.
 *
 * **To ship version N+1:** change the schema in `schema.ts`, bump this, add a
 * step under `N+1` in {@link MIGRATION_STEPS} that maps an N-shaped blob to an
 * (N+1)-shaped one, and add an N entry to the fixture table in
 * `migrations.test.ts`. The suite fails if any of the three is missing.
 */
export const STORE_VERSION = 3

/**
 * One rung of the migration ladder: given a blob in version `N-1`'s shape,
 * return one in version `N`'s.
 *
 * `unknown` in and `unknown` out, not `StateVN-1` in and `StateVN` out, and this
 * is the load-bearing decision of the module. A typed signature is a lie about
 * data that came from `localStorage`: it tells the author the input is
 * well-formed, and the author then writes `input.placements.map(...)` and ships
 * a `TypeError` for every user whose blob was truncated. Untyped input forces
 * every step to look before it reads.
 *
 * A step is free to throw despite that — {@link migrateWorkshopState} catches
 * and falls back to defaults — but a step that throws loses the user's whole
 * scene, whereas one that returns a partially readable blob loses only the parts
 * that were unreadable, because {@link salvageWorkshopState} runs afterwards
 * either way.
 */
export type MigrationStep = (input: unknown) => unknown

/**
 * The ladder, keyed by the version each rung produces.
 *
 * Two rungs. Each is keyed by the version it *produces*, so the step under `2`
 * reads a version 1 blob and returns a version 2 one.
 */
export const MIGRATION_STEPS: Readonly<Record<number, MigrationStep>> = {
  /**
   * 1 → 2: add `lockChosen`.
   *
   * Version 2 records whether the user has ever decided the lock system, which
   * version 1 could not express. The interesting part is what to infer for a
   * blob written before the flag existed, and the answer follows from the
   * default being openlock:
   *
   *   - **`lock` is a lock system other than openlock.** Version 1 only ever
   *     wrote that through `setLockSystem`, which nothing but a deliberate
   *     change called — so this user chose. `lockChosen: true`, and they are not
   *     asked again.
   *   - **`lock` is openlock, missing, or unreadable.** Indistinguishable from
   *     "never touched it", so `lockChosen: false` and the notice appears once.
   *     Being asked once more is the cheap error here; silently locking someone
   *     out of the choice is the expensive one.
   *
   * `unknown` in, `unknown` out (see {@link MigrationStep}), so every read is
   * guarded: a blob that is not a plain object is returned untouched for
   * {@link salvageWorkshopState} to reduce to defaults, and a blob that already
   * carries a boolean `lockChosen` is passed through — a preview build on the
   * same origin can have written a version 2 shape under a version 1 stamp.
   *
   * Spread rather than assignment, deliberately: object spread defines own data
   * properties, so a `__proto__` key surviving from `JSON.parse` is copied as
   * data rather than invoking the prototype setter. `salvage*` then drops it.
   */
  2: (input) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
    const source = input as Record<string, unknown>
    if (typeof source.lockChosen === 'boolean') return source
    const chosen = LockSystemSchema.safeParse(source.lock)
    return { ...source, lockChosen: chosen.success && chosen.data !== DEFAULT_LOCK_SYSTEM }
  },

  /**
   * 2 → 3: add `generated`.
   *
   * Version 3 holds generated bases beside the placements — the recipe and the
   * position, never the mesh (see `schema.ts`). A version 2 blob has no such
   * key, and there is nothing to infer: absence is an empty map, because a build
   * written before the generator could place anything had no generated bases in
   * it. So this rung is a *shape* claim rather than a conversion, and it is
   * written out anyway for two reasons.
   *
   * The first is that {@link salvageWorkshopState} would already produce `{}`
   * from an absent key, and a rung that only relied on that would leave the
   * version stamp unexplained — the harness in `migrations.test.ts` exists so a
   * future breaking change can see what every shipped shape was, and "version 3
   * is version 2 plus this key" is the fact it needs.
   *
   * The second is the preview-build case the `lockChosen` rung already had to
   * handle: a build on the same origin can have written a version 3 shape under
   * a version 2 stamp, so a blob that already carries a plain-object `generated`
   * is passed through untouched rather than overwritten with an empty map. That
   * is the difference between "read best-effort" and "silently empty somebody's
   * bases", and it is the same asymmetry the rung above resolves the same way.
   *
   * Spread rather than assignment, for the `__proto__` reason the rung above
   * gives.
   */
  3: (input) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return input
    const source = input as Record<string, unknown>
    if (asRecord(source.generated) !== undefined) return source
    return { ...source, generated: {} }
  },
}

/** A state recovered from untrusted input, plus what had to be thrown away. */
export interface RecoveredState {
  state: WorkshopState
  /**
   * One entry per discarded datum, each naming its path and the reason, e.g.
   * `placements.f81d4f: x is not a finite number`. Empty when the input was
   * clean. Intended for a console warning and for tests — never for control
   * flow, since a caller cannot act on it beyond telling the user.
   */
  dropped: string[]
}

/* ------------------------------------------------------------------ salvaging */

/**
 * Keys that must never be copied into a result object.
 *
 * `JSON.parse('{"__proto__":{"x":1}}')` produces an object with `__proto__` as
 * an *own* property, and copying that key into an object literal with `obj[key]
 * = value` invokes the prototype setter instead of defining a property. No
 * legitimate key is affected: a `TileId` always starts `tiles/` and a
 * `PlacementId` is a UUID.
 */
const UNSAFE_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Narrow to a plain keyed object, rejecting arrays and `null`.
 *
 * `typeof null === 'object'` and `typeof [] === 'object'`, so both checks are
 * needed. An array where an object belongs is a real case — it is what an
 * earlier draft of an export format, or a hand-edit, produces — and treating it
 * as a keyed object would yield placements keyed `"0"`, `"1"`, `"2"`.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/** Describe a value in a `dropped` entry without dumping a whole scene into it. */
function describeValue(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return JSON.stringify(value.slice(0, 40))
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return String(value)
  return typeof value
}

function salvageLibrary(input: unknown, dropped: string[]): WorkshopState['library'] {
  const out: WorkshopState['library'] = {}
  if (input === undefined) return out
  const source = asRecord(input)
  if (source === undefined) {
    dropped.push(`library: expected an object, found ${describeValue(input)}`)
    return out
  }
  for (const [key, value] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(key)) {
      dropped.push(`library.${key}: unsafe key`)
      continue
    }
    const tileId = TileId.safeParse(key)
    if (!tileId.success) {
      dropped.push(`library.${key}: not a tile id`)
      continue
    }
    // `false` is not corruption — it is the absence of a membership, which a
    // set expresses by omitting the key. Anything else is corruption.
    if (value === false) continue
    if (value !== true) {
      dropped.push(`library.${key}: expected true, found ${describeValue(value)}`)
      continue
    }
    out[tileId.data] = true
  }
  return out
}

function salvageCoordinate(key: string, axis: 'x' | 'z', value: unknown, dropped: string[]): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    dropped.push(`placements.${key}: ${axis} is not a finite number (${describeValue(value)})`)
    return undefined
  }
  // `-0 + 0` is `+0`, and every other value is unchanged. A snap function is a
  // real source of `-0` (`Math.round(-0.2) * 0.5`), and `-0` survives in memory
  // but not through `JSON.stringify`, so leaving it would make an export ->
  // import round trip subtly non-identical.
  return value + 0
}

/**
 * Recover one placement.
 *
 * The asymmetry between rotation and position is deliberate. A missing or
 * unreadable **rotation** falls back to 0, because 0 is a legal rotation and an
 * unrotated tile in the right place is a recognisable scene. A missing or
 * unreadable **coordinate** drops the placement, because there is no safe
 * default: falling back to 0 would silently stack every corrupt tile on the
 * origin, which reads as a bug in the builder rather than as recovered data.
 */
function salvagePlacement(key: string, value: unknown, dropped: string[]): Placement | undefined {
  const source = asRecord(value)
  if (source === undefined) {
    dropped.push(`placements.${key}: expected an object, found ${describeValue(value)}`)
    return undefined
  }
  const tileId = TileId.safeParse(source.tileId)
  if (!tileId.success) {
    dropped.push(`placements.${key}: tileId is not a tile id (${describeValue(source.tileId)})`)
    return undefined
  }
  const x = salvageCoordinate(key, 'x', source.x, dropped)
  const z = salvageCoordinate(key, 'z', source.z, dropped)
  if (x === undefined || z === undefined) return undefined

  if (source.rotation === undefined || typeof source.rotation === 'number') {
    return { tileId: tileId.data, x, z, rotation: normalizeRotation(source.rotation ?? 0) }
  }
  dropped.push(`placements.${key}: rotation is not a number (${describeValue(source.rotation)}), reset to 0`)
  return { tileId: tileId.data, x, z, rotation: 0 }
}

function salvagePlacements(input: unknown, dropped: string[]): WorkshopState['placements'] {
  const out: WorkshopState['placements'] = {}
  if (input === undefined) return out
  const source = asRecord(input)
  if (source === undefined) {
    dropped.push(`placements: expected an object, found ${describeValue(input)}`)
    return out
  }
  for (const [key, value] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(key)) {
      dropped.push(`placements.${key}: unsafe key`)
      continue
    }
    const placementId = PlacementId.safeParse(key)
    if (!placementId.success) {
      dropped.push(`placements.${key}: not a placement id`)
      continue
    }
    const placement = salvagePlacement(key, value, dropped)
    if (placement !== undefined) out[placementId.data] = placement
  }
  return out
}

/**
 * Recover the generated bases.
 *
 * Delegated to row S5's own schema rather than field-checked here, and the
 * asymmetry with {@link salvagePlacement} is deliberate. A `Placement` is four
 * scalars, so this module can salvage it *partially* — a bad rotation falls back
 * to 0 and keeps the tile where it is. A {@link GeneratedPlacement} carries a
 * whole parameter set, and there is no partial reading of one: a recipe missing
 * a `-D` is a different base, and a recipe naming an entry point this panel does
 * not offer has no footprint rule and nothing to draw. Filling either from a
 * default would put a base on the grid that nobody asked for and then print it.
 *
 * So each entry is all-or-nothing, and every drop is named — which is the same
 * contract, applied at the granularity the datum actually has. `safeParse`
 * rather than `parse` keeps the function total; the schema itself normalises
 * `-0` and folds nothing else.
 */
function salvageGenerated(input: unknown, dropped: string[]): WorkshopState['generated'] {
  const out: WorkshopState['generated'] = {}
  if (input === undefined) return out
  const source = asRecord(input)
  if (source === undefined) {
    dropped.push(`generated: expected an object, found ${describeValue(input)}`)
    return out
  }
  for (const [key, value] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(key)) {
      dropped.push(`generated.${key}: unsafe key`)
      continue
    }
    const placementId = PlacementId.safeParse(key)
    if (!placementId.success) {
      dropped.push(`generated.${key}: not a placement id`)
      continue
    }
    const placement = GeneratedPlacementSchema.safeParse(value)
    if (!placement.success) {
      dropped.push(`generated.${key}: not a generated base (${placement.error.issues[0]?.message ?? 'invalid'})`)
      continue
    }
    out[placementId.data] = placement.data
  }
  return out
}

/**
 * Recover the "has chosen" flag.
 *
 * Absent means `false`, which is the safe direction: a user who has in fact
 * chosen sees one dismissible notice, whereas defaulting to `true` would hide
 * the choice from someone who never made it. Anything present but not a boolean
 * is corruption and is reported.
 */
function salvageLockChosen(input: unknown, dropped: string[]): boolean {
  if (input === undefined) return false
  if (typeof input === 'boolean') return input
  dropped.push(`lockChosen: ${describeValue(input)} is not a boolean, reset to false`)
  return false
}

function salvageLock(input: unknown, dropped: string[]): LockSystem {
  if (input === undefined) return DEFAULT_LOCK_SYSTEM
  const parsed = LockSystemSchema.safeParse(input)
  if (parsed.success) return parsed.data
  dropped.push(`lock: ${describeValue(input)} is not a lock system, reset to ${DEFAULT_LOCK_SYSTEM}`)
  return DEFAULT_LOCK_SYSTEM
}

/**
 * Turn arbitrary input into a valid {@link WorkshopState}, keeping everything
 * readable and reporting everything discarded.
 *
 * This runs on **every** rehydrate, not only on a version change — it is wired
 * as `persist`'s `merge`, because `migrate` is called only when the stored
 * version differs from the current one. A blob that is corrupt but correctly
 * stamped `version: 1` never reaches `migrate`, so validating only there would
 * leave the most likely corruption case (a crashed tab at the current version)
 * completely unchecked.
 */
export function salvageWorkshopState(input: unknown): RecoveredState {
  const dropped: string[] = []
  const source = asRecord(input)
  if (source === undefined) {
    if (input !== undefined && input !== null) {
      dropped.push(`state: expected an object, found ${describeValue(input)}`)
    }
    return { state: defaultWorkshopState(), dropped }
  }
  return {
    state: {
      library: salvageLibrary(source.library, dropped),
      placements: salvagePlacements(source.placements, dropped),
      generated: salvageGenerated(source.generated, dropped),
      lock: salvageLock(source.lock, dropped),
      lockChosen: salvageLockChosen(source.lockChosen, dropped),
    },
    dropped,
  }
}

/* ------------------------------------------------------------------ migrating */

/**
 * Climb a persisted blob from the version it was written at to
 * {@link STORE_VERSION}, then salvage whatever comes out.
 *
 * Three cases the caller does not have to think about:
 *
 *   - **No usable version** (absent, `NaN`, a string, a float). Treated as 0, so
 *     the blob walks the whole ladder. A blob with no version stamp predates the
 *     stamp, which means it is at most version 1's shape.
 *
 *   - **A version from the future.** The blob is salvaged as if it were current
 *     rather than discarded. A downgrade is nearly always the same user on a
 *     stale tab or a rolled-back deploy, the shared fields are overwhelmingly
 *     likely to still be readable, and emptying someone's library because their
 *     browser cached yesterday's bundle is a worse failure than showing them a
 *     scene missing whatever version N+1 had added. Salvaging cannot produce an
 *     invalid state — every field is checked on the way through — so the floor
 *     is the same in both cases.
 *
 *   - **A step that throws.** Caught, and the whole blob falls back to defaults.
 *     This is the one path that loses data, which is why the steps themselves are
 *     written to tolerate garbage rather than relying on it.
 */
export function migrateWorkshopState(input: unknown, fromVersion: unknown): RecoveredState {
  const from = typeof fromVersion === 'number' && Number.isInteger(fromVersion) ? fromVersion : 0
  const start = Math.max(from, 0)
  let blob = input
  for (let version = start + 1; version <= STORE_VERSION; version += 1) {
    const step = MIGRATION_STEPS[version]
    if (step === undefined) continue
    try {
      blob = step(blob)
    } catch (error) {
      return {
        state: defaultWorkshopState(),
        dropped: [`migration to version ${String(version)} threw (${String(error)}); state reset`],
      }
    }
  }
  const recovered = salvageWorkshopState(blob)
  if (from > STORE_VERSION) {
    recovered.dropped.push(
      `state was written by version ${String(from)}, newer than ${String(STORE_VERSION)}; read best-effort`,
    )
  }
  return recovered
}
