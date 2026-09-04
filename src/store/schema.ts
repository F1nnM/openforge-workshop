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
 * This file describes the *current* shape only, and — for as long as nothing is
 * deployed — the *only* shape the app will read. `migrations.ts` holds the
 * version gate that discards every other one, and its docblock states the
 * moment that licence expires.
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
 * What fills one slot: an exact **file**, plus who chose it.
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
 *
 * `migrations.ts` supplies `false` for a blob whose `pinned` is missing, names
 * the drop, and the direction is deliberate: `false` is repaired by the next
 * lock change, while `true` would freeze a choice the user never made,
 * permanently and invisibly.
 */
export const SlotFill = z.object({
  /** The file this slot is filled with. A `TileId`, so it is one printable STL. */
  tile: TileId,
  /**
   * `false` when the default solver chose it, `true` when the user did.
   * A lock change re-solves every `auto` fill and never touches a `pinned` one.
   */
  pinned: z.boolean(),
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
   * Set by `setLockSystem` — picking a system, including re-picking openlock, is
   * a decision — and by `acknowledgeLockSystem`, which is "I read the notice and
   * the default is fine" without touching `lock`. Both live in
   * `workshopStore.ts`.
   *
   * Persisted, because the whole point is that it survives a reload.
   */
  lockChosen: z.boolean(),
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
 */
export function defaultWorkshopState(): WorkshopState {
  return { placements: {}, generated: {}, lock: DEFAULT_LOCK_SYSTEM, lockChosen: false }
}
