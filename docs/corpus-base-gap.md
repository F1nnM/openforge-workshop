# The missing-base gap

**385 of the 4,363 `connection|openforge` toppers (8.8%) resolve to no base line item.** §2's
hard rule is that every openforge piece gets one, so each of those is a piece the builder puts on
the grid with nothing underneath it. This note is the corpus side of row **D5**: what the gap is,
which tiles are in it, and which part of it is an archive gap somebody could close.

Everything here was measured by running the shipped resolver
(`src/assembly/resolve.ts#resolvePlacement`) over every topper in `public/catalog/catalog.json`,
once per lock preference. `src/assembly/assembly.test.ts` re-runs the measurements, so the split,
the nine size codes and the shape of the 21 fail the suite rather than sitting stale here.

**The gap was 594 (13.6%) when this row opened, and row W3 closed 209 of it.** D5 was written
against the pre-W3 footprint classifier, where the split was **129 / 21 / 444**. W3 makes
`hasCurveMarker` segment-exact and reclassifies 403 corpus tiles out of `foot.shape === 'none'`;
the whole of that gain landed in the third bucket, taking it 444 → 235, and the 129 and the 21 did
not move by one tile. That is the expected behaviour and worth stating: size codes come from tags
rather than footprints, and the 21 are `rect` shapes the curve classifier does not touch. **The
part of this gap that is an archive gap is exactly the part W3 could not help with.**

> **Filing this upstream is the project owner's call, not this row's.** No issue has been opened
> on `openforge-catalog`, `openforge-bases` or any other repository. The tables below are written
> to be actionable by whoever decides to act.

## The three-way split

The classification is not a heuristic over the data; it is the resolver's own three failure
paths, one note code each (`missingBaseNote`):

| tiles | note code | the failing step | whose problem |
| ---: | --- | --- | --- |
| 129 | `no-matching-base` | the topper publishes a `size|openlock` code and **no base carries that code** | **the archive.** A base that should exist does not |
| 21 | `no-congruent-base` | no size code, a derivable footprint, and **no base is congruent to it** | **geometry.** No base can carry the shape |
| 235 | `base-unmatchable` | **neither key** — no size code and `foot.shape === 'none'` | **the topper's metadata.** Nothing to search bases by |

The split is **identical under `openlock`, `dragonlock`, `magnetic` and no preference at all**:
3,978 toppers get a base under every one of them, 385 under none of them. That is the fact which
says the gap is a property of the corpus rather than of the ranking — row D1 re-ranked base
candidates on suitability and moved the topless rate under openlock from 79.1% to 0 without
moving this number by one tile.

The three are surfaced separately in the bill panel, with three different sentences, by
`src/builder/panels/billView.ts#noteCopy`. A single "no base found" warning would tell 129 people
they had made a mistake, 21 people to go looking for a base that cannot exist, and 235 people
nothing at all.

## 1. The archive gap — 129 toppers, nine size codes

These are the ones worth filing. The topper names a size code, the code is a functional
determinant of width with zero exceptions across 2,822 tiles (`src/assembly/sizeCode.ts`), and
the base side of the corpus simply has no member of that family: **26 codes appear on bases
against 27 on toppers**, and nine topper codes have no base at all.

| code | tiles | footprint | side lock | texture | build |
| --- | ---: | --- | --- | --- | --- |
| `PC` | 23 | wall 2 23 | openlock 10, pegs 5, none 10 | dungeon_stone 23 | separate wall 23 |
| `L` | 20 | `none` 20 | filament 8, openlock 8, dragonlock 4 | aztlan 5, cut-stone 5, dungeon_stone 5, towne 5 | s2w 20 |
| `PB` | 20 | wall 2 20 | openlock 10, pegs 4, none 8 | dungeon_stone 20 | separate wall 20 |
| `IO` | 16 | rect 1×1 16 | openlock 5, none 11 | dungeon_stone 8, dwarven_halls 6, mine 2 | s-system 8, thick wall 8 |
| `IX` | 16 | rect 1×1 16 | openlock 5, none 11 | dungeon_stone 8, mine 6, dwarven_halls 2 | s-system 8, thick wall 8 |
| `P` | 12 | wall 2 12 | openlock 6, pegs 2, none 5 | dungeon_stone 12 | separate wall 12 |
| `II` | 11 | rect 1×1 11 | openlock 4, none 7 | dungeon_stone 8, mine 3 | s-system 8, thick wall 3 |
| `PA` | 6 | wall 2 6 | pegs 1, none 5 | dungeon_stone 6 | separate wall 6 |
| `O` | 5 | rect 2×2 3, rect 4×4 2 | none 5 | dungeon_stone 4, rough_stone 1 | untagged 4, separate wall 1 |

Read as shapes rather than codes, it is four families:

- **The right-angled wall run — `P`, `PA`, `PB`, `PC`, 61 tiles.** Every one a `wall 2`
  footprint, all `dungeon_stone`, all `build|separate wall`, and 27 of them doors or windows.
  This is the largest single hole and the most conspicuous: an angled wall corner is a piece
  people reach for, and there is no angled base under any of them.
- **Corner columns — `L`, 20 tiles.** Four textures × five variants, all `build|s2w`, and all
  with `foot.shape === 'none'`, so the footprint fallback cannot rescue them either.
- **S-system corners — `II`, `IO`, `IX`, 43 tiles.** All `rect 1×1`. Bases *do* cover
  `rect:1x1` (119 of them), so these fail only because `candidatesFor` keys on the size code and
  never falls through to the footprint — deliberately, see below.
- **`O`, 5 tiles.** Right-angled floors. Zero bases carry `O`, so all five are here whatever
  else is true about the code — see the D4 interaction below.

### Why the coded toppers do not fall back to a footprint match

`candidatesFor` uses the size code **or** the footprint, never both: a topper that publishes a
code has told us which base family it belongs to, and answering with a merely congruent base
would report a different question as a success. 109 of these 129 carry a `rect` or `wall`
footprint that bases *do* cover, so a fallback would make the warning disappear and hand out a
base from the wrong family. The gap is surfaced instead. That decision is `resolve.ts`'s and row
**D4** re-opens the key question; it is not changed here.

## 2. No base can carry the shape — 21 toppers

No size code, a real footprint, nothing congruent. Two distinct reasons, and neither is an
oversight:

- **17 half-unit strips** — `rect:0.5x2` ×14 and `rect:0.5x1` ×3, every one a riser or a set of
  stairs. The 16 `rect` footprints the bases cover start at a full unit
  (`1x1, 1x2, 1x3, 1x4, 1.5x2, 1.5x3, 2x2, 2x3, 2x4, 2x8, 3x3, 3x4, 4x4, 4x6, 6x6, 8x8`), so
  **no base in the archive is half a unit wide** and none could be without being a new kind of
  object. Nothing to file.
- **4 `rect:2x6` slabs** — two celtic-knot floors and two cave entrances. Here the range does
  hold neighbours: `2x4` and `2x8` both exist, `2x6` does not. This is the one part of the 21
  that is arguably a real omission, and it is four tiles.

All 21, in full:

| tile | footprint |
| --- | --- |
| `tiles/dungeon_stone/misc/risers/risers/dungeon_stone#riser+high.1x0.5.openforge.stl` | rect 1×0.5 |
| `tiles/dungeon_stone/misc/risers/risers/dungeon_stone#riser+low.1x0.5.openforge.stl` | rect 1×0.5 |
| `tiles/dungeon_stone/misc/risers/risers/dungeon_stone#riser+platform.1x0.5.openforge.stl` | rect 1×0.5 |
| `tiles/cut-stone/misc/risers/risers/cut-stone#riser+high.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/cut-stone/misc/risers/risers/cut-stone#riser+low.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/cut-stone/misc/risers/risers/cut-stone#riser+medium.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/cut-stone/misc/risers/risers/cut-stone#riser+platform.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/cut-stone/misc/stairs/stairs/cut-stone#stairs+high.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/cut-stone/misc/stairs/stairs/cut-stone#stairs+low.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/cut-stone/misc/stairs/stairs/cut-stone#stairs+medium.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/dungeon_stone/misc/risers/risers/dungeon_stone#riser+high.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/dungeon_stone/misc/risers/risers/dungeon_stone#riser+low.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/dungeon_stone/misc/risers/risers/dungeon_stone#riser+mid.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/dungeon_stone/misc/risers/risers/dungeon_stone#riser+platform.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/dungeon_stone/misc/stairs/stairs/dungeon_stone#stairs+high.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/dungeon_stone/misc/stairs/stairs/dungeon_stone#stairs+low.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/dungeon_stone/misc/stairs/stairs/dungeon_stone#stairs+mid.2x0.5.openforge.stl` | rect 2×0.5 |
| `tiles/cave/thick_wall/cave_entrance/cave#cave_entrance+squares.6x2.openforge.stl` | rect 6×2 |
| `tiles/cave/thick_wall/cave_entrance/cave#cave_entrance.6x2.openforge.stl` | rect 6×2 |
| `tiles/cut-stone/floors/floor+celtic_knot/cut-stone#floor,celtic_knot+straight.6x2.openforge.stl` | rect 6×2 |
| `tiles/dungeon_stone/floors/floor%block+celtic_knot/dungeon_stone%block#floor,celtic_knot+straight.6x2.openforge.stl` | rect 6×2 |

## 3. Nothing to match on — 235 toppers

No size code and no derivable footprint: `foot.shape === 'none'` for every one of the 235, which
is also why the plan view cannot draw them. There is no base to file for, because nothing states
what shape of base to look for. What they are:

| dimension | distribution |
| --- | --- |
| kind | floor 128, untagged 62, wall 45 |
| build | `wall on tile` 227, `thick wall` 8 |
| texture | dungeon_stone 203, cut-stone 24, cavern 8 |

227 of the 235 are `build|wall on tile`, which is the same population `resolve.ts`'s rule 3 warns
about from the other direction: a build-tag join would find nothing for any of them, because zero
bases carry that tag.

**This is the bucket row W3 emptied most of.** It was 444 against the pre-W3 classifier; giving 403
tiles a real footprint gave 209 of these toppers a candidate set. What is left is a footprint
question rather than a base question, which is why it is not the part that gets filed.


## The D4 interaction, observed and not fixed

`size|openlock|O` is carried by 43 records — 34 with no derivable shape, 5 `rect 2×2` and 4
`rect 4×4` — so the code is *not* a functional determinant of footprint, which is what row **D4**
exists to fix. Only 5 of the 43 are toppers; the other 38 are `integral` pieces that need no base.

It touches this gap in one specific way: **zero bases carry `O`**, so all five `O` toppers land in
the 129 whatever is decided about the ambiguity. If D4 re-keys on the resolved primitive as its
row says, those five stop being `no-matching-base` and become a `rect:2x2` / `rect:4x4` footprint
match, which bases do cover — 150 and 90 respectively. The 129 in this note is therefore measured
against the join key as it stands, and will need re-measuring after D4. Nothing in this row
changes `sizeCode.ts` or the key.

## If somebody does file this

The actionable request is one sentence: **bases for nine `size|openlock` codes — `P`, `PA`,
`PB`, `PC` (angled wall run, 61 tiles), `L` (corner columns, 20), `II`, `IO`, `IX` (S-system
corners, 43) and `O` (right-angled floors, 5)** — plus, separately and much smaller, a `2×6`
base to sit under four existing floor slabs. Everything above is the evidence for it.

---

## Appendix — the 129, in full

Grouped by size code, largest group first. `side lock` is the topper's own `connection|` systems
other than `openforge`; `—` means the piece names none, so it depends entirely on the base it does
not have. Ids are catalog paths and are stable (`CatalogFile` proves them unique at parse time).

### `PC` — 23 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+standard.PC+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+standard.PC.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+wide.PC+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+wide.PC.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/side/dungeon_stone%eroded#door+arched+standard.PC+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/side/dungeon_stone%eroded#door+arched+standard.PC.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/dungeon_stone#wall+low.PC+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/dungeon_stone#wall+low.PC.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/side/dungeon_stone#wall+low.PC+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/side/dungeon_stone#wall+low.PC.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/dungeon_stone#wall.PC+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/dungeon_stone#wall.PC.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/pegs/dungeon_stone#wall.PC+mirror.openforge,pegs.stl` | wall 2 | pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/pegs/dungeon_stone#wall.PC.openforge,pegs.stl` | wall 2 | pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side,pegs/dungeon_stone#wall.PC+mirror.openforge,side,pegs.stl` | wall 2 | openlock, pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side,pegs/dungeon_stone#wall.PC.openforge,side,pegs.stl` | wall 2 | openlock, pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side/dungeon_stone#wall.PC+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side/dungeon_stone#wall.PC.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openlock/pegs/dungeon_stone#wall.PC.openforge,pegs.stl` | wall 2 | pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/dungeon_stone#window+arched.PC+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/dungeon_stone#window+arched.PC.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/side/dungeon_stone#window+arched.PC+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/side/dungeon_stone#window+arched.PC.openforge,side.stl` | wall 2 | openlock | dungeon_stone |

### `L` — 20 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/aztlan/s2w/corner/column#corner+s2w+low/aztlan#column+corner+low.col+L.openforge,side+filament.stl` | `none` | filament | aztlan |
| `tiles/aztlan/s2w/corner/column#corner+s2w+low/aztlan#column+corner+low.col+L.openforge,side.stl` | `none` | openlock | aztlan |
| `tiles/aztlan/s2w/corner/column#corner+s2w/aztlan#column+corner.col+L.openforge,side+dragonlock.stl` | `none` | dragonlock | aztlan |
| `tiles/aztlan/s2w/corner/column#corner+s2w/aztlan#column+corner.col+L.openforge,side+filament.stl` | `none` | filament | aztlan |
| `tiles/aztlan/s2w/corner/column#corner+s2w/aztlan#column+corner.col+L.openforge,side.stl` | `none` | openlock | aztlan |
| `tiles/cut-stone/s2w/corner/column#corner+s2w,low/cut-stone#column+corner+low.col+L.openforge,side+filament.stl` | `none` | filament | cut-stone |
| `tiles/cut-stone/s2w/corner/column#corner+s2w,low/cut-stone#column+corner+low.col+L.openforge,side.stl` | `none` | openlock | cut-stone |
| `tiles/cut-stone/s2w/corner/column#corner+s2w/cut-stone#column+corner.col+L.openforge,side+dragonlock.stl` | `none` | dragonlock | cut-stone |
| `tiles/cut-stone/s2w/corner/column#corner+s2w/cut-stone#column+corner.col+L.openforge,side+filament.stl` | `none` | filament | cut-stone |
| `tiles/cut-stone/s2w/corner/column#corner+s2w/cut-stone#column+corner.col+L.openforge,side.stl` | `none` | openlock | cut-stone |
| `tiles/dungeon_stone/s2w/corner/column#corner+s2w,low/dungeon_stone#column+corner+low.col+L.openforge,side+filament.stl` | `none` | filament | dungeon_stone |
| `tiles/dungeon_stone/s2w/corner/column#corner+s2w,low/dungeon_stone#column+corner+low.col+L.openforge,side.stl` | `none` | openlock | dungeon_stone |
| `tiles/dungeon_stone/s2w/corner/column#corner+s2w/dungeon_stone#column+corner.col+L.openforge,side+dragonlock.stl` | `none` | dragonlock | dungeon_stone |
| `tiles/dungeon_stone/s2w/corner/column#corner+s2w/dungeon_stone#column+corner.col+L.openforge,side+filament.stl` | `none` | filament | dungeon_stone |
| `tiles/dungeon_stone/s2w/corner/column#corner+s2w/dungeon_stone#column+corner.col+L.openforge,side.stl` | `none` | openlock | dungeon_stone |
| `tiles/towne/s2w/corner/column#corner+s2w,low/towne#column+low+corner.col+L.openforge,side+filament.stl` | `none` | filament | towne |
| `tiles/towne/s2w/corner/column#corner+s2w,low/towne#column+low+corner.col+L.openforge,side.stl` | `none` | openlock | towne |
| `tiles/towne/s2w/corner/column#corner+s2w/towne#column+corner.col+L.openforge,side+dragonlock.stl` | `none` | dragonlock | towne |
| `tiles/towne/s2w/corner/column#corner+s2w/towne#column+corner.col+L.openforge,side+filament.stl` | `none` | filament | towne |
| `tiles/towne/s2w/corner/column#corner+s2w/towne#column+corner.col+L.openforge,side.stl` | `none` | openlock | towne |

### `PB` — 20 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+standard.PB+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+standard.PB.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/side/dungeon_stone%eroded#door+arched+standard.PB+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/side/dungeon_stone%eroded#door+arched+standard.PB.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/dungeon_stone#wall+low.PB+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/dungeon_stone#wall+low.PB.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/side/dungeon_stone#wall+low.PB+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/side/dungeon_stone#wall+low.PB.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/dungeon_stone#wall.PB+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/dungeon_stone#wall.PB.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/pegs/dungeon_stone#wall.PB+mirror.openforge,pegs.stl` | wall 2 | pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/pegs/dungeon_stone#wall.PB.openforge,pegs.stl` | wall 2 | pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side,pegs/dungeon_stone#wall.PB+mirror.openforge,side,pegs.stl` | wall 2 | openlock, pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side,pegs/dungeon_stone#wall.PB.openforge,side,pegs.stl` | wall 2 | openlock, pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side/dungeon_stone#wall.PB+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side/dungeon_stone#wall.PB.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/dungeon_stone#window+arched.PB+mirror.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/dungeon_stone#window+arched.PB.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/side/dungeon_stone#window+arched.PB+mirror.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/side/dungeon_stone#window+arched.PB.openforge,side.stl` | wall 2 | openlock | dungeon_stone |

### `IO` — 16 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/s_system/corner+low/dungeon_stone%block#s_system,corner+low.IO.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/dungeon_stone%eroded#s_system,corner+low.IO.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/side/dungeon_stone%block#s_system,corner+low.IO.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/side/dungeon_stone%eroded#s_system,corner+low.IO.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/dungeon_stone%block#s_corner.IO.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/dungeon_stone%eroded#s_corner.IO.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/side/dungeon_stone%block#s_corner.IO.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/side/dungeon_stone%eroded#s_corner.IO.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dwarven_halls/thick_wall/corner+low/openforge/dwarven_halls#wall+low,corner.IO.openforge.stl` | rect 1×1 | — | dwarven_halls |
| `tiles/dwarven_halls/thick_wall/corner/openforge/dwarven_halls#wall,corner.IO.openforge,side.stl` | rect 1×1 | openlock | dwarven_halls |
| `tiles/dwarven_halls/thick_wall/sentinels/openforge/dwarven_halls#wall,sentinel+1.IO.openforge.stl` | rect 1×1 | — | dwarven_halls |
| `tiles/dwarven_halls/thick_wall/sentinels/openforge/dwarven_halls#wall,sentinel+2.IO.openforge.stl` | rect 1×1 | — | dwarven_halls |
| `tiles/dwarven_halls/thick_wall/sentinels/openforge/dwarven_halls#wall,sentinel+3.IO.openforge.stl` | rect 1×1 | — | dwarven_halls |
| `tiles/dwarven_halls/thick_wall/sentinels/openforge/dwarven_halls#wall,sentinel+4.IO.openforge.stl` | rect 1×1 | — | dwarven_halls |
| `tiles/mines/thick_wall/wooden_walls/mine#wall+low,wooden.IO.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,wooden.IO.openforge.stl` | rect 1×1 | — | mine |

### `IX` — 16 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/s_system/corner+low/dungeon_stone%block#s_system,corner+low.IX.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/dungeon_stone%eroded#s_system,corner+low.IX.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/side/dungeon_stone%block#s_system,corner+low.IX.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/side/dungeon_stone%eroded#s_system,corner+low.IX.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/dungeon_stone%block#s_corner.IX.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/dungeon_stone%eroded#s_corner.IX.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/side/dungeon_stone%block#s_corner.IX.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/side/dungeon_stone%eroded#s_corner.IX.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dwarven_halls/thick_wall/corner+low/openforge/dwarven_halls#wall+low,corner.IX.openforge.stl` | rect 1×1 | — | dwarven_halls |
| `tiles/dwarven_halls/thick_wall/corner/openforge/dwarven_halls#wall,corner.IX.openforge,side.stl` | rect 1×1 | openlock | dwarven_halls |
| `tiles/mines/thick_wall/wooden_walls/mine#wall+low,wooden.IX.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,transition+HHHL,wooden.IX.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,transition+HHLL,wooden.IX.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,transition+HLHL,wooden.IX.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,transition+HLLL,wooden.IX.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,wooden.IX.openforge.stl` | rect 1×1 | — | mine |

### `P` — 12 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+standard.P.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+wide.P.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/side/dungeon_stone%eroded#door+arched+standard.P.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/side/dungeon_stone%eroded#door+arched+wide.P.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/dungeon_stone#wall+low.P.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/side/dungeon_stone#wall+low.P.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/dungeon_stone#wall.P.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/pegs/dungeon_stone#wall.P.openforge,pegs.stl` | wall 2 | pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side,pegs/dungeon_stone#wall.P.openforge,side,pegs.stl` | wall 2 | openlock, pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/side/dungeon_stone#wall.P.openforge,side.stl` | wall 2 | openlock | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/dungeon_stone#window+arched.P.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/side/dungeon_stone#window+arched.P.openforge,side.stl` | wall 2 | openlock | dungeon_stone |

### `II` — 11 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/s_system/corner+low/dungeon_stone%block#s_system,corner+low.II.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/dungeon_stone%eroded#s_system,corner+low.II.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/side/dungeon_stone%block#s_system,corner+low.II.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner+low/side/dungeon_stone%eroded#s_system,corner+low.II.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/dungeon_stone%block#s_corner.II.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/dungeon_stone%eroded#s_corner.II.openforge.stl` | rect 1×1 | — | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/side/dungeon_stone%block#s_corner.II.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/dungeon_stone/s_system/corner/side/dungeon_stone%eroded#s_corner.II.openforge,side.stl` | rect 1×1 | openlock | dungeon_stone |
| `tiles/mines/thick_wall/wooden_walls/mine#wall+low,wooden.II.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,transition,wooden.II.openforge.stl` | rect 1×1 | — | mine |
| `tiles/mines/thick_wall/wooden_walls/mine#wall,wooden.II.openforge.stl` | rect 1×1 | — | mine |

### `PA` — 6 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+narrow.PA.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/door+arched/openforge/dungeon_stone%eroded#door+arched+standard.PA.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall+low/openforge/dungeon_stone#wall+low.PA.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/dungeon_stone#wall.PA.openforge.stl` | wall 2 | — | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/wall/openforge/pegs/dungeon_stone#wall.PA.openforge,pegs.stl` | wall 2 | pegs | dungeon_stone |
| `tiles/dungeon_stone/separate_wall/angled_walls/window+arched/openforge/dungeon_stone#window+arched.PA.openforge.stl` | wall 2 | — | dungeon_stone |

### `O` — 5 tiles

| tile | footprint | side lock | texture |
| --- | --- | --- | --- |
| `tiles/dungeon_stone/floors/floor#angled/openforge/dungeon_stone%block#floor,angled.O.openforge.stl` | rect 2×2 | — | dungeon_stone |
| `tiles/dungeon_stone/floors/floor#angled/openforge/dungeon_stone%block#floor,angled.OA.openforge.stl` | rect 4×4 | — | dungeon_stone |
| `tiles/dungeon_stone/floors/floor#angled/openforge/dungeon_stone%eroded#floor,angled.O.openforge.stl` | rect 2×2 | — | dungeon_stone |
| `tiles/dungeon_stone/floors/floor#angled/openforge/dungeon_stone%eroded#floor,angled.OA.openforge.stl` | rect 4×4 | — | dungeon_stone |
| `tiles/rough_stone/separate_wall/primary_walls/column+low/openlock/rough_stone#column+low.O.openforge.stl` | rect 2×2 | — | rough_stone |

