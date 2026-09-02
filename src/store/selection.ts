/**
 * The selection channel — one tile, handed from wherever the user found it to
 * the builder's palette.
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
 * {@link claimPendingTile} reads **and clears**. That is what makes the channel
 * a mailbox rather than a piece of state two screens have to agree about, and it
 * buys three things:
 *
 *   - Pressing "Use in builder" on the same tile twice works. The claim cleared
 *     the box, so the second write is `null` to non-`null` — a change, and
 *     therefore a wake-up — even though the value is identical. A plain
 *     last-value field would need a nonce to distinguish the two presses; a
 *     mailbox does not.
 *   - Re-mounting the palette does not re-arm a tile the user has since
 *     disarmed. There is nothing left to re-arm.
 *   - React's development double-invoke of effects is harmless: the second
 *     invocation claims `null` and does nothing.
 *
 * A second write before a claim **replaces** the first. Last press wins, which is
 * the only reading of two presses with no claim between them.
 *
 * ## What travels: the file, unresolved
 *
 * The channel carries a {@link TileId} — a *file*, the one the user was looking
 * at — and no number, so neither of A4's two brands over `number` appears here
 * and there is nothing for them to collapse into. A `ManifestOrdinal` is the
 * URL's currency and would have to be re-resolved by the reader; an
 * `AggregateAddress` names an *item*, and an item is not something the palette
 * can arm — `PaletteRow` is keyed by `record.id` and `Placement.tileId` is a
 * file. So a file it is, all the way through.
 *
 * **Nothing here resolves anything, and that is the load-bearing property.** A6's
 * rule 0 resolves a placed file to the variant the build's lock preference wants,
 * *before* base matching, and `assembly.test.ts` measures the three locks
 * disagreeing on the answer for **1,419 of the 3,822 items (37.1%)**. So "the
 * tile the user selected" and "the file that gets printed" are genuinely two
 * objects, and a channel that pre-resolved would conflate them: it would freeze
 * a preference into a handoff, and the file the user picked in the drawer would
 * stop being the file the palette armed. Instead the channel carries the
 * selection verbatim, the canvas writes it into `Placement.tileId` verbatim, and
 * `resolvePlacement` substitutes at bill time and says so through
 * `VariantResolution.substituted`. Rule 0 is idempotent over the corpus, so
 * handing it any variant of the item is safe — which is exactly why this channel
 * does not have to choose one.
 */
import { create } from 'zustand'

import type { TileId } from '@/catalog'

/**
 * The channel's whole state.
 *
 * One field. It is an interface with one member rather than a bare `TileId |
 * null` store so that a second handoff — a pending *slot* filling, say — lands
 * beside it instead of widening this one.
 */
export interface SelectionState {
  /** The file waiting to be armed, or `null` when the box is empty. */
  readonly pending: TileId | null
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
 * Ask the builder to arm this file.
 *
 * Does not navigate and does not touch the library — the caller does both, in
 * that order, because a tile the palette cannot list is a tile it cannot arm.
 */
export function sendTileToBuilder(id: TileId): void {
  useSelectionStore.setState({ pending: id })
}

/**
 * Take the pending file, leaving the box empty.
 *
 * `null` when there was nothing waiting, which is the overwhelmingly common case
 * — every render of the builder that was not reached through "Use in builder".
 * A plain function rather than a hook: the caller is an effect, and an effect
 * that has already decided to act should not also be subscribing.
 */
export function claimPendingTile(): TileId | null {
  const { pending } = useSelectionStore.getState()
  if (pending === null) return null
  useSelectionStore.setState({ pending: null })
  return pending
}

/**
 * Empty the box without arming anything.
 *
 * For a caller that has decided the handoff is stale. Deliberately **not**
 * called from `resetWorkshop`: the reader already refuses to arm a file the
 * palette holds no placeable row for, so a reset that emptied the library
 * disarms the handoff by making it unclaimable, and coupling the persisted store
 * to this one to restate that would be a dependency bought for nothing.
 */
export function clearPendingTile(): void {
  useSelectionStore.setState({ pending: null })
}

/** The pending file. A `TileId` or `null`, so an unchanged box is not a re-render. */
export const selectPendingTile = (state: SelectionState): TileId | null => state.pending

/** @see selectPendingTile */
export function usePendingTile(): TileId | null {
  return useSelectionStore(selectPendingTile)
}
