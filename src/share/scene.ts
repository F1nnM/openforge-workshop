/**
 * What a share link carries: the builder scene, and nothing else.
 *
 * ## An ordered list of *id-less* instances, not the store's keyed map
 *
 * `WorkshopState.placements` is a map keyed by `PlacementId`, and PR 5's docblock
 * explains why — a map makes "move the instance being dragged" a single-key write
 * and leaves the door open to collaborative editing. Those keys are UUIDs.
 * Putting them on the wire would cost 16 bytes per instance against the **14.7
 * (arity 3) to 20.9 (arity 5) an instance costs raw** — measured over a
 * thousand-instance room — so it would nearly double the payload to transmit
 * identities that mean nothing outside the browser that generated them.
 *
 * Row A1 put the id **inside** the record as well, so dropping it is now a
 * projection rather than merely a choice of container: a shared placement is a
 * {@link NewTemplateInstance}, which is `Omit<TemplateInstance, 'id'>` and is
 * exactly what `placeTemplate` takes. That is the type this module hands out in
 * both directions, so a receiver never constructs an id and an encoder never has
 * to decide whether to trust one out of a URL.
 *
 * So a shared scene is an **ordered list**, and the receiving app mints fresh ids:
 *
 * ```ts
 * const decoded = await decodeShareFragment(location.hash, manifest)
 * if (decoded.ok) {
 *   clearPlacements()
 *   setLockSystem(decoded.scene.lock)
 *   for (const instance of decoded.scene.placements) placeTemplate(instance)
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
 * (`capacity.test.ts` prints the table; `payload.ts` carries it, re-measured at
 * format 6): the **first** generated base costs 435 characters of the
 * 2,000-character budget and the next eighty-nine, sharing its recipe, cost 53
 * between them — because the table is deduplicated and `deflate` eats the
 * repetition, which is the same effect the columnar layout was chosen for.
 *
 * The adversarial scene of ninety bases with ninety *different* recipes now
 * reaches 103.3% of the budget and **no longer fits**, where it was 89.2% when
 * X9 asked the question. That is the room underneath growing — a placement
 * became a template instance, and then a fill gained a hold count — and not the
 * generated half, whose per-base cost has moved by single characters across both
 * changes. It stays a warning rather than a defect for the reason `payload.ts`
 * gives at length: the budget is a threshold, the link still works past it, and
 * every shape anybody builds is at 52.8% or less.
 *
 * So they travel. The alternative end state — encode nothing and say so plainly
 * — was available and is the worse of the two: it would put a permanent "this
 * link cannot carry part of your room" in front of a user for 435 characters of
 * URL, on the shape of scene the generator exists to produce.
 *
 * ## What a fill carries, and what it deliberately does not
 *
 * A slot's fill is a **file, one bit, and the accessories fitted into that file**
 * — the store's whole `SlotFill` — and all of it travels. The `tile` is not
 * optional: D1 makes a saved room deterministic by naming exact files, so a link
 * that carried only the template would open as a *different* room for a recipient
 * whose lock preference differs, which is the failure the lock byte already
 * exists to prevent one level up.
 *
 * The `holds` map travels as a file and a bit **per hold**, share format 6, and
 * *solved and empty* travels too — one more bit, per **fill**, because the two
 * readings of zero holds are two different rooms: `holds === {}` is *the user
 * took the last torch out* and `holds === undefined` is *nobody has looked*,
 * which the receiver's default-hold pass fills in against the receiver's own
 * catalog. Without the bit a deliberately cleared wall arrived with its torch put
 * back. A fill whose holds were all *dropped* — a retired accessory — still
 * arrives unsolved and is repaired; `link.ts` maps the three states.
 *
 * `pinned` travels for the reason it is not defaulted in the schema: it is the
 * difference between "the solver picked this, follow my lock" and "the user chose
 * this file, leave it alone", and the two disagree for **1,419 of 3,822 items
 * (37.1%)**. Dropping the bit would be indistinguishable from dropping it *to
 * `false`* — every deliberate override in the room silently reopened to
 * re-solving — and one bit per fill is the cheapest field in the format
 * (`payload.ts` measures the whole column).
 *
 * What does **not** travel is anything derived: no resolved assembly, no slot
 * offsets, no footprint, no bill. `src/store/schema.ts` refuses to persist those
 * for the same reason, and a link is a weaker place to keep a derived value than
 * `localStorage` is, not a stronger one.
 *
 * The facet state is likewise absent. `src/search/searchSchema.ts` already encodes
 * that into the **query string**, and this module owns the **fragment**; a link
 * built by the builder therefore carries both, each in its own half of the URL,
 * with one owner apiece.
 */
import { z } from 'zod'

import { GeneratedBaseId, GeneratedRecipe } from '@/generator/placement/scene'
import type { GeneratedPlacement } from '@/generator/placement/scene'
import type { LockSystem, NewTemplateInstance, WorkshopState } from '@/store'
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
  /**
   * Template instances in a stable order, each without its id.
   *
   * {@link NewTemplateInstance} rather than `TemplateInstance` because the id is
   * minted by the receiver — see the module docblock — and rather than a shape
   * of this module's own, because `placeTemplate` takes exactly this and a
   * second definition of "an instance without its identity" would be one more
   * thing to keep in step with `schema.ts`.
   */
  readonly placements: readonly NewTemplateInstance[]
  /**
   * Generated bases in a stable order, in the same shape the store holds them,
   * so a receiver hands each straight to `placeGeneratedBase`.
   *
   * A second list beside {@link placements} rather than one heterogeneous list,
   * matching the store's two maps and for the store's stated reason, which row
   * A1 made the strongest form of: the two populations no longer have the same
   * *arity*. An instance is a template family with up to five slots, each
   * holding a file that resolves through the lock preference; a generated base
   * is one recipe with one footprint and has no slot for any of that. There is
   * nothing a fill could name in it.
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
 *
 * The rest of each instance travels by **rest destructuring rather than by an
 * explicit field list**, so a field added to `TemplateInstance` reaches the wire
 * without an edit here. An explicit projection would compile the day a field is
 * added and silently drop it, which is exactly the class of loss X9 found in the
 * generated half. `id` is the one field named, because it is the one that must
 * not travel.
 */
export function sharedSceneFromState(state: WorkshopState): SharedScene {
  const placements = Object.values(state.placements).map(({ id: _id, ...instance }) => instance)
  return { lock: state.lock, placements, generated: Object.values(state.generated) }
}

/** An empty scene at the default lock — what a link with no placements decodes to. */
export function emptySharedScene(): SharedScene {
  return { lock: DEFAULT_LOCK_SYSTEM, placements: [], generated: [] }
}
