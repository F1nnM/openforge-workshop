# OpenForge base geometry — vendored, and ours from here

`scad/` holds **byte-for-byte copies** of the OpenSCAD sources that generate OpenForge
bases. Nothing in it is edited, reformatted, or reflowed. The project's own code sits
around it — the engine in `engine/`, the parameter panel in `panel/` — and the `.scad`
files are treated the way `vendor/client-zip/` is treated: input, not source we maintain.

This replaces the previous design, in which the generator was somebody else's web app
behind an iframe on a second origin. The owner's instruction was explicit: *"I would prefer
if we didn't load things from a separate url and integrate with another service… We can use
the scripts from somewhere else, but we should copy them and make them our own. We should
probably still be based on the format the other scripts use."* So the format is unchanged
OpenSCAD, and the hosting is us.

| | |
| --- | --- |
| Upstream | <https://github.com/MasterworkTools/openforge-bases> |
| Commit | **`e6dbbffc40e937fd5e7ddf13562c021c15b98034`** — *"created dual connector walls"* |
| Committed | 2026-01-05 (repo `pushed_at` 2026-01-05T21:00:05Z; the commit is upstream `master` HEAD) |
| Copied | 2026-09-01 |
| Licence | **Apache-2.0** — `scad/LICENSE`, retained as §4(a) requires |
| Attribution | `scad/NOTICE`, written for this copy — see below |
| Author | Devon Jones, sole author of all 27 upstream commits. Not a fork; no upstream parent. |
| Copied files | 35 `.scad` (196,778 bytes) + `LICENSE`; plus `NOTICE` and `.gitattributes` written here |
| Checksums | `scad/MANIFEST.sha256` — 36 lines, `sha256sum -c` compatible |
| Verify | `cd src/generator/scad && sha256sum -c MANIFEST.sha256` |
| Refresh | `npm run refresh:scad` (offline verify) · `-- --fetch` (diff against upstream) |

## The licence, checked rather than assumed

`scad/LICENSE` is the canonical Apache License 2.0 text. Verified by diffing it against
<https://www.apache.org/licenses/LICENSE-2.0.txt>: the two differ **only** in that
apache.org's copy has one leading blank line, which is why the hashes are not equal —

```
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  apache.org (11,358 bytes)
c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4  scad/LICENSE (11,357 bytes)
```

— the second being GitHub's licence-chooser rendering of the same text. Every other byte is
identical, so no term of the licence has been altered.

What §4 asks of a copy, and what was done:

- **§4(a) — hand recipients the licence.** `scad/LICENSE`, unmodified.
- **§4(b) — modified files must say so.** None are modified, so there is nothing to
  declare. `scad.test.ts` asserts every file's SHA-256 against `MANIFEST.sha256`, so this
  claim cannot rot without failing the build. If a file ever *is* modified, it needs a
  header saying so and a row in this document.
- **§4(c) — retain existing notices.** There are none to retain: no `.scad` file upstream
  carries a copyright, licence, or attribution header. Checked, not assumed.
- **§4(d) — propagate upstream's NOTICE.** Upstream has **no NOTICE file**, so there is no
  attribution text we are obliged to carry. `scad/NOTICE` was therefore written for this
  copy: with no per-file headers and no upstream NOTICE, attribution would otherwise live
  only in this document, which travels less well than a file sitting in the directory.

The author of the vendored geometry is the owner of this project, which is why this is a
short section rather than a long one.

### What was deliberately *not* copied

- **`openforge-openscad`** — the web harness. It is **GPL-3.0**, and a fork of
  `seasick/openscad-web-gui`. Its only value was the iframe wrapper this design removes, so
  **nothing from it is in this repository**, not a line. Note the direction of the dates:
  the Apache-2.0 geometry (2026-01-05) is *newer* than the GPL-3.0 harness (2025-10-29), so
  copying the geometry and skipping the harness also takes the more current code.
- **`bases.py`, `bases.sh`, `convertSTL.rb`** — upstream's batch drivers. They shell out to
  a local `openscad` binary over a hard-coded matrix of sizes and lock combinations. Our
  driver is the browser. `bases.py` is still worth reading, and is quoted at length under
  *For row S4* below, because it is the authority on how the catalogued base filenames map
  back to parameters.
- **`examples/`** — 14 marketing PNGs, 5.9 MB.
- **36 blank texture STLs, 82.9 MiB.** See the next section.
- **`lock_flex_magnetic.stl`** (16,684 bytes) — a *build output* of
  `lock_flex_magnetic.scad`, not an input to it. No `.scad` file references it; confirmed by
  grepping every `import()` in the set (there is exactly one, in the excluded
  `bases-wall-primary.scad`). Copying it would imply a dependency that does not exist.

## Excluded: `bases-wall-primary.scad`, the textured primary walls

Not copied, and this is a decision rather than an oversight.

The file offers ten `TEXTURE` values. One of them, `"Plain"`, builds geometry from
primitives. **The other nine `import()` a pre-made blank STL** —

```openscad
fn = str(texture_file, ".blank.", size_file, ".stl");
import(fn, convexity=5);
```

— resolved from a 10 × 5 grid of texture × size. Upstream ships 36 of those blanks at
**82.9 MiB** (86,924,224 bytes), individual files running 1.1 MB to 4.4 MB. Every one of
them would have to be materialised in the WASM filesystem *before* the compile, and the
compile itself is a boolean against a multi-megabyte mesh — estimated 30–180 s, which is
one to two orders of magnitude past the interaction budget the parameter panel is designed
around. Sculpted-texture bases have no OpenSCAD path at all; they are Blender output.

Excluding it is free in dependency terms: **nothing includes it.** It is a leaf, and its own
`include <connectors.scad>` is satisfied by the rest of the set regardless. Dropping it took
the include count from 40 to 39 and broke no chain — see the resolution table below.

Shipping it with nine of ten dropdown options broken would be worse than not shipping it: a
customizer enum gives no way to disable an individual value, so the UI would advertise
textures it cannot build. The capability that is actually lost is *textures*, not walls —
untextured parametric walls remain available through `bases-square-wall.scad`,
`risers_walls.scad` and `impl_wall.scad`, all of which are copied.

**So the panel must never imply that every base is parametric.** Textured and sculpted bases
come from the catalog's 1,962 pre-generated files or not at all.

## What is here

35 files, **196,778 bytes** (192.2 KiB). As a single concatenated payload at gzip -9:
**19,271 bytes** by GNU gzip, **18,452** by Node's zlib — same level, different
implementation, which is why `scad.test.ts` asserts a band there and an exact number for the
raw total. Also 20,439 as a `tar.gz`, and 18,144 as a gzipped JSON object of
`{filename: source}` — that last one is the shape the engine will actually hand to the WASM
filesystem, so it is the number to plan against. Call it **19 KB over the wire**.

### Against the numbers row S1 was written with

| | Row S1 | Actual | |
| --- | --- | --- | --- |
| Files | 20 | **35** | The row undercounts. There are 36 `.scad` upstream; 35 after the one exclusion. 20 is close to the 19 distinct *include targets*, which is probably where it came from. |
| Bytes | 201 KB | **196,778** | Right, and for the right reason: all 36 upstream `.scad` total 202,489 B, so the row measured the whole set. Minus the excluded file, 196,778. |
| Gzipped | 20.7 KB | **19.3 KB** | The row's figure is reproduced almost exactly by `tar czf` of the full upstream set (20,439 B) — a tar's per-file headers, not the payload. |
| `include`s | 39 | **39** | Exact. Upstream has 40; excluding `bases-wall-primary.scad` removed its single `include <connectors.scad>`, which is a coincidence worth knowing about before somebody "fixes" the number. |
| Flat resolution | claimed | **confirmed** | 39/39 bare filenames, 19 distinct targets, zero dangling, no `/`, no `..`. |

The one substantive correction is the file count. Nothing depends on it being 20 — S3's virtual
filesystem is a map, not a fixed-size array — but the row's text should read 35.

### Inert, and measured

Nothing in `src/` imports any of this yet; `scad.test.ts` asserts that by grepping `src/`
for the path. Building with `src/generator/` present and with it moved aside produces the
identical bundle down to the content hash — `index-CPOE7KzK.js` at 589,722 B either way,
512 modules either way. 197 KB of non-TS files under `src/` cost the shipped app nothing,
which is the property S3 inherits and should re-check when it wires the engine.

Sixteen of the files are **entry points** — nothing includes them, each carries its own
customizer parameter block, and each is a candidate for one row in the generator's shape
picker:

| Entry point | Bytes | Shape |
| --- | --- | --- |
| `bases-square.scad` | 3,218 | square floor tiles, 1×1–8×8, notch and grid-centre options |
| `bases-square-wall.scad` | 3,263 | square tile with one wall |
| `bases-square-corner.scad` | 3,283 | square tile, external corner |
| `bases-square-internal_corner.scad` | 3,590 | square tile, internal corner |
| `bases-diagonal.scad` | 3,111 | angled/diagonal tiles |
| `bases-curved.scad` | 3,533 | curved walls, incl. the 3-part a/b/c large variants |
| `bases-curved-inverted.scad` | 2,929 | concave curves |
| `bases-curved-radial.scad` | 3,009 | radial segments by angle |
| `bases-hex.scad` | 2,780 | hex tiles |
| `bases-hex-corner.scad` | 3,486 | hex corners by `ANGLE` |
| `bases-hallway.scad` | 2,862 | hallway sections |
| `bases-portal.scad` | 4,227 | portals |
| `risers_square.scad` | 2,244 | square risers, `z` 1–4 |
| `risers_curved.scad` | 3,476 | curved risers |
| `risers_walls.scad` | 3,109 | wall risers |
| `bases.scad` | 56,641 | **legacy monolith — see below** |

The remaining 19 are implementation and lock libraries: `connectors.scad` (15,974 B, the hub
— included by 5 files, itself including all 9 `lock_*.scad`), nine `impl_*.scad`
(`impl_square.scad` is the most-included file in the set at 11 includers), and nine
`lock_*.scad` primitives, the smallest of which is 587 bytes.

### `bases.scad` is the old design, kept on purpose

It is 29% of the payload and it is superseded. It predates the `bases-*` / `impl_*` split:
one 1,212-line file with a `shape = "square"; // [square,diagonal,curved,alcove]` selector,
lowercase parameter names (`square_basis`, `lock`, `magnet_hole`) where the current files use
uppercase (`SQUARE_BASIS`, `LOCK`, `MAGNET_HOLE`), and its own copies of `connector_positive`
and friends — so it **cannot be compiled together with `connectors.scad`**, only as its own
entry point. `bases.py` drives the `bases-*` and `risers_*` files exclusively and never
touches it.

It was copied anyway because it is the only source for geometry the split files never got:
`alcove`, `curvedsquare`, `dynamic_floors`, and the `external_north/south/east/west` edge
extensions. Deleting it would delete those shapes.

**For S3:** it is not a sixteenth peer entry point. Exposing it alongside `bases-square.scad`
would offer two generators for the same tile with different parameter names and different
output. Treat it as archival until somebody wants `alcove`.

## Include resolution: flat, no traversal

The reason this matters is that S3's virtual filesystem is a flat map from bare filename to
source text. A single include that traversed a directory, or named a file outside the set,
would surface at runtime as an OpenSCAD parse failure with an unhelpful message.

- **39 `include`/`use` statements** across the 35 files. (A 40th occurrence in the set is
  `// include <connectors.scad>` — commented out, line 2 of `impl_diagonal.scad`.)
- **All 39 are bare filenames.** No `/`, no `\`, no `..`, no absolute path.
- **19 distinct targets, all present here.** Zero dangling.
- **No `use <...>`** at all — upstream is `include`-only, so every included file's variables
  and modules land in the includer's scope. That is why the entry points can define
  `SQUARE_BASIS` and have `connectors.scad` see it.
- Deepest chain is four hops: `bases-hex-corner.scad` → `impl_hex_corner.scad` →
  `impl_square.scad` → `connectors.scad` → the nine `lock_*.scad`.

`scad.test.ts` asserts all of this per statement, so a refresh that introduces a
subdirectory include fails the suite instead of the browser.

## The customizer annotations are data, not comments

This is the constraint most likely to be broken by a well-meaning cleanup.

S3 derives the parameter schema from **OpenSCAD's own `--export-format=param`**, not from a
parser of ours. That extractor reads the `.scad` comment syntax directly:

```openscad
/* [Lock] */
// Select the type of clip lock
LOCK = "openlock";// [openlock,triplex,infinitylock,dragonlock,none]
SQUARE_BASIS = "inch"; // [25mm:25mm - Dwarven Forge/Hirstarts, inch:inch (25.4) - OpenLOCK/…]
```

`/* [Group] */` is a parameter group heading. A `//` comment on the line above a variable is
its description, shown as help text. A `//` comment *after* the assignment is its domain: a
bracketed list is an enum; `value:Label` pairs give the option its display label. Reflow one
of those lines, move a comment, normalise the spacing before `//`, or convert a trailing
comment to a leading one, and the parameter silently loses its group, its help text, or its
whole dropdown. There is no error — the file still compiles, and the panel just renders a
free-text box.

**They survived.** Verified two ways, not by inspection: every file's SHA-256 matches
`MANIFEST.sha256`, which was computed from the upstream tarball extraction (`cmp -s` clean on
all 36 files before hashing); and `scad.test.ts` re-checks those hashes on every run, so
byte-for-byte is a build-breaking assertion rather than a claim in a document. The files were
copied with `cp -p` — no editor, no formatter, nothing that reflows a line.

### Line endings are mixed, and that is a trap worth naming

**Twelve of the 35 files are CRLF upstream** — `connectors.scad`, `impl_curved.scad`,
`impl_hex.scad`, `impl_square.scad`, `risers_curved.scad`, `risers_square.scad` and all six
of the CRLF `lock_*.scad` — and in each of those every line is CRLF, not just some. The
other 23 are LF. Separately, **fifteen files have no trailing newline** at EOF.

Nothing in this repository normalises that today: there is no `text=auto` in either
`.gitattributes` (the parent repo's has one unrelated `merge=beads` rule) and no
`core.autocrlf` in any config on the path. But "nothing does it today" is not a guarantee, and
an EOL rewrite would change every hash at once and read in review as tampering rather than as
a checkout artefact. So `scad/.gitattributes` pins `* -text` for this directory, and
`scad.test.ts` asserts the CRLF/LF split explicitly — a normalisation therefore fails with
"12 files should be CRLF, found 0" instead of 36 opaque hash mismatches.

A consumer that wants uniform text must normalise **after** reading, never in the file. S3's
virtual filesystem hands these to OpenSCAD, which accepts both.

The same reasoning is why `eslint.config.js` matters here. It ignores `vendor/` but **not**
`src/`, and this directory is under `src/`. That is fine today: ESLint's flat config lints
only the extensions its `files` patterns name, and none of them match `.scad`, `.sha256`,
`LICENSE` or `NOTICE`. If that ever changes — a formatter added to the repo that globs
`src/**`, say — the fix is to exempt this directory, **not** to move it. `src/generator/scad/`
is the path S3 imports.

## For row S4: base filenames encode parameter tuples

Not needed to build S1, and written down here because S4's catalog-first resolution depends
on it and the source of truth is a file we deliberately did not copy. From upstream
`bases.py` at the same commit.

Output path and filename:

```
plain/<shape>/<dirname>/plain#base+<shapename>.<size>.<options>.stl
plain/<shape>+riser/<dirname>/plain#riser+<shape>,<riser>.<size>.<title>.stl
```

- **`size`** is `{x}x{y}`, with `+a|+b|+c` appended for the 3-part large curves and `+notch`
  when a square is notched. Other generators use their own forms: `{x}r{angle}°` (hex
  corner), `{x}x{x}+{cut}r` (curved inverted), `{size}x` (hex), `{angle}°`.
- **`shapename`** is the shape with `,`-joined modifiers: `square`, `square,grid`,
  `curved,inverted`, `square,wall_locks`, `hex+corner`, `square+s2w+wall`.
- **`riser`** is `z` spelled out: 1 `platform`, 2 `low`, 3 `medium`, 4 `high`.
- **`options`** is a `,`-joined connector list, each optionally `+suffix` —
  `openlock,magnetic+flex`, `openlock+topless,magnetic+flex`, `dragonlock`.

Three traps, all of which will bite a naive inverse mapping:

1. **The filename's lock name is not the `-D LOCK` value.** In `connections()` the entry
   whose filename says `openlock` is generated with `-D LOCK="triplex"`, and the one that says
   `openlock+unsupported` is generated with `-D LOCK="openlock"` (plus `SUPPORTS="false"`).
   In `curved_connections()` those two are **the other way round**. So the mapping is
   per-generator, it looks like an upstream slip, and it cannot be inferred from the name.
   S4 must carry the table, not a rule.
2. **Option *order* encodes `PRIORITY`.** With two connectors and `x == 1 || y == 1 || flip`,
   `bases.py` emits the same geometry twice from one filename stem — once with the connector
   list as written and `-D PRIORITY="lock"`, once reversed with `PRIORITY="magnets"`. So
   `…openlock,magnetic+flex.stl` and `…magnetic+flex,openlock.stl` are different meshes, and
   the difference is a parameter the filename records only through sequence. Otherwise a
   single file is emitted at `PRIORITY="magnets"`.
3. **Every catalogued base is `SQUARE_BASIS="inch"`.** `bases.py` hard-codes it in every
   `run_openscad_*`. The `.scad` files offer four bases — `25mm` (Dwarven Forge/Hirstarts),
   `inch` (25.4, OpenLOCK/Dragonlock), `wyloch` (31.75), `drc` (38.1) — so a request for any
   of the other three **can never resolve against the catalog** and must go to the live
   engine. Two of the four are additionally refused by the geometry itself: `bases-*.scad`
   `echo("ERROR: …")` and emit nothing when `dragonlock` or `infinitylock` is combined with a
   non-inch basis.

Fixed across the generated corpus: `MAGNET_HOLE` is `6` when magnets are on and `0` when
off, and `HEIGHT` is left at its default of `6`. `TOPLESS`, `SUPPORTS`, `NOTCH`/`NOTCH_X`/
`NOTCH_Y`, `CENTER`, `CURVED_LARGE`, `CURVED_MAGNETS` and `WALL_LOCKS` are all passed
explicitly per row.

The `.scad` defaults are therefore load-bearing for the resolver, which is why S4 puts a CI
gate on them: `bases-square.scad` currently defaults to `x = 2, y = 2, HEIGHT = 6,
SQUARE_BASIS = "inch", LOCK = "openlock", TOPLESS = "true", SUPPORTS = "true",
MAGNETS = "flex_magnetic", MAGNET_HOLE = 6, ELECTRONICS = "false", PRIORITY = "lock",
NOTCH = "false", CENTER = "none"`. A silent upstream change to any of those shifts what an
un-set parameter means, and the resolver's hashes stop matching the corpus.

## Refreshing, and how CI catches drift

`scripts/refresh-scad.ts`. Its header documents the design; the operational summary:

```sh
npm run refresh:scad                  # offline. hash every file, compare to the manifest
npm run refresh:scad -- --fetch       # network. diff upstream@SHA against disk, write nothing
npm run refresh:scad -- --head        # network. has upstream master moved past the pin?
npm run refresh:scad -- --fetch --write   # adopt: write files, regenerate the manifest
```

**The default mode makes no network request.** CI runs `npm run refresh:scad` and
`npx vitest run src/generator`, both of which are pure local hashing against
`MANIFEST.sha256` — so drift in *our* copy is caught on every build, with no dependency on
GitHub being reachable and no token in the workflow. The two network modes are opt-in, for a
human deciding whether to move the pin, and **neither writes without `--write`**: `--fetch`
prints a per-file unified diff and exits non-zero. An upstream change arrives as a diff to
read, not as a working tree that quietly changed under you.

After `--write`, this file is wrong until somebody updates it: the commit SHA, the date, the
file count and sizes, and — if the change touched a parameter block or an include — the
sections above. The test suite will fail on the numbers until it is.
