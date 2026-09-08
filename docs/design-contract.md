# OpenForge Workshop — Design Contract

Extracted from the Claude Design project `OpenForge tile catalog redesign`
(`32908bdc-3c46-4fd6-9359-5335b66e43ad`), file `OpenForge Studio.dc.html`.
Raw sources are in `../design/`.

This document records **what the approved design is**, so implementation has a fixed
target. It deliberately does not decide *how* to build it — that is the architecture plan.

---

## 1. Chosen theme: Parchment

The mock ships three themes as a prop enum (`Emberforge`, `Stone minimal`, `Parchment`).
**Parchment is the chosen direction.** It is the only light theme of the three, so the
production app is a light-first design.

| Token | Value | Role |
| --- | --- | --- |
| `--bg` | `#e7dcc4` | Page ground (aged paper) |
| `--bg2` | `#f1e8d3` | Raised surface — header, cards, sidebars |
| `--bg3` | `#dfd2b5` | Recessed surface — inputs, thumbnail wells |
| `--ink` | `#2c2418` | Primary text (dark umber, not black) |
| `--mut` | `#79684d` | Secondary text, labels, counts |
| `--acc` | `#8f5b21` | Accent — links, primary buttons, active state (burnt sienna) |
| `--accink` | `#f6efe0` | Text on accent fills |
| `--acc2` | `#5d7a68` | Secondary accent — "in library" confirmation, storage address (verdigris) |
| `--line` | `rgba(80,60,30,0.2)` | Hairline borders |
| `--chip` | `#d8caab` | Tag/count chip fill |
| `--scrim` | `rgba(60,45,25,0.4)` | Modal backdrop |

Themes are applied by setting CSS custom properties on the root element, so the token
set is the theming API. Any production implementation should keep that shape — it also
lets the three.js materials read the same palette.

### Typography

- **Alegreya** (serif, 500/600/700) — display: the wordmark, page headings, card titles
  in the detail drawer, empty-state headlines.
- **Alegreya Sans** (400/500/600/700) — UI and body text. This is the default `body` font.
- **IBM Plex Mono** (400/500) — data: counts, sizes, dimensions, tag chips, storage
  addresses, eyebrow labels, hints.

The mono/serif/sans split is load-bearing: **anything that is a measured fact is set in
mono**. That is what makes the design read as a workshop tool rather than a shop.

### Recurring devices

- Uppercase mono eyebrow labels with ~2–2.6px letter-spacing above every section and
  sidebar group.
- Roman numerals (`I · SEARCH`, `II · CURATE`, `III · CONSTRUCT`) on the landing cards —
  these encode a real sequence (the intended user journey), not decoration.
- The logo is a rotated square outline with a filled square inside — a tile seen in plan.
- Radial-gradient wells behind every 3D preview and thumbnail.
- Shimmer keyframe (`ofShimmer`) for pending thumbnails and the hero render.

---

## 2. Screen inventory

Four screens plus one overlay. Navigation is a persistent 60px sticky header;
in the mock the screens are client-side state, not routes.

### 2.0 Header (all screens)

Wordmark (`OPENFORGE` / `Catalog & Workshop`) → home. Nav: **Catalog**, **Library**
(with count chip), **Builder** (with placed-count chip). Active tab marked by an inset
bottom border in the accent colour. Right-aligned mono stat: `{n} tiles · s3 archive`.

### 2.1 Landing

- Two-column hero: mono eyebrow, 54px serif headline, 52ch lede, primary
  ("Browse the catalog") + secondary ("Open the builder") buttons.
- Four mono stats: catalogued tiles, texture sets, build systems, MB of STLs.
- Right column: a **rendered composition** — a small room built from real tiles,
  produced by the 3D engine at load time rather than a stock image.
- Three numbered cards: Search / Curate / Construct.
- Footer line crediting Masterwork Tools and noting the archive covers the organised,
  tagged portion of the collection.

### 2.2 Catalog

Two columns: a 238px facet sidebar and a responsive card grid.

**Sidebar** — three facet groups, each with a mono uppercase label:
- *Component* — vertical list with per-facet counts, plus an "All components" row.
- *Texture set* — wrapping pill chips.
- *Build system* — wrapping pill chips.
- "✕ Clear filters" appears only when a filter or query is active.

Facets are **single-select toggles** in the mock (clicking the active one clears it).
There is no deny/exclude state and no hierarchy.

**Grid** — search input (max 520px) + live result count; cards at
`repeat(auto-fill, minmax(215px, 1fr))`, 16px gap. Each card, **top to bottom as
`TileCard.tsx` renders it**:

1. a 4:3 thumbnail well and the title, both inside one `?tile=` link;
2. a texture-set line, with a material swatch dot ahead of the set name
   (`aria-hidden` — the name is beside it, so the colour carries nothing alone);
3. a mono meta line: the size chip, the filename's variant token (empty on 40
   aggregates, and then nothing is drawn), and a **file-size range** rather than
   one size, because a card is one item over 2.28 files;
4. the **availability strip** — described below, and absent from this section
   until row X10 wrote it down;
5. the tag row;
6. a full-width "+ Add to library" / "✓ In library" toggle button.

**The availability strip** (`.of-avail-strip`, `availability.ts` +
`TileCard.tsx#AvailabilityStrip`, row A3) is a `<ul>` of at most four mono chips,
and it answers the two questions a browsing user actually has: *how many parts do
I print*, and *will this join the build I have chosen*. Every chip is **derived
from the aggregate**, never printed from a tag — `CatalogRecord.conn` throws the
position segment away, and 1,283 of 4,363 toppers carry a lock on their side and
none underneath, so a card reading `conn` advertised joinery 1,283 tiles do not
have where it matters.

Three sources, always in this order:

| # | chip | values | count |
| - | ---- | ------ | ----- |
| 1 | **base requirement** — always present | `Needs a base` · `No base needed` · `Base optional` | exactly 1 |
| 2 | **lock systems**, in self-sufficiency order (openlock, dragonlock, magnetic — 1,497 / 359 / 255) | `OpenLOCK` · `DragonLock` · `Magnetic`, each either **filled** (locks on its own underside) or **outlined** with ` sides` appended (joins its neighbours, meets the table on something else) | 0 to 3 |
| 3 | **joinery verdict**, where there is no lock to state | `Insert` · `Joinery untagged` | 0 or 1 |

- **`Base optional` is a third state, not a hedge.** 931 aggregates offer both a
  one-part print and a topper for a separate base; the chip says the choice
  exists and the variants table (§2.5) is where it is made.
- **Magnetic has no `sides` state, and that is the corpus and not the layout.**
  Zero aggregates carry `connection|side|magnetic` — magnets are glued into a
  pocket in the base of a piece and nothing here mounts one on a side wall — so a
  symmetrical two-row grid of six chips would ship a cell that can never light,
  which reads as "this tile does not do magnetic sides" rather than "no tile
  does". `underside` wins where a system is on both faces: 555 aggregates for
  openlock, never for the other two.
- **The strip is never empty, and the partition is exhaustive rather than lucky.**
  2,027 aggregates (53.0%) offer no lock chip at all; 1,878 of those are
  `Needs a base`, and the remaining 149 split exactly 93 insert-only + 56
  joinery-untagged with nothing left over — which is why the verdict has those two
  values and no `none`.
- **`Joinery untagged` means unknown, not incompatible.** 33 of the underlying
  records name a lock in the filename only, 18 of those a magnet size that is
  nowhere in the tag vocabulary.
- **`connection|side|filament` is deliberately not a fourth chip.** It is the side
  system on 114 records — a printed-in-place hinge, not a lock — and a fourth chip
  would invent a build option the builder cannot be set to. All 114 are
  `Needs a base`, so none loses its only chip to the omission.
- **Fixed two-line box, 41px** (`2 × 19px + 3px`), because `VirtuosoGrid` needs a
  uniform card height. The measured worst case over all 3,822 aggregates is
  **4 chips / 60 characters** — `No base needed · OpenLOCK sides · DragonLock
  sides · Joinery untagged`, 15 aggregates — costing 365px of a 394px box.
  `availability.ts#CHIP_BUDGET` carries the arithmetic and
  `availability.test.ts` fails the build when a relabel exceeds it, because
  overflowing clips a chip out of sight rather than visibly breaking the layout.
- **Each chip's accessible name is its label plus a clipped sentence** ("Base
  optional" alone does not say optional between what), and the filled/outlined
  distinction is not available to a reader who cannot see it.
- **A legend sits above the grid** — `filled locks underneath · outlined joins at
  the sides only`, with live chip samples rather than prose. `aria-hidden`,
  because every word of it is already on the first card, and rendered **only
  above a non-empty grid**: above the empty state it is a key to nothing.

**The tag row ships, and it has no `showTags` prop** (row X2). This section specified one,
defaulting off; it is deliberately not implemented. `TileCard` has exactly one call site,
which would always pass it, and defaulting it off would ship the indistinguishable cards
the row exists to fix — with the row on, row A3's last **21** name-collision groups (45
items) close to **0**, because every discriminator left is a 3- or 4-segment `interface|`
or `shape|` tag against a 2-segment neighbour. The row draws on **79** labels corpus-wide
and is **always rendered**, empty on 1,044 of 3,822 items, because `VirtuosoGrid` assumes a
uniform item height; it carries no `aria-label` when empty. Chips are leaves only, never `size|` or `connection|`, and never a
label the title, texture line or size chip already says — X2 measured that without that last
rule the commonest chip in the corpus is `shape|wall` reading "Wall" beside 1,489 titles
that already contain "Wall". The 1,044, the 21→0 and the 79 labels are asserted in
`src/screens/catalog/corpus.test.ts`; the 1,489 is X2's measurement, not a live invariant.

Empty state: *"Nothing in the organized archive matches."* with a note that untagged
tiles exist in storage but are not yet reachable.

### 2.3 Library

- Heading, mono summary (`{n} tiles · {mb} MB`), "Open in builder →" primary action.
- Tiles **grouped by component kind**, each group under a mono uppercase rule.
- Cards are a lighter variant of the catalog card: thumbnail, name, size chip, "remove".
- Empty state with a "Browse the catalog" call to action.

### 2.4 Builder

Three columns at `calc(100vh - 60px)`, no page scroll: 272px palette / flexible canvas /
302px bill of tiles.

**Left — palette**: a search box that queries the *whole catalog* and offers "+ add"
rows for tiles not yet in the library; below it, the library itself as a selectable list
with 52×40 thumbnails. Selected tile is marked with an accent tint and border.
Empty state offers "Add a starter set".

**Centre — canvas**: full-bleed 3D viewport. A floating toolbar, centred at the top:
`↶ Undo` / `↷ Redo` (keyboard `Ctrl`/`Cmd`+`Z`, `Ctrl`/`Cmd`+`Shift`+`Z`), `⟳ Rotate`
(keyboard `R`), `Clear`, and a mono `snap {value}` readout. Bottom-left is a contextual
hint string; bottom-right shows the armed family or the selected piece. Both sit on
translucent plates and are pointer-transparent.

~~`Place` / `Erase` mode toggle.~~ **Superseded — the builder has no modes.** The mock's
two-mode toggle, and the `Move` mode added beside it, are replaced by a **persistent
selection**: the primary button's meaning is a function of what is armed or selected
rather than of a setting, so `Erase` mode is gone (removing is `Delete` on the selection,
with undo behind it) and `Move` mode is gone (a drag from a piece moves it, a drag from
bare ground orbits). `docs/superpowers/specs/2026-09-08-builder-interaction-model-design.md`
is the whole argument; `src/builder/canvas/usePlanTools.ts` carries the short version.

A **floating action bar** is anchored above the selected piece, carrying its verbs —
`⟳` turn, `▤ Slots`, `⌦` remove — and expanding to hold that piece's slot editor. This is
why the right-hand column below stays the bill of tiles permanently: the properties come
to the work rather than displacing the one view of what the room costs to print.

**Right — bill of tiles**: mono uppercase label, `{n} tiles placed` heading, then one row
per unique tile (thumbnail, name, summed MB, `×count`), sorted by count descending.
Footer: `{n} unique models` / `{mb} MB`, a full-width **"⬇ Download tile pack"** button,
and a caption stating the demo downloads a manifest while production bundles a zip.

### 2.5 Tile detail (overlay drawer)

442px right-hand drawer over a scrim, closes on backdrop click or `Escape`.

- Mono eyebrow: `{texture set} · {component}`.
- 288px live 3D canvas, auto-orbiting, drag to orbit / scroll to zoom, with the caption
  "live render · drag to orbit · scroll to zoom".
- Serif title + family subtitle.
- Two actions: library toggle, and "Use in builder →" (which adds to library, switches
  to the builder and pre-selects the tile).
- A 2×2 spec grid: **Footprint**, **Height**, **Build system**, **File** (STL · MB).
- **Storage address** in mono, shown in the secondary accent — the design deliberately
  surfaces the raw archive URL.
- Tag chips. **Implemented — and they always were, here.** The drawer renders *every* tag the
  catalog resolves for the shown variant, as `.of-detail-tags` chips, and has since row 13.
  What was unimplemented were §2.2's chips, on the *card*: that is where A3's measurement
  applied (a tag chip is the only field left that separates the final 21 name-collision
  groups, 45 items, because texture and the size chip separate **nothing** — the display name
  is synthesised from those very tags), and row X2 closed it to 0 there. This drawer list is
  the unfiltered fallback behind the card's three-rule selection: full paths, no width budget,
  nothing suppressed.
- ~~"Other sizes in this family" — variant buttons that swap the drawer's subject.~~
  **Superseded, and deliberately not reimplemented.** This was built in v1 as `familyVariants`,
  grouping by `record.family` across 1,130 folders. Row A4 established that the drawer resolves
  through the *aggregate*, and row A5 retired the module: an item's own variants are now a table
  that discloses all of them, so "other sizes in this family" no longer names a real relation
  from the drawer's subject.
  A post-aggregation equivalent would list **aggregates** in the same folder rather than
  records, which is a different feature with a different information architecture. **It is
  unowned.** Reschedule it deliberately or drop it deliberately, but it is not simply pending.

---

## 3. Interaction inventory

| Interaction | Where | Notes |
| --- | --- | --- |
| Facet toggle | Catalog sidebar | Single-select per group; re-click clears |
| Free-text search | Catalog, Builder palette | Substring over name + tags + set + kind |
| Add / remove library | Card button, detail drawer | Persisted |
| Group library by kind | Library | Uses the component facet ordering |
| Arm a palette family | Builder palette | Arms the family **and its size**; clears any selection |
| Place | Builder canvas | Click while armed. Refused where it would exactly overlap — see below |
| Select | Builder canvas | Click a piece while nothing is armed. Or `[` / `]`, which is the keyboard route |
| Deselect | Builder canvas | Click bare ground, or `Escape` |
| Move | Builder canvas | Drag from a piece (selects on press, then moves), or arrow keys on the selection |
| Remove | `Delete` / `Backspace`, or the action bar | Acts on the selection. No confirmation — undo covers it |
| Rotate | Toolbar, `R`, or the action bar | Turns the ghost while armed, the selection while selected |
| Edit slots | Action bar `▤ Slots`, `Enter`, or the slots panel row | Opens on the selected piece |
| Undo / redo | Toolbar, or `Ctrl`/`Cmd`+`Z` / `Ctrl`/`Cmd`+`Shift`+`Z` / `Ctrl`+`Y` | 50 entries, in memory, not persisted |
| Orbit | Builder canvas | Left-drag from bare ground, or **middle-drag anywhere** |
| Pan / zoom | Builder canvas | Right-drag pans, wheel zooms |
| Clear build | Toolbar | Undoable |
| Snap size | `G`, or the toolbar readout | 0.5 / 1 unit. There is no ¼ — see §7 of the architecture plan |
| Download pack | Bill of tiles | A ZIP built in the browser |
| Escape | Builder canvas | Disarms the palette, or drops the selection |
| Escape | Global | Closes the detail drawer |

~~`Select palette tile` forces `place` mode; `Erase` is a mode; `Shift`-drag moves in any
mode; a right click opens the slot editor.~~ **All superseded.** There are no modes to
force or escape, so `Shift`-click is left free for its conventional meaning (extend a
selection) and `Alt`-drag for duplicate, when those arrive. Right-drag is pan and nothing
else — the slot editor moved to the selection, where it has a real operand.

**Middle-drag orbit is new and it is not a convenience.** With a drag from a piece now
meaning *move*, a room that fills the viewport would otherwise leave no reachable ground
to orbit from — the documented failure mode of this genre of tool. Every camera verb now
has a button that never contends with content.

**Overlapping placements are refused**, where the geometry is exact. `overlap.ts`'s error
is deliberately one-directional — it over-reports and never misses — so only conflicts it
is *certain* of block an edit: exact polygons on both sides, both elevations known, and
neither band a bare default. A conflict it is unsure about is drawn and committed exactly
as before, and a refusal always names the piece that blocked it.

---

## 4. What the mock assumes about the data

Each tile in `tiles-data.js`:

```js
{ id, name, family, kind, set, sys, geo, w, d, h, mb, tags[], file, s3 }
```

- `kind` ∈ floor, wall, door, stairs, column, base, scatter
- `set` ∈ cut-stone, dungeon-stone, rough-stone, smooth, plain, wood
- `sys` ∈ s2w, wall-on-tile, openlock
- `geo` selects one of twelve procedural mesh recipes
- `w`, `d`, `h` in inches; floors 0.25 tall, walls 2.0 tall × 0.3 deep, bases 0.15 tall
- `family` groups size variants for the detail drawer

**Everything visual in the mock is procedural.** `forge3d.js` builds boxes, extrusions
and cylinders and paints them with canvas-generated textures. No STL is ever loaded.
The thumbnails on every card are `toDataURL` captures of those procedural meshes.

The gap between this contract and the real catalog is the subject of the data audit;
the plan must state, per screen, what changes.

---

## 5. Material tinting by texture tag

**Requirement (added after the mock).** Every STL in the archive is colourless geometry.
The catalog's `texture|…` tag names the real-world surface the sculpt represents, so the
3D views should **tint each model according to its texture tag** — a cut-stone wall and a
cave wall should not both render as identical grey plastic.

Rules:

- The texture-tag → material mapping is **hardcoded in the source**. It is not a setting,
  not user-customisable, and there is no theme editor for it.
- It is explicitly **best-effort**. It will not always be right, and that is accepted;
  an approximate material read beats uniform grey.
- Unmapped and untagged tiles need a deliberate "unclassified" material that reads as
  *no data* rather than as a wrong guess.

The mock already gestures at this in `forge3d.js`:

```js
const TINT = { 'cut-stone':'#8b8376', 'dungeon-stone':'#6f6963', 'rough-stone':'#7d7264',
               'smooth':'#9a938a', 'plain':'#57524b', 'wood':'#7a5a38' };
```

That map is six invented sets tuned for the **dark** Emberforge theme. Production needs a
mapping over the *real* texture taxonomy, tuned for the **light Parchment ground** — and
must solve the tension that physically-correct stone albedos are all near-identical
desaturated greys, which would defeat the purpose. Resolved mapping, shading recipe and
fallback rules live in `texture-materials.md` / `texture-materials.draft.ts`.

Note the knock-on: catalog grid cards are served by pre-rendered sprite sheets already in
the bucket, while the live 3D views are coloured. **Those sheets are not greyscale — they
are blue.** `stl-thumb` renders in a default blue Phong material (ambient `#002142`,
diffuse peaking `#3375c8`), and 99.8% of opaque pixels are non-neutral over 2,105,442
decoded from 69 live sheets.

**The decision this asked for has been taken, and the inconsistency is closed rather than
accepted.** Row P1 tints the existing sheets in the browser: every opaque pixel is
`ambient + s·diffuse + k·specular` with a white specular, the two terms un-mix exactly, and
re-mixing them with the family's own Phong triple composes to one `feColorMatrix` per
material — the same renderer, re-lit, not a wash over a render. Grid cards and 3D views are
now drawn from the same sixteen families; every card already goes through a tint matrix,
and which family it asks for is row P3's remaining wiring. See architecture-plan.md §8 for
the pipeline half of the answer (a desaturated `/thumbs/` derivative) and
`src/materials/tint.ts` for the display half.

---

## 6. Known mock-only shortcuts

These are demo scaffolding, not design decisions to preserve:

1. **Procedural geometry** instead of real STL meshes.
2. **31 hand-written tiles** instead of ~8,700 real ones — no virtualisation, no paging.
3. **Thumbnails rendered at load** in a blocking-ish loop, batched every 4 tiles.
4. **Download pack emits a JSON manifest**, not a zip. The caption admits this.
5. **Screens are component state**, so nothing is linkable or shareable.
6. **`s3://openforge-archive/...` addresses are fabricated**; the real archive is an
   HTTPS Cloudflare R2 domain.
7. **Single-select facets with no exclude**, where the real taxonomy is a deep tree.
8. **No compositions** — the real catalog has multi-part blueprints the mock cannot express.
9. **Hand-rolled orbit camera, raycasting, ghost preview and snapping**, all of which
   have maintained library equivalents.
