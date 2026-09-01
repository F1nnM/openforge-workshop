# The OpenLOCK tessellation system

Research note for the OpenForge Workshop. Companion machine-readable table:
[`openlock-tessellation.json`](./openlock-tessellation.json).

**Every number below is labelled.** `[M]` = measured by me from STL geometry in the public
bucket. `[T]` = transcribed from the official cheat sheet image. `[W]` = quoted from a web
source I actually read (URL given). `[S]` = read out of the scanner's own `sizes` table.
`[I]` = my inference, with the reasoning shown. Where sources disagree I say so with the
numbers rather than picking a winner — see [Contradictions](#7-contradictions).

---

## 1. The structural answer

**The codes are footprint identifiers, and that is all they are.** A code names an *outline
plus a set of OpenLOCK port positions*. It says nothing about height, texture, wall-vs-floor,
or joinery. Printable Scenery states this directly `[W]`
(<https://www.printablescenery.com/2017/04/26/openlock-developer-information/>):

> **Footprint Code:** this refers to the tessellation footprint for each tile. The
> standardisation of the tessellation footprint is what makes OpenLOCK a cross-compatible
> system. For example, any A-Tile will have the same footprint as any other A-tile.

and, on the same page, that the footprint is the thing that must never move:

> the footprint tessellation of each piece must never change, and the location of the
> OpenLOCK ports must never alter.

So the tessellation axis is genuinely orthogonal to the connector axis, exactly as this
project already assumes. The clip (currently v5.4, a separate printed part that bridges two
tiles) is joinery; the letter is outline. The same code appears in Devon's own repos as
`floor`, `wall`, `half_wall`, `flat_end`, `riser` and `full_riser` `[W]`
(<https://github.com/devonjones/openforge-cut_stone-openlock>), and Printable Scenery is
explicit that "any tile can be a wall or a floor".

**It is not a size ladder.** It is a **shape taxonomy with per-family size ladders**, plus a
second, colliding namespace for columns. Concretely, six families:

| Family | Members | What varies within it |
|---|---|---|
| Straight wall runs | `IA` `BA` `A` `D` `Q` | length only: 1, 1.5, 2, 3, 4 `[M]` |
| Rect floors | `I` `S` `SA` `SB` `E` `EA` `R` `U` | width × depth `[M]` |
| 1×1 cells by port topology | `I` `IO` `II` `IL` `IT` `IX` | *not* size — all are 1×1 `[M]`; the suffix is the port pattern |
| Diagonal (45°) walls | `P` `PA` `PB` `PC` | end-mitre treatment; the run is 2√2 `[M]` |
| Curves | `F` `V` `X` `XA` (`G` `GA` unused) | radius, sweep, and which side of the radius the band sits `[M]` |
| Columns | `col+I` `col+L` `col+O` `col+T` `col+X` | *not* size — all are 0.5 × 0.5 `[M]`; the letter is the port arrangement |

### The unit

**1 catalog unit = 1 inch = 25.4 mm, exactly.** Confirmed three ways:

- `[W]` Printable Scenery: "OpenLOCK is based on the 1″ Dungeon tile to allow a 25mm base to
  fit within a 1″ square. … 2″ = 50.8mm / 1″ = 25.4mm / half inch = 12.7mm".
- `[W]` `openforge-tutorials/docs/index.md`: "Most Table Top Role Playing Games (TTRPG) use a
  1-inch grid … OpenForge included. The most common tile size is the 2x2 inch tile"; and "The
  walls are 0.5 inches, and floor tiles are on a 1 inch grid."
  Also, on the historical break: "In the past, OpenForge tiles where scaled such that they
  were compatible with a 25mm grid. However, newer tiles … have been updated to be compatible
  with a 1 inch grid … by a factor of 101.6%."
- `[M]` My measurements land on exact multiples of 25.4 mm: 12.70, 25.40, 38.10, 50.80, 76.20,
  101.60, 152.40 — to the last digit the STL stores.

### The two constants that were missing

1. **Wall thickness is 0.5 units (12.70 mm).** `[M]` every wall-run base measured `length ×
   0.500`. `[W]` corroborated twice: "All walls are .5" in width at their base" (PS 2022
   naming thread) and `openlock_wall_positive()` in Devon's generator is
   `cube([12.7,16,5.6])` — 12.7 mm is 0.5″ on the nose
   (<https://github.com/MasterworkTools/openforge-bases/blob/master/lock_openlock.scad>).
   **A wall's footprint is therefore `length × 0.5`, not a zero-width line.** The project's
   current "crude width lookup" is not wrong about the length — it is missing the thickness,
   and missing that the length is only one of six footprint classes.

2. **A column's footprint is 0.5 × 0.5 units.** `[M]` `col+I`, `col+O`, `col+L`, `col+X` all
   measured 12.70 × 12.70 mm. `[W]` "All columns are based on .5" x .5" pillars, so are
   categorized by the orientation of their ports (Corner, Straight, End, T-junction,
   X-junction) plus height" (PS 2022 naming thread). A column occupies exactly one
   wall-thickness square.

### Are the multi-letter codes compositional?

**Partly — three different mechanisms, and you cannot tell which from the letters alone.**

- **`I` + topology letter is compositional and regular.** `I` `IO` `II` `IL` `IT` `IX` are all
  1 × 1 `[M]`, differing only in port pattern. The suffix is the plumbing-fitting convention:
  `O` = none, `I` = two opposite, `L` = corner (two adjacent), `T` = three, `X` = four. This is
  confirmed independently for columns `[W]`: "the letter describes the connection angle", and
  the 2022 rename maps `L-column` → `Column Corner 2`. So the project's guess that `I` means
  "inch/interior" is **wrong**: `I` is the **1 × 1 cell**, and the second letter is the
  junction topology. `IL` is "the one-inch cell with corner ports", not "interior L".
  *`IA` is the exception and breaks the pattern* — it is a 1 × 0.5 wall run `[M]`, not a 1 × 1
  cell. `IA` belongs to the wall ladder, not the `I`-cell family.

- **A trailing `A`/`B`/`C` is a family ladder — but inconsistently.** `S`→`SA`→`SB` is
  2×1→3×1→4×1 `[M]`; `E`→`EA` is 2×2→3×3 `[M]`. But `[W]` in Devon's legacy filenames the same
  suffix sometimes means *an alternate port layout on an identical outline* (`EB` = 2×2 like
  `E`, `RB` = 4×2 like `R`, `UB` = 4×4 like `U`), which matches the PS changelog entry v4.1
  "alternate hole positions on U and E tiles". **Do not implement a rule for the suffix.**
  Treat each code as opaque and look it up.

- **`xG` is a modifier, not a size.** `AxG` / `BAxG` / `QxG` = "the `A`/`BA`/`Q` wall, cut to
  mate with a `G` curve". `[M]` They measure as *straight* 0.5-thick walls (1.991 / 1.547 /
  3.000 long), not arcs. The `size|radius|2.5` they carry describes the **shape of the joint**,
  not the tile outline. Same for `SxG`/`ExG`/`RxG`/`UxG` `[S]`, and `[M]` `SxG` measures
  1.700 × 1.000 — an `S` (2×1) rect with a corner cut, not an arc.

- **`+` is genuine composition.** `A+S` = an `A` wall plus an `S` floor; `D+SA` = `D` wall plus
  `SA` floor `[S]`. Nominal depth 0.5 + 1 = 1.5. See the contradiction in §7.

### The colliding namespace

**The same letters mean different things for tiles and for columns, and the catalog tag does
not record which.** `size|openlock|X` covers both the radius-4 curved wall (18 tiles, measured
as an arc band) and the four-way column `col+X` (11 tiles, measured 0.5 × 0.5) `[M]`. Same for
`I`, `O`, `L`, `T`. `[W]` PS confirms this is inherent to the vocabulary, not a catalog bug:
column letters describe port arrangement, tile letters describe footprints.

**The Workshop must disambiguate on `shape|column`, never on the letter alone.**

---

## 2. The cheat sheet: what it does and does not give

Downloaded from the cited URL with a browser User-Agent; 1300 × 1300 JPEG, 230 KB, read
directly. Title: **"OpenLOCK tessellation and connection reference sheet"**. Footer: "OpenLOCK
by Printablescenery, Published on October 18, 2016, www.thingiverse.com/thing:1833963",
CC-BY-NC, and the strapline "OpenLOCK is always backwards compatible".

**It is purely pictorial. It carries zero dimension numbers.** `[T]` I inspected it at 3×
magnification across four quadrants. Every shape is drawn in plan view as a flat plate with
its OpenLOCK port slots shown as dark recesses, labelled with its code and nothing else. That
is the whole of the primary source: it fixes shape *identity* and *port positions*, and leaves
every dimension to be recovered elsewhere. This is the single most important thing to know
about it, and it is why the rest of this document is measurement.

**Full label inventory** `[T]`, in sheet order:

> V, VG, VN, X, XA, XG, HG, FB, FN, FC, FG, OA, SB, SA, S, Z, Y, YA, ZA, F, G, H, BA, BA-AS,
> AS, DS, D, A, E, C, OPENLOCK CLIP, O, I, IA, I-IA, J, PA, P, PB, PB MIR, PC, PC MIR, EN, ED,
> EC, K, L, M, N, EA, R, E+A, 6X6, W, VE, T, U, QA, Q, QC

Shape classes I could read off the drawing `[T]`: `V` `W` `VE` `T` are quarter-round / curved
corner *floors*; `X` `XA` `XG` `VG` `VN` `HG` `H` `G` `F` are curved *bands* of varying sweep
and width; `K` `L` `M` `N` and `SB` `SA` `S` are plain rectangular bars in two width classes;
`BA` `AS` `A` `D` `DS` `C` are thin wall strips; `E` `EA` `R` `U` `6X6` `E+A` `ED` `EC` are
rectangular floors with bordered port rails; `I` `IA` `J` `I-IA` are the 1×1-and-smaller
cells; `O` `OA` `Z` `Y` `YA` `ZA` are triangles; `P` `PA` `PB` `PC` (+ MIR) are diagonal
strips; `EN` is an L-shaped corner; `FB` `FN` `FC` `FG` are quarter-round corner plates; `QA`
`Q` `QC` are long thin bars.

One transcription check worth recording: the sheet draws `K` `L` `M` `N` as bars of ordered
lengths **M > L > K > N** `[T]`. Devon's legacy filenames give `K` = 2.5″, `L` = 3.0″, `M` =
4.0″, `N` = 2.0″ `[W]` — the same ordering. Two independent sources agreeing on an ordering
that neither states numerically is reasonable evidence both readings are right.

### 21 sheet codes do not exist in this corpus

`[M]` Counting filename size tokens across all 8,702 live records, these sheet codes appear
**zero** times: `VG` `VN` `XG` `HG` `H` `G` `K` `L` `M` `N` `DS` `C` `W` `VE` `J` `T` `QA`
`QC` `FB` `FN` `FC` `FG` `EN` `ED` `EC` `E+A` `6X6` `BA-AS`.

The sheet is Printable Scenery's **superset**. OpenForge uses a subset of it and adds its own
codes that are not on the sheet at all (`AxG` `BAxG` `QxG` `IT` `IO` `II` `IX` `IL` `A+S`
`D+SA` `VxE` `col+*`). Do not treat the sheet as the Workshop's vocabulary.

---

## 3. The complete code table

The closed vocabulary is **38 codes** `[S]` — every `size|openlock|X` tag the scanner can
possibly emit, from the 163-entry `sizes` dict in
`/home/finn/Repos/openforge-catalog/openforge/data/__init__.py`. **36 of the 38 occur on live
tiles** (4,030 tiles); `G` and `GA` are defined but carry zero tiles.

Dimensions are catalog units (1 unit = 25.4 mm). "Measured" is the axis-aligned bounding box
of the smallest STL I could find for that code, in the tile's own model orientation.

| Code | Live tiles | Shape class | Scanner nominal | Measured bbox | Prov. |
|---|---:|---|---|---|---|
| `A` | 1095 | straight wall run | w 2 | **2.000 × 0.500** | M |
| `BA` | 519 | straight wall run | w 1.5 | **1.500 × 0.500** | M |
| `Q` | 481 | straight wall run | w 4 | **4.000 × 0.500** | M |
| `D` | 364 | straight wall run | w 3 | **3.000 × 0.500** | M |
| `IA` | 363 | straight wall run | w 1 | **1.000 × 0.500** | M |
| `S` | 182 | rect floor | 2 × 1 | **2.000 × 1.000** | M |
| `SB` | 153 | rect floor | 4 × 1 | **4.000 × 1.000** | M |
| `I` | 108 | 1×1 cell **/ column** | 1 × 1 | **1.000 × 1.000**; `col+I` **0.500 × 0.500** | M |
| `SA` | 108 | rect floor | 3 × 1 | **3.000 × 1.000** | M |
| `IL` | 86 | 1×1 cell, corner ports | 1 × 1 | **1.000 × 1.000** | M |
| `L` | 50 | **column only** | — | **0.499 × 0.500** | M |
| `PC` | 45 | diagonal wall | w 2, 45° | **3.334 × 0.520** | M |
| `O` | 43 | right triangle **/ column** | 2 × 2 (also OA 4 × 4) | `OA` **4.000 × 4.000**; `col+O` **0.500 × 0.500** | M |
| `PB` | 40 | diagonal wall | w 2, 45° | **2.835 × 0.520** | M |
| `AS` | 35 | straight wall run | w 2 | **2.000 × 0.500** | M |
| `U` | 35 | rect floor **/ octagon segs** | 4 × 4 | **4.000 × 4.000** | M |
| `X` | 29 | curved wall band **/ column** | r 4, 90° | arc **[4.000, 4.500] × 90°**; `col+X` **0.500 × 0.503** | M |
| `AxG` | 28 | wall run, curved interface | w 2, r 2.5 | **1.991 × 0.500** (straight) | M |
| `BAxG` | 28 | wall run, curved interface | w 1.5, r 2.5 | **1.547 × 0.500** (straight) | M |
| `QxG` | 28 | wall run, curved interface | w 4, r 2.5 | **3.000 × 0.500** (straight) | M |
| `IT` | 28 | 1×1 cell, T ports | 1 × 1 | **1.000 × 1.000** | M |
| `P` | 24 | diagonal wall | w 2, 45° | **3.536 × 0.711** | M |
| `IO` | 22 | 1×1 cell, O ports | 1 × 1 | **1.004 × 1.000** | M |
| `XA` | 18 | curved wall band | r 4, 45° | arc **[3.984, 4.489] × 45°** | M |
| `IX` | 18 | 1×1 cell, X ports | 1 × 1 | **1.015 × 1.014** | M |
| `T` | 14 | **column only** | — | *unmeasurable* — see §7 | — |
| `E` | 12 | rect floor | 2 × 2 | **2.000 × 2.000** | M |
| `PA` | 12 | diagonal wall | w 2, 45° | **2.828 × 0.522** | M |
| `A+S` | 11 | rect (wall + floor) | 2 × 1.5 | **2.000 × 1.753** | M |
| `II` | 11 | 1×1 cell, I ports | 1 × 1 | **1.011 × 1.000** | M |
| `D+SA` | 8 | rect (wall + floor) | 3 × 1.5 | **3.000 × 1.892** | M |
| `EA` | 7 | rect floor | 3 × 3 | **3.000 × 3.000** | M |
| `R` | 7 | rect floor | 4 × 2 | **4.000 × 2.000** | M |
| `F` | 6 | curved floor sector | r 2, 90° | arc **[0.000, 2.000] × 90°** (quarter disc) | M |
| `V` | 6 | curved floor sector | r 4, 90° | arc **[0.000, 4.000] × 90°** (quarter disc) | M |
| `VxE` | 6 | curved floor band + notch | r 4, 90° | arc **[2.000, 4.000] × 90°** | M |
| `G` | **0** | curved wall band | r 2, 90° | *via rename:* arc **[2.000, 2.500] × 90°** | M/W |
| `GA` | **0** | curved wall band | r 2, 45° | arc [2.0, 2.5] × 45° | I |

Also measured, not `size|openlock` codes but part of the same vocabulary:

| Token | Live | Shape class | Measured bbox | Prov. |
|---|---:|---|---|---|
| `S+wall` | 53 | rect floor + wall | **2.000 × 1.034** | M |
| `SB+wall` | 45 | rect floor + wall | **4.000 × 1.000** | M |
| `SA+wall` | 26 | rect floor + wall | **3.000 × 1.000** | M |
| `I+wall` | — | 1×1 cell + wall | **1.001 × 0.999** | M |
| `ZA` | 10 | octagon wall segment | **1.917 × 0.520** | M |
| `YA` | 4 | octagon floor segment | **1.531 × 1.848** | M |

`YA`'s bbox is exactly `4·sin(22.5°) = 1.5307` by `2·cos(22.5°) = 1.8478` `[M]`. The 22.5°
trigonometry means it really is octagonal, matching the scanner's `shape|angled|octagon` `[S]`
— it is a segment of a regular octagon of across-corners diameter 2 units `[I]`. `Y` `Z` are
the 4-unit counterparts `[S]`; I could not measure either (no sample under the size cap), so
their exact outlines are **unknown**.

### The `G` datum is worth its own paragraph

`G` carries zero tiles, but its geometry is *not* unknown, because OpenForge renamed it and
the renamed token is in the corpus. `[W]`
<https://github.com/MasterworkTools/openforge-tutorials/blob/master/sets/openlock.md>:

> 8 `curved+concave,wall.2r90°` walls (renamed from G walls)

`[M]` That token measures **inner 2.000, outer 2.500, sweep 90.00°** — a 0.5-wide band sitting
*outside* radius 2. So `G` is pinned exactly, by a citable rename plus a measurement, despite
having no tiles of its own. `GA` is the 45° version by the same logic `[I]`, unmeasured.

### Legacy dimensions for the codes this corpus does not use

`[W]` Recovered from Devon Jones' own archived STL filenames
(<https://github.com/devonjones/openforge-cut_stone-openlock>), which encode inches directly
in the pattern `cut_stone.{kind}.{CODE}.{dims}.{shape}.openlock.stl`. Independently
corroborated for 13 codes by <https://martinnr5.com/2019/10/09/getting-to-grips-with-openforge-part-1/>.
**These are a different generation of the vocabulary — see §7 — so treat them as history, not
as a spec for today's corpus:**

Walls (`length × base width`, inches): `B` 1.0×0.5 · `IA` 1.0×0.5 · `BA` 1.5×0.5 · `A` 2.0×0.5
· `C` 2.5×0.5 · `D` 3.0×0.5 · `Q` 4.0×0.5 · `QB` 4.0×0.5 · `QC` 4.5×0.5 · `QA` 5.0×0.5 ·
`J` 1.0×1.0 · `N` 2.0×1.0 · `K` 2.5×1.0 · `L` 3.0×1.0 · `M` 4.0×1.0.

Floors: `I` 1×1 · `S` 2×1 · `SA` 3×1 · `SB` 4×1 · `E` 2×2 · `EA` 3×3 · `EC` 3×3 · `R` 4×2 ·
`U` 4×4 · `6x6` 6×6.

Curves, in the notation `{outer radius}r[{inner radius}]×{width}`: `TA` 1.5r×0.5 · `TB`
1.5r0.75×0.5 · `G` 2.0r×0.5 · `GA` 2.0r1.0×0.5 · `H` 2.0r×1.0 · `HA` 2.0r1.0×1.0 · `WA`
3.5r×0.5 · `WB` 3.5r1.75×0.5 · `X` 4.0r×0.5 · `XA` 4.0r2.0×0.5. Curved floors are named by
their square footprint instead: `F` 2×2; `T` `V` `W` all 4×4.

Angled: `O` 2×2 · `OA` 4×4 (floors) · `P` `PA` 2×2, `PB` `PC` 4×4 (walls) · `Y` 4.0, `YA` 2.0
(floors) · `Z` 4.0, `ZA` 2.0 (walls).

Codes for which **no dimensional statement exists anywhere I could find**, in any source:
`VE` `VG` `VN` `XG` `HG` `FB` `FC` `FG` `FN` `EN` `ED` `AS` `DS` `BA-AS` `I-IA` `E+A`. `AS` is
known only qualitatively — "An `AS` wall becomes `2×2 Internal Wall`" `[W]` — though `[M]` I
measured its footprint as identical to `A` (2.000 × 0.500), which is consistent: `AS` differs
from `A` in port configuration, not outline.

---

## 4. Curves — and yes, they become placeable

This is the load-bearing result. **Every curved tile in the corpus is an annular sector, and
the primitive that places it is `(centre, innerRadius, outerRadius, startAngle, sweep)`.**

### The primitive

For a sector spanning `[0, θ]` with `θ ≤ 90°`, inner radius `Rin` and outer radius `Rout`, the
arc centre sits at a **corner of the bounding box**, and:

```
bboxX = Rout − Rin·cos(θ)
bboxY = Rout·sin(θ)
```

`[M]` I verified this to **±0.002 units** against 8 independent plain-base samples by solving
the two equations for `(Rout, Rin)` from the measured bbox and comparing with the tag's radius.
For the 90° cases (where the formula degenerates to `Rout × Rout`) I instead located the centre
directly: the correct bbox corner is the one about which the vertex cloud spans exactly 90.00°,
and then `Rin`/`Rout` fall out as the min/max vertex radius. Both methods agree.

### The three bands

The radius tag is the **interface radius** — where the piece meets its neighbour. Which side of
it the material lies on is set by the `concave`/`convex`/`radial` modifier:

| Modifier | Band | Measured evidence (units) | Prov. |
|---|---|---|---|
| `radial` (floor sector) | **`[R−2, R]`** | `2r90` [0.000, 2.000] · `4r22.5` [1.999, 4.000] · `4r45` [2.000, 4.000] · `4r90` [2.000, 4.000] · `6r11.25` [3.999, 5.999] · `6r22.5` [3.999, 5.999] · `6r45` [4.000, 6.000] · `6r90` [4.000, 6.000] | M |
| `convex` (wall/floor edge) | **`[R−0.5, R]`** | `2r45` [1.500, 2.000] · `2r90` [1.500, 2.000] · `4r45` [3.500, 3.997] · `4r22.5` [3.459, 3.936] | M |
| `concave` (wall/floor edge) | **`[R, R+0.5]`** | `2r90` [2.000, 2.500] · `2r45` [1.998, 2.497] · `4r45` [4.000, 4.497] · `4r22.5` [3.941, 4.410] · `X` [4.000, 4.500] · `XA` [3.984, 4.489] | M |

Three things fall straight out of this:

1. **The band width is the wall thickness, 0.5, for the edge cases** — the same 0.5 that a
   straight wall has. The system is consistent: a curved wall is a straight wall bent.
2. **The radial floor band is exactly 2 units wide**, at every radius. `2r` degenerates to
   `[0, 2]`, i.e. a quarter disc, because `R − 2 = 0`.
3. **The eight radial measurements land within 0.002 units of the ideal at four different radii
   and four different sweeps.** This is not a fitted approximation; it is the actual design
   rule.

A fourth band exists for separate-wall floors: `[R−1.5, R]` `[M]`, measured on the `s2w`
variants (`6r11.25` [4.505, 6.005], `6r22.5` [4.503, 6.003], `6r45` [4.502, 6.001]) — the
radial floor inset by 0.5 to leave room for its own wall.

### The named curve codes, resolved

| Code | Band | Sweep | Note |
|---|---|---|---|
| `F` | `[0, 2]` | 90° | quarter disc `[M]`. Equivalent to `2r90° radial`; `[W]` `sets/openlock.md` confirms F was renamed to `floor,curved,radial.2r` |
| `V` | `[0, 4]` | 90° | quarter disc `[M]`. `[W]` independently called a "quarter disk" by `github.com/rdolbeau/OpenLOCKTrack` |
| `VxE` | `[2, 4]` | 90° | annular band, **not** a quarter disc — differs from `V` despite identical tags |
| `X` | `[4, 4.5]` | 90° | concave wall band `[M]` |
| `XA` | `[4, 4.5]` | 45° | concave wall band `[M]` |
| `G` | `[2, 2.5]` | 90° | concave wall band, via the rename `[M]`/`[W]` |
| `GA` | `[2, 2.5]` | 45° | inferred `[I]`, unmeasured |

The reason `X`'s radius tag is 4 while it occupies 4.0–4.5 is stated outright in the spec `[W]`
(PS 2022 naming thread): "Curved wall: These are curved walls that are .5" in width … **Their
width x length dimensions are based on the curved floor tile they connect to.**" A curved wall
is named after the *floor* it clips to, not after its own extent. That single sentence
reconciles the tags with the geometry, and it is why the naive reading (radius 4 ⇒ outer radius
4) is wrong for walls and right for floors.

### The radius/angle value sets

`[M]` The task brief lists radius ∈ {2, 2.5, 3, 4, 6} and angle ∈ {11.25, 22.5, 45, 60, 90,
120, 240, 270, 300}. What actually co-occurs is much narrower — **11 combinations, 1,226
tiles**:

| radius | angle | tiles |
|---:|---:|---:|
| 2 | 90 | 365 |
| 2 | 45 | 222 |
| 4 | 45 | 195 |
| 4 | 90 | 181 |
| 4 | 22.5 | 132 |
| 2 | 22.5 | 28 |
| 2.5 | 90 | 27 |
| 6 | 22.5 | 26 |
| 6 | 45 | 22 |
| 6 | 11.25 | 20 |
| 6 | 90 | 8 |

The angles form a bisection ladder: 90 → 45 → 22.5 → 11.25, with the finer subdivisions only
appearing at the larger radii. `[W]` This matches the generator's own vocabulary exactly:
`bases.py` emits `2r90°`, `4r90°`, `4r` at 90/45/22.5, and `6r` at 90/45/22.5/11.25.

**Radius 3 and angles 60, 120, 240, 270, 300 never co-occur with a radius+angle pair.** They
come from elsewhere in the tag space: 60/120/240/300 are hex-corner angles `[S]`
(`corner,60°`… map to `shape|hex`, no radius), and 90/270 are the `IL` corner
concave/convex markers `[S]` on 1×1 cells. **They are not curves.** Treating any
`size|angle` tag as a sweep would place 84 hex/corner tiles as arcs, wrongly.

### Radius without angle is not a curve

`[M]` 165 tiles (1.9%) carry `size|radius` with no `size|angle`, and the catalog gives all of
them `foot: {shape: "arc"}`. They split two ways:

- **84 are the `xG` interface family** (`AxG`/`BAxG`/`QxG`, radius 2.5). Measured: straight
  0.5-thick walls. The catalog's arc footprint for these is simply wrong.
- **81 are `Nr`-tokened pieces with radius but no angle recorded** (radius 6: 36, radius 2: 24,
  radius 4: 18, radius 3: 3). These are recoverable — the filename token carries the sweep —
  but the tag set does not.

---

## 5. Corpus coverage

From `openforge-workshop/public/catalog/catalog.json` (8,702 live records, fixtures at
`428289679a0c62ade992a51ef949f47cdc2b9aed`). Cross-checked against
`/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints/*.json`, which gives 4,043
code-bearing rows across the same 36 codes — a 13-row difference explained by deprecated
entries not present in the live build.

**Codes by tile count.** 4,030 of 8,702 tiles (46.3%) carry a code. The distribution is
brutally top-heavy:

| Band | Codes | Tiles | Share of coded |
|---|---|---:|---:|
| **Load-bearing** (≥100) | `A` 1095, `BA` 519, `Q` 481, `D` 364, `IA` 363, `S` 182, `SB` 153, `I` 108, `SA` 108 | **3,373** | 83.7% |
| Mid (20–99) | `IL` 86, `L` 50, `PC` 45, `O` 43, `PB` 40, `AS` 35, `U` 35, `X` 29, `AxG` 28, `BAxG` 28, `QxG` 28, `IT` 28, `P` 24, `IO` 22 | **521** | 12.9% |
| Long tail (<20) | `XA` 18, `IX` 18, `T` 14, `E` 12, `PA` 12, `A+S` 11, `II` 11, `D+SA` 8, `EA` 7, `R` 7, `F` 6, `V` 6, `VxE` 6 | **136** | 3.4% |
| Zero | `G`, `GA` | **0** | — |

**The five wall-run codes alone (`A` `BA` `Q` `D` `IA`) are 2,822 tiles — 70% of all coded
tiles and 32% of the whole corpus.** Getting `length × 0.5` right is worth more than everything
else in this document combined.

**Footprint primitive classes across the entire corpus**, derived from tags:

| Primitive needed | Tiles | Share |
|---|---:|---:|
| Rect `w × d` | 3,735 | 42.9% |
| Wall run `length × 0.5` | 3,178 | 36.5% |
| Arc sector `(Rin, Rout, θ)` | 1,226 | 14.1% |
| No size information at all | 179 | 2.1% |
| Radius without angle | 165 | 1.9% |
| Column `0.5 × 0.5` | 135 | 1.6% |
| Angle without radius (hex/corner) | 84 | 1.0% |

**Arc modifier coverage** (of the 1,226 arcs): `concave` 549, `convex` 397, `radial` 138,
`concave`+`radial` 6, `interface` 27, **no modifier 109**. Of the 109, 54 are the named codes
`X`/`XA`/`F`/`V`/`VxE` (resolved by measurement above), 33 are plain `Nr θ°` bases and risers
that are radial by their filename token, and 22 carry `curved|angular|left`/`right` instead.
So **all 1,226 are resolvable**, but 109 need a code- or token-level lookup rather than a
modifier read.

---

## 6. What I measured, and how

**Downloads: 84 STL files, 220 MB total**, from
`https://objects.openforge.tools/models/{md5[:6]}/{md5}.stl` with
`User-Agent: openforge-workshop-research/1.0`. (The default `Python-urllib` agent does get
Cloudflare 403/1010, as warned.) I selected the **smallest** file per (code × footprint class)
and per (radius × angle × floor/wall), preferring `plain#base` parts — these are untextured
base plates, typically a few hundred triangles, and their outline *is* the tessellation
footprint, so they are both the politest and the most accurate thing to measure. Three
selection passes (58 + 30 + 24 rows) resolved to **84 distinct files**, 37 of them untextured
`plain#base` parts, with caching so nothing was fetched twice.

Method: axis-aligned bbox over all vertices. Binary STL parsed as 84-byte header + 50 bytes per
triangle; ASCII STL parsed by `vertex` lines. Format detected by `size == 84 + 50·n` rather
than by sniffing the header text — necessary, because several files here are Blender exports
whose 80-byte header begins with the ASCII string `"Exported from Blender-4.0.1"` while the
body is binary. Arc fitting as described in §4. Scripts are in the scratchpad
(`measure.py`, `arcfit.py`, `arcfit2.py`, `arcfit3.py`, `gen.py`); nothing was written into
`src/`, `pipeline/` or `tools/`.

**Confidence:** the untextured plain bases measure to the exact 25.4 mm multiple — 50.80,
76.20, 101.60 — with no residual, which is why I state those figures flatly. Textured tiles
(`dungeon_stone`, `%eroded`, `%block`) run 0.1–1.0 mm under or over nominal because the surface
displacement moves the extreme vertex; where a code's only sample is textured I have said so
and quoted the measurement as-is rather than rounding it to the number I expected.

---

## 7. Contradictions

Stated with numbers, not smoothed over.

**1. `QxG`'s width tag is wrong by a full unit.** Tag `size|width|4` `[S]`; measured **3.000 ×
0.500** `[M]` (`plain#base+curved.QxG.magnetic+flex.stl`, 76.20 mm — an exact 3-unit multiple,
not a texture artefact). Affects 28 tiles. Related: `AxG` measures 1.991 against a nominal 2
(plausibly a real 0.24 mm interface cut) and `BAxG` measures 1.547 against a nominal 1.5
(1.2 mm *over*). The three `xG` codes do not follow a consistent relationship to their base
codes, and I cannot say which of the three tags is intended.

**2. The catalog gives 165 tiles an arc footprint that is not an arc.** All `size|radius`
tiles get `foot: {shape: "arc"}`, including the 84 `xG` tiles, which measure as straight walls
`[M]`, and 81 radius-without-angle tiles whose sweep the tag set does not record. `foot.shape`
counts: `wall` 3,116, `rect` 3,051, `arc` 1,391, `none` 1,144 — but only 1,226 of the 1,391
"arcs" have both a radius and an angle.

**3. `V` and `VxE` have identical tags and different geometry.** Both are `size|radius|4` +
`size|angle|90` + `shape|floor|curved` `[S]`. Measured: `V` = `[0.000, 4.000]`, a full quarter
disc; `VxE` = `[2.000, 4.000]`, a 2-wide annular band `[M]`. The tags cannot distinguish them;
only the code letter can.

**4. `L` and `T` mean one thing in the catalog and something else on the sheet.** In this
corpus `size|openlock|L` comes exclusively from `col+L` (50 tiles, measured 0.5 × 0.5) and
`size|openlock|T` exclusively from `col+T` (14 tiles) `[M]`. On the sheet and in Devon's legacy
filenames, `L` is a 3.0 × 1.0 inch **wall** and `T` is a 4 × 4 curved **floor** `[T]`/`[W]`.
Same letters, disjoint meanings. `I`, `O` and `X` are overloaded the same way *within* the live
corpus — `size|openlock|X` covers 18 arc-band walls and 11 columns simultaneously.

**5. `U` is overloaded inside the tag itself.** 35 tiles carry `size|openlock|U`: 7 are the
4 × 4 floor, and 28 are `Y`/`YA`/`Z`/`ZA` octagon-segment pieces that the scanner deliberately
maps to `U` `[S]`. Likewise `OA` (4 × 4 triangle) is mapped to `size|openlock|O` alongside `O`
(2 × 2 triangle), erasing a 2× size difference in the tag. **`size|openlock` is not a key you
can join on.**

**6. `A+S` and `D+SA` measure deeper than nominal.** Nominal 1.5 `[S]` (a 0.5 wall plus a
1.0 floor); measured **1.753** and **1.892** `[M]`. Each code has exactly one sample in the
corpus and both are protruding bodies (a chimney and a fireplace), so this is probably
model-specific overhang rather than a wrong nominal — but with n=1 each I cannot demonstrate
that, and I am not going to assert it. **Nominal depth for these two: unverified.**

**7. Letters have been reused across OpenLOCK versions.** `[W]` An archived snapshot of
`thing:1882294` (Dec 2016, "OpenLOCK_4.2") lists a *different* wall alphabet: `A` 2.0×0.5,
`AB` 1.5×0.5, `AC` 2.5×0.5, `B` 1.0×0.5, `BA` 1.5×0.5, `BC` 2.0×0.5, `C` **3.0**×0.5, `CA`
2.5×0.5, `CB` 2.0×0.5. Devon's changelog: "12/31/16 – Updated naming convention to match
OpenLOCK"; PS's: v4.3 "clips renamed sequentially". So `C` meant 3.0″ before v4.3 and 2.5″
after, and `EB` was 2.0×1.5 in Nov 2016 and 2.0×2.0 later. **The cheat sheet is version 8.6.
Any dimension taken from a pre-4.3 source is suspect.** This is the most likely explanation for
contradiction 4 as well.

**8. `Y`/`YA` are triangles in one source and octagon segments in another.** `[W]` Legacy
filenames and OpenLOCKTrack describe `Y` as a triangle ("a pair of Y triangle", `YA` 2.0);
`[S]` the scanner tags them `shape|angled|octagon`; `[M]` the one `YA` I measured has bbox
1.531 × 1.848, which is `4·sin 22.5°` by `2·cos 22.5°` — 22.5° geometry, i.e. octagonal, and
definitively *not* a 2 × 2 right triangle (which would measure 2.000 × 2.000). Measurement and
the scanner agree against the legacy source; most likely another generational rename. `Y` and
`Z` themselves remain **unmeasured**.

**9. The task brief's code list does not match the vocabulary.** The brief lists 38 codes
including `Y` `YA` `Z` `ZA`, which are *size tokens* that emit `size|openlock|U`, not codes;
and omits 18 codes that do exist (`AxG` `BAxG` `QxG` `VxE` `A+S` `D+SA` `IT` `L` `S` `SA` `E`
`EA` `R` `F` `V` `T` `X` `XA`). The **38** figure is nonetheless exactly right, by a different
route: the scanner's `sizes` dict can emit precisely 38 distinct `size|openlock` values, of
which 36 occur live. `G` and `GA` are the two that do not.

**10. One STL in the bucket is empty.** `aztlan#column.col+T.side+dragonlock.stl`
(md5 prefix resolvable from the JSON) is **84 bytes: a binary STL header declaring 0
triangles** `[M]`. It is the only `col+T` sample small enough to have been in my selection, so
`T`'s footprint is unmeasured. It is 0.5 × 0.5 by the column rule `[I]`/`[W]`, but I did not
measure it, and the file itself is a data defect worth fixing upstream.

### What I could not determine

- Exact outlines for **`Y`** and **`Z`** (no sample under my size cap), and for `YA`/`ZA`
  beyond their bounding boxes — I have one textured sample each, enough for a bbox but not for
  the polygon.
- The **`PC` run**: measured 3.334; `2√2 + 0.5 = 3.328` is within texture noise but I cannot
  confirm it. `P` = 3.536 = `2.5√2` and `PA`/`PB` = 2.828 = `2√2` are solid `[M]`.
- Whether the **`xG` lengths** (1.991 / 1.547 / 3.000) are intentional or drift.
- **No complete official code→dimension table exists.** Printable Scenery was asked directly on
  its own forum (<https://www.printablescenery.com/forums/topic/letter-code-reference/>) and
  the thread ends unanswered. `openforge-tutorials` explicitly declines to define the letters
  and defers to Printable Scenery. This document is, as far as I can establish, the most
  complete decode in existence — which is precisely why every row is labelled.
- The description text of `thingiverse.com/thing:1833963` itself (403 live; archived snapshots
  are client-rendered shells).

---

## 8. What this changes for the Workshop

### Footprint primitives to implement

Six, and only six:

1. **`rect(w, d)`** — 3,735 tiles (42.9%).
2. **`wallRun(length, thickness = 0.5)`** — 3,178 tiles (36.5%). **The 0.5 thickness is the fix
   here.** A wall is a 0.5-deep rectangle, not a line.
3. **`arcBand(centre, rIn, rOut, startAngle, sweep)`** — 1,226 tiles (14.1%). Derive `rIn`/`rOut`
   from the radius tag and the modifier: `radial` → `[R−2, R]`, `convex` → `[R−0.5, R]`,
   `concave` → `[R, R+0.5]`, `s2w` radial → `[R−1.5, R]`. Fall back to the per-code table for
   `X` `XA` `G` `GA` (concave), `F` `V` (quarter disc, `[0, R]`), `VxE` (`[R−2, R]`).
4. **`column()`** = `rect(0.5, 0.5)` — 135 tiles (1.6%). Gate on `shape|column`, before any
   letter lookup.
5. **`rightTriangle(size)`** — the `O`/`OA` family, in a 2 × 2 or 4 × 4 cell. `[M]` `OA`
   measures 4.000 × 4.000; treat as a 45° diagonal cut of the cell.
6. **`diagonalWall(run = 2√2, thickness = 0.5)`** — the `P` family, 121 tiles. A 0.5-thick wall
   along the diagonal of a 2 × 2 cell.

### Coverage this buys

| | Tiles | Share |
|---|---:|---:|
| Placeable with these six primitives | **8,274** | **95.1%** |
| — of which curved, previously unplaceable | **1,226** | 14.1% |
| Still unplaceable | **428** | 4.9% |

The 428 break down as: **179** with no size information in their tags at all (2.1%); **165**
carrying a radius with no angle (1.9%) — of which 84 are `xG` pieces that are actually straight
walls and can be fixed by a code lookup, leaving ~81 genuinely needing the filename token
parsed for a sweep; and **84** carrying an angle with no radius (1.0%), which are hex corners
(60/120/240/300°) and `IL` corner markers (90/270°) — a *different* geometry family that needs
its own hex primitive, and which must be excluded from the arc path or it will place 84 tiles
as bogus curves.

**So: curves are placeable, by an annular-sector primitive `(rIn, rOut, sweep)` whose band is
determined by the concave/convex/radial modifier.** That is 1,226 tiles, 14.1% of the corpus,
moving from "unplaceable" to "placed exactly" — with the band rule verified to ±0.002 units at
four radii and four sweeps.

### For base aggregation

Two tiles occupy the same tessellation cell iff they have the same **footprint primitive and
parameters** — not the same code. `size|openlock` is unsafe as a join key: it merges `O` with
`OA` (2 × 2 with 4 × 4), merges `U` with `Y`/`YA`/`Z`/`ZA`, merges tile letters with column
letters, and fails to separate `V` from `VxE`. Key on the resolved primitive instead. The
useful corollary is that the footprint is exactly what the untextured `plain#base` parts *are*,
so those parts are the ground truth for cell identity, and 37 of them are in my measurement
set already.

### Two upstream fixes worth filing

- `QxG`'s `size|width` is 4 but the part measures 3.000.
- `AxG`/`BAxG`/`QxG`/`SxG` should not get `foot.shape = "arc"`; `size|radius|2.5` on those
  describes the joint, not the outline.

---

## Sources

Read directly for this document:

- <https://masterworktools.github.io/openforge-tutorials/OpenLOCK_8.6_Ref.jpg> — the cheat
  sheet. Pictorial only, no dimensions.
- <https://raw.githubusercontent.com/MasterworkTools/openforge-tutorials/wiki/docs/index.md> —
  naming convention, 1-inch grid, 0.5-inch walls. (The site's Pages source is the `wiki`
  branch, not `master`. There is no `llms.txt`; it 404s.)
- <https://github.com/MasterworkTools/openforge-tutorials/blob/master/sets/openlock.md> — the
  only page with code→size statements; source of the `G` rename.
- <https://www.printablescenery.com/2017/04/26/openlock-developer-information/> — defines
  "footprint code"; the 1″/25.4 mm statement.
- <https://www.printablescenery.com/forums/topic/proposed-new-naming-convention-for-openlock-system/>
  — the 2022 rename; walls 0.5″ wide, columns 0.5″ × 0.5″, curved walls named after their
  mating floor.
- <https://www.printablescenery.com/forums/topic/letter-code-reference/> — the question asked
  and left unanswered.
- <https://github.com/devonjones/openforge-cut_stone-openlock> — legacy code→inches, from
  filenames.
- <https://github.com/MasterworkTools/openforge-bases/blob/master/lock_openlock.scad> and
  `bases.scad` — clip/port geometry in mm; `basis = [["25mm", 25], ["inch", 25.4], …]`.
- <https://martinnr5.com/2019/10/09/getting-to-grips-with-openforge-part-1/> and
  <https://github.com/rdolbeau/OpenLOCKTrack> — independent community corroboration.
- `/home/finn/Repos/openforge-catalog/openforge/data/__init__.py` — the 163-entry `sizes` dict,
  the closed vocabulary all catalog dimensions originate from.
- `openforge-workshop/public/catalog/catalog.json` and
  `/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints/*.json` — coverage counts.
- 84 STL files from `https://objects.openforge.tools/models/` — every `[M]` figure.
