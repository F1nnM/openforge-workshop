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
 * Recovery is *salvaging*, not all-or-nothing. One instance with a corrupt
 * coordinate drops that instance and keeps the other forty; it does not empty
 * the room. One unreadable slot fill drops that fill and keeps the instance,
 * which then reads as *needs a choice* for that slot — a state §3.2 already
 * requires the app to render. `RecoveredState.dropped` names everything
 * discarded so the caller can say so out loud instead of silently losing a
 * piece.
 *
 * ## There is no migration ladder any more, and this is the notice that says why
 *
 * Row V1 changed `library` from a map of files to a map of designs and took
 * {@link STORE_VERSION} to 4; row V4 changed a `Placement` from a file to a
 * design and took it to 5; row **A1** deleted `library` outright and replaced a
 * `Placement` with a {@link TemplateInstance} — a template plus a map of
 * per-slot fills — and took it to 6. None of them wrote a rung, and the reason
 * is a decision the project owner made explicitly:
 *
 * > *"Still the rule holds true that it's not used live yet, so no data
 * > migration or backwards compatibility needs to be considered. So discarding
 * > an old user library is totally fine if it makes the new library system code
 * > better."*
 *
 * Nothing is deployed. There is no browser holding a version 1, 2, 3, 4 or 5
 * blob except a developer's own, so the rungs that used to climb 1 → 2 → 3 were
 * code that could never run again — kept for a hypothetical, which is exactly
 * the no-op the standing instruction says to clean up. They are gone, and with
 * them `MigrationStep`, `MIGRATION_STEPS` and the loop that walked them.
 *
 * **A second reason to delete rather than keep, and row A1 made it decisive.**
 * V1's and V4's rung was merely *unwritable at hydrate time*: a `TileId` carries
 * no design, `DesignId` is a hash of a *tag set*, and the tags live in
 * `catalog.json` — 5.6 MB fetched asynchronously, long after `persist` has
 * already run `migrate` synchronously inside `create(...)`. Deferring it until a
 * catalog was in hand was at least conceivable.
 *
 * A1's rung is not unwritable but **underdetermined**, which is a different and
 * worse thing. A version 5 placement is one design on one cell. A version 6
 * placement is a template family plus a fill per slot, and §2.5 generates **52
 * families**: nothing in a design says which family a user meant, and even
 * given one, the other slots' fills would have to be *invented* by the solver.
 * A rung would therefore not recover a room — it would author a new one and
 * present it as the user's. §3.4 already names that class of failure ("a
 * plausible room nobody chose") as the cost of default fills at *placement*
 * time, where a user is watching. Doing it to a saved room at hydrate time,
 * with nobody watching, is the same failure with the disclosure removed.
 *
 * So the choice is not "map or discard"; it is "discard, or fabricate". This
 * module discards, and says so out loud.
 *
 * ### When this licence expires — read this before shipping
 *
 * **The moment a build of this app is served to a user who is not a developer,
 * discarding stops being allowed.** A real user's saved room is not disposable,
 * and there is no way to tell from inside the process whether the blob under
 * `STORAGE_KEY` belongs to a colleague or a stranger. So the expiry is a fact
 * about deployment, not about the code, and it will pass silently unless someone
 * remembers this paragraph. `migrations.test.ts` carries the closest in-repo
 * proxy for it — a guard on `package.json`'s major version, which fails the day
 * this repo calls itself 1.0.0 — and that guard exists to make the reminder
 * arrive by itself rather than to prove anything.
 *
 * **What to do when it expires**, so the next author does not have to rediscover
 * it: reintroduce `MIGRATION_STEPS` as `Readonly<Record<number, (input:
 * unknown) => unknown>>` keyed by the version each rung *produces*, walk it from
 * the stored version to {@link STORE_VERSION} inside the `try` that
 * {@link readPersistedState} already has, and keep {@link salvageWorkshopState}
 * as the step that runs afterwards either way. Every rung must take `unknown`
 * and return `unknown` — a typed signature is a lie about data that came from
 * `localStorage`, and it is what makes an author write `input.placements.map(…)`
 * and ship a `TypeError` to every user whose blob was truncated.
 *
 * **And know which of the two kinds of rung you are writing.** A 5 → 6 rung is
 * the underdetermined kind described above, and the honest answer for it is not
 * a rung at all: park the unconvertible placements somewhere the *user* can see
 * them and let them re-place, rather than guessing a family and a fill set on
 * their behalf. A future N → N+1 that adds a field, or renames one, is the
 * ordinary kind and needs none of that.
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
 *
 * `salvageLibrary` **did** go, with the field it read. It was the only reader in
 * the app that parsed a key as a `TileId` in order to *recognise* an older
 * shape, so the `TileId`/`DesignId` lexical disjointness rows V1 and V4 relied
 * on is no longer load bearing anywhere; `corpus.test.ts` stopped measuring it
 * for that reason.
 */
import { TileId } from '@/catalog'
import { GENERATED_ID_PREFIX, GeneratedPlacement as GeneratedPlacementSchema } from '@/generator/placement/scene'

import type { LockSystem, SlotFill, TemplateId, TemplateInstance, WorkshopState } from './schema'
import {
  DEFAULT_LOCK_SYSTEM,
  LockSystem as LockSystemSchema,
  PlacementId,
  SlotName as SlotNameSchema,
  TemplateId as TemplateIdSchema,
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
 * | 5 | a `Placement` holds `design`, not `tileId` (row V4) |
 * | 6 | `library` is **deleted**; a placement is a {@link TemplateInstance} — a template id plus a fill per slot (row A1) |
 *
 * **To ship version N+1 while discarding is still allowed:** change the schema in
 * `schema.ts` and bump this. Nothing else. A blob at any other version is
 * discarded by the gate below, and `migrations.test.ts` asserts that every
 * version in the table above is in fact discarded rather than half-read.
 *
 * **To ship version N+1 once it is not:** see the expiry note in the module
 * docblock.
 */
export const STORE_VERSION = 6

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
 * = value` invokes the prototype setter instead of defining a property.
 *
 * Checked at **three** levels since row A1, not two: the placement and generated
 * maps, and now every `fills` map inside a placement. A slot name is
 * `z.string().min(1)` — the loosest key schema in the store, because the
 * authority on what a slot is called is the template — so `fills` is the one
 * place where a `__proto__` key is not even ruled out by the key's own shape.
 * A `PlacementId` is a UUID and a {@link TemplateId} is a lowercase slug, so
 * neither of the other two levels has ever been exposed; they keep the check
 * because it costs a set lookup and because relying on a key pattern to defend
 * the prototype is the kind of reasoning that breaks when the pattern loosens.
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
 * The field names earlier versions kept a placement's identity under.
 *
 * Versions 1–4 wrote `tileId`; version 5 wrote `design`. Both are recognised by
 * *name* rather than by the shape of their value, which is what makes the check
 * capable where {@link TemplateId}'s pattern is not: a `DesignId` is `d` plus
 * twelve hex characters and **parses as a template id**, so a value-shaped check
 * could not tell a version 5 identity from a legitimate slug. `schema.ts`'s
 * `TemplateId` docblock has the full argument.
 */
const LEGACY_IDENTITY_FIELDS: readonly (readonly [field: string, held: string])[] = [
  ['tileId', 'a file'],
  ['design', 'an item'],
]

/**
 * Recover the identity of one placement — a {@link TemplateId}, since row A1.
 *
 * Three arms, and each one exists for a shape that is genuinely reachable:
 *
 *   - **An old field name.** Every version 1–4 blob wrote `tileId` and every
 *     version 5 blob wrote `design`, so `template` is *missing* rather than
 *     wrong, and "template is not a template id (undefined)" would describe the
 *     symptom while naming neither the field that is there nor the version that
 *     wrote it. The version gate should already have discarded such a blob
 *     wholesale; this catches the residue it cannot see, which is real —
 *     `persist` sends an *unstamped* blob straight to `merge` without consulting
 *     the gate at all (see {@link readPersistedState}).
 *   - **A `gen:` id.** A generated base lives in the `generated` map and is not a
 *     template: it has no slots and nothing to fill them. One in this slot would
 *     draw nothing, price nothing and be unremovable. **This arm no longer
 *     changes the outcome** — `TemplateId`'s pattern rejects a colon, so the
 *     entry would be dropped anyway — and it is kept for the *message*, which is
 *     the only thing a reader of the console warning gets. `generated.test.ts`
 *     asserts that sentence, so deleting the arm still fails, for a reason one
 *     step removed from the one the pre-A1 docblock gave.
 *   - **Anything else**, named with what was found.
 *
 * Every drop is **named** rather than silent, because a dangling identity kept
 * here would be a piece of the room that renders nowhere and cannot be removed
 * through any button in the app, and dropping it in silence is the same loss
 * with nothing said. Named and dropped is the module's standing policy.
 */
function salvageTemplate(key: string, source: Record<string, unknown>, dropped: string[]): TemplateId | undefined {
  const value = source.template
  if (value === undefined) {
    for (const [field, held] of LEGACY_IDENTITY_FIELDS) {
      if (source[field] === undefined) continue
      dropped.push(`placements.${key}: names ${held} in the old ${field} field — a placement holds a template now`)
      return undefined
    }
  }
  if (typeof value === 'string' && value.startsWith(GENERATED_ID_PREFIX)) {
    dropped.push(`placements.${key}: template is a generated base id, which belongs in the generated map`)
    return undefined
  }
  const template = TemplateIdSchema.safeParse(value)
  if (template.success) return template.data
  dropped.push(`placements.${key}: template is not a template id (${describeValue(value)})`)
  return undefined
}

/**
 * Recover one slot fill.
 *
 * The two fields fail differently, and the asymmetry is the whole content of
 * this function:
 *
 *   - **`tile` has no default.** A fill whose file is unreadable is not a fill;
 *     dropping the entry leaves the slot absent, which the app already renders
 *     as *needs a choice* (§3.2). Inventing a file would put an STL in
 *     somebody's download that they never chose.
 *   - **`pinned` falls back to `false`, and says so.** Absence has never been a
 *     legal shape — version 6 is the first version with fills at all — so it is
 *     corruption and is reported rather than accepted silently the way an absent
 *     `lockChosen` is. The *direction* is what matters: `false` means the solver
 *     chose it, so the next lock change re-solves the slot and repairs the
 *     damage, while `true` would freeze a choice the user never made,
 *     permanently and invisibly. Contract **C-k** is about exactly that bit
 *     staying honest.
 */
function salvageFill(key: string, slot: string, value: unknown, dropped: string[]): SlotFill | undefined {
  const source = asRecord(value)
  if (source === undefined) {
    dropped.push(`placements.${key}.fills.${slot}: expected an object, found ${describeValue(value)}`)
    return undefined
  }
  const tile = TileId.safeParse(source.tile)
  if (!tile.success) {
    dropped.push(`placements.${key}.fills.${slot}: tile is not a file id (${describeValue(source.tile)})`)
    return undefined
  }
  if (typeof source.pinned === 'boolean') return { tile: tile.data, pinned: source.pinned }
  dropped.push(
    `placements.${key}.fills.${slot}: pinned is not a boolean (${describeValue(source.pinned)}), read as auto`,
  )
  return { tile: tile.data, pinned: false }
}

/**
 * Recover an instance's fills.
 *
 * **An absent or unreadable `fills` is an empty map, not a dropped instance**,
 * and that is contract **C-g** read backwards. §3.2 requires a template to be
 * placeable with a slot it has no candidate for, so *no* number of unfilled
 * slots makes an instance invalid — which means the reader has no threshold at
 * which to give up on one. An instance with nothing filled is a template on the
 * grid asking for five choices, which is a state the builder can draw, price as
 * incomplete and let the user finish.
 *
 * Per-entry, for {@link salvageInstance}'s reason at one level down: one
 * unreadable fill costs that slot and not the other four.
 */
function salvageFills(key: string, value: unknown, dropped: string[]): TemplateInstance['fills'] {
  const out: TemplateInstance['fills'] = {}
  if (value === undefined) return out
  const source = asRecord(value)
  if (source === undefined) {
    dropped.push(`placements.${key}: fills is not an object (${describeValue(value)}), read as unfilled`)
    return out
  }
  for (const [slot, fill] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(slot)) {
      dropped.push(`placements.${key}.fills.${slot}: unsafe key`)
      continue
    }
    const name = SlotNameSchema.safeParse(slot)
    if (!name.success) {
      dropped.push(`placements.${key}.fills.${slot}: not a slot name`)
      continue
    }
    const salvaged = salvageFill(key, slot, fill, dropped)
    if (salvaged !== undefined) out[name.data] = salvaged
  }
  return out
}

/**
 * Recover one template instance.
 *
 * Four kinds of failure, and they are four because the data has four:
 *
 *   - A missing or unreadable **rotation** falls back to 0, because 0 is a legal
 *     rotation and an unrotated instance in the right place is a recognisable
 *     scene.
 *   - A missing or unreadable **coordinate** drops the instance, because there
 *     is no safe default: falling back to 0 would silently stack every corrupt
 *     piece on the origin, which reads as a bug in the builder rather than as
 *     recovered data.
 *   - The **identity** has no default at all, so an unreadable one drops the
 *     instance. See {@link salvageTemplate}.
 *   - The **fills** never drop the instance. See {@link salvageFills}.
 *
 * ## The map key wins over the `id` field
 *
 * `schema.ts` puts `id` inside the instance as well as using it as the map key,
 * because an instance travels detached from the map. That makes a disagreement
 * expressible, and this is the one place it is resolved: the field is rewritten
 * from the key and the disagreement is **named**. The key is what every reader
 * of the map addresses by — `state.placements[id]` is the lookup the whole app
 * makes — so trusting the field instead would produce an instance that cannot be
 * found by its own id. Silence was the other option and it is worse: a blob
 * written by a build with a genuine aliasing bug would round-trip clean and the
 * bug would never surface.
 */
function salvageInstance(key: PlacementId, value: unknown, dropped: string[]): TemplateInstance | undefined {
  const source = asRecord(value)
  if (source === undefined) {
    dropped.push(`placements.${key}: expected an object, found ${describeValue(value)}`)
    return undefined
  }
  const template = salvageTemplate(key, source, dropped)
  if (template === undefined) return undefined
  if (source.id !== undefined && source.id !== key) {
    dropped.push(`placements.${key}: id field says ${describeValue(source.id)}; the map key wins`)
  }
  const x = salvageCoordinate(key, 'x', source.x, dropped)
  const z = salvageCoordinate(key, 'z', source.z, dropped)
  if (x === undefined || z === undefined) return undefined
  const fills = salvageFills(key, source.fills, dropped)

  if (source.rotation === undefined || typeof source.rotation === 'number') {
    return { id: key, template, x, z, rotation: normalizeRotation(source.rotation ?? 0), fills }
  }
  dropped.push(`placements.${key}: rotation is not a number (${describeValue(source.rotation)}), reset to 0`)
  return { id: key, template, x, z, rotation: 0, fills }
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
    const instance = salvageInstance(placementId.data, value, dropped)
    if (instance !== undefined) out[placementId.data] = instance
  }
  return out
}

/**
 * Recover the generated bases.
 *
 * Delegated to row S5's own schema rather than field-checked here, and the
 * asymmetry with {@link salvageInstance} is deliberate. A `TemplateInstance` is
 * three scalars, an id and a map, so this module can salvage it *partially* — a
 * bad rotation falls back to 0 and keeps the piece where it is, and a bad fill
 * costs one slot. A `GeneratedPlacement` carries a whole parameter set, and
 * there is no partial reading of one: a recipe missing a `-D` is a different
 * base, and a recipe naming an entry point this panel does not offer has no
 * footprint rule and nothing to draw. Filling either from a default would put a
 * base on the grid that nobody asked for and then print it.
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
 * oversight. The version stamp cannot see it either — the disagreement is
 * expressible *within* one version, so no gate on the stamp can catch it.
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
 * correctly stamped at the current version never reaches the gate, so validating
 * only there would leave the most likely corruption case (a crashed tab at the
 * current version) completely unchecked.
 *
 * A `library` key in the input is **not** reported. It is not corruption of the
 * current shape; it is a field that no longer exists, and the whole of row A1's
 * policy is that a blob written before the change is discarded by the stamp. On
 * the unstamped path an old `library` simply has no reader and no effect, and a
 * message about it would tell the user about a feature the build no longer has.
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
 * mismatch is a screen full of pieces that resolve to nothing.
 *
 * **What this costs, stated rather than buried.** The reader it replaced
 * salvaged a *newer* blob best-effort, arguing that a downgrade is nearly always
 * the same user on a stale tab or a rolled-back deploy and that emptying
 * someone's room over a cached bundle is the worse failure. That argument was
 * right and is now moot: with nothing deployed there is no such user, and the
 * shared fields it relied on being "overwhelmingly likely to still be readable"
 * are precisely what rows V1, V4 and **A1** changed underneath. A1 is the
 * sharpest case yet — a version 5 placement is one design on a cell and a
 * version 6 placement is a family with a fill per slot, so best-effort reading
 * would not produce a degraded room but an *empty* one, with every piece
 * silently missing and nothing on screen able to say which. The day the argument
 * comes back, so must a rung; see the module docblock, including why a 5 → 6
 * rung would have to fabricate rather than convert.
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
 *      blob**, which is why {@link salvageTemplate} recognises an old identity
 *      field by name rather than trusting this gate to have caught the shape
 *      first. That check is not belt-and-braces; it is the sole reader of the one
 *      path the gate cannot see. `migrations.test.ts` asserts both halves.
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
