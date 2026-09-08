/**
 * What a press on the plan *means*, and what a selection *is* — both as values,
 * before anything is written.
 *
 * This is `three/edits.ts`'s pattern applied to the gesture that comes before its
 * verbs. That module states the defect it was extracted from — *"the decision and
 * the side effect were the same statement"* — and it is the same defect a
 * selection would otherwise reintroduce, one layer earlier: a `pointerdown`
 * handler that decides *and* calls `select`, `place` or nothing at all is a
 * handler whose four outcomes can only be asserted by pressing a real button on a
 * real canvas. Here the outcome is a {@link PressMeaning}, the component reads it
 * and makes at most one call, and the four-way table below is provable.
 *
 * That matters more than tidiness, because **jsdom has no WebGL context: no test
 * in this repository can mount the 3D surface.** `move.test.ts` says it, so does
 * `generatedScene.test.ts`, and `RoomSurface.tsx` is consequently untestable by
 * construction — every line of substance that stays inside its listeners is a
 * line nothing can check. So the substance leaves. What is left in the component
 * is the raycast, the store call and the live-region sentence.
 *
 * ## The two states this reads, and why they are exclusive
 *
 * The interaction model has exactly two ephemeral states and they are mutually
 * exclusive: **armed** (a template family picked from the palette, a ghost at the
 * snapped cursor) and **selected** (a piece on the plan, a floating action bar
 * over it). Both would otherwise claim the primary button, `R` and `Delete`, and
 * exclusivity settles all three ambiguities with one rule rather than three
 * tie-breaks. `usePlanTools` holds them in one state object so the invariant is
 * structural; {@link pressMeaning} only has to *read* it, which is why its
 * `armed` parameter is a boolean and not a template id — this module has no
 * business knowing what is armed, only that something is.
 *
 * ## A selection is resolved, never trusted
 *
 * {@link resolveSelection} is the second half of the row and it is a deliberate
 * refusal to cache. The spec asks for two invariants — removing the selected
 * piece clears the selection, and a `selected` id that no longer resolves reads
 * as *no* selection rather than as a dangling one — and resolving the id against
 * the scene on every read makes them one rule instead of two things a future
 * caller has to remember to do. See that function.
 *
 * ## Nothing here writes, and nothing here renders
 *
 * Every function is pure: a scene in, a verdict out. There is no store import, no
 * `TemplateInstance` constructed, and the only DOM type in the file is the
 * `Element` identity comparison {@link claimsPress} exists for.
 */
import type { PlacementId } from '@/store'

import type { PlanPoint } from './geometry'
import type { PlanScene, ScenePiece } from './scene'
import { navigationOrder, pieceAt } from './scene'

/* ------------------------------------------------------------- a press means */

/**
 * The four things a primary press on the plan can mean.
 *
 * A closed union rather than a nullable id, because "select nothing" and "this
 * press is not ours" are genuinely different answers and the old code conflated
 * them: a press on bare ground must *clear* the selection, and a press that
 * missed the plan entirely must be left alone so `OrbitControls` can orbit with
 * it. Collapsing the two would either make every orbit deselect or make bare
 * ground unclickable.
 *
 * `camera` is the only arm the surface does not claim. `select` and `place` are
 * claimed and `stopPropagation`'d away from the controls; `deselect` writes to
 * the tool state but must *not* be claimed, because a drag from bare ground is
 * the orbit gesture and its press is the same press.
 */
export type PressMeaning =
  | { readonly kind: 'select'; readonly id: PlacementId }
  | { readonly kind: 'deselect' }
  | { readonly kind: 'place' }
  | { readonly kind: 'camera' }

/**
 * What a primary press at `at` means, given whether the palette is armed.
 *
 * `at` is the world point the raycast resolved on the plan, or `null` when the
 * ray missed it — over the horizon, or past the edge of the room. A miss is
 * always `camera`, **whatever `armed` is**, because there is nowhere to place: a
 * ghost that is not on the plan has no anchor, and the alternative would be to
 * place a family at whatever coordinate the ray last happened to produce.
 *
 * Armed then wins over everything under the pointer. A press while armed places,
 * even on an existing piece — the ghost sits at the snapped cursor regardless of
 * what is beneath it, so the only placement that could be meant is the one the
 * user can see, and **a piece is never selected while armed** because arming and
 * selecting are the two exclusive states of the module note. This is also what
 * Sims 4 does: picking from the catalogue drops your selection, and a click after
 * that builds rather than selects.
 *
 * Unarmed, the press resolves through `scene.ts`'s {@link pieceAt} — the same
 * topmost-wins pick the rest of the builder uses, over the union of a piece's
 * parts — and a piece under the pointer is selected while bare ground clears the
 * selection. Deselecting on bare ground is the convention every 2D editor in the
 * lineage shares, and it is what gives the floating action bar a way to go away
 * that costs no chrome.
 */
export function pressMeaning(scene: PlanScene, at: PlanPoint | null, armed: boolean): PressMeaning {
  if (at === null) return { kind: 'camera' }
  if (armed) return { kind: 'place' }
  const piece = pieceAt(scene, at)
  return piece === undefined ? { kind: 'deselect' } : { kind: 'select', id: piece.id }
}

/* ------------------------------------------------------- a selection resolves */

/**
 * The selected piece, looked up in the scene — or `null`.
 *
 * **A resolve on every read, not a cached piece**, and that is the point of the
 * function rather than an implementation detail of it. The spec names two
 * invariants a selection has to hold, both of them about a selection outliving
 * its subject: *removing the selected piece clears the selection*, and a
 * `selected` id that no longer resolves — after a Clear, an undo, or a
 * rehydration of the store — reads as **no selection** rather than as a dangling
 * one. Resolving the id against the scene every time makes those one rule. A
 * trusted cache would make them two invariants that some future caller has to
 * maintain by hand, in three places that can each forget: the delete verb, the
 * undo apply, and the rehydration path. Nothing here can forget, because nothing
 * here remembers.
 *
 * Searched across **both** of `PlanScene`'s lists, because a selection may name a
 * catalogued instance or a generated base and the id space is one. Row **S5**
 * proved a `GeneratedBaseId` can never be a `TileId`, so a `PlacementId` names at
 * most one piece across the two maps and searching the union cannot find the
 * wrong one — the same argument `previewMove` relies on to take either
 * population.
 *
 * The two lists are searched directly rather than through `scenePaintOrder`,
 * which would concatenate them: order is irrelevant to a lookup by a unique id,
 * and this runs on every render that draws a selection.
 */
export function resolveSelection(scene: PlanScene, id: PlacementId | null): ScenePiece | null {
  if (id === null) return null
  const found: ScenePiece | undefined =
    scene.pieces.find((piece) => piece.id === id) ?? scene.generated.find((piece) => piece.id === id)
  return found ?? null
}

/**
 * The piece `[` or `]` moves the selection to, or `null` for an empty scene.
 *
 * This is the **primary keyboard route to a selection**: it needs no pointer and
 * no plan cursor, which is why the arrow-key cursor survives only as the
 * secondary path. It walks `scene.ts`'s {@link navigationOrder} — reading order
 * down the plan and then across, which is a *spatial* sequence rather than the
 * insertion order that is no order at all after ten minutes of editing.
 *
 * It **wraps at both ends**, so `]` on the last piece returns the first and `[`
 * on the first returns the last. A stepper that stopped dead at the ends would
 * make the user find out where they are in a sequence they cannot see, and there
 * is nothing past the last piece for the key to mean instead.
 *
 * `from === null` — no selection yet — starts at the first piece for `1` and the
 * last for `-1`, so the first press of either key lands somewhere rather than
 * doing nothing. An id the order does not hold behaves identically, which is
 * {@link resolveSelection}'s rule restated on this path: a stale selection is no
 * selection, so stepping from one starts from the beginning instead of returning
 * `null` and leaving the user with a key that appears broken.
 */
export function stepSelection(scene: PlanScene, from: PlacementId | null, direction: 1 | -1): PlacementId | null {
  const order = navigationOrder(scene)
  if (order.length === 0) return null
  const at = from === null ? -1 : order.findIndex((piece) => piece.id === from)
  if (at < 0) return (direction === 1 ? order[0] : order[order.length - 1])?.id ?? null
  return order[(at + direction + order.length) % order.length]?.id ?? null
}

/* ---------------------------------------------------------- whose press it is */

/**
 * Whether a press on the surface's host belongs to the plan at all.
 *
 * `RoomSurface.tsx` does not listen on the canvas. It listens on
 * `canvas.parentElement` **in the capture phase** and calls `stopPropagation` on
 * the presses it claims, because disabling `OrbitControls` from a `pointerdown`
 * on the canvas itself is a race — three's own handler may already have captured
 * the pointer. That mechanism is right and it stays.
 *
 * What it lacked is a test of `event.target`. The capture-phase listener on the
 * parent sees every press anywhere inside that parent, and the parent is exactly
 * the node drei's `<Html>` portals an in-canvas overlay into — so a press on such
 * an overlay is intercepted, claimed and stopped **before it ever reaches the
 * element the user aimed at**. The symptom is a button that visibly cannot be
 * clicked, with nothing in the button's own code to explain it.
 *
 * This is the bug *class*, not one portal. Moving a single overlay out of the
 * host would leave the trap armed for the next one, so the guard belongs at the
 * top of the listener and it is deliberately the strictest form: a press is the
 * plan's only when its target **is** the canvas, never merely inside the host.
 * Anything else in the host is somebody's overlay and its own listeners get the
 * press intact.
 *
 * A `null` target — a synthetic event, or a node detached between dispatch and
 * handling — is not the canvas and is therefore not claimed, which fails towards
 * "the camera orbits" rather than towards "the plan acts on a press it cannot
 * locate".
 */
export function claimsPress(target: EventTarget | null, canvas: Element): boolean {
  return target === canvas
}
