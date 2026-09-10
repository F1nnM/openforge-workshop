# Accessory mounts: placing torches, doors and lintels where the meshes say they go

**Date:** 2026-09-09
**Status:** implemented 2026-09-10
**Closes:** the "Previews only — a fill can name a recipe's slot, not a file's" line in
`src/builder/panels/slots/AccessorySection.tsx`, and the disagreement it refuses to create
between the room and the parts list.

## The problem

1,005 of the 8,702 live files declare an *accessory slot* — a `torch`, `door`, `lintel`,
`portcullis`, `trapdoor`, … that another file fits into. 1,047 of those 1,244 declarations
are required, so an unfilled one is a hole in the print. Today a placed wall with a torch
slot is drawn without a torch, the bill does not list one, the download does not contain
one, and the picker under **Accessory slots** keeps nothing, because:

- `TemplateInstance.fills` is one level deep — `Record<SlotName, SlotFill>`, a slot *of the
  recipe*. There is no key for a slot *of a file*.
- Nothing says **where** an accessory goes. The composition config says what fits
  (`torch: require interface|torch & part|torch`) and nothing else; the accessory files
  carry `foot: {shape: 'none'}`, no size, `layer: 'insert'`. The catalog's own
  `docs/config-spec.md` scopes the config to `accept/require/deny`. No public prose — wiki,
  Thingiverse, blog, the *New Torch Wall* Patreon post — states an angle, a height or a
  face. Placement is unstated, not contradicted.

So the position has to be **measured**, and the spike of 2026-09-09 measured it. This
spec turns that spike into a build-time tool, a data contract, a store shape, and a
renderer step. Everything below that quotes a number was measured in the spike over a
227-host sample (one per slot × family × footprint × variant) and all 139 insert blobs.

## What the meshes say

- **Accessories are authored in their own frame, not the host's.** `torch.stl` is a
  7 × 7 × 12 mm peg at the origin; doors are 4–9 mm slabs centred on x/y with an
  inconsistent `z_min` (0, 5, 7, 9, 11.5, and negative — some hang from the top). One
  `torch.stl` blob fills all 354 torch slots at three heights on 1- to 4-unit walls, so
  in-place authoring is impossible by construction; the mount **must** come from the host.
- **Hosts are inconsistent in their own frame too** (a cut-stone door wall sits at
  y ≈ 53…66, a dungeon_stone torch wall at y ≈ ±6.4), but `place.ts#tileMatrix` already
  bbox-normalises every mesh, so a mount expressed **relative to the host's bbox** is
  stable.
- **Torch socket** = a 2-pin Dupont connector pocket (the Patreon post; "the connector goes
  fully inside the wall", the torch "sits snug against the wall"): a 5.5 × 3.0 mm slot
  (5.5 × 2.5 on the "tight" variant), ≈ 17–19 mm deep along its axis, axis **62–65° from
  the face normal (≈ 25–28° from vertical), tilting up/out** — the peg goes *down* into the
  wall. Always the `−y` face of the authored wall (`+b` variants: `+y`; pillars: all four
  faces), x centred on the run to ±0.27 mm, entrance **24.5 / 16.2 / 6.85 mm below the
  wall top** for `low` / `mid` / `high` (113 sockets per band over the whole corpus; the
  40-host sample this spec was written from read 23.5 / 16.9 / **10.3**, and the `high`
  figure was the one it got wrong — it over-drew from the taller `arc` hosts, which sit at
  7.7 against a straight wall's 6.5). Identical across dungeon_stone, cut-stone, s_system,
  corners and every curve; 4-unit S-system walls carry **two** (x = ±25.1…25.6) and are
  `wall`-footprint, not `rect`.
- **Openings.** Rectangular door walls are open-topped with a ≈ 33 mm notch = the lintel
  seat (lintels measure 32.8–33.4). The single door leaf (27–28 mm) sits in a 1.5 mm rebate
  on `−y` over a 25 mm opening; `wide` / `double` openings take **two leaves** (2 × 24.6 ≈
  47.5); portcullises run in ≈ 2 mm grooves (27 / 34 / 51 mm openings for 31.8 / 37.5 /
  55.8 mm slabs). Doors are pin-hung in the doorway (Thingiverse 2823497).
- **Floors.** Trapdoor / grate / brazier slots are through-holes (19.5 × 18, 35–85, Ø36–40).
- **Curved walls are authored with the arc centre at the mesh origin** (49–58 % of
  mid-height vertices sit on one of the two nominal radii from (0, 0); an algebraic circle
  fit lands in the slab and is wrong).
- One fixture error found: `dungeon_stone%eroded#wall,door+rectangular+narrow.A.openforge,
  side.stl` carries `door` + `lintel` slots but is one piece with the door modelled in.

Final detector hit rates **over the whole corpus** (1,130 objects, 16.34 GB, 0 read
failures, 2026-09-10): 995 hosts yielding **1,301 mounts** — 702 opening, 438 socket, 55
pocket, 78 surface, 28 hole — and 139 anchored inserts. Of the **1,230 slots** the host
blobs declare, **1,183 resolved (96.2 %)**; torch sockets are **344 / 356**.

The 47 that did not resolve each say why, and they are five known shapes rather than a
tail: **14 `arc-fit-refused`** (convex 2r45 and concave 2r90 walls whose mesh is not struck
from the radii their tags name), **12 `no-socket`** — the ten round `dungeon_stone` and two
square `cut-stone` full pillars, whose bore sits on a curved or chamfered face the 0.5 mm
axis-aligned depth map cannot resolve into a clean 5.5 × 3 mm mouth — **12 `modelled-in`**
(the fixture error above and four sibling door walls, `door` + `lintel` each, plus a
catacombs loculus and a ruined archway), **6 `runs-off-end`** (the `dormer+window` roof
run, which has no jamb to hinge against) and **3 `no-opening`**.

## Shape of the change

Four parts, in dependency order. Each is one PR-sized unit and the first two ship value
on their own (a linted inventory and a richer index).

```
tools/mounts/  ──▶  pipeline/mounts/inventory.json  ──▶  pipeline join  ──▶  catalog.json
                                                                                │
                            store `holds` ◀── AccessorySection picker           │ mounts / anchor
                                  │                                             ▼
                     resolve/bill/download ◀── PlanPiece.accessories ◀── canvas/catalog.ts
                                                       │
                                              buildRoom3D: one more instance per mount
```

### 1. `tools/mounts/` — the measuring pass

TypeScript under `tsx`, `npm run mounts`, the shape of `tools/measure/`: `catalog.ts`
(targets), `fetch.ts` **imported** from `tools/measure/fetch.ts` (identifying User-Agent,
md5-of-content verification, concurrency ≤ 8), a JSON-lines log that *is* the resume
state, a sidecar rebuilt from the log, and a `--inventory` mode that writes the checked-in
file the build reads.

**Targets.** Hosts: every live record whose `config.parts` has a name other than `base` —
1,005 records, **995 distinct blobs, ≈ 15 GB**. Inserts: every `layer: 'insert'` record —
285 records, **139 distinct blobs, ≈ 1.35 GB**. Both keyed on the blob; a measurement is a
property of the bytes, and 171 md5s are shared by 520 rows.

**The detector, per host** (the spike's, unchanged in substance):

1. Parse the STL (`src/three/stl/parse.ts`, as `measure` does). Record the bbox.
2. If the footprint is an `arc`: fit the centre starting from the origin against the
   footprint's `rIn` / `rOut` (× 25.4 mm) with a few Gauss–Newton steps to whichever nominal
   radius each mid-height point is nearer; **refuse** the host (`arc-fit-refused`) when
   fewer than 40 % of those points land within 1 mm of a nominal radius. Unroll to
   `(u = arc length at the mid radius, w = r − r_mid, z)`; every later step runs in that
   frame and results are re-rolled.
3. **Depth map**, 0.5 mm cells, per axis: cast the grid through the mesh and keep per
   column the first hit from each side and the hit count (vectorised over `(triangle,
   cell)` pairs with a barycentric test — no BVH).
4. **Openings** through the thin axis: empty columns bounded by the wall's *top line* (90th
   percentile of per-column topmost hits) and its ends, connected components ≥ 60 mm² and
   ≥ 8 mm both ways. Width is the **row-median** run (immune to the slivers a textured
   shoulder leaves under the top line), `sill` / `head` from the body rows, `open_top` when
   the body reaches the top line.
5. **Pockets** on the four side faces: depth against a **12.5 mm local median baseline**
   (not a global plane — a capital's underside or an S-system floor plate is then its own
   surface). A **tilt sweep** −75°…75° in 5° steps about the in-face horizontal axis; at
   each angle every component ≥ 8 mm² with both entrance dimensions ≥ 2.5 mm, neither
   > 12 mm, and depth ≥ 6 mm is a candidate; candidates are clustered by entrance (4 mm)
   and the deepest-mean per cluster kept. Entrance and bottom are read off the hit points
   and rotated back, so the axis is a measured line, not the sweep step. Any pocket whose
   entrance lies within 3 mm of an opening's box is dropped (a tilted ray grazing a jamb
   reads as a pocket).
6. **Floor holes** through z: as openings, on hosts with a `rect` footprint under 15 mm
   tall, excluding components that reach the silhouette edge (a diagonal cut is not a hole).
7. **Match mounts to slots** by a class table, then a signature:

   | slot names | class | signature |
   | --- | --- | --- |
   | `door`, `lintel`, `portcullis`, `archway`, `frame`, `shutters`, `window`, `grate door`, `grate` on a wall, `arch`, `grate (left/right)` | `opening` | **every** opening on the thin axis (a double window wall has two, and `frame` / `shutters` fill both); a `lintel` shares the `door`'s opening(s) |
   | `torch` | `socket` | 5–6.5 × 2–3.5 mm, 58–68° from the normal, ≥ 12 mm deep; **every** match is a mount |
   | `trapdoor`, `grate` on a floor | `hole` | the largest non-edge through-z component |
   | `treasure` | `pocket` | the deepest pocket on either big face at 0° tilt, 8–14 mm across |
   | everything else (`statue`, `beam`, `brace`, `support`, `top`, `slab_*`, `fracture slope`, `broken_section`, `crosshead`, `brazier`, `brazier_base`) | `surface` | not measured: the host's top-face centre, axis +z |

   **`brazier` and `brazier_base` are `surface`, not `hole`, and `crosshead` appears once.**
   Both were amended to the code after review (2026-09-10). A brazier's bore is centred on
   the top face of its floor, so the `hole` detector's answer and the top-face centre are
   the same point to within the plate's thickness — and `surface` is the one class that
   always resolves, where a `hole` that the depth map misses drops the mount altogether.
   `crosshead` was listed under both `opening` and `surface`; it is a `surface`.

   A slot with no match is **absent** from the inventory and present in the report with a
   reason: `no-opening`, `no-socket`, `no-hole`, `arc-fit-refused`, `runs-off-end` (an
   opening touching the wall's end), `modelled-in` (an `opening`-class slot on a host with
   no through-column at all — the fixture error).

**Per insert:** bbox and an **anchor** — `kind` and the point/axis the consumer aligns:

Tried in this order — **leaf, plate, peg, block** — because the tests are not exclusive
and the earlier kinds are the more specific claims:

| kind | rule | anchor point | axis |
| --- | --- | --- | --- |
| `leaf` | one axis ≤ 10 mm, both others ≥ 10 mm | bottom-centre of the slab | the thin axis |
| `plate` | triangles flat on one bbox face cover ≥ 50 % of it and ≤ half that on the opposite face | that face's centre | that face's normal, into the plate |
| `peg` | two smaller axes within 1.5×, long axis ≥ 1.4× the middle and ≤ 40 mm | base-flange centre (the wide end) | the long axis, base → tip |
| `block` | the rest | bottom-centre | +z |

**`plate` before `peg`** was amended after review (2026-09-10): `torch_plate.stl` is
7.5 × 8.9 × 13.5 mm and satisfies both rules, and peg-first anchored it on the end of its
long axis rather than on the flat back it presses against the wall — which left the
`socket` + `plate` row below with nothing in the corpus to exercise. Measured over all 139
inserts the order moves two of them: `torch_plate.stl` becomes a `plate`, and `torch.stl`
— a flat base under an unflat head — becomes one too, with the **identical** `at` and
`axis` it carried as a peg, so nothing about the 354 torch slots renders differently. The
remaining two pegs are the `brazier+small` blobs.

(The insert subagent's measurement: at ≤ 10 mm every `part|door` file is a `leaf`; 33 of
33 lintels are `plate` or `leaf`. Final kinds over the corpus: **117 leaf, 13 block,
7 plate, 2 peg**.)

**Run mechanics.** Fetch and parse on the main thread; the depth-map work — ~40 s per
host on one core for the sweep — in `worker_threads`, one per core. ≈ 1 h for the whole
pass on 12 cores, once. Resumable at blob granularity through the log; `--retry-failed`;
`--sample N` for a stratified subset; `--dry-run` for the target table and byte totals;
`--report` rebuilds the sidecar; `--inventory` writes `pipeline/mounts/inventory.json`.
Exit codes as `measure`: 0 / 1 / 2.

**Output.** `pipeline/mounts/inventory.json`, checked in beside `thumbs/inventory.json`,
blob-keyed, with `version`, `measured` (ISO-8601), `tool` and `catalog` stamps:

```jsonc
{
  "hosts": {
    "<md5>": {
      "bbox": { "min": [x, y, z], "max": [x, y, z] },          // mesh mm, Z-up
      "arc":  { "centre": [x, y], "onRadius": 0.57 },          // arcs only
      "mounts": [
        { "slot": "torch", "kind": "socket", "face": "-y",
          "at": [x, y, z], "axis": [ax, ay, az], "section": [5.5, 3.0], "depth": 17.2 },
        { "slot": "door",  "kind": "opening", "face": "-y",
          "at": [x, y, z], "width": 25.0, "sill": 10.5, "head": 50.0, "openTop": true, "leaves": 1 },
        { "slot": "lintel", "kind": "opening", ... "leaves": 1 },
        { "slot": "trapdoor", "kind": "hole", "face": "+z", "at": [x, y, z], "size": [19.5, 18.0] },
        { "slot": "treasure", "kind": "pocket", "face": "-y", "at": [x, y, z], "axis": [0, 1, 0], "section": [9.0, 9.0], "depth": 9.6 },
        { "slot": "statue", "kind": "surface", "face": "+z", "at": [x, y, z] }
      ],
      "unresolved": [{ "slot": "door", "reason": "modelled-in" }]
    }
  },
  "inserts": {
    "<md5>": { "bbox": {...}, "anchor": { "kind": "peg", "at": [x, y, z], "axis": [0, 0, 1] } }
  }
}
```

`at` is in **host bbox coordinates**: x and y from the bbox centre, z from the bbox
bottom, millimetres, Z-up — the frame `tileMatrix` produces after `stand` and `toOrigin`,
up to the axis swap (`(x, y, z) → (x, z, −y)`). For an `opening`, `at` is the centre of the
opening's body at mid-thickness; for a `socket`, the entrance centre on the face; for a
`hole`, the centre on the top face. `leaves` is 2 when the slot's `require` carries
`size|wide` or `size|double`, else 1.

**Tests.** Unit tests over **synthetic STLs written by the test** — a box with a 65° slot
of known entrance and depth, a box with an open-topped doorway of known width/sill/head
and a notch, a flat plate with a hole, a 90° arc segment with a slot — each with an exact
expected answer within 0.5 mm / 1°, so nothing needs the network. A corpus test over the
checked-in inventory asserts the conventions: every torch host has ≥ 1 socket in 58–68°
with |x| ≤ 0.5 mm; socket heights fall in three bands by `component|torch|{low,mid,high}`;
door openings fall in the class bands; the fixture error is reported as `modelled-in`.
`docs/verify-catalog-facts.py` gains the four counts this document quotes (hosts, host
blobs, insert blobs, slots by class).

### 2. Pipeline join — `mounts` and `anchor` on the record

`pipeline/mounts.ts` reads and validates the inventory (Zod, like `thumbs.ts`) and
`BuildOptions` gains a **required** `mounts: MountInventory` for the same reason `thumbs`
is required there: "so that 'no mount' and 'nobody asked' cannot be confused".
`tools/stamp/lock.ts` passes an empty inventory — a measurement is input, not derivation.

`CatalogRecord` gains two optional fields, both keyed off the blob:

- `mounts?: Mount[]` on hosts — the inventory's `mounts` with `at` already in bbox
  coordinates, so the browser never sees the raw bbox.
- `anchor?: InsertAnchor` on inserts.

`SCHEMA_VERSION` 4 → 5 (fields were added). `PIPELINE_VERSION` is unchanged: the emitted
`{tags, records}` with an empty inventory is byte-identical to today's, which is what the
lock digests. The importer asserts the brotli budget as it does now; expected cost is
≈ 1,300 mounts × ~60 B raw, under 20 KB brotli against 133 KB of headroom.

The join also emits the report's `unresolved` list to stderr as a **fixture lint** — the
importer already prints derivation warnings, and a `door` slot on a wall with no opening is
exactly the kind of thing the person running `npm run stamp` should see.

### 3. Store — a hold is a fill of a fill

`SlotFill` gains one optional field:

```ts
export const SlotFill = z.object({
  tile: TileId,
  pinned: z.boolean(),
  /** Accessory fills of *this file's* composition slots, keyed by the slot name. */
  holds: z.record(HoldName, SlotFill).optional(),
})
```

One level, and `holds` on a hold is **refused at write time** (14 of the 285 inserts carry
a config of their own; an accessory's accessories are out of scope, and are counted, not
filled). `HoldName` is `z.string().min(1).brand<'HoldName'>()` — the same argument
`SlotName` makes: the meaning check belongs to whoever holds the config.

Actions, mirroring the four that exist: `fillHold(id, slot, hold, tile)` (pinned false),
`pinHold(...)` (pinned true), `clearHold(id, slot, hold)`, `unpinHold(...)`. `clearFill` and
a re-solve that replaces the *host* file drop its holds — a hold is a fill of that file, and
the new file re-solves its own. `STORE_VERSION` 8 → 9; the 8 → 9 rung is the identity
because `holds` is optional. It is the first rung ever written: the discard licence in `migrations.ts` ends "the moment a
build of this app is served to a user who is not a developer", and the app has a public URL
now, so `migrations.ts`'s notice is updated to say the licence has expired.

**Default holds.** Placing or re-solving a host file that declares **required** accessory
slots fills them the way `fill.ts` fills template parts: the first candidate under the
composition index (`@/screens/detail/slots`' `slotStates`, which already applies
`constrain`), preferring the room design, then ascending address; `pinned: false`.
Optional slots stay empty. The lock preference does not enter — inserts carry
`conn: []` — so `relock.ts#reSolveScene` leaves holds alone unless the host fill itself
changed.

**Share payload.** `SHARE_FORMAT_VERSION` 5 → 6. Per fill, one more uvar (hold count),
then flat hold columns instance-major: hold-name index into the existing slot-name table
(hold names are words like slot names), file ordinal, and the holds' pinned bits as a
bitset of their own. A v5 link decodes as before with zero holds. `payload.test.ts`'s
exact-byte assertions are updated, and the price-table tests are re-run rather than gated
(they are the accepted cost of that file).

Amended after review (2026-09-10): **one further bitset, one bit per fill**, after the hold
pinned bitset, saying that the fill carried an explicit `holds` map with **nothing in it**.
Zero holds is two states of a fill — `{}` (*the user took the last torch out*) and
`undefined` (*never solved*, which the recipient's default-hold pass fills in) — and a
count cannot tell them apart, so a deliberately emptied wall arrived with its accessory put
back. Format 6 is unshipped, so it is extended in place rather than bumped. It is the last
column, so v5 decode is unchanged: no bit, `undefined`. It costs ⅛ byte per fill, which
takes the room-shaped capacity from 6,956 instances under format 5 to **6,680** (a one-fill
payload from 224 bytes to 226) and leaves the scattered figure at 80.

### 4. Assembly, bill, download

`resolve.ts#readFills` walks `template.parts` today; it additionally walks each fill's
`holds`, producing an `AssemblyPart` per hold with `slot` = the recipe slot and a new
`hold: HoldName`. `BillSlotRef` gains the same optional `hold`. **Quantity is the number
of copies drawn** — `Σ copiesOf(mount, insert.anchor)` over `mountsFor(host, hold)`, and
`copiesOf` lives in `catalog/mounts.ts` because the renderer and the bill must not count
separately (`@/assembly` may not import from `@/builder`, so a shared module in `@/catalog`
is the only place one answer can live). A hold on a host with four sockets is four torches
in the bill and four files' worth of bytes — the print needs four — and a hold in a single
`wide` doorway is **two**, because that one opening takes two half-leaves. Amended after
review (2026-09-10): the mount count under-billed all 85 two-leaf doorways by one leaf
each. A hold whose host has no measured mount for that
slot counts once and is listed under `BillOfTiles.unplaced` (new; sibling of `unfilled`)
so the room and the bill still agree about what will be drawn. Required accessory slots
with no hold appear under the existing `unfilled` with `hold` set. The download plan builds
from bill lines, so accessories reach the ZIP with no change there.

### 5. Plan projection and rendering

`canvas/catalog.ts#parts` is unchanged for the plan: an insert has `foot: none` and draws
nothing in 2D — it sits inside the host's footprint. `PlanPiece` gains
`accessories: readonly PlanAccessory[]`:

```ts
interface PlanAccessory {
  readonly slot: SlotName          // the recipe slot whose fill holds it
  readonly hold: HoldName
  readonly fill: SlotFill
  readonly record: CatalogRecord   // the insert
  readonly host: PlanPiecePart     // the part it is mounted on
  readonly mount: Mount            // one of host.record.mounts, matched on slot name
  readonly index: number           // which of the slot's mounts (pillar face 0..3)
}
```

One entry per (hold, mount). `buildRoom3D` walks `piece.accessories` after `piece.parts`
and adds an instance to the insert's blob group with

```
M_accessory = M_host_room · T(mountLocal) · R(mountAxis) · A⁻¹ · stand
```

where `M_host_room = lift · toPlan · turn` — the host's `tileMatrix` without its
`toOrigin · stand` (already folded into the mount frame), plus the host's `liftMatrix`
elevation, so an accessory rides on a base-lifted wall, `mountLocal = (at.x, at.z,
−at.y)` — the mount's bbox coordinates through the same axis swap `uprightBounds` applies —
`R(mountAxis)` is **two rules, not one**, and `A⁻¹` brings the insert's anchor point to
the origin.

**A `socket` or a `pocket` is posed by the anchor's axis**, because a peg's axis is its
pose: +Y goes to the reversed socket axis, and the remaining roll is chosen so the insert's
own +z stays as close to world up as possible (the torch flame points up).

**An `opening`, a `hole` or a `surface` is posed by the insert's bbox extents**
(`anchor.size`), and this was amended after review (2026-09-10): a `leaf`'s axis is its
*thinnest* bbox axis, which is the through-wall direction for a door (28 × 4 × 35.5 — thin
is the depth) and the **height** for a lintel (`door_lintel.1.stl` is 32.84 × 12.99 × 6.09
— thin is the height), so aiming it at the surface normal laid all 131 `lintel` mounts on
their side. An insert is authored Z-up, so the extents cannot be wrong that way: the mesh's
+z stays world up, the **longer** of its two horizontal extents is the span and the
**shorter** is the through-wall axis. For an `opening` the through axis is yawed onto
±`normal` — the sign from `anchor.axis` when the anchor axis *is* that mesh axis (a door's
declared `+thin`), else `+normal` — and the span therefore lands across the face. A `hole`
or a `surface` takes no rotation at all. There is no roll step on these three: the vertical
is fixed by the extents and the yaw by the normal.

| mount | anchor | where |
| --- | --- | --- |
| `socket` | `peg` | base-flange centre on the entrance, axis along the socket axis (the torch leans 25–28° out) |
| `socket` | `plate` | plate centre on the entrance, normal into the wall — `torch.stl` and `torch_plate.stl` are both `plate`s |
| `opening`, 1 copy | `leaf` / `plate` / `block` | anchor point at `(at.x, sill, at.y)`, shorter horizontal extent through the wall |
| `opening`, 2 copies | `leaf` | two instances at `at.x ± width/4`, the second turned 180° about vertical so its face shows |
| `opening` + `lintel` | `leaf` / `plate` / `block` | anchor point at `(at.x, head, at.y)` — it sits on the head of the opening, one piece however many leaves the doorway takes |
| `opening` + `portcullis` | `leaf` | as a single leaf, bottom at `sill` |
| `pocket` | `block` / `peg` | anchor point on the entrance, axis into the wall |
| `hole` | any | anchor point at the hole centre on the top face, unturned |
| `surface` | any | anchor point at the top-face centre, unturned |

**Two copies is `copiesOf`, not `leaves`.** `leaves: 2` says *the doorway is authored for
two leaves*, which is not the claim *this insert is one of them*: the same 47.5 mm opening
takes two 24.6 mm leaves or **one** 60.85 mm `door_lintel.double.1.stl`, both `leaf`-kind.
So the second copy is drawn only for a `leaf` whose span is under 80 % of the opening — the
measured gap is 52 % against 109–128 % — and the count, the offset and the bill's quantity
are all that one function.

Blob groups are what they are today, so an insert used on twenty walls is one
`InstancedMesh`; `roomBlobs` includes accessory blobs so `useLodStore` fetches their
GLBs — which already exist in the LOD store (checked: `door.wooden` 4.6 KB, `torch` 28 KB).
Material resolution goes through the same `options.resolve(record)`; inserts with no
texture tag land in `@/materials`' filename-hint / part-tag stages (`torch_plate` → metal)
which exist for exactly them.

The footprint-disagreement report is skipped for inserts (they have no footprint to
disagree with). `Room3D` gains `unplaced`: holds drawn nowhere for lack of a mount — the
same list the bill shows, derived once in `canvas/catalog.ts` and consumed by both.

### 6. Editing

`AccessorySection` keeps its inventory and its picker; the picker's `onPick` now writes
`pinHold` / `clearHold` and the "Previews only" line is deleted. The holder rows show the
mount count when it is more than one ("× 4 faces") so the quantity in the bill is not a
surprise. Nothing is added to the right-click `SlotEditor`; accessories have one home.

## What is deliberately not in this design

- **Accessories of accessories** (14 inserts with their own config). Counted in the
  inventory report; not filled, not drawn.
- **A second, sharper socket detector.** The spike's interior-plane box-cavity fit lands the
  entrance ≈ 1 mm sharper but only for box cavities and needs no tilt sweep. Left out; the
  preview does not resolve a millimetre.
- **Runtime measurement in the browser.** Hosts are 6–28 MB STLs; the LOD GLBs are
  decimated and would lose a 5.5 mm pocket.
- **A hand-authored mount table.** 15 host directories × 3 heights × N lengths, and it would
  still need the meshes open to write.
- **Unit-cell placement of the *lintel* by its own opening** — it seats on the door's head;
  one opening, two slots.

## Risks

- **The measuring pass reads 16 GB from a bucket the project does not own.** Once,
  resumable, at ≤ 8 concurrent, with the same identifying agent `measure` uses. The result
  is checked in; nobody re-runs it without a reason.
- **`at` depends on the source STL's bbox and the renderer uses the LOD's.** Decimation
  preserves extents to within ~0.1 mm (`tools/lod` measures this); the contract test in
  `builder/three/contract.test.ts` gains a bbox-agreement check against the fixture GLB.
- **Two leaves turned rather than mirrored.** A mirror flips winding; a half-turn shows the
  leaf's back on one side of a double door. Acceptable for a preview and stated.
- **The 8 → 9 store rung is the first ever written.** It is the identity; the test is that a
  v8 blob hydrates with every fill intact and no `holds`.

## Verification, end to end

1. `npm run mounts -- --sample 40` reproduces the spike's numbers on the sample (angle
   band, heights, widths) — the corpus test asserts them.
2. `npm run import:catalog` emits an index under budget with `mounts` on 1,005 records and
   `anchor` on 285, and prints the `modelled-in` lint for the one known fixture error.
3. Place a `dungeon_stone` torch wall: a torch appears on the `−y` face, leaning out, at
   the height of the `low` / `mid` / `high` variant; the bill lists `torch.stl × 1`; the
   ZIP contains it. Place a 1×1 full pillar: four torches, bill × 4. Place a rectangular
   door wall: a leaf in the opening and a lintel on its head; `wide`: two leaves.
4. Share the room; the link round-trips with holds; a pre-change link still decodes.
5. `mise run check` green; `docs/verify-catalog-facts.py` green with the four new counts.
