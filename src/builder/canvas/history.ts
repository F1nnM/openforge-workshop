/**
 * Undo, as a capped ring of placement snapshots.
 *
 * `move.ts:27` has carried the admission since PR #29: *"There is no undo stack
 * in the app yet — nothing in `src/store/**` records history."* It also carried
 * the bill, because every argument in that module about writing to the store
 * once per gesture was really an argument about what a history stack would have
 * to record. This is that stack, and it is deliberately the dullest possible
 * one: two arrays of snapshots and three total functions over them.
 *
 * ## Why snapshots and not an inverse-command log
 *
 * The tempting design is a log over `SurfaceEdit`, which is already a six-kind
 * discriminated union and would hand out semantic labels for free — the edit
 * *knows* it was a rotate. It is the wrong trade, for a reason that gets worse
 * over time rather than better: an inverse log needs an inverse **per verb,
 * forever**. That is a seventh inverse on the day the action bar starts writing
 * slot fills, and thereafter a silent hole in undo the first time someone adds
 * an eighth verb and forgets its inverse — silent because nothing type-checks
 * the completeness of a hand-written inverse table, and the failure mode is not
 * a crash but a `Ctrl`+`Z` that quietly does the wrong thing to a user's room.
 *
 * A snapshot covers every present and future mutation of the placement map by
 * construction. It cannot be incomplete, because it never enumerates the verbs.
 *
 * ## Why a snapshot is cheap enough to be allowed to be dull
 *
 * Because `placements` is a keyed map rather than an array, which
 * `src/store/schema.ts` chose partly for this: *"An array would address a
 * placement by position … fine for one user with an undo stack, fatal to the
 * collaborative editing the plan leaves open."* A snapshot of a map is a
 * **shallow object copy** — one object holding N existing references — where a
 * snapshot of a scene graph would be a deep clone of geometry. Nothing under
 * this module clones a `TemplateInstance`, and nothing needs to: the store
 * replaces instances rather than mutating them, so the reference in a snapshot
 * is the value the snapshot was taken of.
 *
 * ## Why the ring is not in `WorkshopState`
 *
 * `src/store/schema.ts` is explicit about what putting it there would mean:
 * *"**Anything added here is persisted**; ephemeral UI state (hover,
 * drag-in-progress, panel open) belongs in component state or in a separate
 * un-persisted store."* A persisted undo stack is not merely wasteful — fifty
 * copies of the room in `localStorage` against a quota this app has already had
 * to ask for — it is a hazard. Restoring last week's stack means a user's first
 * `Ctrl`+`Z` in a new session reverts an edit they no longer remember making,
 * from a session they have long since finished, and there is no way for the
 * status line to explain that. Undo is a property of *this sitting* at the
 * keyboard. So the ring lives beside the store, in the hook that owns it, and
 * dies with the tab.
 *
 * ## Why `describeChange` diffs rather than taking a label
 *
 * The status line has to say what an undo did, and the obvious way is for each
 * call site to pass its own sentence in alongside the snapshot. That is the same
 * per-verb bookkeeping the inverse log was rejected for, reintroduced one field
 * over: a label supplied by a call site is a claim about the edit that nothing
 * checks, and it drifts the moment a verb changes what it writes without
 * changing what it says. Diffing the two maps derives the sentence from what
 * actually happened, so it cannot disagree with the placements the user is now
 * looking at — the same reason `ghost.ts` and `vacancy.ts` share one collision
 * predicate with the scene pass rather than keeping a second opinion.
 *
 * Every function here is total and pure. There is no store import, no React, and
 * no clock: `useHistory.ts` owns the subscription, the re-entrancy flag that
 * stops an applied undo recording itself, and the `useRef` the ring sits in.
 */
import type { PlacementId, SlotName, TemplateInstance, WorkshopState } from '@/store'

/**
 * How many undo steps are kept, oldest dropped.
 *
 * Fifty is the design's figure and it is a memory bound, not a usability one: at
 * a shallow copy per entry the ring costs fifty small objects plus the
 * references in them, which is nothing beside the meshes already resident, while
 * an uncapped ring over a long session is an unbounded leak that nothing would
 * ever notice until the tab died. Fifty steps is also comfortably past the point
 * at which a user stops pressing `Ctrl`+`Z` and starts clearing the plan.
 */
export const HISTORY_DEPTH = 50

/**
 * One snapshot: the whole placement map, exactly as the store holds it.
 *
 * Aliased from `WorkshopState` rather than restated, for the reason
 * `src/store/schema.ts` gives for inferring its own types from Zod — a
 * hand-written copy of a shape is a stale shape waiting to happen. When row A1
 * changed the value from a tile to a template instance, this alias changed with
 * it and this module did not.
 */
export type Placements = WorkshopState['placements']

/**
 * The ring: what can be undone, and what has been undone and can be redone.
 *
 * Two stacks rather than a cursor into one array. A cursor is the same
 * information and admits a state the two stacks cannot represent — a cursor
 * pointing past the end of the array — so the invariant *"`past` is behind you,
 * `future` is ahead of you"* is a shape here rather than an assertion.
 *
 * Neither stack holds the *current* placements. Those live in the store, which
 * is the only copy the app renders, and duplicating them here would create a
 * second answer to "what is on the plan" that could go stale. It is the reason
 * {@link undo} and {@link redo} take `current` as an argument instead of
 * reading it off the history.
 */
export interface History {
  readonly past: readonly Placements[]
  readonly future: readonly Placements[]
}

/** A ring with nothing in it — the state of a freshly loaded tab. */
export const EMPTY_HISTORY: History = { past: [], future: [] }

/**
 * Note an edit: push the placements as they were, and abandon the redo branch.
 *
 * `previous` is the value *before* the edit, because that is what `Ctrl`+`Z` has
 * to restore. The subscription in `useHistory.ts` sees both sides of a store
 * change and passes the older one.
 *
 * **`future` is cleared, and that is not a detail.** Once the user has edited on
 * top of an undone state, the redo entries describe a branch of history that no
 * longer leads anywhere from here; keeping them would let `Ctrl`+`Shift`+`Z`
 * install a map assembled from two different lineages. Every editor with a
 * linear undo model does this, and the alternative — a tree — is a feature
 * nobody asked for and a UI nobody could read.
 *
 * The oldest entry is dropped past {@link HISTORY_DEPTH} rather than the newest
 * refused: an undo stack that stopped recording at fifty edits would leave the
 * user unable to undo the thing they *just* did, which is the one entry that is
 * always wanted.
 */
export function record(history: History, previous: Placements): History {
  return {
    past: [...history.past, snapshot(previous)].slice(-HISTORY_DEPTH),
    future: [],
  }
}

/**
 * Step back one edit, if there is one.
 *
 * `null` rather than an unchanged history when `past` is empty, so the caller
 * can tell "nothing happened" from "something happened" without comparing
 * histories — that is what the toolbar's disabled state and the status line's
 * silence are both driven from.
 *
 * The returned `placements` is handed back as it was stored, not copied again:
 * the caller's job is to install it in the store, and the store owns whatever it
 * is given from then on. `current` is snapshotted on the way onto `future` for
 * the same reason {@link record} snapshots — see {@link snapshot}.
 *
 * `future` needs no cap of its own. It can only grow by an entry that `past`
 * simultaneously loses, so it is bounded by {@link HISTORY_DEPTH} by
 * construction.
 */
export function undo(
  history: History,
  current: Placements,
): { readonly history: History; readonly placements: Placements } | null {
  const previous = history.past[history.past.length - 1]
  // The lookup *is* the emptiness test: under `noUncheckedIndexedAccess` an
  // out-of-range index is `undefined`, so a separate length check would be a
  // second statement of the same condition that the compiler would then ask us
  // to narrow anyway.
  if (previous === undefined) return null
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, snapshot(current)],
    },
    placements: previous,
  }
}

/**
 * Step forward one undone edit, if there is one. The mirror image of
 * {@link undo}: pop `future`, push `current` onto `past`.
 *
 * `past` is not re-capped here. A redo can only put back an entry a preceding
 * undo took off `past`, so it cannot push the stack past {@link HISTORY_DEPTH};
 * capping anyway would be a no-op at best and, if the cap ever dropped an entry,
 * would silently make the next `Ctrl`+`Z` skip a step.
 */
export function redo(
  history: History,
  current: Placements,
): { readonly history: History; readonly placements: Placements } | null {
  const next = history.future[history.future.length - 1]
  if (next === undefined) return null
  return {
    history: {
      past: [...history.past, snapshot(current)],
      future: history.future.slice(0, -1),
    },
    placements: next,
  }
}

/**
 * One sentence for the status line, derived from the two maps themselves.
 *
 * Three things can have happened to a key: it appeared (**placed**), it vanished
 * (**removed**), or it survived and its instance is not the same piece any more
 * (**changed**). Counts are pluralised — `'Placed 1 tile.'`, `'Placed 3
 * tiles.'` — and *tile* is the word deliberately, even though a placement is a
 * template instance of up to five parts: it is the noun the toolbar, the palette
 * and the bill all use to the user, and the status line is not the place to
 * introduce a second vocabulary.
 *
 * ## More than one category at once
 *
 * A single undo can be all three — restoring the state before a Clear that
 * followed a move puts pieces back, takes pieces away and shifts pieces in one
 * step. Those are reported as **comma-separated clauses in one sentence, in the
 * fixed order placed, removed, changed**: `'Placed 3 tiles, removed 1 tile,
 * changed 2 tiles.'` Clauses for categories with a count of zero are omitted
 * entirely, so the common single-category case reads exactly as it did before
 * this rule existed.
 *
 * The order is fixed rather than sorted by count on purpose. Sorted, the same
 * edit would read differently depending on how large the plan happened to be,
 * which makes the line harder to skim and impossible to assert about; fixed, the
 * sentence is a stable shape the user's eye can learn.
 *
 * `'No change.'` when the two maps are equivalent. That is a real case rather
 * than defensive padding: it is what a store write that rewrote the map without
 * changing any piece produces, and saying so is better than a blank status line,
 * which reads as an undo that failed.
 */
export function describeChange(before: Placements, after: Placements): string {
  const counts = countChanges(before, after)
  const clauses = [
    clause('placed', counts.placed),
    clause('removed', counts.removed),
    clause('changed', counts.changed),
  ].filter((text) => text !== null)
  if (clauses.length === 0) return 'No change.'
  const sentence = clauses.join(', ')
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/** How many keys fell into each of {@link describeChange}'s three categories. */
interface ChangeCounts {
  readonly placed: number
  readonly removed: number
  readonly changed: number
}

/**
 * Both key sets, in two passes — one per direction of the asymmetry.
 *
 * Iterating either map alone would miss a whole category, since a key only in
 * `before` is a removal and a key only in `after` is a placement. The two passes
 * split that cleanly: the first classifies every key that *was* there as gone or
 * as still there and different, the second counts the arrivals. The alternative
 * is one pass over the union of the keys, which needs a `Set` built from both
 * key arrays and then has to re-establish inside the loop which side each key
 * came from — the same work, spelled less plainly.
 *
 * `Object.entries` rather than `Object.keys` on the first pass, because it
 * carries the value along: `placements` is keyed by a branded {@link PlacementId}
 * and a bare `Object.keys` string cannot index it without the cast the second
 * pass has to make.
 */
function countChanges(before: Placements, after: Placements): ChangeCounts {
  let placed = 0
  let removed = 0
  let changed = 0
  for (const [key, was] of Object.entries(before)) {
    const now = after[key as PlacementId]
    if (now === undefined) removed += 1
    else if (!samePiece(was, now)) changed += 1
  }
  for (const key of Object.keys(after)) {
    if (before[key as PlacementId] === undefined) placed += 1
  }
  return { placed, removed, changed }
}

/** `'placed 3 tiles'`, or `null` when the count is zero and there is nothing to say. */
function clause(verb: string, count: number): string | null {
  if (count === 0) return null
  return `${verb} ${count} ${count === 1 ? 'tile' : 'tiles'}`
}

/**
 * Whether two instances under the same key are the same piece to the user.
 *
 * Identity first, because it is the answer almost every time: the store replaces
 * the instances it edits and leaves the rest alone, so an untouched piece is the
 * very same object in both maps and the comparison stops at one `===`.
 *
 * When identity fails the fields are compared, and that second half is what
 * makes the sentence honest rather than merely cheap. A map rebuilt from a share
 * link, a rehydration, or any pass that reconstructs instances wholesale would
 * fail every identity check and report the entire room as changed — a sentence
 * that is both alarming and wrong. The fields compared are the ones that decide
 * what is drawn and what is printed: `template`, `x`, `z`, `rotation` and the
 * `fills`. `id` is not among them, because `src/store/schema.ts`'s rule is that
 * *"the key wins"* and both instances are already under the same key, so
 * comparing it could only ever restate that.
 */
function samePiece(was: TemplateInstance, now: TemplateInstance): boolean {
  if (was === now) return true
  if (was.template !== now.template) return false
  if (was.x !== now.x || was.z !== now.z || was.rotation !== now.rotation) return false
  return sameFills(was.fills, now.fills)
}

/**
 * Whether two fill maps name the same file in the same slots, pinned the same
 * way.
 *
 * A slot's whole content is `{ tile, pinned }` — `SlotFill` has no third field —
 * so this is exhaustive rather than a chosen subset, and `pinned` counts because
 * re-pinning a fill is an edit the user made and an edit a lock change must not
 * undo. An absent key is an unfilled slot, which is why the key counts are
 * compared: a template whose `floor` was cleared has one fewer key, and every
 * remaining key still agreeing does not make it the same piece.
 */
function sameFills(was: TemplateInstance['fills'], now: TemplateInstance['fills']): boolean {
  if (Object.keys(was).length !== Object.keys(now).length) return false
  return Object.entries(was).every(([slot, before]) => {
    const after = now[slot as SlotName]
    return after !== undefined && before.tile === after.tile && before.pinned === after.pinned
  })
}

/**
 * A shallow copy of the map, taken on the way into the ring.
 *
 * The store already replaces `placements` wholesale on every edit, so in the
 * app as it stands the copy is belt to that brace. It is taken anyway because
 * the ring's promise is that an entry is a *snapshot* — a value that will read
 * the same in ten minutes — and that promise should not depend on a discipline
 * enforced elsewhere. The cost is one object per edit; the alternative is an
 * undo that silently degrades to a no-op the first time anything writes a
 * placement in place.
 *
 * Shallow is the whole point, and it is safe for the reason the module docblock
 * gives: instances are replaced rather than mutated, so copying the map's
 * references copies its values.
 */
function snapshot(placements: Placements): Placements {
  return { ...placements }
}
