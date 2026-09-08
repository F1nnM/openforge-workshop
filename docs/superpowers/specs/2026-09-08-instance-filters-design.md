# The palette's filters as a property of a placed instance

Date: 2026-09-08
Status: approved for implementation

## Why

The recipe fold made component, height and size **controls on a palette row**.
They decide what a click places and then they are forgotten: the armed position
lives in `usePlanTools`, which is explicit that it is *"a property of what is
armed, not of the room"*.

That is now the wrong boundary. A placed instance was placed *as* an arched door
at 2 x 2, and two surfaces need to know it:

- the **slot editor**, whose candidate lists should offer what the filters allow
  rather than all 1,451 walls;
- the **instance itself**, so re-opening a room a week later still says which
  door it is.

## The filters are not recoverable from the fills

`TemplateInstance`'s docblock refuses footprint, size and colour because they are
*"hoisted facets of the fill's own record"* — derivable, so storing them would
only let them go stale. The filters are not in that class.

*Any component* and *arched door, which happens to be what is filled* produce
**identical fills**. The distinction exists only if it is stored, and it is the
distinction the slot editor needs: one offers every wall, the other offers 54.

## Decisions taken

Confirmed with the project owner:

- **A filter change re-solves, and may discard a pin.** A pinned fill still
  valid under the new filters stays pinned; one that is not is dropped and its
  slot re-solved. Auto fills always re-solve.
- **The filters travel in a share link.** A recipient's slot editor is filtered
  the way the author's was.
- **The modal uses the palette's own chips**, one group per axis, above the slot
  list.

### The pin rule sets a precedent, deliberately

`relock.ts` states contract **C-k**: *"a driver that silently deleted a user's
fill on a candidate-set change would be contract C-k's failure with a delete key,
so clearing has exactly one caller and it is the user."* It already meets this
exact case — a size change that invalidates a fill — by leaving the stale fill in
place and **reporting** it, so that *"the surface that does have the user in front
of it can offer the clear."*

This is the first solver-driven pin discard, and the reasoning above does not
extend to it:

| C-k's case | this case |
| --- | --- |
| a lock toggle | one control on one instance |
| rewrites up to 250 instances | rewrites one |
| the user is not looking at the pieces | the piece is on screen in the modal |
| the change was not about that fill | the change is *precisely* about it |

What is carried over is the honesty rather than the inaction: the driver
**returns the pins it dropped** so the modal can say what it did. A pin replaced
without a word would be C-k's failure whatever the trigger.

## Architecture

### The field

```ts
readonly filters: readonly string[]
```

on `TemplateInstance`, spelled exactly as `usePlanTools#armedPosition` joins the
axes. `STORE_VERSION` **7 → 8**.

**Named `filters` and not `position`, which is a correction made during
implementation.** The palette calls each setting of a control a *position*, as of
a dial — `ControlPosition`, `armedPosition`, `GENERATED_FAMILY_SIZES`' 303
positions — and that word is right there. On an instance it sits beside `x` and
`z` and reads as the cell, which is how the project owner in fact read it. The
control vocabulary is unchanged; only the field and its carriers moved.

The bump is additive and bumps anyway, which is row D6's own argument: `design`
was one optional field whose absent reading was the shipped default, and it moved
the stamp because **one version number must name one shape**. Blobs at any other
version are discarded while `package.json` reads `0.1.0`;
`migrations.test.ts`' guard fires the day it does not.

### On place

`placeTemplate` writes `tools.armedPosition`. Nothing else changes: the palette
already clears every axis when a different row is armed, so an instance cannot
inherit a filter its own row cannot express.

### On change: `reSolveInstance`

A new driver beside `reSolveScene`, for one instance and one filter set.

1. Pose the template — `{...template, tags: [...template.tags, ...filters]}`.
2. Per slot, resolve candidates under the posed template with **no sibling
   selections**. That is the widest set the filters allow, and using it makes the
   compatibility test a function of the filters alone rather than of the order the
   slots are walked in.
3. A pinned fill in that set **stays pinned**. One outside it is **dropped**.
4. `solveTemplateFills` runs with the surviving pins as its preset.
5. Return the dropped pins.

```ts
interface InstanceReSolve {
  readonly fills: TemplateInstance['fills']
  /** Pins dropped because the new filters do not admit them. Reported, never silent. */
  readonly replaced: readonly { readonly slot: SlotName; readonly was: TileId }[]
}
```

### In the modal

`slotEditorModel` poses the instance's filters onto the template's tags before
`assemblyState`, which filters every slot's cards through the mechanism the fold
already built. `SlotEditor.tsx` renders one `AxisControl` per non-empty axis
above the slots.

`AxisControl` moves out of `PalettePanel.tsx` into its own module so both
surfaces mount the same control. That is the only structural move in the UI
work, and it is the point rather than a side effect: two spellings of one chip
would drift.

### In a share link

A filter table and a per-instance index column, through the existing
`writeTable` — the fourth use of a helper that already serves the template, slot
and recipe tables.

```
uvar    filter table count       distinct filter sets in the scene
filter table                     count x (uvar byte length, UTF-8 bytes)
filter column                    count x uvar (index into the filter table)
```

A filter set is one table entry as a single joined string rather than a list of
tag indices: they **repeat** across a room — ninety instances of one row share
one — so the table amortises to near nothing and a per-instance list would pay
for the repetition ninety times.

`SHARE_FORMAT_VERSION` **4 → 5**. The capacity figures are **re-measured, not
adjusted by arithmetic**, and `capacity.test.ts` recomputes them from the codec
either way.

## The one place two bases meet

The placement path routes a size through `fills.ts#positionContextFor`, which
turns a `(width, depth)` pair into a `cell` and lets B3's per-slot anchor
derivation spread it — a congruence for the floor, a *run* for the wall. The
editor's lists route everything through `parentTags`, where each slot's own
`constrain` collects it.

Those are two answers to one question. If they disagree, the editor can offer a
file the re-solve would not choose — not a corruption, since both are valid under
the filters, but a surface that contradicts itself.

They are expected to agree on the shipped assemblies: for a `cell` or `residual`
anchor both produce the congruence, and for the wall's `edge` anchor both produce
`size|width|N`, differing at most in the run predicate's `deny`.

**Asserted rather than assumed.** A test compares the two bases' resolved
candidate sets per slot, per assembly, per size position. If they differ, that is
a finding to report and not a difference to paper over.

## Testing

| claim | where |
| --- | --- |
| a placed instance carries the armed filters | `src/builder/three/edits.test.ts` |
| version 7 blobs are discarded, not half-read | `src/store/migrations.test.ts` |
| a valid pin survives a filter change | `src/template/relock.test.ts` |
| an invalid pin is dropped **and reported** | `src/template/relock.test.ts` |
| auto fills always re-solve | `src/template/relock.test.ts` |
| the editor's lists narrow to the instance's filters | `src/builder/panels/slots/slots.test.tsx` |
| the axis controls render above the slots | `src/builder/panels/slots/slots.test.tsx` |
| the filters survive a share round trip | `src/share/link.test.ts` |
| the payload prices are re-measured | `src/share/capacity.test.ts` |
| the two size bases agree per slot, per size position | `src/template/corpus.test.ts` |

## What breaks, accepted

- **Saved rooms are discarded**, by the same licence row A1 relied on and row D6
  used: `package.json` is `0.1.0`.
- **Existing share links stop resolving.** `SHARE_FORMAT_VERSION` is checked
  *"first and hardest"* and a mismatch is refused with the version in the
  message, so a stale link fails legibly rather than decoding to a wrong room.
