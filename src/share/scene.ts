/**
 * What a share link carries: the builder scene, and nothing else.
 *
 * ## An ordered list, not the store's keyed map
 *
 * `WorkshopState.placements` is a map keyed by `PlacementId`, and PR 5's docblock
 * explains why — a map makes "move the tile being dragged" a single-key write and
 * leaves the door open to collaborative editing. Those keys are UUIDs. Putting
 * them on the wire would cost 16 bytes per placement against the ~6 the placement
 * itself costs, cutting capacity by roughly three quarters to transmit identities
 * that mean nothing outside the browser that generated them.
 *
 * So a shared scene is an **ordered list**, and the receiving app mints fresh ids:
 *
 * ```ts
 * const decoded = await decodeShareFragment(location.hash, manifest)
 * if (decoded.ok) {
 *   clearPlacements()
 *   setLockSystem(decoded.scene.lock)
 *   for (const placement of decoded.scene.placements) placeTile(placement)
 *   for (const base of decoded.scene.generated) placeGeneratedBase(base)
 * }
 * ```
 *
 * `clearPlacements` already empties both maps and releases every mesh hold, so
 * the generated line needs no clearing step of its own. A base arrives as an
 * *unrendered* one, exactly as it does after a reload — the recipe is in the
 * link and the mesh never is — so the outline draws, the bill carries S5's
 * `warn` row and the download refuses until the generator renders it again.
 *
 * That is PR 18's four lines, deliberately not wrapped in a function here: the
 * store's write path is synchronous and PR 5 keeps it that way on purpose, so the
 * `await` belongs at the call site where the caller can see it, not hidden behind
 * an `applyScene()` that looks synchronous and is not.
 *
 * ## Generated bases *are* in the link, and X9 found out that they were not
 *
 * Row X9 reported this module as reading `state.placements` only, so a shared
 * room **silently dropped its generated bases** — the one failure mode the whole
 * share codec is written to avoid, and the reason `decodeShareFragment` never
 * throws and always names what it lost. Data loss with no error is worse than a
 * refused link.
 *
 * The honest question was whether they *fit*, because a generated base is not a
 * catalog file and has no manifest ordinal to stand in for it: what identifies
 * one is its recipe, and a canonical recipe key is 85–242 characters. Measured
 * (`capacity.test.ts` prints the table; `payload.ts` carries it): the **first**
 * generated base costs 440 characters of the 2,000-character budget and the next
 * eighty-nine, sharing its recipe, cost 66 between them — because the table is
 * deduplicated and `deflate` eats the repetition, which is the same effect the
 * columnar layout was chosen for. The adversarial scene of ninety bases with
 * ninety *different* recipes reaches 89.2% of the budget and still fits, and
 * nobody builds that.
 *
 * So they travel. The alternative end state — encode nothing and say so plainly
 * — was available and is the worse of the two: it would put a permanent "this
 * link cannot carry part of your room" in front of a user for 440 characters of
 * URL, on the shape of scene the generator exists to produce.
 *
 * ## The library is not in the link
 *
 * `WorkshopState` also holds the library — the items a user kept. A share link is
 * "here is the room I built", not "here is my bookmark list", and the library is
 * the one part of the state that is personal rather than about the artefact.
 * **That is now the whole of the reason**, and the second one this docblock used
 * to give is worth 3× to 14× less than when it was written: it said an entry
 * *"costs a full `TileId`"*, 39 to 183 characters, since a library entry has no
 * placement to amortise an ordinal against. Row V1 re-keyed the library to
 * designs and a `DesignId` is **13 characters flat**, so the cost argument has
 * mostly evaporated — and it could evaporate entirely, since a library entry
 * could travel as its design's address ordinal exactly as a placement does. The
 * decision does not move: it was never about the bytes. JSON export
 * (`src/store/transfer.ts`) is the path that carries everything.
 *
 * The facet state is likewise absent. `src/search/searchSchema.ts` already encodes
 * that into the **query string**, and this module owns the **fragment**; a link
 * built by the builder therefore carries both, each in its own half of the URL,
 * with one owner apiece.
 */
import { z } from 'zod'

import { GeneratedBaseId, GeneratedRecipe } from '@/generator/placement/scene'
import type { GeneratedPlacement } from '@/generator/placement/scene'
import type { LockSystem, Placement, WorkshopState } from '@/store'
import { DEFAULT_LOCK_SYSTEM } from '@/store'

/**
 * One distinct generated base, as the recipe table carries it.
 *
 * Both halves of the identity travel: the `base` id and the `recipe` it was
 * derived from. They are redundant — an id *is* `gen:` plus the canonical recipe
 * key — and carrying both anyway is the deliberate choice, because the
 * alternative is to recompute the key at the receiving end, and `recipeKey` sits
 * in `@/generator/panel/recipe`, which value-imports the 25 KB of pinned
 * parameter JSON that S4's and S5's boundary tests exist to keep out of the
 * eager chunk (X9 measured that one convenient import at +20,168 B raw).
 * Restating the key builder instead — the trade `recipeHandle` already makes for
 * `recipeId` — would put a second implementation of recipe *identity* in the
 * tree, and identity is the one thing S5 argues must have exactly one.
 *
 * Measured cost of carrying the second copy: the document is 563 bytes raw for
 * the widest of the five shapes against ~290 for the recipe alone, and deflate
 * takes the duplicated text back down — the whole first document lands in 440
 * characters of link. So the redundancy costs tens of characters, once.
 *
 * What it does *not* do is check the pair agrees. Nothing else does either:
 * `placeGeneratedBase` parses a `GeneratedPlacement` without cross-checking
 * `base` against `recipeKey(recipe)`, so `importWorkshop` already accepts a
 * hand-edited JSON backup carrying a mismatched pair. That hazard predates this
 * module and is not widened by it — a mismatch yields a base whose 8-character
 * caption handle disagrees with its geometry, and nothing branches on the handle
 * (S4 is explicit) — but it is a real hole and it belongs to `src/store/**`.
 */
export const SharedGeneratedBase = z.object({ base: GeneratedBaseId, recipe: GeneratedRecipe })
export type SharedGeneratedBase = z.infer<typeof SharedGeneratedBase>

/**
 * A recipe table entry as canonical text.
 *
 * Explicit key order rather than `JSON.stringify(document)`, and the parameters
 * sorted by name, so that **two shares of one scene produce the same link** — the
 * property the module docblock claims for `Object.values`, extended to the
 * generated half. A `GeneratedPlacement` read back from `localStorage` preserves
 * whatever key order the writer used, and `canonicalise`'s sort is a fact about
 * the panel rather than about the schema, so neither can be relied on here.
 *
 * `JSON.stringify` of a string, a finite number or a boolean is total and needs
 * no escaping of its own; the vector arm stringifies as a JSON array, which is
 * what {@link GeneratedRecipe}'s `RecipeValue` reads back.
 */
export function stringifySharedGeneratedBase(document: SharedGeneratedBase): string {
  const names = Object.keys(document.recipe.parameters).sort()
  const parameters = names.map((name) => `${JSON.stringify(name)}:${JSON.stringify(document.recipe.parameters[name])}`)
  return (
    `{"base":${JSON.stringify(document.base)},"recipe":{"v":1,` +
    `"entry":${JSON.stringify(document.recipe.entry)},"parameters":{${parameters.join(',')}}}}`
  )
}

/** A builder scene as a link carries it. */
export interface SharedScene {
  /**
   * The lock preference, travelling with the link.
   *
   * Not optional and not defaulted at the receiving end, because §2 makes this the
   * choice that decides which concrete STL each placed design resolves to: the
   * same scene under `openlock` and under `magnetic` is a different download pack,
   * and 40.2 percentage points of the catalog are reachable under one and not the
   * other. A link that dropped it would open as a different build for a recipient
   * whose own preference differs.
   */
  readonly lock: LockSystem
  /** Placements in a stable order. Ids are minted by the receiver — see the module docblock. */
  readonly placements: readonly Placement[]
  /**
   * Generated bases in a stable order, in the same shape the store holds them,
   * so a receiver hands each straight to `placeGeneratedBase`.
   *
   * A second list beside {@link placements} rather than one heterogeneous list,
   * matching the store's two maps and for the store's stated reason: every
   * reader of a `Placement` is entitled to keep assuming its identity slot names
   * one item **in the catalog**. Row V4 changed that slot from a `TileId` to a
   * `DesignId` and the entitlement is unchanged — a generated base has no design
   * any more than it has a file, so it is no closer to fitting in that list than
   * it was.
   */
  readonly generated: readonly GeneratedPlacement[]
}

/**
 * Project the persisted state onto a shareable scene.
 *
 * Takes the state as an argument rather than reading the store, so the codec stays
 * headless and testable in a node environment. `Object.values` preserves the map's
 * insertion order, which is placement order, so two shares of one scene produce
 * the same link.
 */
export function sharedSceneFromState(state: WorkshopState): SharedScene {
  return { lock: state.lock, placements: Object.values(state.placements), generated: Object.values(state.generated) }
}

/** An empty scene at the default lock — what a link with no placements decodes to. */
export function emptySharedScene(): SharedScene {
  return { lock: DEFAULT_LOCK_SYSTEM, placements: [], generated: [] }
}
