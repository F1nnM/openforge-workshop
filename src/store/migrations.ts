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
 * about deployment, not about the code, and it would pass silently unless
 * someone remembered this paragraph.
 *
 * ### The licence has expired, and this is what changed
 *
 * **The app is served at its public URL.** So the paragraph above is no longer a
 * warning, it is history: from version 8 onwards a stored blob can belong to
 * somebody this project has never met, and their room is not ours to throw away.
 *
 * The consequences are exactly three, and no more:
 *
 *   1. **Versions 1–7 are still discarded, and that is not a leftover.** None of
 *      them was ever served to anyone — no browser outside a developer's holds
 *      one — so the owner's decision still covers them, and a 5 → 6 rung would
 *      still have to *fabricate* a room rather than convert one.
 *   2. **Version 8 is climbed.** It is the shape that shipped, so
 *      {@link readPersistedState} accepts its stamp. The rung is the identity
 *      (see {@link STORE_VERSION}), which is a fact about this particular change
 *      rather than a policy: `holds` is additive and *absent* is a correct
 *      reading of every version 8 fill.
 *   3. **Every future shape change needs a rung**, written at the same time as
 *      the bump, and the mechanism is {@link READABLE_VERSIONS} being a list of
 *      **literal** numbers: moving {@link STORE_VERSION} without touching it
 *      leaves the new current version outside the readable set, so the gate
 *      discards the app's own writes and `migrations.test.ts` goes red at once.
 *      That replaced the `package.json` major-version reminder that used to
 *      stand in for the expiry — a reminder about an event that has already
 *      happened is a no-op, and this repo cleans those up.
 *
 * **How to write the next rung**, so the next author does not have to rediscover
 * it: for anything less trivial than this one, reintroduce `MIGRATION_STEPS` as
 * `Readonly<Record<number, (input: unknown) => unknown>>` keyed by the version
 * each rung *produces*, walk it from the stored version to
 * {@link STORE_VERSION} inside the `try` that {@link readPersistedState} already
 * has, and keep {@link salvageWorkshopState} as the step that runs afterwards
 * either way. Every rung must take `unknown` and return `unknown` — a typed
 * signature is a lie about data that came from `localStorage`, and it is what
 * makes an author write `input.placements.map(…)` and ship a `TypeError` to
 * every user whose blob was truncated.
 *
 * **And know which of the two kinds of rung you are writing.** A 5 → 6 rung is
 * the underdetermined kind described above, and the honest answer for it is not
 * a rung at all: park the unconvertible placements somewhere the *user* can see
 * them and let them re-place, rather than guessing a family and a fill set on
 * their behalf. A future N → N+1 that adds a field, or renames one, is the
 * ordinary kind — 8 → 9 is that kind at its easiest, an addition whose absent
 * reading is already right.
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

import type { HoldFill, HoldName, LockSystem, SlotFill, TemplateId, TemplateInstance, WorkshopState } from './schema'
import {
  DEFAULT_LOCK_SYSTEM,
  HoldName as HoldNameSchema,
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
 * | 7 | adds `design` — the room-wide design family, a `texture` root or absent (row D6) |
 * | 8 | a {@link TemplateInstance} adds `filters` — the control filters it was placed at |
 * | 9 | a {@link SlotFill} adds `holds` — the accessories fitted into that file's own mounts |
 *
 * **Version 9 is the first bump with a rung under it, and 8 → 9 is the
 * identity.** Not because writing one was too much trouble: `holds` is additive
 * and an absent one means *never solved*, which is exactly and precisely what
 * every version 8 fill is. There is nothing to convert, so the rung is the
 * absence of a conversion rather than a missing one — and {@link readPersistedState}
 * accepts the stamp instead of discarding it. That is the whole difference the
 * expired licence makes; see the module docblock.
 *
 * **Row 8's bump is additive too, and bumps for the same reason.** `filters` is
 * one field with a defaulted absent reading — `[]`, which is *any* on every axis
 * and exactly the state every instance placed before it existed was in — so a
 * version 7 blob read as a version 8 one would in fact come back correct. That
 * is the argument for not bumping, and it is refused here as it was for `design`:
 * one version number must name one shape.
 *
 * **Row D6's bump is the *additive* kind, and it bumps anyway.** `design` is one
 * optional field whose absent reading is the shipped default, so a version 6
 * blob read as a version 7 one would in fact come back correct — which is
 * exactly the argument for not bumping, and it is refused for the reason the
 * stamp exists at all: **one version number must name one shape.** Versions 2
 * and 3 were additions too (`lockChosen`, `generated`) and both moved the stamp;
 * leaving it here would make `6` name two shapes and would put the next author
 * in the position the first commit's docblock describes — *"the first breaking
 * change has to guess at the shape of every blob already in every user's
 * browser"*. What that bump cost was a developer's own saved room, which is
 * precisely the licence row A1 relied on — and which has since expired. A bump
 * costs nobody's room now, because a bump comes with a rung; see the module
 * docblock.
 *
 * **To ship version N+1 now that discarding is no longer allowed:** change the
 * schema in `schema.ts`, bump this, and **write the rung from N** — add N+1 to
 * {@link READABLE_VERSIONS} and convert N, which is the identity only when the
 * change is additive with a correct absent reading, as this one is. You cannot
 * forget: that list holds literal numbers rather than arithmetic on this
 * constant, so a bump on its own leaves N+1 *unreadable*, the gate discards the
 * app's own writes, and `migrations.test.ts` fails on the current version and on
 * the one below it. A blob older than the list is discarded by the gate below,
 * which is licensed only because versions 1–7 were never served to anyone.
 */
export const STORE_VERSION = 9

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
 * Recover **a file and who chose it** — the half a slot fill and a hold share.
 *
 * Called at two depths, which is why it takes a `path` instead of building one:
 * `placements.…fills.floor` for a slot's own fill and
 * `placements.…fills.floor.holds.torch` for what is fitted into it. One reader
 * for both is not a tidiness argument — it is the only way the two levels cannot
 * disagree about the fallback direction below.
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
function salvageHoldFill(path: string, value: unknown, dropped: string[]): HoldFill | undefined {
  const source = asRecord(value)
  if (source === undefined) {
    dropped.push(`${path}: expected an object, found ${describeValue(value)}`)
    return undefined
  }
  const tile = TileId.safeParse(source.tile)
  if (!tile.success) {
    dropped.push(`${path}: tile is not a file id (${describeValue(source.tile)})`)
    return undefined
  }
  if (typeof source.pinned === 'boolean') return { tile: tile.data, pinned: source.pinned }
  dropped.push(`${path}: pinned is not a boolean (${describeValue(source.pinned)}), read as auto`)
  return { tile: tile.data, pinned: false }
}

/**
 * Recover one slot fill: a {@link HoldFill}, plus whatever is fitted into it.
 *
 * `path` is threaded through {@link salvageHoldFill} rather than rebuilt at each
 * level, which is what lets one shape check serve both depths — a hold *is* a
 * fill (`schema.ts#SlotFill`), so a second copy of the tile-and-pinned reading
 * would be two places for the `pinned` fallback direction to drift apart.
 */
function salvageFill(key: string, slot: string, value: unknown, dropped: string[]): SlotFill | undefined {
  const path = `placements.${key}.fills.${slot}`
  const fill = salvageHoldFill(path, value, dropped)
  if (fill === undefined) return undefined
  const holds = salvageHolds(path, asRecord(value)?.holds, dropped)
  return holds === undefined ? fill : { ...fill, holds }
}

/**
 * Recover a fill's holds — the accessories fitted into the file it names.
 *
 * ## Three states in, three states out
 *
 * `undefined` means *never solved* and `{}` means *solved*, and `schema.ts` sets
 * out why the app cannot do without the distinction. So this function has two
 * ways of returning nothing and they mean opposite things, which decides both of
 * its fallbacks:
 *
 *   - **An absent `holds` is `undefined`, silently.** It is what every version 8
 *     fill and every fresh one looks like, so it is the ordinary state rather
 *     than a drop.
 *   - **An unreadable `holds` is `undefined`, and is named.** The repairable
 *     direction, exactly as `pinned` falls back to `false`: *never solved* is
 *     fixed by the next default-hold pass, where `{}` would tell that pass this
 *     file had been considered and freeze an answer nobody gave. This is the one
 *     place the reading differs from {@link salvageFills}, which has no such
 *     tri-state and reads an unreadable map as empty.
 *
 * A **present** map whose entries are all corrupt still returns `{}`: the map
 * being there is what says the fill was solved, and the entries are per-accessory
 * for {@link salvageFills}' reason one level down — one unreadable torch costs
 * that socket and not the wall.
 *
 * ## Nesting is refused by name
 *
 * {@link HoldFill} has no `holds` field, so a nested one cannot be *expressed* —
 * but a blob can still carry it, and Zod would strip it in silence. It is
 * reported instead, and the whole hold is dropped rather than flattened: a value
 * shaped like something this build cannot read was written by something that is
 * not this build, and quietly keeping half of it is how a shape mismatch turns
 * into a room that is subtly not the user's.
 */
function salvageHolds(path: string, value: unknown, dropped: string[]): SlotFill['holds'] {
  if (value === undefined) return undefined
  const source = asRecord(value)
  if (source === undefined) {
    dropped.push(`${path}: holds is not an object (${describeValue(value)}), read as never solved`)
    return undefined
  }
  const out: Record<HoldName, HoldFill> = {}
  for (const [hold, held] of Object.entries(source)) {
    if (UNSAFE_KEYS.has(hold)) {
      dropped.push(`${path}.holds.${hold}: unsafe key`)
      continue
    }
    const name = HoldNameSchema.safeParse(hold)
    if (!name.success) {
      dropped.push(`${path}.holds.${hold}: not a hold name`)
      continue
    }
    if (asRecord(held)?.holds !== undefined) {
      dropped.push(`${path}.holds.${hold}: a hold cannot carry holds of its own`)
      continue
    }
    const fill = salvageHoldFill(`${path}.holds.${hold}`, held, dropped)
    if (fill !== undefined) out[name.data] = fill
  }
  return out
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
  const filters = salvageFilters(key, source.filters, dropped)

  if (source.rotation === undefined || typeof source.rotation === 'number') {
    return { id: key, template, x, z, rotation: normalizeRotation(source.rotation ?? 0), fills, filters }
  }
  dropped.push(`placements.${key}: rotation is not a number (${describeValue(source.rotation)}), reset to 0`)
  return { id: key, template, x, z, rotation: 0, fills, filters }
}

/**
 * One instance's control filters, or `[]`.
 *
 * **Absent is `[]` and not a dropped instance**, which is the same reading
 * {@link salvageFills} gives an absent `fills`: `[]` is *any* on every axis, so
 * an instance without a position is one that narrows nothing — a complete,
 * ordinary state and the one every instance placed before the field existed was
 * in. There is no threshold at which missing filters invalidate a placement.
 *
 * A non-array, or an array holding anything but non-empty strings, is reported
 * and reduced to `[]` rather than taken apart entry by entry. That is the
 * opposite of `salvageFills`' per-entry rule and deliberately so: a fill is one
 * slot's answer and its neighbours are independent, while the filters are **one
 * choice across axes** — half of `['component|door|arched', 'size|width|2']` is
 * not a narrower version of it, it is a different filter nobody chose.
 */
function salvageFilters(key: PlacementId, value: unknown, dropped: string[]): readonly string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    dropped.push(`placements.${key}: filters is not an array (${describeValue(value)}), reset to none`)
    return []
  }
  const bad = value.filter((tag) => typeof tag !== 'string' || tag.length === 0)
  if (bad.length > 0) {
    dropped.push(
      `placements.${key}: filters holds ${String(bad.length)} entry that is not a tag ` +
        `(${describeValue(bad[0])}), reset to none`,
    )
    return []
  }
  return value as readonly string[]
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

/**
 * Recover the room-wide design.
 *
 * Absent means *no preference*, which is the shipped default, so an absent value
 * is **not** reported: it is the ordinary state rather than a drop. Present but
 * not a non-empty string is corruption and is named.
 *
 * There is deliberately **no check that the value names a `texture` root this
 * archive carries.** That needs `catalog.json`, which `schema.ts` keeps out of
 * the store's closure, and the check would buy nothing: `FillContext.family` is
 * a preference and never a filter, so an unknown design is honoured on no slot
 * and every slot still fills. The failure is a room that looks unstyled, not a
 * room that cannot be built — and `@/ui/design-picker` only ever writes a root
 * it derived from the emitted index, so the reachable cause is a hand edit.
 */
function salvageDesign(input: unknown, dropped: string[]): string | undefined {
  if (input === undefined) return undefined
  if (typeof input === 'string' && input !== '') return input
  dropped.push(`design: ${describeValue(input)} is not a design family, reset to no preference`)
  return undefined
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
  const design = salvageDesign(source.design, dropped)
  return {
    state: {
      placements: salvagePlacements(source.placements, dropped),
      generated: salvageGenerated(source.generated, dropped),
      lock: salvageLock(source.lock, dropped),
      lockChosen: salvageLockChosen(source.lockChosen, dropped),
      /* Spread rather than assigned, because `exactOptionalPropertyTypes` makes
         `design: undefined` and *no `design` key* two different values — and the
         second is the one that survives `JSON.stringify` into `localStorage`
         unchanged, so a round trip through `persist` cannot turn one into the
         other. */
      ...(design === undefined ? {} : { design }),
    },
    dropped,
  }
}

/* --------------------------------------------------------------- version gate */

/**
 * The stamps this build reads, newest last.
 *
 * Two entries rather than one, and the second is the rung: version 8 is the
 * shape that was served at the app's public URL, so a browser out there holds
 * one and discarding it would throw away a stranger's room. It needs no
 * conversion — see {@link STORE_VERSION} — so being in this list *is* the rung.
 *
 * ## Written out, and **never** derived from {@link STORE_VERSION}
 *
 * `[STORE_VERSION - 1, STORE_VERSION]` would say the same thing today and would
 * be a trap: it widens itself on the next bump, so a version 10 that forgot its
 * rung would silently admit every version 9 blob and read it as a version 10
 * one — which is the *half-read* failure this whole module exists to refuse, and
 * it would arrive with no test failing anywhere. Literal numbers cannot do that.
 * They stay where they are when the stamp moves, so a bump alone makes the
 * **current** version unreadable and `migrations.test.ts` goes red on the spot,
 * which is the mechanism the module docblock promises.
 *
 * So: adding a number here is a decision, and it is only correct when the change
 * that version made is additive *and* the absent reading of the new field is the
 * right one. Anything else needs a rung that transforms, and the module docblock
 * says how to write one.
 */
export const READABLE_VERSIONS: readonly number[] = [8, 9]

/**
 * {@link READABLE_VERSIONS} as a set, so the membership test takes `unknown`.
 *
 * The argument really is `unknown`: `storedVersion` comes out of `localStorage`
 * or a file and may be a string, `null` or `NaN`, and a membership test that has
 * to narrow before it can ask is a branch that can be got wrong.
 */
const READABLE_STAMPS: ReadonlySet<unknown> = new Set(READABLE_VERSIONS)

/**
 * Whether this build reads a blob stamped `version`.
 *
 * Exported for `transfer.ts` and for nothing else. An imported *file* is checked
 * before {@link readPersistedState} sees it, so that a foreign version is refused
 * with a message rather than silently emptying the room — and that check has to
 * ask this question rather than answer it again, or the two paths drift the day
 * the readable set changes. It drifted here first: the 8 → 9 rung would have left
 * a file exported yesterday refused while the same state in `localStorage` was
 * read.
 */
export function readsStoredVersion(version: unknown): boolean {
  return READABLE_STAMPS.has(version)
}

/**
 * Read a persisted blob that claims to be at `storedVersion`.
 *
 * One branch, and it is nearly symmetric: **the stamp is one this build reads,
 * or the blob is discarded.** Older, newer, absent, `NaN`, a string, a float —
 * all the same answer, a fresh state and one line in `dropped` naming what the
 * stamp said. Symmetry is the reason it is written this way rather than as three
 * cases: a gate with a direction has a wrong side, and the wrong side of a shape
 * mismatch is a screen full of pieces that resolve to nothing.
 *
 * The one asymmetry is {@link READABLE_VERSIONS}, and it is not a softening of
 * that argument: the previous version is read because its shape is *known* and
 * convertible, not because it is *close*. Every other stamp is still refused
 * outright.
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
  if (!readsStoredVersion(storedVersion)) {
    return {
      state: defaultWorkshopState(),
      dropped: [
        `state was written at version ${describeValue(storedVersion)}, and this build reads only ` +
          `${READABLE_VERSIONS.join(' or ')}; discarded and started fresh`,
      ],
    }
  }
  try {
    /* The 8 → 9 rung is the identity, so there is no conversion to run before
       this: a version 8 fill has no `holds`, and *absent* is the reading version
       9 gives it. A rung that transformed would go here, ahead of the salvage,
       and the module docblock says how to shape one. */
    return salvageWorkshopState(input)
  } catch (error) {
    return {
      state: defaultWorkshopState(),
      dropped: [`reading version ${describeValue(storedVersion)} state threw (${String(error)}); discarded`],
    }
  }
}
