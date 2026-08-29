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
`repeat(auto-fill, minmax(215px, 1fr))`, 16px gap. Each card:
4:3 thumbnail well, title, a mono size chip, texture set name, mono file size,
optional tag chips (behind a `showTags` prop, default off), and a full-width
"+ Add to library" / "✓ In library" toggle button.

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
`Place` / `Erase` mode toggle, `⟳ Rotate` (keyboard `R`), `Clear`, and a mono
`snap {value}` readout. Bottom-left is a contextual hint string; bottom-right shows the
selected tile name. Both sit on translucent plates and are pointer-transparent.

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
- Tag chips.
- "Other sizes in this family" — variant buttons that swap the drawer's subject.

---

## 3. Interaction inventory

| Interaction | Where | Notes |
| --- | --- | --- |
| Facet toggle | Catalog sidebar | Single-select per group; re-click clears |
| Free-text search | Catalog, Builder palette | Substring over name + tags + set + kind |
| Add / remove library | Card button, detail drawer | Persisted |
| Group library by kind | Library | Uses the component facet ordering |
| Select palette tile | Builder | Sets the active tile and forces `place` mode |
| Place | Builder canvas | Click on the ground plane; snapped; auto-elevated onto floors |
| Erase | Builder canvas | Click a placed mesh; raycast up to the record's group |
| Rotate | Toolbar or `R` | 90° steps; footprint swaps on odd steps |
| Orbit / pan / zoom | Builder canvas | Drag orbits, shift-drag or middle-drag pans, wheel zooms |
| Clear build | Toolbar | No confirmation in the mock |
| Snap size | Prop enum | ¼ / ½ / 1 inch |
| Download pack | Bill of tiles | Mock emits a JSON manifest; production must emit a zip |
| Escape | Global | Closes the detail drawer |

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

Note the knock-on: catalog grid cards are served by pre-rendered **greyscale sprite
sheets** already in the bucket, while the live 3D views would be coloured. That
inconsistency needs an explicit decision.

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
