/**
 * OpenForge Workshop — the shape of the persisted client state.
 *
 * Five things survive a reload: the **library** (tiles the user kept), the
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
 * This file describes the *current* shape only. Migration from older shapes
 * lives in `migrations.ts`, and the reason the two are separate is that a
 * migration must read shapes this file no longer describes.
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
 * Branded so a `PlacementId` cannot be passed where a {@link TileId} is
 * expected. Both are opaque strings over the same scene, and confusing them
 * would be a silent lookup miss rather than an error.
 */
export const PlacementId = z.string().min(1).brand<'PlacementId'>()
export type PlacementId = z.infer<typeof PlacementId>

/**
 * One tile placed on the plan-view grid.
 *
 * Four fields, and the omissions are as deliberate as the inclusions:
 *
 *   - **`tileId`, not a design id.** §2 fixes `id` (the fixture `full_name`) as
 *     the key React, placements and share links address a tile by. §7's "place
 *     designs, not files" is about the *palette*, and the concrete file it
 *     resolves to is a function of the placed tile plus the global lock
 *     preference — so resolving it at download time keeps a saved scene correct
 *     when the user later changes that preference, while storing the resolved
 *     file would freeze it.
 *
 *   - **No footprint, size or colour.** All three are `CatalogRecord` fields.
 *     Copying them here would double the persisted payload and desynchronise on
 *     the next import.
 *
 *   - **No base.** Every `connection|openforge` piece needs a base line item
 *     (§7), but it is *auto-inserted* into the bill of tiles by the assembly
 *     resolver, not placed by the user. Persisting it would produce two bases
 *     the day that rule changes.
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
  tileId: TileId,
  x: coordinate,
  z: coordinate,
  /**
   * Rotation in degrees, canonicalised to `[0, 360)`.
   *
   * The *step* is per-tile and comes from `CatalogRecord.rotStep` — 893 tiles
   * carry an angle that is not a multiple of 90 and would never tile on a 90°
   * step — so the step is not stored here; only the resulting angle is. The
   * range is enforced so that two placements at the same visual angle compare
   * equal, which is what lets the share codec (PR 10) encode an angle as a small
   * integer rather than as an unbounded float.
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
 * `library` is a set of {@link TileId}s held as a keyed map whose value slot
 * carries no information. A JSON object is the only shape that survives
 * `JSON.stringify` as a set without a custom replacer — and a custom replacer is
 * exactly the kind of asymmetry that breaks a migration years later. The map
 * also gives O(1) membership, which is what lets a catalog card ask "am I in the
 * library?" without scanning, and preserves insertion order (every `TileId`
 * starts `tiles/`, so no key is integer-like and V8's ordering rules keep them
 * in the order they were added).
 */
export const WorkshopState = z.object({
  library: z.record(TileId, z.literal(true)),
  placements: z.record(PlacementId, Placement),
  /**
   * Generated bases on the grid — a **second map beside {@link placements}**, in
   * the same {@link PlacementId} space.
   *
   * Row S5 minted the record and argued the shape; this is the field it said the
   * store row would add. Not a widening of `Placement.tileId`, because that
   * field is a `TileId` and every reader of the other map — the share codec,
   * `migrations.ts`'s `TileId.safeParse` per entry, `billView.ts`'s
   * `placementKey`, `buildBillOfTiles` — is entitled to keep assuming so. A
   * union in that slot would make all of them conditional for a population that
   * is not in any of their questions.
   *
   * Sharing the id space is what makes one namespace over the whole scene, and
   * S5 proved it is safe: a `GeneratedBaseId` starts `gen:` and therefore fails
   * `TileId`'s `^tiles/…` pattern, so `generatedPlacementKey` and
   * `placementKey` are disjoint by construction rather than by convention, and
   * row G4's identical-twin refusal is unaffected.
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
 * A fresh empty state.
 *
 * A function, not a frozen constant, because the caller owns the result: the
 * store mutates its copy, and handing every caller the same object would let a
 * migration's fallback alias the store's live state.
 */
export function defaultWorkshopState(): WorkshopState {
  return { library: {}, placements: {}, generated: {}, lock: DEFAULT_LOCK_SYSTEM, lockChosen: false }
}
