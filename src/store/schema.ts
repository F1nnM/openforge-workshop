/**
 * OpenForge Workshop — the shape of the persisted client state.
 *
 * Four things survive a reload: the **placements** (the builder scene, now
 * template instances rather than tiles), the **generated bases** on that scene
 * as recipes rather than meshes, the **lock preference** and whether the user
 * has ever chosen that preference. Nothing else.
 * Anything derivable from the catalog — the assembly a placement resolves to,
 * the bill of tiles, the candidate set of a slot — is deliberately absent,
 * because a derived value written to `localStorage` goes stale the moment the
 * catalog is reimported, and a stale copy is worse than a recomputation that
 * costs microseconds.
 *
 * **The library is gone.** Row A0 deleted the screen and every reader; row A1
 * deleted the field, the four actions, the three selectors, the three hooks and
 * the salvage function. Templates are the only placement unit (§2.5), so the
 * "items the user kept" surface has no home and no caller. Nothing here
 * deprecates it or keeps a shim: the field is absent, and a blob still carrying
 * one is discarded by the version gate.
 *
 * **Zod is the source of truth**, matching `src/catalog/schema.ts`: every
 * exported type is `z.infer`'d from the schema beside it, so a schema edit
 * cannot leave a stale type behind. Identities come from the catalog contract —
 * this module never invents its own {@link TileId}.
 *
 * This file describes the *current* shape, and `migrations.ts` holds the gate
 * that decides which *stored* shapes reach it. That gate used to discard every
 * shape but this one; the app is served at its public URL now, so it climbs from
 * the version below as well, and its docblock states what a future shape change
 * therefore owes a user's saved room.
 */
import { z } from 'zod'

import { TileId } from '@/catalog'
import { GeneratedPlacement } from '@/generator/placement/scene'

/* --------------------------------------------------------------- lock system */

/**
 * The three joinery systems a build can use.
 *
 * Global, not per-tile: you cannot physically mix them in one build (§2), so
 * this is one choice for the whole app rather than a facet on a placement.
 */
export const LockSystem = z.enum(['openlock', 'dragonlock', 'magnetic'])
export type LockSystem = z.infer<typeof LockSystem>

/**
 * The default lock system — **openlock**, and the margin is the whole argument.
 *
 * Measured reachability over the 3,822 distinct designs, where a design is
 * reachable if it offers that lock or carries no lock at all (§2):
 *
 * | system     | designs reachable | share      |
 * | ---------- | ----------------: | ---------: |
 * | openlock   |     3,817 / 3,822 | **99.9%**  |
 * | dragonlock |     2,854 / 3,822 |      74.7% |
 * | magnetic   |     2,282 / 3,822 |      59.7% |
 *
 * **Spread: 40.2 percentage points.** An earlier draft of the plan put the cost
 * of this choice at 0.1 points and was wrong by two orders of magnitude, which
 * is why the numbers are carried here rather than left as folklore: defaulting
 * to anything but openlock silently hides a quarter to two-fifths of the catalog
 * from a user who never opened the picker.
 */
export const DEFAULT_LOCK_SYSTEM: LockSystem = 'openlock'

/* --------------------------------------------------------------- identities */

/**
 * Identity of one placement in the builder scene.
 *
 * Placements are held in a **keyed map, not an array**, and this id is the key.
 * An array would address a placement by position, so every concurrent edit would
 * have to rewrite indices — fine for one user with an undo stack, fatal to the
 * collaborative editing the plan leaves open. A map costs nothing today and
 * keeps that door open. It also makes "move the instance the user is dragging" a
 * single-key write rather than a splice.
 *
 * Branded so a `PlacementId` cannot be passed where a {@link TileId} is
 * expected. Both are opaque strings over the same scene, and confusing them
 * would be a silent lookup miss rather than an error.
 */
export const PlacementId = z.string().min(1).brand<'PlacementId'>()
export type PlacementId = z.infer<typeof PlacementId>

/**
 * Identity of a **template family** — the recipe an instance is an instance of.
 *
 * ## Why a pattern and not `min(1)`
 *
 * Row X5's argument for {@link TileId}, applied one field over: `migrations.ts`
 * runs this schema over a value out of `localStorage`, so the brand is the only
 * thing standing between a corrupt blob and an instance that names no template —
 * which would draw nothing, price nothing, and be unremovable through any button
 * in the app. Under `z.string().min(1)` the strings `"undefined"`, `"null"` and
 * a whole JSON document all survive.
 *
 * The pattern is exactly what `pipeline/templates.ts#templateSlug` emits —
 * `name.toLowerCase().replace(/[^a-z0-9]+/g, '-')` with the ends trimmed — so it
 * is the *generator's* range rather than a guess at it, and `corpus.test.ts`
 * asserts that all 40 shipped ids parse. A single segment is legal because the
 * slug function can produce one from a one-word family name; requiring a hyphen
 * would buy lexical disjointness from `DesignId` (below) at the price of
 * refusing a legitimate id the day B4 generates a one-word family — the same
 * failure mode {@link coordinate} refuses to court by not enforcing the snap
 * lattice.
 *
 * ## What this is *not* disjoint from, stated rather than discovered
 *
 * A `DesignId` is `d` followed by twelve hex characters (measured: all 3,822),
 * which **matches this pattern**. So unlike the `TileId`/`DesignId` pair that
 * rows V1 and V4 relied on, `TemplateId` and `DesignId` are *not* lexically
 * disjoint and no salvage check can tell them apart.
 *
 * That costs nothing, and the reason is what a version 5 blob actually looks
 * like: it wrote the identity under `design`, and **had no `template` field at
 * all**. So the reachable corruption is a placement carrying `design` and no
 * `template`, which `migrations.ts#salvageTemplate` recognises by *field name*
 * and reports — a stronger check than any pattern, because it does not depend on
 * the two id spaces looking different. A hand edit that renamed the field as
 * well as re-stamped the version is the one case that slips through, and it
 * fails closed: the id resolves to no template and the instance is reported as
 * unrenderable by the same path a retired family takes.
 *
 * Not imported from `screens/assemblies/templates.ts`, and that is deliberate:
 * `@/store` must not reach a screen, and the 40-entry data table has no business
 * in the store's file closure. Whether an id names a template the *build* ships
 * is a question for the reader that has the table; whether it is a well-formed
 * id is this schema's.
 */
export const TemplateId = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a template id is a lowercase hyphen-separated slug')
  .brand<'TemplateId'>()
export type TemplateId = z.infer<typeof TemplateId>

/**
 * The name of one slot on a template — `'floor'`, `'right wall'`, `'base'`.
 *
 * `min(1)` and nothing stronger. Two of the six shipped part names contain a
 * space — `'right wall'` and `'left wall'`, carried by **8 of the 128 parts** —
 * so a {@link TemplateId}-style slug pattern here would refuse real data, and
 * `corpus.test.ts` measures that. There is no pattern that would separate a
 * *real* slot name from an arbitrary string either, because the authority on
 * what a slot is called is the template: validation here is a shape check and
 * the meaning check belongs to whoever holds the template — C2's solver and
 * C3's editor.
 *
 * ## The brand buys nothing in key position, and this is the notice that says so
 *
 * {@link TemplateInstance.fills} is keyed by this type, and a Zod brand is
 * **dropped from the key position of a `Record`**: a branded string is not a
 * literal union, so `Record<SlotName, SlotFill>` compiles to an index signature
 * and `Record<string, SlotFill>` is assignable to it. Row V3 found that with
 * `tsc` on the library's key and the finding is unchanged; `readonly SlotName[]`
 * is *not* assignable to `readonly string[]`'s inverse, so **the array is the
 * safe position and the map is not.** {@link filledSlots} is the one place that
 * crosses from one to the other.
 *
 * The brand is kept anyway, for the one thing it does do: it makes
 * `fillSlot(id, slot, tile)`'s signature say which of its two string arguments
 * is which, and it forces a caller to mint a slot name deliberately rather than
 * hand over whatever string was to hand. That is documentation with a compiler
 * behind it at the *argument* positions, and nothing at all at the key
 * positions. Both halves are true and only one of them is worth relying on.
 */
export const SlotName = z.string().min(1).brand<'SlotName'>()
export type SlotName = z.infer<typeof SlotName>

/**
 * The name of one **hold** on the file a slot is filled with — `'torch'`,
 * `'left door'`, `'brazier'`.
 *
 * A hold is a composition slot of the *filled file* rather than of the template:
 * a wall that carries a torch socket declares somewhere to put a torch, and what
 * goes there is a second file. So this is {@link SlotName} one level down, and it
 * is `min(1)` for exactly {@link SlotName}'s reason: the authority on what a hold
 * is called is the composition that declares it, so validation here is a shape
 * check and **the meaning check belongs to whoever holds the config** — the
 * measuring tool that named the mounts, and the editor that offers them.
 *
 * A separate brand rather than a reuse of {@link SlotName}, because the two name
 * different things and are looked up in different tables: passing a slot name
 * where a hold name belongs would be a silent lookup miss on a map that happens
 * to have the same key type. The brand's limits are {@link SlotName}'s too —
 * dropped in key position, load bearing at the argument positions of
 * `fillHold(id, slot, hold, tile)`, where it is the only thing saying which of
 * the three strings is which.
 */
export const HoldName = z.string().min(1).brand<'HoldName'>()
export type HoldName = z.infer<typeof HoldName>

/* ---------------------------------------------------------------- placements */

/**
 * A rotation in degrees, canonicalised to `[0, 360)`.
 *
 * The *step* is per-family and comes from the catalog — 893 tiles carry an angle
 * that is not a multiple of 90 and would never tile on a 90° step — so the step
 * is not stored, only the resulting angle. The range is enforced so that two
 * instances at the same visual angle compare equal, which is what lets the share
 * codec (row A5) encode an angle as a small integer rather than as an unbounded
 * float.
 *
 * Named rather than left inline because a template instance rotates as **one
 * unit** (§1: "the whole thing placed and rotated as one unit"): the slot
 * offsets are arithmetic against this one angle at fill time (§2.2), so there is
 * exactly one rotation per instance and no per-slot yaw to keep in step with it.
 */
export const Rotation = z.number().finite().nonnegative().lt(360)
export type Rotation = z.infer<typeof Rotation>

/**
 * A plan-view coordinate.
 *
 * `x`/`z` are grid units — `y` being height, which the store deliberately does
 * not model: elevation is derived (§2.2, §9), because 18.4% of measured toppers
 * are authored pre-lifted by 6.0 mm and 77.5% are not, and a stored elevation
 * would encode that inconsistency.
 *
 * Validated as finite numbers and nothing stronger. §7 snaps the template
 * *origin* to 0.5 units, and §2.2's slot offsets land on multiples of 0.25 and
 * deliberately do **not** snap — but snapping is the canvas's job and a schema
 * that enforced a lattice here would reject a scene the day a legitimate finer
 * mode ships. What the schema *does* enforce is that a coordinate is a real
 * number, because an instance at `NaN` cannot be rendered, hit-tested or shared.
 */
const coordinate = z
  .number()
  .finite()
  // `-0 + 0` is `+0`; every other value passes through untouched. Snapping is a
  // real source of `-0` (`Math.round(-0.2) * 0.5`), and `-0` survives in memory
  // but not through `JSON.stringify`, so a scene holding one would not compare
  // equal to itself after an export and re-import.
  .transform((value) => value + 0)

/**
 * **A file, plus who chose it** — the shape both a slot fill and a hold are made
 * of.
 *
 * Named and extracted rather than written twice, because a hold is a fill of the
 * file a slot is filled with (see {@link SlotFill}) and the two answer the same
 * two questions: *which STL*, and *did the user say so*. Everything the pair have
 * in common lives here; the one thing only the outer one has — the holds
 * themselves — is added by {@link SlotFill}, which is also where the argument for
 * both fields is written down.
 *
 * **This is the leaf, and that is the whole of the nesting rule.** A value of
 * this type has nowhere to put a hold, so the recursion the shape could have had
 * is closed by the type rather than by a check: `z.record(HoldName, HoldFill)`
 * admits one level and cannot express a second.
 */
export const HoldFill = z.object({
  /** The file this slot is filled with. A `TileId`, so it is one printable STL. */
  tile: TileId,
  /**
   * `false` when the default solver chose it, `true` when the user did.
   * A lock change re-solves every `auto` fill and never touches a `pinned` one.
   */
  pinned: z.boolean(),
})
export type HoldFill = z.infer<typeof HoldFill>

/**
 * What fills one slot: a {@link HoldFill}, plus the accessories fitted into that
 * file's own composition slots.
 *
 * ## A hold is a fill of a fill, and it is exactly one level deep
 *
 * The wall a slot is filled with may declare a torch socket; the torch that goes
 * in it is a second file, chosen the same way and pinnable the same way, so a
 * hold *is* a fill and reuses the shape rather than paraphrasing it. What it is
 * not is recursive: {@link HoldFill} has no `holds` field, so **a hold cannot
 * carry holds by construction** — not by a check, not by a depth counter, and not
 * by a `z.lazy` that would make the type infinite and the salvage unbounded. A
 * torch in a wall in a corner is the whole of the modelled world, and the measured
 * corpus has nothing deeper: an accessory's own composition slots, if it ever grew
 * any, would be a change of shape here and a migration rung rather than data that
 * quietly nests one more time.
 *
 * ## `undefined` and `{}` are different answers, and every reader depends on it
 *
 *   - **`holds === undefined` means *never solved*.** No default-hold pass has
 *     looked at this fill. It is the state every fill written before this field
 *     existed is in, and the state a fresh fill starts in.
 *   - **`holds === {}` means *solved, or emptied by the user*.** Either the
 *     solver looked and this file's mounts admitted nothing, or the user took the
 *     last accessory out — {@link clearHold} of the last hold leaves the empty map
 *     rather than removing the field.
 *
 * The distinction is what makes a default-hold solver safe to run on every
 * hydrate: it fills only the fills whose `holds` is `undefined`, so a room where
 * the user deliberately emptied a socket does not sprout a torch again on the next
 * reload. Collapsing the two would leave that user no way to say *nothing goes
 * here* that survives a reload, which is the same failure `pinned` exists to
 * prevent one level up.
 *
 * `migrations.ts#salvageHolds` reads an unreadable `holds` as `undefined` for that
 * reason and names it: *never solved* is repaired by the next pass, where *solved
 * and empty* would freeze an answer nobody gave.
 *
 * ## The rest is {@link HoldFill}'s docblock
 *
 * Decision **D1** (§2.1): a fill names a file rather than a design. That deletes
 * roughly 700 of `resolve.ts`'s 956 lines — rule 0, which guessed a variant out
 * of an aggregate, and rule 1, which guessed a base under every topper — and it
 * makes a saved room deterministic: a re-import cannot silently change what it
 * contains.
 *
 * ## Why `pinned` is not optional, and not a default
 *
 * A file-valued fill freezes the lock choice at fill time, and the three lock
 * systems disagree about which file to print for **1,419 of 3,822 items
 * (37.1%)** — measured in `corpus.test.ts`, in this directory, because it is the
 * only fact justifying this field. Without the bit, switching lock style would
 * leave a placed room unchanged, contradicting the requirement row V3 shipped
 * (the base a user sees follows their lock selection). With it, the lock stays
 * live for every slot the user has not deliberately overridden, and an explicit
 * pick is honoured exactly. One boolean per fill buys both.
 *
 * **Required rather than `.optional()` with a default**, so that every producer
 * decides. `pinned` absent would mean "auto", which is the state a solver that
 * forgot to write the field would silently land in — and the solver is the one
 * caller for which "auto" happens to be right, so the mistake would never
 * surface. Making it explicit puts the decision at every call site, which is
 * what contract **C-k** turns on: `fillSlot` writes `false` and `pinFill` writes
 * `true`, and neither takes a boolean parameter that could be passed wrongly.
 * The hold actions repeat the pair — `fillHold` and `pinHold` — for the same
 * reason and with the same refusal of a boolean argument.
 *
 * `migrations.ts` supplies `false` for a blob whose `pinned` is missing, names
 * the drop, and the direction is deliberate: `false` is repaired by the next
 * lock change, while `true` would freeze a choice the user never made,
 * permanently and invisibly.
 */
export const SlotFill = HoldFill.extend({
  /**
   * The accessories fitted into this file's own composition slots, by hold name.
   * **Absent means never solved; empty means solved.** See the docblock above.
   */
  holds: z.record(HoldName, HoldFill).optional(),
})
export type SlotFill = z.infer<typeof SlotFill>

/**
 * One **template instance** on the plan-view grid: the epic's placement unit.
 *
 * §1: *"a recipe with named slots, each slot filled from the catalog, the whole
 * thing placed and rotated as one unit. Templates are the only placement
 * unit."* This replaces row V4's `Placement`, which was a single `DesignId`
 * on a cell. The reversal is not a refinement of that argument but a change of
 * subject: V4 asked *which identity should one tile carry*, and the answer no
 * longer matters because a placement is not one tile.
 *
 * ## `fills` is a map, not an array, and the brand is not why
 *
 * The choice is between `Record<SlotName, SlotFill>` and
 * `readonly { slot, tile, pinned }[]`. The array would enforce the
 * {@link SlotName} brand, which the map cannot (see {@link SlotName}), and that
 * is the *only* thing it wins — the brand cannot distinguish a real slot name
 * from any other string, so what it enforces is a cast discipline rather than a
 * fact. The map wins two things that are facts:
 *
 *   - **One fill per slot, by construction.** An array admits two fills for
 *     `floor`, which is a corruption class needing a salvage policy ("which
 *     wins?") and a UI that can render it. `corpus.test.ts` measures that all 40
 *     shipped templates have unique part names, so uniqueness is a property of
 *     the data and the map is not lying about it.
 *   - **`fills[slot]` is the editor's whole question.** C3 lists slots and asks
 *     each one what fills it; on an array that is a scan, and on a map it is the
 *     lookup the shape already is.
 *
 * **An absent key is an unfilled slot, and reads as *needs a choice*.** That is
 * contract **C-g** and §3.2's "places anyway": a template with no candidate for
 * one part is dropped on the grid with that part empty, not refused. Under
 * `noUncheckedIndexedAccess` a branded-key `Record` already indexes to
 * `SlotFill | undefined`, so the plan's `Partial<Record<…>>` and this schema's
 * inference are the same type at every read site; `Partial` is not spelled here
 * because `z.record` does not emit it and a hand-written type beside the schema
 * is the stale-type hazard this module exists to avoid.
 *
 * There is deliberately **no check that `fills`' keys are slots of `template`**.
 * That needs the template table, which lives in the bundle beside
 * `screens/assemblies/templates.ts` and must not enter the store's file closure
 * (see {@link TemplateId}). An unknown key is therefore expressible, and it
 * fails closed the same way an unknown template does — nothing renders it,
 * because rendering walks the *template's* parts and asks `fills` for each.
 *
 * ## `id` is inside the object as well as being the map key
 *
 * The plan's §2.1 sketch puts it there, and the reason is that an instance is
 * now a composite that travels **detached from the map**: the resolver takes
 * one, the bill groups by one, the renderer keys React on one, and the share
 * codec ordinals one. Every one of them needs the identity, so the alternative
 * is an `[id, instance]` tuple threaded through eight rows' signatures.
 *
 * The hazard that buys is a key and a field that can disagree, and it is closed
 * in exactly one place: **the key wins.** `migrations.ts#salvageInstance`
 * reports a disagreement and rewrites the field from the key, because the key is
 * what every reader of the map addresses by; and `placeTemplate` mints both from
 * one value so nothing in the app can produce the disagreement in the first
 * place.
 *
 * ## What is still absent, and why
 *
 * **No footprint, size or colour**, for row V4's reason, unchanged: they are
 * hoisted facets of the fill's own record, and `pipeline/aggregate.ts` fails the
 * build if an aggregate holds two values of any of them. Copying one here would
 * double the payload and desynchronise on the next import.
 *
 * **{@link TemplateInstance.filters} is not in that class, and the difference is
 * the whole reason it is a field.** A hoisted facet is *derivable*, so storing it
 * only creates something that can go stale. The filters are not derivable: *any
 * component* and *arched door, which happens to be what is filled* produce
 * **identical fills**. The distinction exists only if it is stored, and it is
 * exactly the distinction the slot editor turns on — one offers every wall, the
 * other offers 54.
 *
 * **No slot offsets.** §1.4 measured the `base` slot admitting **25 distinct
 * footprints** and `wall` 14, so a stored `(dx, dz, dy, yaw)` is wrong for most
 * fills of the same slot. Layout is a *rule* evaluated against the fill's own
 * footprint at fill time (§2.2, row B2), and there is nothing here for it to go
 * stale against.
 *
 * **No base.** It used to be auto-inserted by the resolver; a template declares
 * it as an explicit slot instead, so it is an ordinary key of `fills` and rule 1
 * dies with it (§1.7).
 */
export const TemplateInstance = z.object({
  id: PlacementId,
  template: TemplateId,
  x: coordinate,
  z: coordinate,
  rotation: Rotation,
  fills: z.record(SlotName, SlotFill),
  /**
   * The palette **filters** this instance was placed under: every control axis's
   * tags, exactly as `builder/canvas/usePlanTools.ts#armedPosition` joins them.
   *
   * `['component|door|arched', 'size|width|2', 'size|depth|2']` for an arched
   * door at 2 x 2, and `[]` for *any* on every axis — which is a real choice
   * rather than an absence, and the one every instance placed before this field
   * existed was in.
   *
   * **Nothing spatial**, which is why the field is not called `position`: the
   * palette calls each setting of a control a *position*, as of a dial
   * (`ControlPosition`, `armedPosition`, `GENERATED_FAMILY_SIZES`' 303
   * positions), and that word is right there and wrong here — it would sit
   * beside {@link TemplateInstance.x} and {@link TemplateInstance.z} and read as
   * the cell. The cell is those two.
   *
   * **Defaulted rather than optional**, so a reader never has two shapes to
   * handle. The absent case belongs to `migrations.ts`, which discards the blob
   * that would produce it.
   *
   * Validated as a tag list and nothing stronger. Whether these tags name
   * anything, or anything *this template* can express, needs the family table —
   * which must not enter the store's file closure, for the reason
   * {@link TemplateId} gives at length. A filter naming an axis the template has
   * no control for narrows nothing and is inert, which is the same way an unknown
   * `fills` key fails closed.
   */
  filters: z.array(z.string().min(1)).readonly().default([]),
})
export type TemplateInstance = z.infer<typeof TemplateInstance>

/**
 * Fold an arbitrary angle into `[0, 360)`.
 *
 * Total by construction: a non-finite input yields 0 rather than propagating
 * `NaN` into a scene. `-0` is normalised to `0` so that a round-tripped scene
 * compares equal under `Object.is`.
 */
export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  const folded = deg % 360
  if (folded === 0) return 0
  return folded < 0 ? folded + 360 : folded
}

/* --------------------------------------------------------------------- state */

/**
 * The whole of the persisted state — and the whole of the store's state.
 *
 * The two are the same object on purpose. `persist`'s `partialize` defaults to
 * the identity, so keeping the store free of ephemeral fields means the
 * migration functions operate on exactly the type the app reads, with no
 * projection to keep in step. **Anything added here is persisted**; ephemeral UI
 * state (hover, drag-in-progress, panel open) belongs in component state or in a
 * separate un-persisted store — `selection.ts` and `meshes.ts` are the two that
 * exist.
 */
export const WorkshopState = z.object({
  /**
   * The builder scene: template instances, keyed by {@link PlacementId}.
   *
   * The key is duplicated in each value's `id`; see
   * {@link TemplateInstance} for why, and for the rule that the key wins.
   */
  placements: z.record(PlacementId, TemplateInstance),
  /**
   * Generated bases on the grid — a **second map beside {@link placements}**, in
   * the same {@link PlacementId} space.
   *
   * Row S5 minted the record and argued the shape; this is the field it said the
   * store row would add. Not a widening of the instance's identity slot, because
   * every reader of the other map — the share codec, `migrations.ts`'s per-entry
   * parse, `billView.ts`'s `placementKey`, `buildBillOfTiles` — is entitled to
   * keep assuming that slot names something *in the catalog*, and a generated
   * base is not in the catalog at all: it has no design, no aggregate and no
   * manifest ordinal. A union in that slot would make all of them conditional
   * for a population that is not in any of their questions.
   *
   * **Row A1 sharpened that, and it is now the strongest form of the
   * argument.** V4 changed the slot from a `TileId` to a `DesignId` and left the
   * argument standing; A1 changes it to a {@link TemplateId} plus a map of
   * fills, so the two populations no longer even have the same *arity*. A
   * generated base is one recipe with one footprint; an instance is a family
   * with up to five slots, each holding a file that resolves through the lock
   * preference. There is no slot in a `GeneratedPlacement` for any of that and
   * nothing a fill could name.
   *
   * Sharing the id space is what makes one namespace over the whole scene. S5's
   * disjointness proof was lexical — a `GeneratedBaseId` starts `gen:` and
   * therefore fails `TileId`'s `^tiles/…` pattern — and there is exactly **one**
   * place that compares identities across the two populations,
   * `move.ts#identityOf` behind row G4's identical-twin refusal, which qualifies
   * the id with the population it came from. So the disjointness is a fact about
   * `'catalog'` versus `'generated'` rather than about what the ids look like,
   * and no measurement is load bearing. `migrations.ts` still rejects a `gen:`
   * id in the template slot by name, because that slot reads `localStorage`.
   *
   * ## What persists, and what cannot
   *
   * **The recipe and the position. Never the mesh.** S4's rule — ~200 bytes of
   * JSON against 0.5–2.4 MB of STL, and it survives an engine upgrade as a cache
   * miss rather than a broken reference — and S5's schema has nowhere to put
   * bytes, a digest or a byte count, asserted by round-tripping a record
   * carrying one. The bytes live in `meshes.ts`, which is **not** persisted.
   *
   * So a reload brings back every generated base as an *unrendered* one: the
   * outline is still exactly right, because the footprint is arithmetic over the
   * recipe, and S5 already has the state for the rest — a `warn` bill row saying
   * the piece is on the plan and not in the download, and a download that
   * refuses rather than shipping a pack one file short. Re-opening the generator
   * on that recipe renders it again.
   *
   * A `GeneratedRecipe` naming an entry point the panel does not offer is a
   * parse failure rather than a piece that silently vanishes — see S5's
   * `scene.ts`. `migrations.ts` drops such an entry and names it.
   */
  generated: z.record(PlacementId, GeneratedPlacement),
  lock: LockSystem,
  /**
   * Whether the user has ever decided the lock system for themselves.
   *
   * `lock` alone cannot answer that question, and this is why the flag exists
   * rather than being inferred: `lock === 'openlock'` is indistinguishable from
   * "never opened the picker", because openlock *is* the default. So without a
   * second bit there is no way to offer the choice once and then stop offering
   * it — the app would either nag a user who has already decided or never
   * mention a preference that costs up to 40.2 percentage points of catalog
   * reach (see {@link DEFAULT_LOCK_SYSTEM}).
   *
   * Set by `setLockSystem` in `workshopStore.ts` — picking a system, including
   * re-picking openlock, is a decision. It used to have a second writer,
   * `acknowledgeLockSystem`, for the dismiss action on the first-run notice;
   * that notice is gone, so the toggle is the only thing that can answer now.
   *
   * Persisted, because the whole point is that it survives a reload.
   */
  lockChosen: z.boolean(),
  /**
   * The room's **design** — one `texture` root for the whole scene, or absent
   * for *no preference*.
   *
   * The owner's requirement, verbatim: *"Room-Wide Design as the default,
   * manual deviations are always allowed."* Row C1 argued for exactly this
   * field in `builder/panels/palette.ts` and deliberately built nothing,
   * because at the time nothing read it; row C2's solver has read
   * `FillContext.family` as its **first** preference since it shipped and
   * nothing set it. The measured consequence is one corner drawn out of four
   * stone types — see `@/template`'s `FillContext.family`.
   *
   * ## Why it is called `design` here and `family` there
   *
   * `family` is taken. In this epic it means a *template* family — a
   * {@link TemplateId}, `builder/panels/families.ts`' `TemplateFamily`, the
   * thing the palette arms — so `WorkshopState.family` would read as "the armed
   * recipe" at every call site. `design` is the owner's own word and the word
   * §1.6 uses (*"filterable by design"*). It reaches the solver as
   * {@link FillContext.family} and the value is the same in both: a `texture`
   * root exactly as {@link CatalogRecord.texture} carries it.
   *
   * ## A string, not an enum, and not validated against the archive
   *
   * The 36 reachable roots are a fact about `catalog.json`, which this module
   * must not reach — `schema.ts`' own rule is that anything derivable from the
   * catalog is absent, because a derived value in `localStorage` goes stale the
   * moment the catalog is reimported. A root spelled `cut_stone` when the
   * archive says `cut-stone` therefore *parses*, and it **fails open** rather
   * than closed: `FillContext.family` is a preference and never a filter, so a
   * design no record carries is honoured on no slot and every slot still fills.
   * That is the fallback contract C2 documented, and it is the reason this field
   * needs no catalog to be safe.
   *
   * `.optional()` rather than a required value with a sentinel, and unlike
   * {@link SlotFill.pinned} that is right here: *no room design* is the shipped
   * default and the state a user returns to, so there is no producer for whom
   * the absent case is a mistake. It mirrors `FillContext.family?` one field
   * over, so the store's shape and the solver's shape are the same shape.
   *
   * **Measured, over the 91 families this build can place and their 179
   * slots:** 28 of the 36 reachable roots reach at least one slot and 8 reach
   * none; the best two reach 122 and 111 of 179. The **base** slot is the
   * exception and is not a bug — **38 of 40 base slots have only `plain`
   * candidates**, so row A3's `rankBases` keeps deciding them. `@/ui/design-picker`'s
   * `reach.ts` re-derives all of that from the emitted index rather than
   * carrying it as a constant.
   */
  design: z.string().min(1).optional(),
})
export type WorkshopState = z.infer<typeof WorkshopState>

/**
 * The slots an instance has filled, as an array whose element type is the map's
 * own key.
 *
 * Generic on purpose, and the reason is a hole row V3 found with `tsc` and this
 * row inherited one field over: **a Zod brand is dropped from the key position
 * of a `Record`**, because a branded string is not a literal union, so
 * `Record<string, SlotFill>` *is* assignable to `Record<SlotName, SlotFill>`.
 * `readonly SlotName[]` is not assignable to an arbitrary `readonly K[]`.
 * **The array is the safe position; the map is not.**
 *
 * So the derivations take arrays, and this is the one place that turns the map
 * into one. Reading `K` off the caller's own field is what makes that worth
 * anything: `Object.keys(fills) as SlotName[]` names the brand instead of
 * deriving it and would keep compiling the day the key changes again, handing
 * every entry to a lookup that cannot resolve it and rendering an empty list in
 * silence.
 *
 * It lives here, beside the field it exists for, rather than in each consumer:
 * eight rows import {@link TemplateInstance} from this module and every one of
 * them walks a `fills` map, so the alternative is eight casts.
 *
 * **It serves {@link SlotFill.holds} too**, and needs no second copy to do it: a
 * {@link HoldFill} is a {@link SlotFill} without the optional field, so a hold
 * map satisfies the parameter and `K` comes back as {@link HoldName}. The name
 * says *slots* because that is what it was written for; the fact it relies on is
 * about brands in key position, which the two maps share exactly.
 *
 * This is the shape row V3 shipped as `libraryDesigns`, kept while the field it
 * was written for was deleted. The *lesson* was never about the library — it was
 * about brands in key position — and the field that inherits it has eight
 * readers where the library had three.
 */
export function filledSlots<K extends string>(fills: Readonly<Partial<Record<K, SlotFill>>>): K[] {
  return Object.keys(fills) as K[]
}

/**
 * A fresh empty state.
 *
 * A function, not a frozen constant, because the caller owns the result: the
 * store mutates its copy, and handing every caller the same object would let a
 * migration's fallback alias the store's live state.
 *
 * {@link WorkshopState.design} is **absent** rather than set to the largest
 * family, and the largest family is a real temptation: `dungeon_stone` holds
 * 1,566 of the 3,822 items and reaches 122 of the 179 placeable slots, so
 * defaulting to it would make the very first placement look designed. It is
 * declined for {@link DEFAULT_LOCK_SYSTEM}'s reason read the other way round —
 * the lock has a default because *some* joinery has to be printed and 99.9%
 * reach makes one answer obviously least-bad, where a design has no such
 * answer: the top two roots reach 122 and 111 slots and picking between them
 * for the user is picking what their dungeon looks like. So the shipped state
 * is the one C2 already specified, `family === undefined`, under which the
 * solver falls through to the preferred variant and the ascending address.
 */
export function defaultWorkshopState(): WorkshopState {
  return { placements: {}, generated: {}, lock: DEFAULT_LOCK_SYSTEM, lockChosen: false }
}
