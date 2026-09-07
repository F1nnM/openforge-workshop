# Base Generator Integration

How the parametric base generator stops being an iframe and becomes a first-class placeable
object in the Workshop builder.

This is a section of the architecture plan. It assumes the surrounding decisions in
[`design-contract.md`](design-contract.md) (Parchment theme, three-column builder, 442px
detail drawer) and the static-Cloudflare / R2 / client-side-index direction.

---

## 0. Summary

| Question | Answer |
| --- | --- |
| Generation strategy | **Client-side `openscad-wasm` in a Web Worker**, with the existing catalog acting as the pre-baked cache |
| Cross-origin isolation | **Not required.** No `COOP`, no `COEP`. Verified four ways — see §2 |
| Deciding constraint | The `.scad` is a **living upstream Devon edits monthly.** Every alternative either forks it or freezes it |
| `.scad` source | `MasterworkTools/openforge-bases` (**Apache-2.0**), pinned commit — *not* the GPL-3 web fork |
| Parameter UI | Generated from `openscad --export-format=param`, run at **build time** in CI |
| Addressing | **Input-addressed** (hash the recipe + pinned engine), not content-addressed on STL bytes |
| R2 writes | **None.** The Workshop stays read-only against `objects.openforge.tools` |
| Catalog vs generated | **One "Bases" experience.** The generator is the UI; the 1,773 catalogued bases are its cache |
| Licence consequence | The Workshop must ship **GPL-3.0-or-later with public source**. This is the one real constraint |

---

## 1. The decision

**Run OpenSCAD as WebAssembly in a Web Worker in the user's browser, and resolve every
parameter set against the existing catalog first so the common cases never render at all.**

### 1.1 What actually drove it

Not payload. Not latency. Not cross-origin isolation — that turned out to be a
non-problem (§2). The deciding constraint is this:

> `openforge-bases` is 201 KB of OpenSCAD that Devon Jones edits roughly monthly —
> "added rough stone" (2025-07), "added hex corners" (2025-06), "adding some new scad
> updates for dual clip options" (2025-10), "created dual connector walls" (2026-01).
> It is a *live* source of truth, and it is the same source that produced the 1,773
> base STLs already in the archive.

Every rejected alternative fails against that one sentence:

| Alternative | Why not |
| --- | --- |
| **Port to `manifold-3d` / JSCAD** | Buys an 11.7× smaller payload (176 KB vs 2.05 MB brotli) and Apache-2.0 licensing. Costs a **permanent fork** of 201 KB of live SCAD — 62 `hull()`s, 216 `cube`s, 110 `cylinder`s, 657 `translate`s across 20 files — that must be re-ported by hand on every upstream commit. That is precisely the manual-maintenance burden the catalog's whole architecture exists to eliminate. Rejected. |
| **Pre-bake the whole parameter space** | Arithmetically impossible, not merely expensive. `bases-square.scad` alone spans **~2,540,160** discrete combinations before the free numerics `HEIGHT` and `MAGNET_HOLE`, against 1,773 catalogued bases in total. ~20 TB across all generators. Rejected as a blanket strategy — but see §1.2, because a *targeted* version of this idea is already built. |
| **Server-side render service** | Contradicts the no-always-on-backend intent. Cloudflare Workers physically cannot host it: 128 MB per-isolate memory covering WASM allocations, which textured-wall CSG on a 4 MB imported mesh will exceed. That means leaving Cloudflare entirely, for a workload with 3–5 s container cold starts. Rejected. |
| **Keep the iframe (+ `postMessage`)** | Ruled out by the requirement. Also worth recording *why* it was never tight: `openscad.openforge.tools` has no `postMessage` listener, no URL parameter parsing, and delivers its STL by synthesising an `<a download>` and clicking it **inside the frame** — which a cross-origin parent can neither observe nor intercept. The integration was loose because nothing tighter was possible. |

### 1.2 The catalog *is* the pre-bake — this is the hybrid

The single most useful thing recon established is that the catalogued bases and the
generator are **not two catalogs**. They are one generator and 1,773 of its outputs.
The filenames literally encode the parameter tuples:

```
plain#base+square.2x2.openlock+topless,magnetic+flex.stl
  ↕
bases-square.scad  x=2  y=2  LOCK=openlock  TOPLESS=true  MAGNETS=flex_magnetic
```

They were produced by `openforge-bases/bases.py` shelling out to the OpenSCAD CLI with
`-D` flags over nested loops of shape × size × connector. The catalog's tag vocabulary
maps one-for-one onto the generator's parameter vocabulary: `connection|openlock`,
`connection|openlock|topless`, `connection|dragonlock`, `connection|magnetic|flex` ↔
`LOCK`, `TOPLESS`, `MAGNETS`.

So we do not need to *build* a pre-baked sweep. One already exists, is already in R2, is
already content-addressed at `/models/{md5[:6]}/{md5}.stl`, and already has sprite
previews. We need a **resolver** (§5.2) that maps a parameter tuple back to a catalog
`md5`. On a hit: instant, zero WASM, known bytes, known preview. On a miss: render.

This is what makes the hybrid work without a new pre-bake job, without new R2 objects,
and without asking the user to choose between two kinds of base.

**Measured hit for the panel's default state** — `x=2, y=2, inch, openlock, topless,
flex_magnetic` resolves to a catalogued file. The generator panel opens on a cache hit
and paints a real preview with no render at all.

### 1.3 Where tracks disagreed, and the call

| Disagreement | Call | Why |
| --- | --- | --- |
| Vendor `.scad` from the GPL-3 web fork, or from `openforge-bases`? | **`openforge-bases`** | It is **Apache-2.0** (verified via GitHub API metadata), it is the actual source of truth, and the web fork's `public/scad/` copy is ~8 months stale. This single choice dissolves the worst licence blocker: the `.scad` files are no longer ambiguously-licensed additions to a GPL-3 tree. |
| Lift the fork's `parseParameter.ts`, or use `--export-format=param`? | **`--export-format=param`** | Merged as openscad/openscad#3864 (2021-08-24), used in production by `openscad-playground` (`src/runner/actions.ts:31`). It is the same code path OpenSCAD's own GUI uses, so it *cannot* disagree with what `-D` actually does. It also avoids copying unambiguously GPL-3 upstream TypeScript. |
| Is `curvedlarge = undef;` a blocker? | **No — dead code** | It lives only in `public/scad/bases.scad`, the 56 KB legacy monolith. Verified: `bases.scad` appears in **zero** of the 34 entries in the fork's `App.tsx` import list. It is unreferenced. The 13 live entry points use uppercase `-D`-overridable globals with valid literals throughout. Blocker dismissed. |
| Pre-bake the textured walls (~6,840 combos), or exclude them? | **Exclude from v1; serve from the catalog** | The walls are *already* pre-baked — 221 `base+wall` rows across dungeon_stone, cut-stone, aztlan, timber, wood, foundation, necro. Pre-baking them again duplicates R2 content. Excluding `bases-wall-primary.scad` from v1 also makes its 90,168,428 bytes of blank texture STLs a non-issue. |
| Content-address generated STLs by md5 of the bytes? | **No — input-address** | OpenSCAD is not byte-deterministic across versions (openscad#4931). See §4.3. |
| Bake generated STLs to R2? | **No** | The Workshop README states plainly: "This project never writes to it." That constraint wins. §4.4 shows how share links survive without it. |
| Parse STL on the main thread or in a worker? | **Main thread** | Measured ~0.8 ms/MB; a real catalog tile (1,335,084 B, 26,700 triangles) parses in ~1.1 ms. The worker exists for CSG, which is seconds. |

### 1.4 The one constraint that survives: GPL

Reduced as far as engineering can reduce it:

- The `.scad` geometry is **Apache-2.0** (from `openforge-bases`). Clean.
- The parameter parser is **not copied** — OpenSCAD emits the schema itself. Clean.
- The render worker is **ours**, ~120 lines. We do not copy the fork's GPL-3
  `worker/openSCAD.ts`. Clean.
- **`openscad.wasm` is a GPL-2.0-or-later binary and we ship it.** Not clean. There is no
  engineering move that removes this while keeping the tight integration — the arms-length
  separation was exactly what the iframe was buying, and we are spending it deliberately.

**This constrains the design in exactly one way: the Workshop must be licensed
GPL-3.0-or-later with its source published.** For a Patreon-funded community project
distributing free STLs, that costs nothing that matters. Recommended default in §9.1.
Discharge the source-offer obligation with a `/licenses` route carrying the GPL text, the
written offer, and the reproducible build recipe for the wasm artefact.

If GPL-3.0-or-later is unacceptable, the only clean alternative is a separate-origin
worker — and that forfeits the requirement this document exists to satisfy.

---

## 2. Hosting consequences

### 2.1 Cross-origin isolation is not required

This was the presumed deciding constraint. It is not real, and two independent recon
tracks confirmed it four ways:

1. **Build default.** `openscad-wasm`'s `Makefile` line 2: `PTHREAD ::= 0`. The
   `-sSHARED_MEMORY=1 -sPROXY_TO_PTHREAD=1` line is commented out.
2. **Binary decode.** The memory section of both the official `files.openscad.org` zip and
   the deployed playground build decodes to `flags=0x1 shared=False initial=256 max=65536`
   — bit 1 clear, and no imported memory. A threaded build would require shared, imported
   memory.
3. **Source search.** Zero hits for `SharedArrayBuffer`, `pthread`, `Atomics`,
   `crossOriginIsolated`, `PROXY_TO_PTHREAD` across `openscad-wasm`, `openscad-playground`,
   and the shipped glue.
4. **Deployment proof.** The official playground is served from **GitHub Pages**, which
   cannot set custom headers. `curl -I https://ochafik.com/openscad2/` returns no COOP and
   no COEP. It further loads scripts from `ajax.googleapis.com` and `cdnjs.cloudflare.com`,
   which `require-corp` would police. It is definitively not isolated, and it works.

**No threads → no `SharedArrayBuffer` → no isolation requirement.**

### 2.2 Headers the app sends

A `_headers` file in `public/`, served identically by Workers Static Assets and by
Cloudflare Pages — copied here verbatim from `public/_headers`, the file that actually
ships:

```
/*
  Cross-Origin-Opener-Policy: unsafe-none
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob: https://objects.openforge.tools; connect-src 'self' https://objects.openforge.tools; font-src https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/assets/*.wasm
  Content-Type: application/wasm
```

Not `/engine/*`, which this section originally named: `vite.config.ts` imports the wasm
binary as `?url` with no custom `assetsDir`, so Vite emits it — and the engine's JS glue —
under Vite's own default `assets/` output directory, content-hashed
(`assets/openscad-{hash}.wasm`), not under a path this app chose. `/assets/*` covers every
hashed build output, which is the standard immutable-caching move for a Vite production
build and not narrower than intended.

Three things here are load-bearing and easy to get wrong:

- **`Cross-Origin-Embedder-Policy` is deliberately absent.** Not `unsafe-none`, not
  `credentialless` — absent. Setting it is the failure mode, not omitting it.
- **`'wasm-unsafe-eval'` in `script-src`.** Any CSP without `'unsafe-eval'` blocks
  `WebAssembly.compile` unless `'wasm-unsafe-eval'` is present. This is the single most
  common way a working WASM build dies on deploy.
- **`Content-Type: application/wasm`.** V8 caches *compiled* WebAssembly keyed by resource
  URL, but only for `compileStreaming`/`instantiateStreaming`, only above a 128 kB
  threshold. Emscripten's glue silently falls back to non-streaming `ArrayBuffer`
  instantiation if the MIME type is wrong — and you lose warm-start compilation with no
  error. The service worker's cached `Response` must preserve this header too.

### 2.3 Headers R2 sends

`objects.openforge.tools` today returns `access-control-allow-origin: *` (present when an
`Origin` is sent) and **no** `cross-origin-resource-policy`. That is sufficient. Two
recommended additions, both via a Cloudflare **Transform Rule → Response Header
Modification → Set static**:

| Header | Value | Why |
| --- | --- | --- |
| `Cross-Origin-Resource-Policy` | `cross-origin` | Cheap insurance. Costs nothing today; is the one header that would block us if isolation ever became necessary. Every other origin we touch (`fonts.gstatic.com`, `fonts.googleapis.com`) already sends it. |
| `Access-Control-Expose-Headers` | `ETag` | `Content-Length` is CORS-safelisted, so `client-zip`'s `predictLength()` already works. `ETag` is **not** safelisted — and `ETag` equals the md5, which is how we verify a fetched STL is the file the recipe named. Without this header the check is impossible. |

### 2.4 What breaks if we get it wrong

Setting `COEP: require-corp` "just in case" is the actively harmful move:

| Asset | Under `require-corp` | Mitigation if we ever did isolate |
| --- | --- | --- |
| R2 STLs via `fetch()` | **Fine.** CORS mode satisfies COEP without CORP | none needed |
| R2 sprite-sheet PNGs in `<img src>` | **Blocked.** `no-cors` subresources need CORP, which R2 does not send | add `CORP: cross-origin` (§2.3) *and* `crossorigin="anonymous"` on every `<img>` |
| three.js `TextureLoader` without `crossOrigin` | **Blocked**, same reason | set `loader.setCrossOrigin('anonymous')` |
| Google Fonts CSS + WOFF2 | **Fine.** Both send `CORP: cross-origin` already | none needed |
| Any future third-party embed | **Blocked** unless it sends CORP | per-embed; most do not |

`COEP: credentialless` does not rescue this: **Safari has never shipped it** — unsupported
on desktop through 27 and iOS through 26.6, ~78% global coverage. For a tabletop-terrain
audience with heavy iPad use that is disqualifying.

And the iframe escape hatch points the wrong way. `<iframe credentialless>` lets an
*already-isolated* parent embed a non-isolated third party. It does not let a non-isolated
parent host an isolated worker — the entire frame chain must be isolated. Isolation cannot
be quarantined into a sub-frame. Fortunately it is moot.

### 2.5 Payload budget

| Artefact | Raw | Brotli q11 | When |
| --- | --- | --- | --- |
| `openscad.wasm` | 9,603,115 B | **2,024,138 B** | Lazy — only on first "Generate a base" |
| `openscad.js` glue | 124,567 B | 26,901 B | Same chunk |
| `.scad` virtual filesystem (13 entry points + 9 impl + 9 lock + connectors) | ~145,000 B | ~15,000 B | Same chunk, inlined as a JS object |
| Parameter schema JSON (build-time) | ~40,000 B | ~6,000 B | **Eager** — the panel must paint before any WASM |
| Recipe→md5 resolver map (§5.2) | ~42,000 B | ~12,000 B | Eager, part of the catalog index |

**Nothing WASM-related is in the initial bundle.** The existing generator site does the
opposite — it fetches all 34 `.scad` files at boot. Do not copy that.

The 90 MB of blank texture STLs that `bases-wall-primary.scad` needs are **not shipped at
all** in v1, because that entry point is not shipped (§8).

---

## 3. The user flow

### 3.1 Where it lives: a mode of the 442px drawer, opened from the palette

The generator is **not** a route, **not** a fourth screen, and **not** a panel wedged into
the 272px palette (too narrow for ~14 parameters).

It is a second mode of the existing right-hand **442px detail drawer** — because the
drawer already *is* the generator's shape: a 288px live 3D canvas over a radial-gradient
well, a serif title, a mono spec grid, and a "Use in builder →" action. A generated base
and a catalogued tile are the same kind of object viewed the same way, which is exactly the
product claim in §5.

**One deliberate extension of the design language:** the generator drawer is **non-modal —
no `--scrim`**. The tile-detail drawer uses a scrim because it is a read-only overlay. The
generator is a working tool, and keeping the canvas live behind it is what lets the AABB
ghost of the base-under-construction sit in the scene while the user tunes it. Same 442px
geometry, same drawer chrome, same `Escape`-to-close. The bill of tiles is covered while
it is open, as it already is by the detail drawer.

### 3.2 Walkthrough: "I need a 2×2 base"

**1 — Reaching it.** Two doors, both in the 272px palette:

- A persistent row pinned above the palette search, in the mono uppercase eyebrow idiom:
  `⚙ GENERATE A BASE` in `--acc`.
- The palette search itself. Typing `2x2 base` returns catalog rows *and* a synthetic row
  `⚙ Generate a 2×2 base…`. This is the tight integration in one gesture — the generator is
  a search result, not a separate destination.

**2 — The drawer opens.** Mono eyebrow `PARAMETRIC · BASE`. Serif title `Square base`.
Below the title, a horizontal strip of shape chips — `Square` · `S2W wall` · `S2W corner` ·
`Riser` — one per shipped `.scad` entry point. This is a UI constraint and a technical one
at once: five of the entry points export a module literally named `base_square` with
different signatures, so they can never share a compilation unit. One entry point at a time
is enforced by the shape picker.

**3 — Parameters.** Accordion groups generated straight from the build-time schema, one per
`/* [Group] */` marker: `Base Tile Size`, `Square Basis`, `Lock`, `Magnets`, `Electronics`,
`Priority`, `Notch Options`, `Center Options`. `[Global]` pinned open, `[Hidden]` dropped.
Every value is set in **IBM Plex Mono** — they are measured facts.

Two presentation rules the raw schema cannot express:

- A string enum whose option set is exactly `{"true","false"}` renders as a **checkbox** and
  serialises back as the string. Without this the panel is a wall of two-item dropdowns —
  the OpenForge `.scad` encodes booleans as strings in twelve places.
- The `value:label` pairs in `SQUARE_BASIS` contain `/` and spaces
  (`25mm:25mm - Dwarven Forge/Hirstarts`). Split on the **first** colon only.

**4 — The resolution strip.** Directly under the parameters, one mono line. This is the key
UI invention and the whole answer to "which base does the user reach for":

```
IN ARCHIVE · plain#base+square.2x2.openlock+topless,magnetic+flex.stl · 0.47 MB
```
in `--acc2` verdigris — the same colour the design already uses for the storage address and
the "in library" confirmation. Or, on a miss:
```
NOT IN ARCHIVE · renders in your browser · ~2 s
```
in `--mut`.

The user never chooses between catalogued and generated. They see which one they got.

**5 — The preview.** 288px canvas over the radial-gradient well.

- *On a hit:* the sprite preview paints immediately; the real STL streams from R2 and
  replaces it. No WASM instance is ever created.
- *On a miss:* an **AABB proxy box** appears in the same frame the parameter changed —
  `x · y · square_basis` and `HEIGHT` are pure arithmetic, no geometry needed. It carries
  the `ofShimmer` keyframe already in the design language. The real mesh replaces it when
  the render lands.

**6 — Placing it.** `Place in build →` as the drawer's primary action, mirroring the
detail drawer's `Use in builder →`. It closes the drawer, makes the base the active palette
selection with the accent tint, forces the toolbar into `Place` mode, and sets the canvas
hint to `click the ground to place · R to rotate`. From there it is an ordinary placeable —
same snapping, same rotation, same erase, same bill-of-tiles row.

### 3.3 While a render runs

| Rule | Detail |
| --- | --- |
| **Dispatch policy** | Discrete controls (select, checkbox, shape chip) dispatch on change. Continuous controls (`HEIGHT`, `MAGNET_HOLE`) dispatch on `pointerup` **or** after 350 ms idle, whichever comes first. Pure debounce makes a fast machine feel artificially laggy; commit-on-release matches the physical gesture. |
| **Single-flight** | One job at a time. A new dispatch **kills** the running one via `worker.terminate()`. Never queue — a queue turns one slider wiggle into five sequential renders. `callMain()` is a synchronous blocking call into WASM, so `terminate()` is the *only* reliable abort. |
| **Fresh instance per render** | A new `Worker` and a new `OpenSCAD({...})` per job, terminated after. Emscripten memory grows and never shrinks, so a persistent instance permanently inflates after one large render. This also gives cancellation for free. |
| **Never blank the viewport** | Keep the last successful mesh at 60% opacity. Spinner in the drawer header, not over the canvas. |
| **Warm on open** | Start fetching and instantiating the WASM when the drawer opens, not on first parameter change — it overlaps with the user reading the form. |
| **Automatic preview toggle** | A mono checkbox in the drawer footer, on by default, plus an always-visible `Regenerate` and `Reset to defaults`. Every comparable tool ships this — OpenSCAD desktop, MakerWorld — which is strong evidence users want the choice. |
| **What the scene shows** | The AABB ghost tracks the live parameters even while the mesh is stale, so the footprint in the build is always truthful. |

### 3.4 When it fails

**OpenSCAD's error channel is `echo()`, and there is not a single `assert()` in the
codebase.** An invalid combination prints to stderr and emits **empty geometry with exit
code 0**. So:

> Never trust the exit code. Check the triangle count in the output STL header
> (bytes 80–83). Zero triangles is a failure regardless of what `callMain` returned.

Three layers, outermost first:

1. **Preflight, in the form.** The cross-parameter rules are not expressible in customizer
   annotations — they live in `if`/`echo` guards at the bottom of each `.scad`. Hand-coded
   in ~60 lines: `dragonlock` and `infinitylock` require `SQUARE_BASIS == "inch"`; `cut`
   must be `< x` in the inverted and radial files; `CURVED_LARGE` a/b/c only apply at 6×6
   and 8×8. Violating combinations are **disabled in the widget** with a mono hint —
   `dragonlock needs the inch grid` — so the render never starts.
2. **Empty output.** Inline error strip in the drawer carrying the echoed stderr line
   verbatim in mono, on `--bg3`. Last-good mesh stays on screen.
3. **Watchdog.** 45 s hard timeout → `worker.terminate()`, keep the last-good mesh, and
   offer `Try again`.

   **The `Simplify` button this section used to specify is withdrawn, because row S2
   measured both of its levers and neither one is one.** It offered "drop magnets, or
   step the size down one — because those are the two levers that actually move render
   time", on the reasoning that "magnets roughly double triangle count; each is a
   `$fn=100` cylinder pair per connector". Measured (§3.5):

   - **Stepping the size down barely helps.** 1×1 to 8×8 is a **53× triangle range for
     6× the time**, and the per-1,000-triangle cost *falls* from 45 ms to 5 ms across it.
     The cost is the fixed CSG tree, not the output size.
   - **"Roughly double" understates magnets** for openlock (**5.3×** triangles), triplex
     (**8.0×**) and `none` (**142×**) — and it is **backwards for dragonlock**, where
     turning magnets *off* yields *more* triangles (12,304 against 10,976) and a slower
     render. Dropping magnets does not help dragonlock at all.

   So a `Simplify` button would press two levers, one of which is nearly flat and one of
   which is a different multiple per lock system and inverted for one of them — it would
   often make the render slower while telling the user it was making it faster. The
   honest control is the parameters themselves, which the form already exposes.

   The watchdog stays, and the reason has moved: nothing in the sweep came within 2.5× of
   3 s, so a timeout is no longer the expected end of a slow render. It is there for the
   memory case below, which has no other symptom.

**Memory exhaustion is the nastiest failure and needs naming.** The WASM heap max is
4 GiB − 64 KiB, but iOS Safari caps far lower, and `emscripten_resize_heap` **returns
`false` rather than throwing** — so exhaustion surfaces as an opaque OpenSCAD abort with no
message. The watchdog is what turns that into a user-visible outcome rather than a hang.

### 3.5 Latency, honestly — measured

**This section used to say "no render was timed".** It now is. Row S2 (PR #48)
installed both builds and benchmarked them, and
the three things this section got wrong are worth more than the one it got right.

| | |
| --- | --- |
| **WASM** (what ships) | `2026.01.02.wasm30347`, `-WebAssembly-node` snapshot under Node 22.23.2 |
| **Native** (reference only) | `2026.01.02.ai30348`, AppImage extracted — same day's adjacent CI build, so the comparison is controlled |
| Machine | AMD Ryzen 5 7640U, 12 threads, 65 GB, Linux 7.0.11 |
| Method | 21 renders per configuration, 51 configurations, one process each, sequential |
| Reproduce | `npm run scad-bench -- --repeats 21 --json out/wasm.json` |

#### The verdict: auto-preview, debounced. No Generate button.

A 4×4 square base is **437 ms median / 481 ms p95** against the ~3 s threshold — **7×
under**. Nothing in the sweep came within 2.5× of 3 s; the slowest shippable configuration
is a `risers_square` 4×4 high dragonlock at **933 ms median / 1.16 s p95** (49,386
triangles). So every UX number in §3.3 stands, and the §8.0 spike it was conditional on has
happened.

**Debounced rather than live**, and that is the one qualification: **15 of 46
configurations exceed a 250 ms live-interaction budget on geometry alone.** Risers and
8×8-grid dragonlock spend 400–900 ms in geometry and need §3.3's commit-on-release; a
1×1 to 4×4 square is 60–150 ms and is genuinely live.

**One hard condition: `--backend=manifold` is mandatory.** WASM CGAL is **7.8 s at 2×2 and
16.0 s at 4×4** — 19× and 35× slower, and **5× *over* the threshold**. Dropping that one
flag turns this verdict into a Generate button.

#### The estimate table was 1–2 orders out, and the formula was not

The extrapolation had two halves and they did not fail together. `triangles = (bytes − 84)
/ 50` **reproduced the STL header count on 48 of 48 meshes** — exact. The *magnitudes* were
not: every row below overstates triangles by a consistent **3.46–3.68×**, and the
triangles-to-seconds mapping was one to two orders out.

| Configuration | Est. tris | **Real** | Est. WASM | **Measured (WASM)** | |
| --- | ---: | ---: | --- | ---: | --- |
| `bases-square` 2×2 openlock + flex | 10,807 | **3,120** | 1–4 s | **429 ms** | 2× fast |
| `bases-square` 4×4 openlock + flex | 23,671 | **6,440** | 3–8 s | **437 ms** | 7× fast |
| `bases-square` 8×8 grid + dragonlock | 86,144 | **23,980** | 12–40 s | **705 ms** | 17× fast |
| `risers_square` 4×4 high dragonlock | 180,100 | **49,386** | 25–60 s | **893 ms** | 28× fast |
| `bases-wall-primary` dungeon_stone A | 116,062 | *not vendored* | 60–180 s | *unmeasured* | — |

**The consistent 3.6× is the more interesting finding of the two**: it suggests the
catalogued STLs those byte counts came from were generated by an older CGAL-era OpenSCAD,
so the archive's meshes are not what this generator now produces. The fifth row has no
measured counterpart because S1 did not vendor `bases-wall-primary.scad`; its estimate
stays an estimate, and §8's v3 is where it is excluded for good.

#### What actually dominates, ranked

1. **Backend / kernel — 19–35×.** Dwarfs everything else combined.
2. **Entry point — up to 7×.** `risers_square` 906 ms against `bases-square` 4×4's ~430 ms.
   `bases-curved-radial` is the priciest curve.
3. **Lock — ~1.4×.** dragonlock dearest, `none` cheapest.
4. **Magnets — 1.3–2.6×.**
5. **Size — almost flat.** See §3.4: 53× the triangles for 6× the time.

**`$fn` is not a lever at all.** The plan flagged 89 `$fn=200` across the vendored set as
the likely cost driver. `-D '$fn=50'`, `200` and `400` produce **byte-identical output**,
because every `$fn` in the set is a *call-site argument* (`cylinder(..., $fn=200)`) rather
than a top-level assignment. It cannot be tuned from outside without editing the vendored
files, so "reduce tessellation to go faster" does not exist here.

#### The startup floor is the real split

`cube(0.01)` through the same flags:

| | Floor |
| --- | ---: |
| WASM | **281 ms** |
| native | **28 ms** |

That is **65–80% of a small WASM render**, and a browser worker holding a compiled
`WebAssembly.Module` pays it **once** — so §3.3's "warm on open" is not an optimisation,
it is most of the budget. Every figure above is decomposed into floor plus geometry in the
report. Native against WASM: **6.7× median total wall clock** (min 3.2×, max 13.6×, over
46 manifold configurations), **4.6× on geometry alone**, **10× on the floor**.

#### Two facts the panel has to respect

- **The two builds do not produce identical meshes.** 45 of 48 match, but `bases-curved`
  4×4 differs by **+26 triangles (+0.67%)** and two openlock rows by −2. So a
  browser-generated base is **not** byte-identical to the catalogued STL of the same
  parameters, and the UI must not claim "this is the archive's file". §5.2's resolver
  looks a recipe up in the catalog and that is still right; what it must not say is that
  the two are the same bytes.
- **`connectors.scad` at the pinned commit emits `Ignoring unknown variable "DUAL"` on 48
  of 48 configurations.** An ignored variable is a branch not taken, so that is part of
  what the default geometry *is* rather than a warning to silence.

#### Two flags are mandatory, not optional

- `--backend=manifold`. Treat CGAL as non-viable in a browser — the 7.8 s / 16.0 s above.
  **2026.01.02 defaults to Manifold**, so the note this section used to carry — that the
  CLI help reads `'CGAL' (old/slow) [default]` — is stale for current builds; it was true
  of the published 2025-03-25 zip, and a pinned older build still defaults to CGAL. Pass
  it explicitly either way.
- `--export-format=binstl`. `export.cc:102` aliases the `stl` suffix to **`asciistl`**, so
  the openscad-wasm README's own example (`-o cube.stl`) produces ASCII STL — roughly 5×
  the bytes and ~3× the parse cost. Anyone writing this from the README inherits the bug.

And one trap in the probe itself: **the WASM build exits 7 on `--version`** while printing
to stderr, so a probe that trusts the exit code silently decides WASM is absent and falls
through to native. S2's first attempt did exactly that.

#### Still unmeasured, and named rather than assumed

- **A real browser.** Everything above is V8 in Node, with no worker boundary and no
  compositor competing. **iOS Safari's much lower WASM heap cap is untested**, and
  `emscripten_resize_heap` returns `false` rather than throwing (§3.4) — iOS is the risk.
- **8×8 through CGAL** (`npm run scad-bench -- --heavy --suite backend`).
- **Textured primary walls**, for the vendoring reason above.

---

## 4. The data model

### 4.1 Types

```ts
/** Inches. The builder grid is inch-based; see §9.8. */
type Inch = number;

/** nanoid(10). Stable for the life of a placement. Never reused, never reordered. */
type PlacementId = string;

/** One of the shipped .scad entry points, filename without extension. */
type GeneratorId =
  | 'bases-square' | 'bases-square-corner' | 'bases-square-wall'
  | 'bases-square-internal_corner' | 'bases-curved' | 'bases-curved-radial'
  | 'bases-curved-inverted' | 'bases-diagonal' | 'bases-hex' | 'bases-hex-corner'
  | 'bases-hallway' | 'bases-portal'
  | 'risers_square' | 'risers_curved' | 'risers_walls';

type ParamValue = string | number | boolean | number[];

interface Footprint { w: Inch; d: Inch; h: Inch; }

interface EngineRef {
  /** Our wasm artefact id, e.g. 'ofw-openscad-2026.07.26-a91c3f'. */
  build: string;
  backend: 'manifold';
  /** Passed as --enable=<f>, sorted, so the ref canonicalises. */
  features: readonly string[];
}

interface Recipe {
  v: 1;
  generator: GeneratorId;
  /** sha256 of the entry .scad plus its transitive includes, from the build manifest. */
  scadDigest: string;
  engine: EngineRef;
  /** Customizer overrides. Keys the schema declares. Values equal to the default are omitted. */
  params: Readonly<Record<string, ParamValue>>;
  /** Arithmetic footprint. Lets the scene be spatially correct before geometry exists. */
  footprint: Footprint;
}

interface CatalogSubject {
  kind: 'catalog';
  /** md5 → https://objects.openforge.tools/models/{md5.slice(0,6)}/{md5}.stl */
  md5: string;
}

interface GeneratedSubject {
  kind: 'generated';
  recipe: Recipe;
  /**
   * Set iff this recipe resolved to a file already in the archive (§5.2).
   * When present the app fetches R2 and never instantiates OpenSCAD.
   * A cache, not truth — re-derivable, and re-derived when absent.
   */
  resolved?: { md5: string };
}

type Subject = CatalogSubject | GeneratedSubject;

interface GridPose {
  /** Grid cell of the placement's origin corner, in snap units. */
  x: number;
  y: number;
  /** Layer index; 0 = ground plane. */
  level: number;
  /** Quarter turns. Footprint swaps on odd values. */
  rot: 0 | 1 | 2 | 3;
}

interface Placement {
  id: PlacementId;
  pose: GridPose;
  subject: Subject;
}

interface BuildDocument {
  v: 1;
  /** Snap size in inches: 0.25 | 0.5 | 1. */
  snap: number;
  /** Index build id, so we can tell whether a catalog md5 predates the current index. */
  indexBuild: string;
  placements: Placement[];
}
```

### 4.2 Canonicalisation and the recipe hash

```
recipeHash = sha256(canonicalJSON({
  v, generator, scadDigest, engine: { build, backend, features: [...features].sort() },
  params: <keys sorted; defaults omitted; numbers rounded to 4 dp>
}))
```

Three rules, each load-bearing:

- **`footprint` is excluded** — it is derived from `params`, and including it would let a
  rounding difference fork the cache.
- **Defaults are omitted.** `{x:2, y:2}` and `{x:2, y:2, HEIGHT:6}` must hash identically
  when `HEIGHT` defaults to 6. Otherwise the panel's own default state fails to match
  itself after a round trip.
- **Numbers round to 4 dp** before hashing. A slider emitting `2.0000000001` must not fork
  the cache from `2`.

### 4.3 Why input-addressed, not content-addressed

The catalog content-addresses STLs by md5 of the bytes. **Do not extend that scheme to
generated bases.** OpenSCAD is not byte-deterministic across versions:

> `--enable=predictible-output` (note the load-bearing misspelling — that is the actual
> flag string) sorts vertices and faces and makes output reproducible **for the same binary
> and input only**. Manifold's maintainer, on openscad#4931: *"There is no guarantee that
> the output is the same across versions/compilers."* Because (1) mesh boolean operations
> are assumed associative but are not, so results depend on a reordering heuristic that
> changes across versions, and (2) the mesh simplification heuristic is not perfect and
> updating the version may change it.

If we content-addressed generated STLs, **every engine upgrade would silently orphan every
cached blob and every share link that named one.** Input-addressing (hash the recipe,
*including* the pinned engine build) is the Nix answer to exactly this, and it degrades
gracefully: an engine upgrade is a cache miss, not a corruption.

The byte hash still has a job — storage integrity and R2 `ETag` validation. It is just not
an identity.

Pass `--enable=predictible-output` anyway. It costs a small slowdown (it disables some
optimisations) and buys same-build reproducibility, which is what makes a cache hit
trustworthy *within* a deployment.

### 4.4 Round-tripping: reload and share links

**Persistence.** `BuildDocument` → JSON → `CompressionStream('deflate-raw')` → base64url,
stored in `localStorage` for reload and in the **hash fragment** for share links. The hash
fragment never reaches a server, which matters for a static site with no backend. A recipe
is ~300 bytes of JSON; a 40-placement build with three distinct recipes compresses to well
under 2 KB — versus 2–10 MB per STL. Share links stay tiny.

**Opening a share link, step by step:**

1. Parse and validate against the versioned `Recipe` schema. Unknown keys in `params` are
   **ignored**; missing keys fall back to the *current* schema defaults. This is OpenSCAD's
   own parameter-set rule and it is the right one — it lets a parameter be added upstream
   without invalidating existing links.
2. Every placement renders its **AABB proxy immediately**, from `recipe.footprint`. The
   room is spatially correct and orbitable in the first frame, before any geometry exists.
   This is the single reason the no-R2-write decision is survivable.
3. Catalog subjects and resolved generated subjects fetch from R2 in parallel.
4. Unresolved generated subjects re-run the resolver against the *current* index — which may
   now hit, if the archive grew since the link was made.
5. Genuine misses render in the background, **one at a time**, with progress surfaced in
   the bill of tiles (§6). The user can orbit, pan, and inspect throughout.

### 4.5 Drift: what happens when the app version changed

| Drift | Detection | Behaviour |
| --- | --- | --- |
| **Engine upgraded** — `recipe.engine.build` ≠ current | Exact string compare | Regenerate with the **current** engine. Show a mono note in the bill-of-tiles row: `regenerated · engine updated`. We do **not** attempt to reproduce old bytes. These are physical prints; the current engine is the one whose output Devon has validated. Silent drift is only dangerous when hidden. |
| **`.scad` changed** — `recipe.scadDigest` ≠ current | Exact string compare | Same treatment, note reads `regenerated · geometry updated`. |
| **Parameter removed upstream** | Key present in `params`, absent from schema | Ignore the key. Note: `1 setting no longer exists`. |
| **Parameter added upstream** | Key in schema, absent from `params` | Use the current default. Silent — this is the intended promotion path. |
| **Enum value removed** | Value not in `options` | Fall back to default, note the substitution explicitly. This is the one case that can change the print, so it is never silent. |
| **Resolver now hits** | `resolved` absent, resolver returns an md5 | Use the archive file. Strictly better — instant, and no WASM. |
| **Resolver no longer hits** | `resolved.md5` not in the current index | Fall back to rendering. The md5 is stale, not wrong. |

The principle: **an old share link always produces a placeable base of the right footprint.
It may produce marginally different geometry than the sender saw, and when it does we say
so in mono, in the bill of tiles, where the user is already reading measured facts.**

---

## 5. Catalog bases vs generated bases

### 5.1 The product answer: one Bases experience

**The generator is the interface. The 1,773 catalogued bases are its cache.** They are not
merged, and the generator does not supersede them — they are *the same thing*, and the UI
should stop pretending otherwise.

This is justified by data, not preference. From the v2 index (8,702 rows), `kind: base`
holds **1,773** rows and `kind: stairs` holds **319** riser rows. Their filenames encode
generator parameter tuples one-for-one, and they were produced by `bases.py` driving the
same `.scad` through the CLI. Presenting them as two competing catalogs would be presenting
a function and a memo table of that function as rival products.

But three asymmetries are real and the UI must be honest about all of them:

**(a) Generator-only ground — things no catalogued base can give you.**

| Capability | Catalogued |
| --- | --- |
| `SQUARE_BASIS = 25mm` (Dwarven Forge / Hirstarts) | **0 files** |
| `SQUARE_BASIS = wyloch` (31.75 mm) | **0 files** |
| `SQUARE_BASIS = drc` (38.1 mm, Dragon's Rest) | **0 files** |
| `bases-diagonal.scad` | **0 files** |
| Arbitrary `HEIGHT`, arbitrary `MAGNET_HOLE` | fixed at sweep defaults |

Every one of the 1,773 catalogued bases is inch-basis. Three entire grid systems exist
**only** through generation.

**(b) Catalog-only ground — sculpted textures with no OpenSCAD path at all.**

446 of the 1,773 base rows carry a texture the generator cannot produce: `cave` (167),
`wood` (71), `brick` (55), `aztlan` (41), `foundation` (37), `timber` (37),
`legacy_sewers` (17), `sewer` (16), `goblin_fireplace` (3), `stone` (2). These are hand
sculpts. And even the textures `bases-wall-primary.scad` *does* reach are not modelled — it
`import()`s a pre-rendered blank STL and differences connectors out of it. The generator
bolts connectors onto a fixed sculpt; it does not make the sculpt.

**(c) Scale.** `bases-square.scad` alone spans ~2.5 M discrete combinations. The whole
archive holds 1,773 bases. The cache covers a vanishing fraction of the space — but it
covers the *popular* fraction, which is the whole point of a cache.

### 5.2 The resolver

A build-time reverse index, shipped with the catalog index.

**Build step.** For each of the 2,092 `base` + `stairs` rows, parse the filename into a
canonical parameter tuple, hash it the same way §4.2 hashes a live recipe, and emit
`Map<tupleHash8, rowIndex>`. Roughly 42 KB raw, ~12 KB gzipped.

**Runtime.** Hash the panel's current tuple, look it up, done. No string matching at
runtime — which matters, because the filename grammar is *not* consistent: the archive
contains both `base+s2w+square+corner` (21 rows) and `base+square+s2w+corner` (8 rows) for
what is the same shape. Parsing into an unordered token set at build time absorbs that;
a runtime string builder would not.

**Conservative matching rule.** The filename only encodes the axes `bases.py` swept —
shape, size, `LOCK`, `TOPLESS`, `MAGNETS`, and the notch/grid/mirror flags. It says nothing
about `HEIGHT`, `MAGNET_HOLE`, `ELECTRONICS`, `PRIORITY`, or `CENTER`. So:

> A catalog hit requires that every axis the filename does **not** encode is at its current
> `.scad` default. Touch `HEIGHT` and you get a render. Always.

This is deliberately conservative. The alternative — assuming unswept axes match — would
silently hand the user a file that is not what their parameters describe, and the failure
mode is a base that does not physically fit. Not acceptable for something people print.

**CI gate.** The build step **fails** on any `base`/`stairs` row whose filename does not
parse, and on any `.scad` default that changed since the last resolver build. That surfaces
every grammar case and every silent-lie risk without anyone having to guess at them.

### 5.3 How this reads in the UI

| Surface | Behaviour |
| --- | --- |
| **Catalog screen** | Unchanged. Bases are ordinary tiles under the `base` component facet, sculpted textures and all. This is the only route to the 446 sculpted bases, and that is correct — they are not parametric. |
| **Library** | Unchanged. A generated base can be added to the library; it stores the recipe, not an md5. |
| **Builder palette** | `⚙ GENERATE A BASE` above search; generator rows in search results. |
| **Generator drawer** | `Texture` axis offers **Plain only** in v1, with a mono footnote: `sculpted textures — browse the catalog →` linking to the catalog pre-filtered to `component:base`. Honest, not hidden. |
| **Resolution strip** | Makes the boundary continuously visible without ever making it a choice (§3.2 step 4). |

---

## 6. The bill of tiles, and the download

### 6.1 Rows

The bill of tiles is 302px: one row per unique tile — thumbnail, name, summed MB, `×count`
— sorted by count descending, with a footer of `{n} unique models` / `{mb} MB` and the
full-width `⬇ Download tile pack` button.

A generated base has no catalog md5 and no known size until it has rendered. So:

| Field | Catalog row | Generated row |
| --- | --- | --- |
| **Row identity** | `md5` | `resolved.md5` if resolved, else `gen:{recipeHash.slice(0,8)}` |
| **Thumbnail** | sprite sheet | live 288px→52×40 capture of the rendered mesh; before that, the AABB proxy under `ofShimmer` |
| **Name** | filename | derived from the recipe via the archive's own filename grammar (§6.2) |
| **Size** | exact bytes from the index | `— MB` in `--mut` while pending; exact bytes after render |
| **Badge** | none | mono `⚙` in `--acc` |

**No size estimate is shown while pending.** An estimate in a mono field, in a design whose
whole typographic premise is that mono means *measured*, would be a lie in the one typeface
that promises not to be.

**Footer while any base is pending:** `{n} unique models · {mb} MB + {k} pending`.

**The download button is disabled while any generated base is unrendered**, with the hint
`rendering 2 of 3 bases…`. This is not a limitation dressed up — it is what guarantees
`predictLength()` always has exact byte counts, and therefore that the browser shows a real
progress bar instead of an indeterminate spinner on a 300 MB archive.

### 6.2 Naming

Generated files are named using the **archive's own filename grammar**, produced by the
same build-time parser that powers the resolver, run in reverse:

```
plain#base+square.2x2.openlock+topless,magnetic+flex.stl
plain#base+square.3x3+notch.openlock,magnetic+flex.h8.stl     ← non-default HEIGHT suffixed
```

Non-catalogued axes (`HEIGHT`, `MAGNET_HOLE`, non-inch `SQUARE_BASIS`) append a short
deterministic mono suffix, because those are exactly the cases where no archive filename
exists to copy.

This is not cosmetic. It means a generated base and a downloaded base sort together in the
user's folder; it means when the archive later gains that exact file the names already
match; and it means the same parameters always produce the same filename, so re-downloading
collides rather than accumulating `(1)`, `(2)`.

### 6.3 The ZIP

`client-zip@2.5.0`'s `downloadZip()` accepts a **heterogeneous mix in one archive** —
`Response`, `File`, `Blob`, `ArrayBuffer`, `ReadableStream` — so R2 `Response`s and
in-memory generated `Blob`s coexist with no adapter layer.

```
openforge-build-2026-08-29/
  README.txt
  MANIFEST.json
  tiles/aztlan#floor.2x2.openforge.stl
  tiles/dungeon_stone#wall.2x1.openlock.stl
  bases/plain#base+square.2x2.openlock+topless,magnetic+flex.stl
```

**Store-only, no compression.** `client-zip` cannot deflate, and that is the right trade
here: `@zip.js/zip.js` would compress binary STL 3–5×, but compression makes the output size
unknowable up front, which forfeits `Content-Length` and the browser's native progress bar.
R2 egress is free; phone CPU is not. Revisit only if measured pack sizes hurt real users.

**Two mechanical requirements:**

1. **The index needs exact `bytes`.** The current v2 index stores `mb` rounded to two
   decimals — with values as low as `0.0`. That is not summable and it is not a byte count,
   so `predictLength()` produces a wrong `Content-Length` and Zip64 lengths. Add a `bytes`
   column. The catalog DB has the value; this is a one-line change to the index builder and
   it is **non-negotiable**.
2. **`downloadZip()` returns a `Response`, it does not save a file.** Turning it into a
   download without a service worker means `await response.blob()`, which buffers the entire
   archive in memory — fatal on a 300 MB pack. `showSaveFilePicker()` is desktop
   Chromium-only (no Firefox, no Safari, no mobile). So a **service-worker `fetch` handler**
   is the answer, and it is what makes the service worker load-bearing rather than a
   nice-to-have PWA extra. It also gives the native download UI with a real progress bar,
   because we can set `Content-Length` and `Content-Disposition`.

   Note: `client-zip`'s `package.json` exports map (`{".": "./index.js"}`) blocks the
   `client-zip/worker.js` subpath that people normally vendor for this. It does not bite us
   — we write our own service worker via `injectManifest` and import `downloadZip` from the
   package root, which the bundler resolves normally.

Also worth knowing: `URL.createObjectURL()` is **unavailable inside service workers**, so
the download must be triggered against a synthetic URL the SW intercepts, never a blob URL.

### 6.4 Provenance

Three layers, in descending authority:

**1 — `MANIFEST.json`** — authoritative, machine-readable, survives the user renaming files.

```json
{
  "v": 1,
  "generated": "2026-08-29T14:22:10Z",
  "app": "openforge-workshop@0.4.1",
  "engine": { "build": "ofw-openscad-2026.07.26-a91c3f", "backend": "manifold",
              "features": ["fast-csg", "lazy-union", "manifold", "predictible-output"] },
  "files": [
    { "path": "tiles/aztlan#floor.2x2.openforge.stl", "source": "archive",
      "md5": "f1e2ff0bc747302d95adc5c0cf694678", "bytes": 8923084, "count": 6 },
    { "path": "bases/plain#base+square.2x2.openlock+topless,magnetic+flex.stl",
      "source": "generated", "recipeHash": "9c1f4a02e5b7d331", "bytes": 465190, "count": 4,
      "recipe": { "v": 1, "generator": "bases-square",
                  "scadDigest": "sha256:7b19…", "params": { "x": 2, "y": 2 } } }
  ]
}
```

Note `"source": "generated"` on a file whose parameters *also* exist in the archive would be
wrong — a resolved recipe is written as `"source": "archive"` with its md5, because that is
literally what was downloaded.

**2 — `README.txt`** — the same information in prose, plus CC BY-NC-SA 4.0 attribution to
Devon Jones / Masterwork Tools, plus the engine build line. This is the file a human
actually opens six months later.

**3 — The 80-byte binary STL header**, on generated files only:

```
OpenForge Workshop 2026-08-29 r:9c1f4a02e5b7
```

42 bytes, null-padded, and the recipe hash is the join key back into `MANIFEST.json`. This
is safe and the corpus already does it — a real file pulled from `objects.openforge.tools`
begins `Exported from Blender-4.0.1`, and OpenSCAD itself writes
`char header[80] = "OpenSCAD Model\n"`. Slicers ignore the field. Three hard rules:

- **≤ 79 bytes, ASCII, null-padded.** Bytes 80–83 are the triangle count.
- **Must not begin with `solid`.** Parsers that check that prefix before the size arithmetic
  would misclassify the file as ASCII STL.
- **Must not contain the substring `COLOR=`.** `STLLoader.parseBinary` scans the entire
  header for it and, on a hit, switches into Magics vertex-colour mode and reinterprets the
  per-facet attribute bytes. A real landmine, however unlikely the collision.

**We do not rewrite headers on archive files.** They are streamed byte-for-byte from R2 as
`Response` objects; rewriting would mean buffering a 30 MB file to change 80 bytes. Only
generated blobs get a header, and they are already in memory.

**3MF is deferred.** It is the only format that carries structured provenance *inside* a
single file slicers understand (`-O export-3mf/meta-data-title=…` etc.), but getting both a
viewport mesh and a 3MF requires two `-o` flags, and `openscad.cc:1158` loops the entire
parse-and-render once per output file. It costs a full second render. Not a v1 default.

---

## 7. What we build vs what we install

The standing rule is prefer a maintained library. Where the answer is "ours", the line count
is an honest estimate and the justification is stated.

| Piece | Provider | Version / size | Notes |
| --- | --- | --- | --- |
| OpenSCAD engine | **`openscad/openscad-wasm`**, built from source | Docker `make all`; ~9.6 MB → 2.02 MB br | No usable npm package. `openscad-wasm@0.0.4` is third-party (`20lives`), has no `repository` field, and is a `SINGLE_FILE` build with the wasm base64-embedded into 13.9 MB of JS — which also defeats `instantiateStreaming`. No tagged release since `2022.03.20` despite active development. We own a build step. |
| `.scad` geometry | **`MasterworkTools/openforge-bases`**, pinned commit | Apache-2.0 | Git submodule or CI fetch. **Never hand-copy** — the web fork's vendored copy is already 8 months stale, and for physically-interlocking terrain stale geometry is a print failure, not a cosmetic bug. |
| Parameter schema | **`openscad --export-format=param`** at build time | — | CI runs it per entry point, commits the JSON. Ships eagerly; the panel paints with zero WASM. |
| Schema build script | ours | **~40 lines** | Shell + node. Loops entry points, writes JSON, diffs against committed. |
| Render worker | ours | **~120 lines** | Message switch, fresh `OpenSCAD()` instance per job, `terminate()` after. Deliberately **not** the fork's `worker/openSCAD.ts`, which is GPL-3. |
| Form state | **`react-hook-form@7.86.0`** | 1.18 MB unpacked, **zero runtime deps** | Uncontrolled by default — exactly right for a slider firing 60 events/sec. Handles a runtime-derived field set via `values`/`reset`. |
| Parameter widgets | ours | **~200 lines** | A `switch` over six widget kinds. See below for why not rjsf. |
| Validation | **`zod@4.5.2`** (`zod/mini`) | 4.0 kB gz for a 3-field object vs 13.1 kB full | Live param validation + the versioned `Recipe` schema. `z.toJSONSchema()` and `z.globalRegistry`/`.meta()` are why Zod over valibot — we hang customizer decorations on schema nodes. |
| Cross-parameter rules | ours | **~60 lines** | Not expressible in customizer annotations; lives in `if`/`echo` guards. Must be hand-coded. |
| Recipe ↔ filename resolver | ours | **~150 lines** (build) + ~20 (runtime) | The linchpin (§5.2). Nothing to install; the grammar is OpenForge's. |
| STL → geometry | **`three@0.185` `STLLoader`** | — | Main thread, ~0.8 ms/MB. **Never call `computeVertexNormals()`** — `parseBinary` already writes the correct flat facet normal to all three vertices, and averaging would round off every hard edge on the base. |
| Scene | **`@react-three/fiber@9.7.0`** + `@react-three/drei` | — | Note r3f 9 requires `react >=19 <19.3`. |
| Geometry lifecycle | ours | **~80 lines** | Refcounted `Map<recipeHash, BufferGeometry>`. Necessary because r3f's auto-dispose covers only instances *in the JSX tree*: geometry passed as a prop is never disposed, `applyProps` does not dispose a replaced value (regenerate ten times, leak nine), and `<primitive>` is exempt by design. |
| ZIP | **`client-zip@2.5.0`** | store-only | Mixes `Response` + `Blob` in one archive; `predictLength()` gives a real progress bar. |
| Service worker | **`vite-plugin-pwa@1.3.0`**, `injectManifest` | — | `generateSW` cannot host the custom `fetch` handler the streaming download needs. Two settings everyone misses: raise `maximumFileSizeToCacheInBytes` (default **2 MiB**, so a 9.6 MB wasm is silently dropped from the precache manifest), and add `wasm` to `globPatterns` (defaults cover only css/js/html). |
| SW download handler | ours | **~40 lines** | Intercept a synthetic URL, return the `downloadZip()` `Response` with `Content-Disposition`. |
| Result cache | ours over **Cache API** | **~50 lines** | Keyed by recipe hash. Cache API over OPFS: it is purpose-built for `Response` objects and makes a generated base look identical to an R2 fetch to the rest of the loading code. OPFS's advantages (in-place partial writes, sync access handles) are ones write-once STL blobs never use. |
| Share-link codec | ours over `CompressionStream` | **~40 lines** | `deflate-raw` + base64url. Native, no dependency. |
| Hashing | `crypto.subtle.digest('SHA-256')` | — | Native. |

**Total "ours": ~800 lines.** That is the honest number.

### Why not the obvious libraries

| Rejected | Why |
| --- | --- |
| **`@rjsf/core@6.8.0`** | Nominally exactly this use case, and wrong. The customizer schema is not JSON Schema: "slider vs spinbox", the tab grouping, the `//8`-means-maxLength-for-strings-but-step-for-numbers overload, and the `"true"/"false"`-string-as-checkbox rule all have to be expressed as a **generated `uiSchema`** — which is the same 200 lines, now written twice. Cost: 2.18 MB unpacked plus lodash, lodash-es, prop-types, `markdown-to-jsx`, and AJV 8, on top of three.js and a client-side catalog index. Its v6 guide still describes React 19 support as pending while r3f 9 *requires* React 19. |
| **`@tanstack/react-form@1.33.5`** | Its entire value is compile-time inference from a statically-known form shape. Ours is read out of a `.scad` at runtime, so the generics collapse to `Record<string, unknown>` and we pay the API surface for nothing. |
| **A hand-written customizer parser** (~230 lines) | What everyone writes, including this project's own upstream — whose parser carries `// TODO: Use AST parser instead of regex` and demonstrably mishandles the max-only slider form `// [50]` (yields `{step:50}` instead of `{max:50}`). Since we must ship the engine anyway, asking it for the schema is free and cannot drift. Keep a regex parser only as an optional CI lint. |
| **`openscad-playground@2.4.0`'s `<OpenSCADPlayground>`** | Maintained and genuinely embeddable, but drags in Monaco, MUI 7, and react-router-dom for what needs to be a parameter panel and a mesh. Its headless `spawnOpenSCAD()` export is a reasonable substitute for our 120-line worker; take it if maintenance burden bites, accepting the GPL-2.0-or-later npm dependency. |
| **`openscad-customizer-web@0.3.0`** | Closest thing to a purpose-built library, and its README describes exactly this problem. But 8 downloads/week, and it is a *widget* that owns the canvas and the download button — the opposite of what a first-class placeable needs. Read it for reference. |
| **`openrscad-engine@0.13.0`** | Tempting: a Rust reimplementation, pure-Rust Manifold kernel, single-digit-ms warm edits, accepts customizer `params`. But it is a **reimplementation**, so it can disagree with `bases-square.scad` on any construct it renders differently — and these become physical objects that must snap together with OpenLOCK connectors. Its own README says pin with `~` not `^`. Revisit only with a mesh-diff harness against real OpenSCAD. |
| **`@zip.js/zip.js@2.8.61`** | More actively maintained and it compresses. Forfeits `Content-Length` and the real progress bar. See §6.3. |
| **`coi-serviceworker`** | Unnecessary — no threads, no isolation (§2.1). And if a threaded build were ever adopted, Cloudflare Pages sets headers natively via `_headers`, which beats a SW hack. |

---

## 8. Phasing

### v0 — Spike — **done, question 3 answered by row S2**

Three questions, an afternoon each, on which **every latency number in §3 was
conditional**:

1. Build `openscad-wasm` from the Docker `Makefile` and confirm `--export-format=param`
   works in the WASM build (only `openscad-playground` proves it works at all).
2. Confirm `--enable=predictible-output` exists in that build.
3. ~~**Time** `bases-square x=4 y=4 LOCK=openlock MAGNETS=flex_magnetic` and
   `x=8 y=8 CENTER=grid` with `--backend=manifold`, on a mid-range laptop and an
   iPad.~~ — **measured.** §3.5: 4×4 is **437 ms median / 481 ms p95**, 8×8 grid +
   dragonlock is **705 ms**, both on the shipped WASM build with `--backend=manifold`. So
   **auto-preview is on by default and there is no Generate button.** The laptop half is
   done (AMD Ryzen 5 7640U, Node 22); the **iPad half is not**, and it is the one that
   still carries risk — iOS Safari's WASM heap cap is much lower and
   `emscripten_resize_heap` returns `false` rather than throwing.

The conditional this section set is therefore discharged for the desktop case and open for
iOS. It was decided from a measurement rather than a guess, which is what it asked for.

### v1 — Minimum credible tight integration

**Four entry points only:** `bases-square`, `bases-square-corner`, `bases-square-wall`,
`risers_square`.

Chosen because they are simultaneously the biggest catalog families (270 `base+square`,
21+8 s2w corner, 28+8 s2w wall, and the riser sweep under `kind: stairs`), the cheapest
geometry (pure CSG on primitives — **no** `$fn=200` arcs, **no** `import()`), and the
literal answer to "I need a 2×2 base".

Ships:
- Full parameter surface for those four. It is free — the schema generates the UI.
- Plain texture only, stated in the panel.
- The resolver, so the default state and most common tuples never render at all.
- AABB proxy, single-flight cancellable render, watchdog, empty-geometry detection.
- Recipes in the build document, `localStorage` persistence, hash-fragment share links.
- ZIP with generated blobs, `MANIFEST.json`, `README.txt`, STL header provenance.
- `bytes` column in the catalog index.
- No R2 writes.

### v2 — The rest of the shapes

`bases-curved`, `bases-curved-radial`, `bases-curved-inverted`, `bases-diagonal`,
`bases-hex`, `bases-hex-corner`, `bases-hallway`, `bases-portal`,
`bases-square-internal_corner`, `risers_curved`, `risers_walls`.

Deferred out of v1 because these carry the real cost centres — 38 live `$fn=200` sites in
`impl_curved*.scad`, and 6×6 dragonlock curved output is 66,259 triangles. They need the v0
measurements to exist first. `bases-diagonal` is the highest-value item here: zero catalog
counterpart, so it is pure new ground.

### v3 — Textured walls

`bases-wall-primary.scad`. Blocked on getting its 90,168,428 bytes of blank texture STLs
(42 files, 1.1–4.4 MB each) onto R2 under a new `blanks/` prefix and fetched lazily into the
Emscripten FS. Those blanks are generator *inputs*, not catalog *outputs*, so they do not
fit `/models/{md5[:6]}/{md5}.stl` semantics — and putting them there is an R2 write, which
needs Devon (§9.6). Meanwhile the 221 `base+wall` rows already in the archive serve this
need through the catalog.

Also note `bases-wall-primary.scad` defines `ELECTRONICS`, `HEIGHT`, `NOTCH`, `CENTER` and
`PRIORITY` **below** its customizer block (lines 83–87), so those five are not `-D`
overridable on that file even though the schema will surface some of them. The widget must
suppress them.

### Deferred indefinitely
3MF export with embedded metadata; curated parameter presets; publishing generated STLs
back to the archive.

### Explicitly never
The `manifold-3d`/JSCAD port. A full parameter-space pre-bake.

---

## 9. Open questions

Each has a recommended default so nothing blocks.

**9.1 — What licence does the Workshop ship under?**
The only genuinely blocking question, and it is a lawyer question, not an engineering one.
We ship a GPL-2.0-or-later WASM binary; the `.scad` is Apache-2.0 and the parser problem is
gone, but the binary remains.
→ **Default: GPL-3.0-or-later, source public, `/licenses` route carrying the GPL text, the
written source offer for `openscad-wasm`, and the reproducible build recipe.** For a
Patreon-funded project distributing free STLs this costs nothing that matters. If rejected,
the only clean alternative is a separate-origin worker, which forfeits the tight
integration — escalate before writing code.

**9.2 — Is `openforge-bases` really Apache-2.0, and does it carry the same `.scad` the web
fork ships?**
The whole `.scad` licence story rests on this. GitHub metadata says Apache-2.0, pushed
2026-01-05.
→ **Default: yes.** Verify in the v0 spike by diffing `openforge-bases` against the fork's
`public/scad/`, and add a CI gate that fails on unexpected divergence. Ask Devon to confirm
the grant in writing — one sentence in a README settles it permanently.

**9.3 — Who builds and hosts the WASM artefact?**
There is no official npm package and no tagged release since 2022.
→ **Default: our CI builds it from the pinned Docker `Makefile` and serves it from the
Pages deploy at `/engine/{build}/openscad.wasm`.** Not R2 — that would be a write. Keep
every previously-shipped build addressable so an old recipe can name its exact engine.

**9.4 — Does the WASM build actually support `--export-format=param`?**
Only `openscad-playground` proves it works, and against its own build.
→ **Default: assume yes; the v0 spike settles it.** Fallback if absent: a ~200-line regex
parser as a **CI-only tool**, still never shipped to the browser.

**9.5 — Add a `bytes` column to the catalog index?**
→ **Default: yes, non-negotiable.** `mb` rounded to two decimals is not summable (some rows
read `0.0`) and breaks `predictLength()`. The catalog DB has the exact value; this is a
one-line change to the index builder.

**9.6 — Should generated bases ever be published back to the archive?**
Would turn popular recipes into permanent cache hits for everyone.
→ **Default: no for v1.** It requires an R2 write path the README forbids, plus abuse
limits, plus telemetry we deliberately do not collect. The better instrument already exists:
periodically extend `bases.py`'s offline sweep to cover axes users ask for. Revisit only if
render latency proves to be a real complaint.

**9.7 — LOD proxies for catalog STLs.**
Out of scope for this document but **larger than this document**. Catalog STLs average
11.8 MB (103 GB across 8,702 files, up to 30.3 MB), and `STLLoader` inflates binary STL
1.44× into CPU and GPU buffers — one 30 MB tile is ~43 MB. A thirty-tile room built from raw
STLs will drop the WebGL context. The base generator is not the memory risk; the catalog is.
→ **Default: build-time decimated proxies (Draco or meshopt glTF) for the viewport, full STL
only at download.** Flag it to whoever owns the builder architecture section.

**9.8 — Non-inch grids in an inch builder.**
The generator can produce 25 mm, 31.75 mm and 38.1 mm bases. The builder's snap grid is
inch. A wyloch base placed on an inch grid does not tile.
→ **Default: v1 locks `SQUARE_BASIS` to `inch` in the builder panel**, with the mono note
`other grids: coming soon`. Mixed-grid builds are a *builder* feature (a per-document grid
basis), not a generator feature, and pretending otherwise ships a base that silently does
not fit. The three non-inch grids are the generator's single biggest exclusive capability,
so this should be v2 — but as a builder change, not a generator one.

**9.9 — Auto-preview on or off by default?**
→ **Settled: on.** The v0 spike ran (row S2) and 4×4 is **437 ms median / 481 ms p95**
against the ~3 s threshold — 7× under, so the "off otherwise" arm never applies on
desktop. **Debounced rather than live**, because 15 of 46 configurations exceed a 250 ms
live-interaction budget on geometry alone; §3.3's commit-on-release is what carries that.
The toggle still ships, because every comparable tool has one. Open only for iOS, where
the heap cap is untested (§3.5).

---

## Appendix — facts worth not rediscovering

| Fact | Consequence |
| --- | --- |
| `export.cc:102` aliases the `stl` suffix to **`asciistl`** | Always pass `--export-format=binstl`. The upstream README's own example produces ASCII. |
| Multiple `-o` flags loop `cmdline(cmd)` per output (`openscad.cc:1158`) | Two output formats = two full CSG evaluations. There is no shared render. |
| Zero `assert()` in the entire OpenForge `.scad` corpus; errors are `echo`ed | Invalid params produce **empty geometry with exit code 0**. Check triangle count, never the exit code. |
| Five entry points export a module named `base_square` with different signatures | They can never be `include`d into one compilation unit. Render each entry point in isolation. |
| `public/scad/bases.scad` (56 KB) is unreferenced by `App.tsx` | Dead legacy monolith. It holds 47 of the 89 `$fn=200` sites and the invalid `curvedlarge = undef;`. Exclude it — 28% of the SCAD bytes for zero value. |
| All 39 `include` statements resolve to bare sibling filenames | A flat virtual filesystem of ~20 files resolves the entire dependency graph. No BOSL2, no MCAD, no `OPENSCADPATH`, no runtime library fetch. |
| Zero `minkowski()`, zero `text()`, zero `surface()`, zero list comprehensions | The classic WASM killers are all absent. `LiberationSans-Regular.ttf` is never needed. |
| `emscripten_resize_heap` returns `false` rather than throwing | Memory exhaustion surfaces as an opaque abort. The watchdog is the only thing that makes it visible. |
| `URL.createObjectURL()` is unavailable inside service workers | The streaming download must use a synthetic URL the SW intercepts. |
| The archive's own STLs carry `Exported from Blender-4.0.1` in the 80-byte header | Header provenance is established practice in this corpus, not an invention. |
