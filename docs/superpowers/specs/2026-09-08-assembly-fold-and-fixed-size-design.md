# Folding the 40 recipes, fixing their size, and putting the modular base in the right box

Date: 2026-09-08
Status: approved for implementation

## Why

Three defects share one cause: the 40 recipe templates are read verbatim from
read-only upstream fixtures, and nothing in this repo derives anything from
them.

1. **32 of the 40 are one template.** Diffed part-by-part, 14 single-piece and
   13 modular wall recipes are identical except for one `component|*` require on
   one slot. `Arched Door` and `Rectangular Door` differ by
   `component|door|arched` vs `component|door|rectangular` and nothing else.
   Every one of the 13 component variants is a **file-exact subset** of the
   corresponding `Wall (Any)` recipe — 0 files outside, measured on all 26.
2. **Their size is not fixed.** 100 of the 128 slots admit candidates spanning
   several footprints. The 8 corner recipes name `size|width|2`/`size|depth|2`
   outright and are fine; the 32 wall recipes carry only
   `constrain: [size|width, size|depth]` and no size of their own, so
   `constrain` collects nothing and the assembly's size is whatever the user
   happens to click. `Arched Door (Single Piece)` offers 8 floor footprints and
   13 base footprints.
3. **The modular base is drawn in the wrong box.** `rules.ts` anchors `base` to
   `cell` on all 40. An S2W base is authored 0.5 short per walled axis, so
   `place.ts` centres it and leaves it 0.25 units (6.35 mm) out.

Two smaller defects fall out of the same reading and are fixed here because the
fold would otherwise promote them:

4. **`Wall (Any, Modular)` admits walls with integrated bases.** Row D1 made all
   47 generated families deny `shape|base`; the 40 recipes never got that deny.
   Exactly 3 non-base slots admit such records — `Wall (Any, Modular)`'s wall
   (278 of 1608) and both wall slots of `Corner (Any, Modular)` (144 of 490
   each). The assembly then fills its own `base` slot as well and the wall
   floats on a second base. After the fold, "any component" is the *default*
   position of the main wall row, so this moves from two obscure rows onto the
   common path.
5. **`s2w-wall-on-tile-wall-drain-modular`'s base slot is missing `build|s2w`**
   that all 12 of its siblings carry. It admits 305 candidates over 10
   footprints where they admit 48 over 4.

## Decisions taken

Confirmed with the project owner before implementation:

- **Palette shape**: the component is a **control on the row**, not a set of
  scannable preset rows. The option was presented as "6 rows"; the measured
  answer is 10, for the reason in the next section. The decision that was
  actually taken — control rather than presets — is unaffected by the count.
- **`any size`**: dropped on assemblies only. Every assembly placement is
  sized. The 47 single-tile families keep their `any size` position, because 7
  of them have a size no `size|` tag can name and cannot be forced.
- **Scope**: all five defects above plus the base anchor in one PR.
- **Upstream is read-only.** Nothing in
  `openforge/db/fixtures/blueprints/*.yaml` is edited. Everything here is a
  derivative generated in this repo.

## What the fold actually collapses to, and why it is 10 and not 6

The tag grammar matches **exactly**, not by prefix: 527 records carry
`shape|wall|low` and **0** of them carry `shape|wall`. So a slot requiring
`shape|wall` cannot reach a low wall, and `Wall (Any)` — whose only shape
require is `shape|wall` — silently excludes all 81 low-wall candidates
(measured: 81 of 81 outside, 144 of 144 in modular). That is defect 4's
sibling and the fold fixes it by construction.

A control axis can only ever **add requires**, because the only channel a
position has is `parentTags`, which `constrain` collects into `require`.
`processConfigValues` has no path from a parent tag to a `deny`. So an axis is
expressible as positions **iff** its values are positively taggable:

| root | bare | `\|low` | both | axis expressible? |
| --- | ---: | ---: | ---: | --- |
| `shape\|wall` | 4354 | 527 | **0** | **yes** — disjoint, so the bare tag *means* full |
| `shape\|column` | 135 | 25 | **25** | no — every low column also carries the bare tag |
| `shape\|corner` | 671 | 25 | **25** | no |

So the wall recipes fold completely and the corners keep their low/full pair:

| after | replaces |
| --- | ---: |
| `Wall (Single Piece)` — component × height × size | 16 |
| `Wall (Modular)` — component × height × size | 16 |
| `Corner: Low (Single Piece / Modular)` | 2 |
| `Corner: Full (Single Piece / Modular)` | 2 |
| `Internal Corner: Low (Single Piece / Modular)` | 2 |
| `Internal Corner: Full (Single Piece / Modular)` | 2 |
| **10** | **40** |

`filterSpecificTags` keeps the **most general** match, so the merged wall
template must carry no `shape|` tag of its own — otherwise a `shape|wall`
template tag would mask a `shape|wall|low` position. The height position is the
only `shape|`-rooted parent tag.

The merged wall slot is keyed on `role|wall` rather than `shape|wall`. Measured:
`role|wall` covers all 527 low walls and every candidate of all 30 specific
variants, and narrows the two `(Any)` slots by the 2 and 41 column/foundation
records leaking into them today — a correction, not a loss.

## Architecture

### The provenance claim, and how it changes

`pipeline/templates.ts` rests on one property: `printFixture` re-emits all 20
YAML files byte-for-byte and `printTemplateModule`'s output is asserted
byte-identical to the committed module, so `src/assembly/templates.ts` is
*provably the fixtures' content*. Row B6 declined to normalise a real upstream
tag defect specifically to keep that claim (`pipeline/templates.ts`, "Why this
is a guard and not a normalisation").

This spec **downgrades that claim deliberately**, and replaces it with a
stronger one for the derived half:

- The 20-file byte round-trip is **unchanged**. `loadTemplateFixtures` and
  `printFixture` are not touched, and `templates.test.ts` keeps asserting them.
- `RECIPE_TEMPLATES` — the faithful 40 — **stays exported**, unchanged, and
  stays byte-asserted. It is no longer what the palette lists.
- A new pure function derives the 10 from the 40. Its output is a new export,
  byte-asserted the same way.
- The derivation is proved **lossless against the live archive**: for each of
  the 40 originals and each of its slots, the candidate set is reproduced
  exactly by the derived template at the matching control position. This is a
  set equality over file ids, not a count.

So the shipped table stops being "the fixtures' content" and becomes "a pure,
byte-asserted, candidate-equivalent function of the fixtures' content". The
losslessness test is what earns that.

### New module: `pipeline/fold.ts`

Pure, no I/O. `foldRecipes(fixtures: readonly TemplateFixture[])` returns the
10 derived templates plus their control domains. Reads the 40 as parsed by the
existing loader; writes nothing.

Four declared operations, and the provenance test asserts the derivation uses
**only** these:

1. **Drop a `component|*` require** from a slot and record its value as a
   `component` axis position.
2. **Drop a `shape|wall`-rooted require** from a slot and record its value as a
   `height` axis position.
3. **Swap `shape|wall` for `role|wall`** on the merged wall slot, and add the
   corresponding `constrain` entries (`component`, `interface`, `shape|wall`).
4. **Add a `deny`** — `shape|base` on modular wall slots (defect 4), and
   `build|s2w` as a *require* on the drain-modular base slot (defect 5).

Operations 1–3 are widenings that the control positions restore exactly;
operation 4 is a narrowing, and each instance of it is justified by a sibling
census (12 of 13 siblings carry `build|s2w`; 47 of 47 families deny
`shape|base`) so upstream fixing the data fails the import loudly, in B6's
spirit.

### Emitted shape

`src/assembly/templates.ts` gains two exports and keeps its three:

```ts
export const ASSEMBLY_TEMPLATES: readonly RecipeTemplate[]        // the 10
export const ASSEMBLY_CONTROLS: Readonly<Record<string, AssemblyControls>>
```

```ts
interface AssemblyControls {
  readonly component: readonly ControlPosition[]  // 'any' + 14
  readonly height: readonly ControlPosition[]     // 'any' | 'full' | 'low'; [] on the corners
  readonly size: readonly ControlPosition[]       // no 'any size' position
}
interface ControlPosition { readonly label: string; readonly tags: readonly string[] }
```

**Axis domains, not the cross product.** The live
`(component × height × size)` product is ~700 entries per build; the three
domains are ~26. The panel greys a dead combination by resolving it, which is
what `palette.ts` already does to show candidate counts. A corpus test asserts
every size position has at least one live `(component, height)` pair.

### Size domains

Derived exactly as `pipeline/families.ts` derives the family domains, then
filtered to positions where **every slot resolves and the cell slot pins one
footprint**.

Measured on the **pre-fold** `Wall (Any, Single Piece)`: 8 live positions — 1x1,
2x1, 2x2, 3x1, 3x3, 4x1, 4x2, 4x4 — and at each, floor and base pin to exactly
one footprint. Modular: 4 — 2x2, 3x3, 4x2, 4x4. The domain is **re-derived after
the fold**, because swapping `shape|wall` for `role|wall` widens the wall slot
and may add positions; these figures are the floor to expect, not the emitted
answer, and the corpus test asserts the emitted one rather than these numbers.

Every position names **both** width and depth. A width-only position is what
leaves size floating: `floor-straight / 2 wide` admits 2x1, 2x2, 2x3 and 2x4.
The same fix applies to the 47 width-only family positions (defect below).

The wall slot still spans several *geometries* at a pinned size — at 2x2 it is
`wall:2` plus four diagonals and a triangle — but all of those occupy the same
2x2 cell. That is a shape choice inside a fixed size, not floating size, and
the spec does not try to remove it.

### The 47 width-only family positions

`GENERATED_FAMILY_SIZES` has 303 positions, of which **63 admit more than one
footprint** and **47 name a width with no depth**. Those 47 are replaced by
their live `(width, depth)` pairs. The `any size` position stays, per the
decision above. Net effect measured: splitting every family by footprint would
be 271 assemblies against 303 positions today, so this does not grow the table
meaningfully.

### The modular base anchor

`residualBox`'s own docblock already describes this exact case for the floor
and says `SlotPlacement` carries the extent as `residual` and
`builder/canvas/catalog.ts` draws it instead of the tagged one. The machinery
is complete; the base was left on `cell`.

**The anchor is a function of the fill, not of the recipe.** `Corner (Any,
Modular)` and `drain-modular` both omit `build|s2w` from their base slot, so
each admits both kinds — 257 non-s2w `shape|base|wall` records exist alongside
the 48 s2w ones. A static per-recipe anchor is provably wrong for one fill of
those two templates.

- `src/template/rules.ts` gains `isInsetFill(record): boolean` — true when a
  `layer: 'base'` record carries `shape|base|s2w`. No internal-corner special
  case is needed: an internal corner has no `edge` slot, so its residual equals
  its cell and the switch is a no-op there. That matches the measured
  full-cell internal-corner base.
- `placeTemplateSlots(layout, feet, insetParts?: ReadonlySet<SlotName>)` treats
  a `cell`-anchored rule in `insetParts` as `residual`. `offsets.ts` keeps
  taking footprints only and never sees a record; the record→boolean decision
  happens in the three callers that already hold fills.
- Callers: `builder/canvas/catalog.ts:302` (holds `fills`, the draw path),
  `builder/three/fills.ts:286` (doubts only), `builder/panels/slots/slotEditor.ts:291`.

Measured from the live LOD meshes (not the sidecar, which has 0 of the 95 S2W
bases):

| base | tagged | mesh | spans |
| --- | --- | --- | --- |
| `base+s2w+square+wall.2x2` | 2 × 2 | 2.000 × 1.500 | [0,2] × [0,1.5] |
| `base+s2w+square+wall.4x2` | 4 × 2 | 4.000 × 1.500 | [0,4] × [0,1.5] |
| `base+s2w+square+wall.4x4` | 4 × 4 | 4.000 × 3.500 | [0,4] × [0,3.5] |
| `base+s2w+square+corner.2x2` | 2 × 2 | 1.500 × 1.500 | [0,1.5]² |
| `base+s2w+square+corner.4x4` | 4 × 4 | 3.500 × 3.500 | [0,3.5]² |
| `base+square+s2w+internal_corner.2x2` | 2 × 2 | 2.000 × 2.000 | full cell |
| control: non-s2w `base+square.2x2` | 2 × 2 | 2.000 × 2.000 | full cell |

The residual reproduces every row: 2×2 wall → cell 2×2 less a 0.5 wall on one
face = 2 × 1.5; 2×2 corner → less two 0.5 walls on adjacent faces = 1.5 × 1.5;
internal corner → no edge slots, so cell. The sidecar independently confirms
the control row on **120 of 120** measured non-s2w rect bases, max deviation
0.011 units.

Affected: 18 of 40, and the split is exact — 20 `(Single Piece)` deny
`build|s2w` so they never resolve one; the 2 modular internal corners get a
full-cell base; the 16 wall and 2 external corner modular recipes are off by
0.25.

## Testing

| claim | where | shape |
| --- | --- | --- |
| the 20 fixtures still round-trip byte-for-byte | `pipeline/templates.test.ts` | unchanged |
| the emitted module is byte-identical to the emitter | `pipeline/templates.test.ts` | extended to the new exports |
| the fold uses only the 4 declared operations | `pipeline/fold.test.ts` | per-slot diff of the 40 against the 10 |
| **the fold is lossless** | `src/assembly/corpus.test.ts` | for all 40 × slots, candidate **set** equality against the derived template at the matching position |
| every size position pins one footprint on the cell slot | `src/template/corpus.test.ts` | over all 10 × their size domains |
| every size position has a live `(component, height)` | `src/template/corpus.test.ts` | resolve each |
| no non-base slot admits a `shape|base` record | `src/assembly/corpus.test.ts` | the 3 known slots go to 0 |
| the drain-modular base matches its 12 siblings | `pipeline/fold.test.ts` | sibling census, fails in both directions |
| the S2W base lands on the residual | `src/template/corpus.test.ts` | join the 95 S2W bases to the residual; assert extent equality |
| `(Single Piece)` is untouched | `src/template/offsets.test.ts` | anchor unchanged for a non-inset fill |
| the internal corner is a no-op | `src/template/offsets.test.ts` | residual equals cell with no edge slot |

The existing baseline is 170 files / 3941 tests, green.

## What breaks, accepted

- **Template ids change.** `TemplateId`s are stored in rooms and share links, so
  existing links to the 32 folded recipes will not resolve. `CLAUDE.md` states
  no backwards compatibility is maintained; `migrations.ts` already fails closed
  on an unknown template (reports the instance, renders nothing) so a stale link
  degrades rather than corrupting.
- **The provenance claim weakens** as described above. Mitigated by the
  losslessness test, which is a stronger statement about the *candidates* than
  byte-fidelity was.
- **`RECIPE_TEMPLATES` stays in the bundle** alongside the derived 10, so the
  generated module grows before it shrinks. It is not in `catalog.json` and the
  chunk is lazily mounted. If the size matters later, the 40 can be dropped once
  the losslessness test is moved to a fixture.
