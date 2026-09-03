/**
 * OpenForge Workshop — reading persisted state that may be anything at all.
 *
 * {@link readPersistedState} is the one function in the app whose input is
 * genuinely arbitrary. Everything else reads either the build-time catalog
 * (validated once by CI) or data the app itself just produced. This reads
 * whatever is sitting under a `localStorage` key, which can be:
 *
 *   - a scene written by a version that shipped months ago;
 *   - a scene written by a version that **never** shipped, because a preview
 *     deploy or a local dev build shared the same origin;
 *   - half a scene, because the tab was killed mid-write;
 *   - a scene from a *newer* build, when the user opens an older cached tab;
 *   - something hand-edited in devtools;
 *   - a JSON document that has nothing to do with this app.
 *
 * A reader that assumes well-formed input throws during hydration, and a throw
 * during hydration is a white screen on the app's own home page with the poison
 * still in storage — every reload reproduces it. So the contract for everything
 * in this file is: **total function, never throws, always returns a valid
 * {@link WorkshopState}.** `migrations.test.ts` is the proof, and it is the point
 * of this module rather than an accessory to it.
 *
 * Recovery is *salvaging*, not all-or-nothing. One placement with a corrupt
 * coordinate drops that placement and keeps the other forty; it does not empty
 * the room. `RecoveredState.dropped` names everything discarded so the caller
 * can say so out loud instead of silently losing a tile.
 *
 * ## There is no migration ladder any more, and this is the notice that says why
 *
 * Row V1 changed `library` from a map of files to a map of designs and took
 * {@link STORE_VERSION} to 4. It did **not** write a rung that maps a saved
 * `TileId` to its design, and the reason is a decision the project owner made
 * explicitly:
 *
 * > *"Still the rule holds true that it's not used live yet, so no data
 * > migration or backwards compatibility needs to be considered. So discarding
 * > an old user library is totally fine if it makes the new library system code
 * > better."*
 *
 * Nothing is deployed. There is no browser holding a version 1, 2 or 3 blob
 * except a developer's own, so the two rungs that used to climb 1 → 2 → 3 were
 * code that could never run again — kept for a hypothetical, which is exactly
 * the no-op the standing instruction says to clean up. They are gone, and with
 * them `MigrationStep`, `MIGRATION_STEPS` and the loop that walked them.
 *
 * **A second reason to delete rather than keep.** The rung V1 was asked for could
 * not have been written at all: a `TileId` carries no design, `DesignId` is a
 * hash of a *tag set*, and the tags live in `catalog.json` — 5.6 MB fetched
 * asynchronously, long after `persist` has already run `migrate` synchronously
 * inside `create(...)`. A rung has no catalog and can never get one. So the
 * choice was never "map or discard"; it was "discard, or invent a second
 * persisted field to park unresolved files in and a second policy for draining
 * it". Discarding is the honest half of that pair.
 *
 * ### When this licence expires — read this before shipping
 *
 * **The moment a build of this app is served to a user who is not a developer,
 * discarding stops being allowed.** A real user's saved room and library are not
 * disposable, and there is no way to tell from inside the process whether the
 * blob under `STORAGE_KEY` belongs to a colleague or a stranger. So the
 * expiry is a fact about deployment, not about the code, and it will pass
 * silently unless someone remembers this paragraph. `migrations.test.ts` carries
 * the closest in-repo proxy for it — a guard on `package.json`'s major version,
 * which fails the day this repo calls itself 1.0.0 — and that guard exists to
 * make the reminder arrive by itself rather than to prove anything.
 *
 * **What to do when it expires**, so the next author does not have to rediscover
 * it: reintroduce `MIGRATION_STEPS` as `Readonly<Record<number, (input:
 * unknown) => unknown>>` keyed by the version each rung *produces*, walk it from
 * the stored version to {@link STORE_VERSION} inside the `try` that
 * {@link readPersistedState} already has, and keep {@link salvageWorkshopState}
 * as the step that runs afterwards either way. Every rung must take `unknown`
 * and return `unknown` — a typed signature is a lie about data that came from
 * `localStorage`, and it is what makes an author write `input.placements.map(…)`
 * and ship a `TypeError` to every user whose blob was truncated. Two shapes
 * needing a rung are already known: this row's `library` (files → designs, which
 * needs a catalog and therefore cannot run at hydrate — park and drain, or
 * resolve on the library screen's first render) and row V4's `Placement`.
 *
 * ## What did *not* go
 *
 * {@link salvageWorkshopState} stays, entire. It is not backwards compatibility:
 * it defends against a **current-version** blob that is corrupt anyway — a tab
 * killed mid-write, a hand edit, a `__proto__` key out of `JSON.parse` — and it
 * runs on every rehydrate rather than only on a version change. Deleting it
 * would leave the most likely corruption case completely unchecked, which is the
 * argument `workshopStore.ts` makes for wiring it into `merge` as well as into
 * `migrate`.
 */
import { DesignId, TileId } from '@/catalog'
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
 * Set from the first commit, together with the reader beside it, because
 * retrofitting a version stamp is far harder than starting with one: without it,
 * the first breaking change has to guess at the shape of every blob already in
 * every user's browser. That reasoning is unchanged by the ladder's removal —
 * the stamp is what makes a foreign shape *recognisable*, and recognising it is
 * the whole of {@link readPersistedState}'s job.
 *
 * **History, kept because a future rung author will need to know what shipped:**
 *
 * | version | shape |
 * | ------: | --- |
 * | 1 | `library` (files), `placements`, `lock` |
 * | 2 | adds `lockChosen` |
 * | 3 | adds `generated` — recipes and positions, never meshes |
 * | 4 | `library` is keyed by **design**, not by file (row V1) |
 *
 * **To ship version N+1 while discarding is still allowed:** change the schema in
 * `schema.ts` and bump this. Nothing else. A blob at any other version is
 * discarded by the gate below, and `migrations.test.ts` asserts that every
 * version in the table above is in fact discarded rather than half-read.
 *
 * **To ship version N+1 once it is not:** see the expiry note in the module
 * docblock.
 */
export const STORE_VERSION = 4

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
 * legitimate key is affected: a `DesignId` is `d` plus twelve hex characters, a
 * `TileId` always starts `tiles/` and a `PlacementId` is a UUID.
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

/**
 * Recover the library — a set of {@link DesignId}s.
 *
 * `DesignId` is `z.string().min(1)`, which accepts far more than a design id: it
 * would accept a `TileId`, and a `TileId` in this map is not a hypothetical but
 * the *exact* shape every version 1–3 blob had. So a key that parses as a tile
 * id is rejected here and named, and the check is capable rather than decorative
 * because the two spaces are lexically disjoint — `^tiles/…` against `d` plus
 * twelve hex characters, 0 of the corpus's 3,822 design ids starting `tiles/`
 * (`corpus.test.ts`).
 *
 * The version gate should already have discarded any such blob wholesale; this
 * catches the residue it cannot see — a hand edit, or a preview build that wrote
 * an old library under the current stamp. **Rejecting is the point.** A dangling
 * file id kept in this map would resolve to no record, so it would render
 * nowhere, count towards the header's tally, and be unremovable through any
 * button in the app; dropping it *silently* would be the same loss without the
 * message. Named and dropped is the module's standing policy for a datum it
 * cannot read, and this is that policy applied one level down.
 */
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
    if (TileId.safeParse(key).success) {
      dropped.push(`library.${key}: a file id, not a design id — the library holds items now`)
      continue
    }
    const design = DesignId.safeParse(key)
    if (!design.success) {
      dropped.push(`library.${key}: not a design id`)
      continue
    }
    // `false` is not corruption — it is the absence of a membership, which a
    // set expresses by omitting the key. Anything else is corruption.
    if (value === false) continue
    if (value !== true) {
      dropped.push(`library.${key}: expected true, found ${describeValue(value)}`)
      continue
    }
    out[design.data] = true
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
 * to 0 and keeps the tile where it is. A `GeneratedPlacement` carries a whole
 * parameter set, and there is no partial reading of one: a recipe missing a `-D`
 * is a different base, and a recipe naming an entry point this panel does not
 * offer has no footprint rule and nothing to draw. Filling either from a default
 * would put a base on the grid that nobody asked for and then print it.
 *
 * So each entry is all-or-nothing, and every drop is named — which is the same
 * contract, applied at the granularity the datum actually has. `safeParse`
 * rather than `parse` keeps the function total; the schema itself normalises
 * `-0` and folds nothing else.
 *
 * **What this deliberately does not check**, because row X10 found it and it is
 * still true: `GeneratedPlacement` does not cross-check `base` against `recipe`,
 * so a blob whose `base` names a different recipe than the one beside it parses
 * clean. It cannot be checked here. Proving the pair consistent needs
 * `recipeKey`, which needs `@/generator/panel/schemas` and its 25 KB of pinned
 * parameter JSON — a measured 20,168 B added to this module's file closure, and
 * `src/generator/placement/scene.ts`'s docblock and `boundary.test.ts` hold that
 * line on purpose. So the hole stays exactly the size X10 measured: not widened,
 * not closed, and named here so the next reader does not mistake it for an
 * oversight. Version 4's discard does not touch it — the disagreement is
 * expressible *within* one version, so no gate on the version stamp can see it.
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
 * as `persist`'s `merge`, because the version gate is called only when the
 * stored version differs from the current one. A blob that is corrupt but
 * correctly stamped `version: 4` never reaches the gate, so validating only
 * there would leave the most likely corruption case (a crashed tab at the
 * current version) completely unchecked.
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

/* --------------------------------------------------------------- version gate */

/**
 * Read a persisted blob that claims to be at `storedVersion`.
 *
 * One branch, and it is symmetric: **the stamp is {@link STORE_VERSION} or the
 * blob is discarded.** Older, newer, absent, `NaN`, a string, a float — all the
 * same answer, a fresh state and one line in `dropped` naming what the stamp
 * said. Symmetry is the reason it is written this way rather than as three cases:
 * a gate with a direction has a wrong side, and the wrong side of a shape
 * mismatch is a screen full of items that resolve to nothing.
 *
 * **What this costs, stated rather than buried.** The reader it replaced
 * salvaged a *newer* blob best-effort, arguing that a downgrade is nearly always
 * the same user on a stale tab or a rolled-back deploy and that emptying
 * someone's library over a cached bundle is the worse failure. That argument was
 * right and is now moot: with nothing deployed there is no such user, and the
 * shared fields it relied on being "overwhelmingly likely to still be readable"
 * are precisely what row V1 changed underneath — a version 3 library is a map of
 * files, and reading it as a map of items produces entries that name nothing.
 * The day the argument comes back, so must a rung; see the module docblock.
 *
 * Total, like everything else here. The salvage that follows a matching stamp is
 * wrapped so that a throw from anywhere inside it costs the scene rather than
 * the app: a `RangeError` out of a pathological `Object.entries`, say. Nothing in
 * `salvage*` is expected to throw and nothing in the suite makes it — the `try`
 * is there because the alternative to a caught throw here is a white screen with
 * the poison still in storage.
 *
 * ## What this function is never called with, and it is not what the old
 * docblock claimed
 *
 * The reader this replaced documented three cases it handled, one of them *"no
 * usable version (absent, `NaN`, a string, a float) — treated as 0, so the blob
 * walks the whole ladder"*. **On the `localStorage` path that case was
 * unreachable, and had been since the first commit.** `zustand/middleware`'s
 * `persist` guards the call:
 *
 * ```js
 * if (typeof deserializedStorageValue.version === 'number' && deserializedStorageValue.version !== options.version)
 * ```
 *
 * so a blob whose stamp is absent, a string, `null` or `NaN` never reaches
 * `migrate` at all — it goes straight to `merge`, which is
 * {@link salvageWorkshopState}, and is read as though it were current. A
 * *fractional* stamp does reach it, being a number.
 *
 * Two consequences, both real:
 *
 *   1. **{@link salvageWorkshopState} is the only defence for an unstamped
 *      blob**, which is why `salvageLibrary` rejects a `TileId` key rather than
 *      trusting this gate to have caught the shape first. That check is not
 *      belt-and-braces; it is the sole reader of the one path the gate cannot
 *      see. `migrations.test.ts` asserts both halves.
 *   2. **The only caller that exercises the non-numeric cases is
 *      `transfer.ts`**, where the version comes out of a file rather than out of
 *      `persist` — and that caller now refuses a mismatch before calling this at
 *      all.
 *
 * Nothing here tries to defeat the guard: no blob this app has ever written is
 * unstamped (the stamp was set in the first commit), so an unstamped blob is a
 * hand edit or foreign JSON, and reading it best-effort with every unreadable
 * field named is the right answer for both.
 */
export function readPersistedState(input: unknown, storedVersion: unknown): RecoveredState {
  if (storedVersion !== STORE_VERSION) {
    return {
      state: defaultWorkshopState(),
      dropped: [
        `state was written at version ${describeValue(storedVersion)}, and this build reads only ` +
          `${String(STORE_VERSION)}; discarded and started fresh`,
      ],
    }
  }
  try {
    return salvageWorkshopState(input)
  } catch (error) {
    return {
      state: defaultWorkshopState(),
      dropped: [`reading version ${String(STORE_VERSION)} state threw (${String(error)}); discarded`],
    }
  }
}
