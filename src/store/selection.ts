/**
 * The selection channel — one **arm**, handed from wherever the user found a
 * tile to the builder's palette.
 *
 * Row G5, and the defect it closes is PR #23's: *"Use in builder cannot truly
 * pre-select — the store has no selection concept."* The drawer could add a tile
 * to the library, navigate to `/builder` and seed the palette's search, and then
 * it ran out of channel: the palette's armed row lives in `usePlanTools()`, which
 * is React state inside a screen the drawer never renders. There was nowhere to
 * put "and arm this one".
 *
 * ## Not persisted, and not in `WorkshopState`
 *
 * `schema.ts` is explicit that **anything added to `WorkshopState` is persisted**
 * and that ephemeral state belongs elsewhere, and `usePlanTools.ts` already spent
 * a docblock on why an armed tool must not come back from last week's session.
 * A pre-selection is weaker still than an armed tool — it is a *handoff*, valid
 * for the one navigation that created it. Two different features hide behind the
 * same word:
 *
 *   - **A remembered selection.** Survives a reload; belongs in `WorkshopState`,
 *     needs a migration rung, and nobody has asked for it.
 *   - **A pre-selection.** Survives one navigation and is then consumed. This.
 *
 * So this is a **separate store with no `persist` middleware**, which is the
 * shape `schema.ts` names ("a separate un-persisted store"). Consequences worth
 * stating, because they are the reasons rather than side effects:
 *
 *   - **The version ladder is untouched.** `STORE_VERSION` governs the shape of
 *     the `localStorage` blob. Nothing here is written to it, so there is no
 *     rung to add — now, when the plan's "nothing is deployed" stops being true,
 *     or ever. The ladder is not collapsed either: this row gave it no reason to
 *     be, and a field that never reaches storage is not the change the ladder
 *     exists for.
 *   - **Export/import ignores it.** `transfer.ts` round-trips the durable copy of
 *     a scene; a handoff in flight is not part of a scene.
 *   - **A reload drops it.** Correct: the press that created it is gone.
 *
 * ## One-shot, and self-clearing
 *
 * {@link claimPendingArm} reads **and clears**. That is what makes the channel
 * a mailbox rather than a piece of state two screens have to agree about, and it
 * buys three things:
 *
 *   - Pressing "Use in builder" on the same item twice works. The claim cleared
 *     the box, so the second write is `null` to non-`null` — a change, and
 *     therefore a wake-up — even though the value is identical. A plain
 *     last-value field would need a nonce to distinguish the two presses; a
 *     mailbox does not.
 *   - Re-mounting the palette does not re-arm something the user has since
 *     disarmed. There is nothing left to re-arm.
 *   - React's development double-invoke of effects is harmless: the second
 *     invocation claims `null` and does nothing.
 *
 * A second write before a claim **replaces** the first. Last press wins, which is
 * the only reading of two presses with no claim between them.
 *
 * ## What travels: the arm — a family and a size, and this is row C1's call
 *
 * Row **A1** parted the channel from the persisted scene and wrote the decision
 * into this docblock as C1's: V4 had made the two speak one currency end to end
 * — `claimPendingDesign` handed a `DesignId` to `tools.setSelectedDesign`,
 * which handed it to the store's placing action — and A1 made a placement a
 * template family with a fill per slot, so **there is no design in a placement
 * anywhere and no action here to hand one to.** The box was still holding an
 * item nothing could act on.
 *
 * It now holds a {@link PendingArm}: **the `TemplateId` of a family and the tags
 * of one position of that family's size control.** Four reasons, in the order
 * they decide it:
 *
 *   1. **The reader can act on it, and could not act on a design.** After row C1
 *      the palette's entire state is *(family, size position)* and the surface
 *      places `tools.selectedTemplate`. A `DesignId` names nothing in that list.
 *      Passing one anyway is not even a type error the compiler can be relied on
 *      to catch — `DesignId` is a brand over `z.string().min(1)` and all 91
 *      template ids satisfy it, measured — which is exactly the cast row A8
 *      refused, and it would report every placement `unknown-template`.
 *   2. **The lossy step happens at the writer, where it can be explained.**
 *      Turning a specific tile into *the family that admits it* loses which tile
 *      it was. The drawer knows the tile and can say what it is about to arm;
 *      a reader handed an id would be silently reinterpreting it.
 *      `builder/panels/familyKey.ts#armForTags` is that map, and it is a function
 *      of the tile's own tags: **3,728 of 3,822 designs (97.5%) resolve to a
 *      family** — they must, because the families partition the corpus — and
 *      **3,206 of those (86.0%) also hit an exact size position**, so the
 *      handoff usually arms *"Floor: Straight, 2 wide by 2 deep"*. The 94 that
 *      resolve to nothing are all `role|insert`: a door is not a family, it is a
 *      fill for a host tile's accessory slot, and the drawer says so instead of
 *      arming something wrong.
 *   3. **Size travels because the arm *is* (family, size).** A placement stores
 *      fills, not a size; a size position is a set of tags that joins an
 *      instance's `parentTags` so the slot's own `constrain` block collects them
 *      (B4). So it is an input to the fill, which makes it part of the arm and
 *      not part of the scene — and the channel carrying it costs a `string[]`.
 *   4. **Nothing here resolves anything, and that is still the load-bearing
 *      property.** A6's rule 0 resolves a placed item to the variant the build's
 *      lock preference wants, and `assembly.test.ts` measures the three locks
 *      disagreeing for **1,419 of 3,822 items (37.1%)**. A family plus a size
 *      domain position is not a file, so there is no choice in this box for a
 *      preference to freeze — the same property G5 wanted and V1 got by carrying
 *      a design, held by a value that the reader can also use.
 *
 * **The kind changed, so the five functions are renamed**, which is the rule V1
 * set here when it turned the box from a file into a design: a caller that keeps
 * compiling against a name it recognises would hand one kind of thing to
 * something that believes it received another. There is exactly one writer (the
 * catalog drawer) and one reader (the builder palette).
 *
 * What A1 changed in this file beyond the docblock is one thing, and it is stated
 * at {@link clearPendingArm}.
 */
import { create } from 'zustand'

import type { TemplateId } from './schema'

/**
 * What the box holds: a family, and one position of its size control.
 *
 * `size` is the position's **tags** rather than its index or its label. Tags are
 * what a size position *is* — they join the instance's `parentTags` — so the
 * value is self-describing and a reader can match it against the family's table
 * by set equality without agreeing on an ordering with the writer. `[]` is the
 * `any size` position, which every family carries and which is a real default
 * rather than a missing selection: with no size chosen the slot's `constrain`
 * collects nothing and the family admits every size.
 *
 * A plain `readonly string[]` and not a branded tag type, because `@/store` holds
 * no tag vocabulary and must not import one: `schema.ts`'s `TemplateId` docblock
 * gives the rule — whether an id names something this *build* ships is a question
 * for the reader that has the table, and this closure has neither the template
 * table nor the tag table.
 */
export interface PendingArm {
  readonly template: TemplateId
  /** One or two `size|width|w` / `size|depth|d` tags, or none for `any size`. */
  readonly size: readonly string[]
}

/**
 * The channel's whole state.
 *
 * One field. It is an interface with one member rather than a bare `PendingArm |
 * null` store so that a second handoff — a pending *slot* filling, say — lands
 * beside it instead of widening this one.
 */
export interface SelectionState {
  /** The arm waiting to be taken up, or `null` when the box is empty. */
  readonly pending: PendingArm | null
}

/**
 * The channel.
 *
 * Exported for tests and for the same reason `useWorkshopStore` is: a non-React
 * caller reads it through `getState()`. Application code should prefer the
 * functions and the hook below.
 */
export const useSelectionStore = create<SelectionState>(() => ({ pending: null }))

/**
 * Ask the builder to arm this family, at this size.
 *
 * Does not navigate; the caller does. It used to not touch the library either,
 * and the caller was expected to add the item first because an item the palette
 * could not list was an item it could not arm — rows A0 and A1 deleted the
 * library, and row C1 replaced the archive list with the 91 template families, so
 * there is no first step and the palette's rows are a function of the *build*
 * rather than of anything the user saved.
 */
export function armTemplateInBuilder(arm: PendingArm): void {
  useSelectionStore.setState({ pending: arm })
}

/**
 * Take the pending arm, leaving the box empty.
 *
 * `null` when there was nothing waiting, which is the overwhelmingly common case
 * — every render of the builder that was not reached through "Use in builder".
 * A plain function rather than a hook: the caller is an effect, and an effect
 * that has already decided to act should not also be subscribing.
 */
export function claimPendingArm(): PendingArm | null {
  const { pending } = useSelectionStore.getState()
  if (pending === null) return null
  useSelectionStore.setState({ pending: null })
  return pending
}

/**
 * Empty the box without arming anything.
 *
 * For a caller that has decided the handoff is stale — **and, since row A1, for
 * `resetWorkshop`.** That is contract **C-f**, and it is a reversal of what this
 * docblock used to say.
 *
 * The old argument was: *"the reader already refuses to arm a file the palette
 * holds no placeable row for, so a reset that emptied the library disarms the
 * handoff by making it unclaimable, and coupling the persisted store to this one
 * to restate that would be a dependency bought for nothing."* **Its premise was
 * the library, and rows A0 and A1 deleted it.** The palette now lists the 91
 * templates this build ships (§3.1), which are a function of the bundle and not
 * of anything a reset clears — so a pending handoff survives a reset *and stays
 * claimable*, and the first render of the builder after "clear everything" would
 * arm a family whose last placement the user had just thrown away. Row C1 sharpens the
 * invariant rather than weakening it: the reader's refusal is now *narrower* than
 * it was, because a family is refused only when the build does not ship it.
 *
 * The coupling is one-directional: `workshopStore.ts` imports this function and
 * nothing here imports from there.
 */
export function clearPendingArm(): void {
  useSelectionStore.setState({ pending: null })
}

/** The pending arm. An object or `null`, so an unchanged box is not a re-render. */
export const selectPendingArm = (state: SelectionState): PendingArm | null => state.pending

/** @see selectPendingArm */
export function usePendingArm(): PendingArm | null {
  return useSelectionStore(selectPendingArm)
}
