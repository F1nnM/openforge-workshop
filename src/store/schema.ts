/**
 * OpenForge Workshop — the shape of the persisted client state.
 *
 * Five things survive a reload: the **library** (the items the user kept), the
 * **placements** (the builder scene), the **generated bases** on that scene as
 * recipes rather than meshes, the **lock preference** and whether the user has
 * ever chosen that preference. Nothing else.
 * Anything derivable from the catalog — the assembly a placement resolves to,
 * the bill of tiles, the base auto-inserted for a `connection|openforge` piece —
 * is deliberately absent, because a derived value written to `localStorage` goes
 * stale the moment the catalog is reimported or the lock preference changes, and
 * a stale copy is worse than a recomputation that costs microseconds.
 *
 * **Zod is the source of truth**, matching `src/catalog/schema.ts`: every
 * exported type is `z.infer`'d from the schema beside it, so a schema edit
 * cannot leave a stale type behind. Identities come from the catalog contract —
 * this module never invents its own `TileId`.
 *
 * This file describes the *current* shape only, and — for as long as nothing is
 * deployed — the *only* shape the app will read. `migrations.ts` holds the
 * version gate that discards every other one, and its docblock states the
 * moment that licence expires.
 */
import { z } from 'zod'

import { DesignId } from '@/catalog'
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

/* ---------------------------------------------------------------- placements */

/**
 * Identity of one placement in the builder scene.
 *
 * Placements are held in a **keyed map, not an array**, and this id is the key.
 * An array would address a placement by position, so every concurrent edit would
 * have to rewrite indices — fine for one user with an undo stack, fatal to the
 * collaborative editing the plan leaves open. A map costs nothing today and
 * keeps that door open. It also makes "move the tile the user is dragging" a
 * single-key write rather than a splice.
 *
 * Branded so a `PlacementId` cannot be passed where a `TileId` is
 * expected. Both are opaque strings over the same scene, and confusing them
 * would be a silent lookup miss rather than an error.
 */
export const PlacementId = z.string().min(1).brand<'PlacementId'>()
export type PlacementId = z.infer<typeof PlacementId>

/**
 * One **item** placed on the plan-view grid.
 *
 * Four fields, and the omissions are as deliberate as the inclusions:
 *
 *   - **`design`, not a `tileId`** — row V4, and it is the reversal of the
 *     argument this docblock used to make. That argument was: §2 fixes `id` (the
 *     fixture `full_name`) as the key React, placements and share links address a
 *     tile by, §7's *"place designs, not files"* is about the palette, and
 *     resolving the concrete file at download time keeps a saved scene correct
 *     when the user later changes the lock preference — *"while storing the
 *     resolved file would freeze it"*.
 *
 *     **That last clause is what defeats it.** Row V3 made the palette arm an
 *     *item*, so by the time a click reaches the store there is no file to put in
 *     this slot; one has to be *resolved* to fill it, under whatever preference
 *     happened to be set at the moment of the click. Storing that is precisely
 *     the freezing the old docblock warned against, one step earlier in the
 *     pipeline — and the three lock systems disagree about which file for
 *     **1,419 of the 3,822 items (37.1%)**, so it is a freeze with teeth.
 *
 *     A design is the identity that cannot freeze anything, because there is no
 *     choice in it to freeze. `src/store/selection.ts` made the same move for
 *     G5's handoff and gives the long version.
 *
 *     Why {@link DesignId} and not a `TileId` kept "as a hint" beside it:
 *     two identities for one placement is two things to keep in step, and the
 *     hint would be read — `billView.ts` used to report the difference between
 *     the two as a *substitution*, which after this row is a difference between
 *     nothing and something. See {@link WorkshopState.library} for why a design
 *     hash beats an {@link AggregateAddress} in persisted state.
 *
 *   - **No footprint, size or colour.** All three used to be named as
 *     `CatalogRecord` fields and now they are also **hoisted facets of the
 *     item**: `pipeline/aggregate.ts` fails the build if any of the 3,822
 *     aggregates holds two distinct values of `name`, `kinds`, `texture`,
 *     `build`, `foot`, `sizeCode` or `rotStep`. So the plan-view geometry of a
 *     placement is a function of the design alone and does not move when the
 *     lock preference re-resolves the file — which is what makes drawing a
 *     design as cheap as drawing a file was. Copying any of them here would
 *     still double the persisted payload and desynchronise on the next import.
 *
 *   - **No base.** Every `connection|openforge` piece needs a base line item
 *     (§7), but it is *auto-inserted* into the bill of tiles by the assembly
 *     resolver, not placed by the user. Persisting it would produce two bases
 *     the day that rule changes. Unchanged by this row, and strengthened by it:
 *     under openlock 1,808 of the 4,363 base-needing files resolve to a sibling
 *     that needs no base at all, so whether a placement has a base under it is
 *     now a question about the *preference*, and a persisted answer would be
 *     wrong for a third of the catalog the moment the user changed it.
 *
 * `x`/`z` are grid units — plan-view coordinates, `y` being height, which v1
 * does not model. They are validated as finite numbers and nothing stronger:
 * §7 snaps to 0.5 units with 1.0 as a coarse mode, but snapping is the canvas's
 * job (PR 17) and a schema that enforced it here would reject a scene the day a
 * legitimate finer mode ships. What the schema *does* enforce is that a
 * coordinate is a real number, because a tile at `NaN` cannot be rendered,
 * hit-tested or shared.
 */
const coordinate = z
  .number()
  .finite()
  // `-0 + 0` is `+0`; every other value passes through untouched. Snapping is a
  // real source of `-0` (`Math.round(-0.2) * 0.5`), and `-0` survives in memory
  // but not through `JSON.stringify`, so a scene holding one would not compare
  // equal to itself after an export and re-import.
  .transform((value) => value + 0)

export const Placement = z.object({
  design: DesignId,
  x: coordinate,
  z: coordinate,
  /**
   * Rotation in degrees, canonicalised to `[0, 360)`.
   *
   * The *step* is per-item and comes from `CatalogRecord.rotStep` — 893 tiles
   * carry an angle that is not a multiple of 90 and would never tile on a 90°
   * step — so the step is not stored here; only the resulting angle is.
   * `rotStep` is one of the hoisted facets, so the step is the same for every
   * variant of a design and asking the resolved record for it is asking the
   * item. The range is enforced so that two placements at the same visual angle
   * compare equal, which is what lets the share codec (PR 10) encode an angle as
   * a small integer rather than as an unbounded float.
   */
  rotation: z.number().finite().nonnegative().lt(360),
})
export type Placement = z.infer<typeof Placement>

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
 * separate un-persisted store.
 *
 * `library` is a set held as a keyed map whose value slot carries no
 * information. A JSON object is the only shape that survives `JSON.stringify`
 * as a set without a custom replacer — and a custom replacer is exactly the kind
 * of asymmetry that breaks a reader years later. The map also gives O(1)
 * membership, which is what lets a catalog card ask "am I in the library?"
 * without scanning, and it preserves insertion order: a {@link DesignId} is
 * `d` followed by twelve hex characters (verified: **all 3,822** in the live
 * corpus), so no key is integer-like and V8's ordering rules keep them in the
 * order they were added.
 */
export const WorkshopState = z.object({
  /**
   * The items the user kept, keyed by **design**.
   *
   * The owner's requirement, twice over: *"I want this aggregation to be done
   * correctly everywhere. The aggregated tile is always the thing the user
   * sees"*, and then *"the user should be saving aggregates not individual
   * tiles."* §7 of `docs/architecture-plan.md` already said it — *"place
   * designs, not files"* — and the catalog screen honoured it while this field
   * did not: it held a `TileId`, so saving an item saved **one way of
   * printing it**, chosen by whatever lock preference happened to be set at the
   * moment of the click.
   *
   * ## Why {@link DesignId} and not {@link AggregateAddress}
   *
   * Both name an item. Only one of them survives a catalog reimport, and this
   * map is persisted, so that is the whole question.
   *
   *   - A `DesignId` is `pipeline/design.ts`'s **content hash of the design**:
   *     twelve hex characters of SHA-256 over the tag set with the whole
   *     `connection|` namespace removed. It is a pure function of the design, so
   *     two builds agree and an unrelated addition to the corpus changes
   *     nothing.
   *   - An `AggregateAddress` is the **lowest {@link ManifestOrdinal} in the
   *     group**, and its own docblock in `src/catalog/schema.ts` says it is
   *     *"NOT stable under retirement"*: if the lowest-ordinal file leaves the
   *     corpus the address changes even though the group only shrank, and
   *     **1,705 of 3,822 aggregates (44.6%)** hold two or more files and are
   *     exposed to exactly that. Row A1 also gave it no inverse, on purpose —
   *     `aggregateAddress(ord)` is the only conversion and there is no path back
   *     — so a stale address in storage could not even be diagnosed, only
   *     dropped.
   *
   * A1 accepted that instability *"only because this number never enters a share
   * link"*, contrasting a stale catalog URL ("that item moved", a normal web
   * outcome) with a share link decoding to a different room. A persisted library
   * is the second kind of object, not the first: it is read back weeks later, on
   * a newer index, with no user present to notice that entry 40 became entry 41.
   *
   * The design hash's own instability is a **tag edit** — add a tag to a file and
   * it leaves its design for another. That is a real exposure and it is the
   * smaller one: it is caused by an edit to the very thing the user saved, it
   * cannot be caused by an unrelated file retiring, and it fails *closed* (the
   * key resolves to nothing and the library screen already reports and offers to
   * clear an entry the catalog no longer holds).
   *
   * ## Not a `TileId`, and the type system is what keeps it that way
   *
   * `DesignId` and `TileId` are separate Zod brands, so neither is assignable to
   * the other and a call that used to save a file is a compile error rather than
   * a key that silently resolves to nothing. They are also **lexically
   * disjoint**: a `TileId` matches `^tiles/…` (row X5) and no design id in the
   * corpus starts `tiles/` — 0 of 3,822, asserted in `corpus.test.ts` — which is
   * what lets `migrations.ts` recognise a file id sitting in this map and say so
   * instead of keeping a dangling key. It is the same disjointness argument row
   * S5 made for `gen:` against `tiles/`, one level up.
   *
   * ## What the collapse buys, measured
   *
   * At 2.28 files per design, saving every file in the corpus is **8,702 entries
   * under the old key and 3,822 under this one, 56.1% fewer**. The number that
   * matters more is how often two saves of *one* item used to produce two
   * entries: the three lock systems pick **two or more distinct files for 1,419
   * of the 3,822 items (37.1%)**, so browsing under openlock, switching to
   * dragonlock and pressing Add again used to leave a duplicate — and the
   * library screen had to explain it. There is nothing left to explain.
   */
  library: z.record(DesignId, z.literal(true)),
  placements: z.record(PlacementId, Placement),
  /**
   * Generated bases on the grid — a **second map beside {@link placements}**, in
   * the same {@link PlacementId} space.
   *
   * Row S5 minted the record and argued the shape; this is the field it said the
   * store row would add. Not a widening of {@link Placement}'s identity slot,
   * because every reader of the other map — the share codec, `migrations.ts`'s
   * per-entry parse, `billView.ts`'s `placementKey`, `buildBillOfTiles` — is
   * entitled to keep assuming that slot names one *item in the catalog*, and a
   * generated base is not in the catalog at all: it has no design, no aggregate
   * and no manifest ordinal. A union in that slot would make all of them
   * conditional for a population that is not in any of their questions. Row V4
   * changed that slot from a `TileId` to a `DesignId` and did not weaken this
   * argument by one word — if anything it sharpened it, because a `DesignId` is
   * the key of a *derivation over the catalog* and there is nothing for a
   * recipe to derive from.
   *
   * Sharing the id space is what makes one namespace over the whole scene.
   * **What V4 did change is the proof.** S5's was lexical — a `GeneratedBaseId`
   * starts `gen:` and therefore fails `TileId`'s `^tiles/…` pattern — and
   * `DesignId` carries no such pattern (`z.string().min(1)`, and tightening it
   * would rewrite 208 fixture ids across 28 files to buy back a theorem), so
   * that argument would now rest on a measurement of the corpus rather than on
   * the schemas. There is exactly **one** place that compares identities across
   * the two populations, `move.ts#identityOf` behind row G4's identical-twin
   * refusal, and it now qualifies the id with the population it came from — so
   * the disjointness is a fact about `'catalog'` versus `'generated'` rather
   * than about what the ids happen to look like, and no measurement is load
   * bearing. `placementKey` and `generatedPlacementKey` were never keys of one
   * map, so their disjointness was only ever needed for that comparison.
   * `migrations.ts` still rejects a `TileId` or a `gen:` id in the design slot
   * by name, because that slot reads `localStorage`.
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
   * Persisted, because the whole point is that it survives a reload. It is also
   * the reason the store is at version 2: a version 1 blob has no such field,
   * and `migrations.ts` fills it in.
   */
  lockChosen: z.boolean(),
})
export type WorkshopState = z.infer<typeof WorkshopState>

/**
 * The saved designs, as an array whose element type is the library's own key.
 *
 * Generic on purpose, and the reason is a hole row V3 found with `tsc`:
 * `Readonly<Record<TileId, true>>` **is** assignable to
 * `Readonly<Record<DesignId, true>>`, because a branded string is not a literal
 * union, so `Record` produces an index signature and the brand is dropped from
 * the key position. `readonly TileId[]` is **not** assignable to
 * `readonly DesignId[]`. **The array is the safe position; the map is not.**
 *
 * So the derivations take arrays, and this is the one place that turns the map
 * into one. Reading `K` off the caller's own field means a library keyed by
 * file yields `TileId[]`, which every consumer then refuses — where
 * `Object.keys(library) as DesignId[]` names the brand instead of deriving it
 * and would keep compiling the day the key changes again, handing every entry
 * to a lookup that cannot resolve it and rendering an empty list in silence.
 *
 * It lives here, beside the field it exists for, rather than in either
 * derivation: `screens/library/grouping.ts` and `builder/panels/palette.ts` are
 * both store-free, and importing `@/store` into them to share three lines would
 * cost more than the duplication did. Both *call sites* are components that
 * already read the store.
 *
 * `Partial` is load-bearing rather than politeness: `Record<K, true>` demands
 * every member of `K`, and a library holds a handful of 3,822.
 */
export function libraryDesigns<K extends string>(library: Readonly<Partial<Record<K, true>>>): K[] {
  return Object.keys(library) as K[]
}

/**
 * A fresh empty state.
 *
 * A function, not a frozen constant, because the caller owns the result: the
 * store mutates its copy, and handing every caller the same object would let a
 * migration's fallback alias the store's live state.
 */
export function defaultWorkshopState(): WorkshopState {
  return { library: {}, placements: {}, generated: {}, lock: DEFAULT_LOCK_SYSTEM, lockChosen: false }
}
