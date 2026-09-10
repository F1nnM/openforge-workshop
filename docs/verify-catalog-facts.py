#!/usr/bin/env python3
"""Re-derive every load-bearing number in architecture-plan.md from the catalog fixtures.

Run:  python3 docs/verify-catalog-facts.py [path-to-fixtures-dir]

Prints a markdown table. Exits non-zero if an internal invariant fails (counts that
must sum to the live total, percentages that must agree with their counts). The plan
quotes these numbers; CI should run this and fail the build when they drift.

Every definition used here is stated explicitly, because the first draft of the plan
quoted figures whose definitions were never written down and which turned out to be
irreproducible.

Row W7 folded in the figures the v2 series rests on -- the size-code ambiguity (D4),
the base range and print options (D1), joinery per face (D2), the band a curve names
(W5) and what a design collapses into (A1) -- on one rule for where each one lives:

  * this script reads RAW FIXTURES and is the authority on the CORPUS. A figure that
    is a fact about tags belongs here, with an invariant that fails when it moves.
  * a figure about the SHIPPED INDEX belongs in `pipeline/catalog.test.ts`, which
    reads the emitted artefact and cross-checks these rows against it.
  * a figure that needs a MEASURED PARAMETER -- an arc band's radii, a diagonal's
    run, an xG wall's length -- is not mirrored here at all. Those live in
    `pipeline/tessellation.ts`, and a second copy would give them two homes; this
    script stars the dimension out and says which file carries the real one.

Two rows deliberately report a figure and do not assert it clean: `mixed` aggregates
are 0 by construction rather than by measurement, and `a system named past the system
segment` records a live defect. Both say so in the Definition column, because an
invariant that cannot fail is worth less than a number that admits what it is.
"""

from __future__ import annotations

import json
import pathlib
import sys
from collections import Counter, defaultdict

DEFAULT_FIXTURES = pathlib.Path(
    "/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints"
)

# Tag SEGMENTS that mark curved geometry. A segment, not a substring: the earlier
# version of this list scanned the joined tag string, and its own comment claimed
# that making the scan segment-exact "would move the NONE bucket". It does not.
# Every one of these occurs in the corpus only as a whole `|`-segment; the single
# near-miss, `shape|option|curved_interface` (111 tags), sits on tiles that also
# carry a bare `shape|curved`. The substring scan flags 2,133 tiles and the
# segment scan 2,077, and the difference is exactly NON_CURVE_SEGMENTS below.
#
# Mirrors CURVE_TAG_SEGMENTS in pipeline/tessellation.ts.
CURVE_SEGMENTS = ("curved", "radial", "concave", "convex")

# What the substring scan caught that is NOT a curve: `hex`, on 56 tiles. A hex
# is a different geometry family with its own primitive, and calling it a curve
# places hex corners as bogus arcs. Kept as data rather than deleted because the
# 56 are the whole difference between the two scans, and the test asserts it.
#
# Mirrors NON_CURVE_TAG_SEGMENTS in pipeline/tessellation.ts.
NON_CURVE_SEGMENTS = ("hex",)

# The corpus's explicit fragment marker: `size|segment|<letter>` says this file is
# one lettered piece of a design whose size token names the WHOLE design. 319 live
# tiles carry one. Measured, in catalog units:
#
#   dungeon_stone%block#floor+curved+concave.8x8+b    tagged 8x8  measured 4.000 x 4.000
#   cut-stone#floor+curved+concave.6x6+b              tagged 6x6  measured 3.000 x 3.000
#   dungeon_stone%eroded#floor+curved,orthagonal+b.8x8+b  tagged 8x8  measured 2.079 x 1.931
#
# Not a rule, either -- the same letter on the same nominal size measures
# differently in different designs -- so there is nothing to derive and the pair
# must not be believed. Contrast a curve with no segment letter, whose pair the
# mesh honours exactly (cut-stone#floor+curved.4x4 measures 4.000 x 4.000).
#
# Deliberately narrow. A single-letter LAST segment is the corpus's plain variant
# suffix across 25 tag families (component|torch|a, texture|towne|long_planks|b),
# so it is not a fragment signal; only `size|segment` is.
FRAGMENT_PREFIX = "size|segment|"

# The corpus's OTHER fragment marker, and the one row W3 declined. A single-letter
# LAST segment is an ordinary variant suffix in 25 tag families, so W3 was right
# not to treat it as a fragment signal. W1's measurements say the NAMESPACE is the
# signal, not the letter. Over the 402 curve-marked RECT md5, error against the
# tagged pair, in catalog units:
#
#   letter's namespace         md5   min    median   max
#   (no letter)                372   0.000  0.003    2.507
#   component|<letter>          20   0.904  1.903    2.905
#   shape|curved|<letter>        9   0.436  0.436    0.436
#   shape|floor|<letter>         2   0.026  0.026    0.026
#
# `component|` is the part namespace, and its MINIMUM error is twice any other
# row's maximum. The nine `shape|curved|<letter>` tiles sit at 0.436 -- identical
# to their unlettered siblings in `rough_stone+ruined#curved+floor` (0.437) -- so
# there the letter carries nothing. Hence the conjunction below: a `component|`
# letter AND a curve marker, which is exactly the 20 `shingles#roof,corner` tiles,
# all 20 measured and all 20 wrong (tagged 1.5x1.5..3.5x3.5, measured
# 0.596x2.185..0.596x5.041 -- 0.6-unit barge-boards of a hip-roof corner).
#
# 135 further RECT tiles carry `component|<letter>` with no curve marker and NONE
# of them has been measured, so they keep their footprint. Mirrors
# `isLetteredCurvePart` in pipeline/footprint.ts.
COMPONENT_PREFIX = "component|"

# The column gate. `size|openlock` cannot be it -- its letters collide with the
# `col+` namespace on I L O T X -- and `shape|column` cannot be it either: that
# tag is on 135 tiles, and the two extra are `rough_stone#column+low.I` (a 1x1
# cell) and `.O` (a 2x2 right triangle), both column-shaped SUBJECTS on a tile
# footprint. Calling either a 0.5x0.5 pillar shrinks it fourfold.
#
# This tag is exact: 133 tiles, letter equal to the tile's `size|openlock` code on
# all 133 (L 50, O 34, I 24, T 14, X 11), and not one of the 133 carries any other
# size tag. Mirrors COLUMN_SHAPE_TAG in pipeline/tessellation.ts's consumer.
COLUMN_SHAPE_PREFIX = "size|column_shape"

# The four column letters W2 measured at 12.70 x 12.70 mm. `T` is absent
# deliberately: W2 marks `col+T` `unmeasured` because the only col+T STL in the
# bucket is an 84-byte binary header declaring zero triangles, and `isMeasured`
# returns False for it. Its 14 tiles are refused and stay in NONE. The other 13 of
# those 14 are real meshes (3-22 MB) that were never in a measurement work list,
# so the refusal is "nobody measured this row", not "this file is empty".
MEASURED_COLUMN_LETTERS = ("I", "L", "O", "X")

# The 45-degree marker: 130 tiles, and exactly the two families row W4 added.
# `shape|angled` alone is 260 tiles, including 79 `plain#base+angled` with no angle
# tag and 48 hex pieces at 60 degrees. `shape|angled|right` is on all 130
# P/PA/PB/PC/O tiles and on nothing else; all 130 carry `size|angle|45` and none
# carries a radius. The split inside it is total: all 121 P-family tiles have a
# width and no depth, all 9 O tiles have both, with width equal to depth.
DIAGONAL_TAG = "shape|angled|right"

# The tag on a piece whose `size|radius` is the curve it MATES WITH, cut into one
# face, rather than its own outline. 111 tiles, and W1 refused a sector fit on
# every one. Row W4 could only spell the three `xG` wall codes because the other 27
# were the arc bucket's to settle; row W5 replaced the code tuple with the tag,
# which is what the corpus actually says.
#
#   84 walls   AxG 28, BAxG 28, QxG 28. A run length is set by the tessellation, so
#              W2's table has it measured: AxG 1.991, BAxG 1.547, QxG 3.000 -- the
#              last against a tagged `size|width|4`, wrong by a full unit and an
#              exact 76.20 mm multiple. They become a WALL of the measured run.
#   27 floors  ExG/RxG/SxG/UxG/UxG2 by filename token, and NOT ONE of them carries
#              a `size|openlock` tag, so no table lookup can supply the width the
#              tag over-states. Measured, ExG and SxG are 1.700 against a tagged 2
#              and RxG/UxG are 2.487 against a tagged 4 -- over-stated by 0.300 and
#              1.513 units, which on a tessellating floor is an overlap with the
#              neighbour rather than a rounding error. They become NONE.
#
# Four of the 27 do measure their tagged pair (three UxG2 and one UxG) and no tag
# separates them from the 23 that do not, since UxG and UxG2 carry identical size
# tags. Refusing all 27 is the conservative read of an unseparable set.
CURVED_INTERFACE_TAG = "shape|option|curved_interface"

# The codes among the 111 that W2's table gives a measured `wall_run` length. This
# script mirrors the code list only -- the runs live in `pipeline/tessellation.ts`,
# where `wallRunLength` gates on `shape: "wall_run"` rather than on a tuple. The
# two agree because these are the only `size|openlock` values that co-occur with
# CURVED_INTERFACE_TAG at all: AxG 28, BAxG 28, QxG 28, and no code on the other 27.
CURVED_INTERFACE_WALL_CODES = ("AxG", "BAxG", "QxG")

# The widest sweep an ARC may carry. Mirrors MAX_SECTOR_SWEEP_DEG in
# `src/catalog/schema.ts`, and it is the domain of the sector box formula rather
# than a taste: `bboxX = rOut - rIn*cos(theta)` and `bboxY = rOut*sin(theta)` are
# only correct while the extreme point sits on a bounding radius, i.e. theta <= 90.
# No live tile is excluded by it -- a `size|radius` co-occurs only with 11.25, 22.5,
# 45 and 90 -- and the angles that would be, 120/240/270/300, are hex-corner and
# `IL`-corner markers on tiles that carry no radius.
MAX_SECTOR_SWEEP_DEG = 90

# The four codes W2 gives `shape: "diagonal_wall"`, with their measured runs. All
# four are tagged `size|width|2` without exception and none is 2 units long:
# P 3.536 (= 2.5*sqrt2), PA 2.828 (= 2*sqrt2), PB 2.835, PC 3.334. The tag names
# the cell the piece cuts across; the table names the piece. This script mirrors
# the code list only -- the runs live in `pipeline/tessellation.ts`, which is the
# artefact W2 owns, and duplicating four measurements here would give them two
# homes. Gating on the code list rather than on "has a width" is what keeps the
# two classifiers identical: neither can mint a `diag` it has no run for.
DIAGONAL_WALL_CODES = ("P", "PA", "PB", "PC")

# `part|lintel`: 21 inserts whose radius is the arch they fit, not their outline.
# Measured 1.31 x 0.48-0.63 against a tagged 2r/3r/4r whose sector box would be
# 2-4 units. Their only `size|width` is the non-numeric build marker `sw` or `wot`,
# so de-arcing them lands them in NONE with no special case.
LINTEL_TAG = "part|lintel"

LOCK_SYSTEMS = ("openlock", "dragonlock", "magnetic")

# `connection|side|openlock` puts a POSITION in the second segment, not a system.
# Reading segment 1 blindly invents a "side" connection system on the 2,081 tiles
# carrying any connection|side tag. Found by the PR 3 schema work.
#
# `bottom` (6 tags), `left` (1) and `right` (1) are the same thing at a 260th of the
# scale and were missing from this tuple: they minted phantom systems named after
# positions on exactly 8 records, taking the corpus from 7 connection systems to 10.
# The position vocabulary is the LEADING segment's only -- `connection|openlock|side`
# (3 tags) spells the same fact the other way round and is not folded, because the
# side-lock definition below is segment 2 of `connection|side|...` and the plan's
# 23.9% is measured against it. All 3 also carry a bare `connection|openlock`, so no
# system is lost there; only its position is understated.
# Tag drift collapsed on the way into the index. Mirrors `TAG_ALIASES` in
# `pipeline/normalise.ts`; `pipeline/catalog.test.ts` asserts the two agree, so a
# divergence fails rather than drifting silently.
TEXTURE_ROOT_ALIASES = {"foundations": "foundation"}

CONNECTION_POSITIONS = ("side", "bottom", "left", "right")

# The position an unpositioned `connection|<sys>` tag describes: the tile's own
# underside. `connection|bottom` spells it explicitly on 6 tiles and never names a
# system, so folding the two spellings together is a no-op today and correct if a
# `connection|bottom|<sys>` tag ever appears.
OWN_POSITION = "bottom"

# The band segment a curve names in its own tags: exactly CURVE_SEGMENTS minus
# the bare `curved`. `curved` says the outline IS a curve; the other three say
# which SIDE of the interface radius the material sits on, which is the band.
# Derived from that tuple rather than written out again, so the two cannot drift.
#
# `arcBandFromModifier` in `pipeline/footprint.ts` scans these three plus `s2w`,
# and `s2w` only chooses between two radial bands -- it can never be the reason a
# tile names a band at all -- so "names a band" is the same predicate in both.
#
# The band's RADII are deliberately absent. They are a parameter, they live in
# `pipeline/tessellation.ts`, and W5's reasoning for keeping them out of this
# script is that a mirror would give the offsets two homes. This file only asks
# whether the corpus names a band; `pipeline/catalog.test.ts` asserts which band,
# how wide, and where each one came from, against the emitted index.
BAND_MODIFIER_SEGMENTS = tuple(s for s in CURVE_SEGMENTS if s != "curved")

# The print modifiers, which sit from the modifier slot onwards -- segment two of
# `connection|<system>|...`, or segment three when a position leads. Never at the
# system position. Mirrors `PRINT_MODIFIERS` in `src/catalog/aggregate.ts`.
#
# `pegs` and `filament` are NOT here, and the research that listed them among
# five modifiers had them in the wrong slot: both are SYSTEMS. The corpus spells
# them `connection|pegs` (147 tags) and `connection|side|filament` (114) -- the
# same slot `openlock` occupies. They appear in `distinct connection systems`
# below, and the table asserts neither ever reaches a modifier slot.
PRINT_MODIFIERS = ("topless", "unsupported", "flex", "split")

# The two modifiers that name a base which is a DIFFERENT OBJECT, worst first.
# Mirrors `PRINT_OPTIONS` in `src/assembly/assemblyIndex.ts` reversed -- that
# list is best-first and a fold wants the worst. The other two are excluded on
# measurements the table below re-derives: `flex` is on all 1,141 magnetic bases
# and on no other base, so it describes the system rather than a choice inside
# it, and `split` never lands on a base at all.
RANKED_PRINT_MODIFIERS = ("topless", "unsupported")

# The three primitives whose dimension is a MEASURED PARAMETER rather than a tag:
# an `arc`'s two radii come from its band, a `diag`'s length and an `xG` wall's
# run from W2's table. All three live in `pipeline/tessellation.ts`, so the
# congruence key below stars them out instead of mirroring them. See
# `footprint_key`.
PARAMETRIC_KEYS = ("arc:*", "diag:*", "wall:*")

# The one slot name that is joinery rather than an accessory. 2,451 of the 3,695
# live slots are `base`, and they say "print a base under this topper" -- a
# placement fact the assembly resolver owns, not somewhere an accessory goes.
# Mirrors `JOINERY_SLOT` in tools/mounts/catalog.ts.
JOINERY_SLOT = "base"

# What kind of place each accessory slot names, and therefore what the measuring
# run looks for in the mesh. Mirrors `SLOT_CLASSES` in tools/mounts/classify.ts,
# which is the authority: the slot NAME is the only cheap evidence available
# before 16.34 GB of STL is read, and it decides whether a host gets a 31-angle
# tilt sweep (socket, pocket), a through-cast (opening), a read from above
# (hole), or one bounding box (surface, grate).
#
# `grate` is its own class and not `opening`: a grate half is a plate laid into a
# channel rather than something hung in a hole. The table is exhaustive over the
# corpus and the invariant below fails if a slot name appears that is not in it,
# which is the signal that the tool needs teaching before the next run.
SLOT_CLASSES = {
    "arch": "opening",
    "archway": "opening",
    "beam": "surface",
    "brace": "surface",
    "brazier": "surface",
    "brazier_base": "surface",
    "broken_section": "surface",
    "crosshead": "surface",
    "door": "opening",
    "fracture slope": "surface",
    "frame": "opening",
    "grate": "grate",
    "grate (left)": "grate",
    "grate (right)": "grate",
    "grate door": "opening",
    "grate flange": "grate",
    "lintel": "opening",
    "portcullis": "opening",
    "shutters": "opening",
    "slab_1": "surface",
    "slab_2": "surface",
    "statue": "surface",
    "support": "surface",
    "top": "surface",
    "torch": "socket",
    "trapdoor": "hole",
    "treasure": "pocket",
    "window": "opening",
}


def load(fixtures: pathlib.Path) -> list[dict]:
    rows: list[dict] = []
    for path in sorted(fixtures.glob("*.json")):
        with path.open() as fh:
            rows.extend(json.load(fh))
    return rows


def tags_of(row: dict) -> list[str]:
    return row.get("tags") or []


def tag_value(row: dict, prefix: str) -> str | None:
    """Return the segment following `prefix|`, for the first tag that matches."""
    for tag in tags_of(row):
        if tag.startswith(prefix + "|"):
            rest = tag[len(prefix) + 1 :]
            return rest.split("|")[0]
    return None


def numeric(row: dict, prefix: str) -> float | None:
    raw = tag_value(row, prefix)
    if raw is None:
        return None
    try:
        return float(raw)
    except ValueError:
        return None  # e.g. size|width|sw and size|width|wot are build markers, not widths


def connections_by_position(row: dict) -> dict[str, set[str]]:
    """The joinery systems a tile offers, keyed by the face they are mounted on.

    Total over CONNECTION_POSITIONS: every face is present, empty where nothing is
    mounted there. `connection|side|openlock` is openlock on the side;
    `connection|openlock` is openlock on the tile's own underside;
    `connection|openlock|topless` is still openlock. A bare position tag
    (`connection|side`, 2,080 tiles) names a face and no system, so it contributes a
    face with an empty set -- the system is named by its sibling tags.

    This is the projection `record.conn` throws away, and the one figure that makes
    the loss fatal is that 0 of the 4,363 toppers carry a bottom lock: the 1,283 that
    name a lock name it on the SIDE. Read off the flattened list they look like tiles
    offering that lock underneath, which is joinery they physically do not have.
    """
    found: dict[str, set[str]] = {position: set() for position in CONNECTION_POSITIONS}
    for tag in tags_of(row):
        if not tag.startswith("connection|"):
            continue
        parts = tag.split("|")[1:]
        position = OWN_POSITION
        if parts and parts[0] in CONNECTION_POSITIONS:
            position = parts[0]
            parts = parts[1:]
        if parts:
            found[position].add(parts[0])
    return found


def connection_systems(row: dict) -> set[str]:
    """Every joinery system a tile offers, on any face.

    The union of `connections_by_position`, so the flattened and the positional
    reading cannot drift apart. This is the definition `CatalogRecord.conn` ports.
    """
    return set().union(*connections_by_position(row).values())


def locks_at(row: dict, position: str) -> set[str]:
    """The lock systems mounted on one face."""
    return connections_by_position(row)[position] & set(LOCK_SYSTEMS)


def layer_of(row: dict) -> str:
    """Where a tile sits in an assembly. Mirrors `classifyLayer` in pipeline/facets.ts.

    The three positive signals are disjoint on the live corpus, so the order records
    intent rather than resolving a conflict.
    """
    tags = tags_of(row)
    if any(t.startswith("part|") for t in tags):
        return "insert"
    if any(t.startswith("shape|base") for t in tags):
        return "base"
    if any(t.startswith("connection|openforge") for t in tags):
        return "topper"
    return "integral"


def segments_of(row: dict) -> set[str]:
    """Every `|`-separated segment of every tag, as a set."""
    return {segment for tag in tags_of(row) for segment in tag.split("|")}


def has_curve_marker(row: dict) -> bool:
    """Whether the tile's outline is curved. Segment-exact; `hex` is not a curve.

    No longer a veto on the footprint -- see `footprint_kind`. It records that a
    RECT is an axis-aligned over-approximation of an annular sector rather than
    the outline itself, which is the fact W5's reshape needs.
    """
    return bool(segments_of(row) & set(CURVE_SEGMENTS))


def has_substring_curve_marker(row: dict) -> bool:
    """The scan this file used to do, kept so the table can report the difference.

    If a `texture|hexagonal`-shaped tag ever lands, this and `has_curve_marker`
    diverge by more than the 56 hex tiles and the table says so.
    """
    joined = " ".join(tags_of(row))
    return any(marker in joined for marker in CURVE_SEGMENTS + NON_CURVE_SEGMENTS)


def is_design_fragment(row: dict) -> bool:
    """Whether the width/depth pair names a larger design this file is part of.

    319 live tiles, and after row W4 all 319 are NONE. W3 reached only 283 of
    them, because a radius won ahead of this test on the 36 `curved+inverted`
    fragments; W4 stopped reading those radii as outlines (`radius_is_feature`),
    so the rule now applies to them too -- and W1's measurements say it should:
    `7x7+6r+a` is tagged 7x7 and measures 5.000 x 2.000.
    """
    return any(tag.startswith(FRAGMENT_PREFIX) for tag in tags_of(row))


def is_lettered_curve_part(row: dict) -> bool:
    """Whether a single-letter `component|` tag marks this as one part of a curve.

    The same fact `size|segment` states, spelled in the part namespace. 20 tiles,
    all `shingles#roof,corner+{concave,convex},{a,b}`. See COMPONENT_PREFIX for
    the measured error table that makes the namespace -- not the letter -- the
    discriminator, and for why the curve marker is a conjunct.
    """
    if not has_curve_marker(row):
        return False
    for tag in tags_of(row):
        if not tag.startswith(COMPONENT_PREFIX):
            continue
        last = tag.split("|")[-1]
        if len(last) == 1 and last.isalpha():
            return True
    return False


def radius_is_feature(row: dict) -> bool:
    """Whether a `size|radius` parameterises a FEATURE rather than the outline.

    `arc` asserts that the outline is an annular sector, and W1 refused a sector fit
    on 192 tiles that carry a radius: all 165 that carry no `size|angle`
    (fit: rejected, 165/165) plus the 27 `curved_interface` floors, which do carry a
    `size|angle|90` and are refused all the same. So the fabricated 90-degree sweep
    was not the defect -- the primitive was. The corpus says so in tags, three ways,
    and this is those three ways. They cover the 192 exactly:

     111  curved_interface    the radius is the curve this piece MATES WITH, cut
                              into one face. 84 become a WALL of their measured
                              run, 27 have no derivable width and become NONE.
      60  `inverted`          a square plate with a curved CUT -- the complement
      21  part|lintel         the radius of the arch the lintel drops into

    None of the three is a per-file exception list. After it, every remaining arc
    tile carries a `size|angle` in (0, 90], which the table below asserts is 0
    exceptions.
    """
    if CURVED_INTERFACE_TAG in tags_of(row):
        return True
    if LINTEL_TAG in tags_of(row):
        return True
    return "inverted" in segments_of(row)


def column_kind(row: dict) -> str | None:
    """`"column"`, `"none"` for an unmeasured letter, or None for a non-column."""
    letter = tag_value(row, COLUMN_SHAPE_PREFIX)
    if letter is None:
        return None
    return "column" if letter in MEASURED_COLUMN_LETTERS else "none"


def triangle_leg(row: dict) -> float | None:
    """The leg of a right isosceles triangle, from the tags.

    From the tags and NOT from a code lookup, because `size|openlock|O` covers
    both sizes and W2's table can hold only one: its row says 4x4 (the `OA`
    variant it was measured on) while five of the nine tiles are 2x2. Requiring
    width to equal depth makes "isosceles" a checked claim; an unequal pair falls
    through to RECT, and today none does.
    """
    width = numeric(row, "size|width")
    depth = numeric(row, "size|depth")
    if width is None or depth is None:
        return None
    return width if width == depth else None


def footprint_kind(row: dict) -> str:
    """The single primitive the Builder would use to place this tile.

    Order matters, and it is the contract `pipeline/footprint.ts` ports.

    Columns first, because a column carries no other size tag at all and its own
    tag is the only unambiguous spelling of the `col+` namespace. Diagonals next,
    because `shape|angled|right` is a statement about the OUTLINE that the
    width/depth pair below cannot make: a right triangle is half of its box and a
    45-degree run is longer than the cell it crosses.

    Then the vetoes, in order. A tile with width+depth that also carries a radius
    is an arc -- unless a tag reassigns that radius to a feature, which is row
    W4's correction and 165 tiles. A tile with width+depth that also carries a
    part letter, in either the `size|segment` or the `component|` spelling, has no
    derivable footprint at all, because the pair names a design this file is only
    one piece of.

    A curve marker is none of those. It says the outline is a sector, not that the
    pair is wrong -- and where a curve has no radius and no part letter, the mesh
    measures the tagged pair to three decimal places. Vetoing on it stranded 403
    placeable tiles in NONE, which is what W3 undid.
    """
    column = column_kind(row)
    if column is not None:
        return column

    if DIAGONAL_TAG in tags_of(row):
        # The `P` family carries a width and no depth; the `O` pair carries both.
        # Both readings need their own evidence -- a checked isosceles pair, or a
        # code with a measured run -- so a bare `shape|angled|right` falls through
        # rather than becoming a diagonal with no dimension.
        if triangle_leg(row) is not None:
            return "tri"
        if tag_value(row, "size|openlock") in DIAGONAL_WALL_CODES:
            return "diag"

    width = numeric(row, "size|width")
    depth = numeric(row, "size|depth")
    radius = numeric(row, "size|radius")

    # A sector needs a sweep, and row W4 stopped inventing one. Zero live tiles
    # reach the "none" here -- every arc surviving `radius_is_feature` carries a
    # `size|angle`, and the ARC-with-no-angle row below asserts that is 0.
    if radius is not None and not radius_is_feature(row):
        if radius <= 0:
            return "none"
        sweep = numeric(row, "size|angle")
        return "arc" if sweep is not None and 0 < sweep <= MAX_SECTOR_SWEEP_DEG else "none"

    # A curved interface eats into the tagged cell, so the tagged pair over-states
    # the outline. A wall run's real length is in W2's table; a floor's is nowhere,
    # so it is refused rather than placed 0.300-1.513 units long. 84 walls, 27
    # floors, and this branch is why the 27 are not RECT.
    if CURVED_INTERFACE_TAG in tags_of(row):
        return "wall" if tag_value(row, "size|openlock") in CURVED_INTERFACE_WALL_CODES else "none"

    if is_design_fragment(row):
        return "none"
    if is_lettered_curve_part(row):
        return "none"
    if width is not None and depth is not None:
        return "rect"
    if width is not None:
        return "wall"
    return "none"


def footprint_key(row: dict, kind: str) -> str | None:
    """The congruence class two tiles share iff a base of one fits under the other.

    Mirrors `footprintKey` in `src/assembly/footprint.ts`, with one deliberate
    difference: three of the seven primitives carry a dimension this script does
    not hold. An `arc`'s radii come from its BAND, a `diag`'s length and an `xG`
    wall's run from W2's measured table, and all three are PARAMETERS owned by
    `pipeline/tessellation.ts` -- mirroring them here would give the offsets two
    homes, which is the trade W5 already settled. Those three collapse to a
    starred class (PARAMETRIC_KEYS) and `pipeline/catalog.test.ts` carries the
    dimensioned key against the emitted index.

    The collapse is checked rather than assumed, in both directions. The
    ambiguity row below reports the codes that span two classes under THIS key,
    and the pipeline test asserts the dimensioned key finds the same four -- so a
    code ambiguous only INSIDE a starred class fails there instead of hiding
    here. And where a starred class would change an answer, the table says so:
    the 43 recoverable toppers are asserted to key on a dimensioned class.

    `None` for NONE, and that is the load-bearing return rather than a
    convenience. The 726 tiles with no derivable footprint are not congruent to
    each other; `footprintKey` returns `undefined` for the same reason, and its
    docstring counts the false pairs a shared `'none'` key would mint.
    """
    if kind == "rect":
        width, depth = numeric(row, "size|width"), numeric(row, "size|depth")
        if width is None or depth is None:
            return None
        return f"rect:{min(width, depth):g}x{max(width, depth):g}"
    if kind == "wall":
        if CURVED_INTERFACE_TAG in tags_of(row):
            return "wall:*"
        width = numeric(row, "size|width")
        return None if width is None else f"wall:{width:g}"
    if kind == "tri":
        leg = triangle_leg(row)
        return None if leg is None else f"tri:{leg:g}"
    if kind == "column":
        return "column"
    if kind == "diag":
        return "diag:*"
    if kind == "arc":
        return "arc:*"
    return None


def modifier_slot_segments(row: dict) -> list[str]:
    """Every segment sitting where a print modifier can sit, whatever it is.

    Segment two of `connection|<system>|...`, or segment three when a position
    leads. Returned unfiltered so the table can name what turns up there that is
    not a modifier: today a position spelled backwards (`connection|openlock|side`,
    3 tags) and one system spelled backwards (`connection|openforge|dragonlock`,
    5 tags, and every reader in the repo drops it -- see the row that counts it).

    Reading from segment one instead is the `connection|side|openlock` defect one
    namespace over: segment one is a position or the system itself, and no
    modifier ever occupies it.
    """
    found: list[str] = []
    for tag in tags_of(row):
        if not tag.startswith("connection|"):
            continue
        parts = tag.split("|")[1:]
        positioned = bool(parts) and parts[0] in CONNECTION_POSITIONS
        found.extend(parts[2:] if positioned else parts[1:])
    return found


def print_options(row: dict) -> set[str]:
    """The print modifiers a tile names. Mirrors `project` in `src/catalog/aggregate.ts`."""
    return {segment for segment in modifier_slot_segments(row) if segment in PRINT_MODIFIERS}


def print_option(row: dict) -> str:
    """The one print option a tile amounts to: the WORST modifier it names.

    Mirrors `printOption` in `src/assembly/assemblyIndex.ts`. Worst rather than
    first, so a base tagged `openlock|topless` beside a plain `magnetic` is
    topless -- it has no top whichever system you clip it with. Total even though
    zero live bases carry both, because a tag that carried both must not resolve
    to the flattering answer; the table asserts the zero separately.
    """
    named = print_options(row)
    for modifier in RANKED_PRINT_MODIFIERS:
        if modifier in named:
            return modifier
    return "plain"


def aggregate_class(layers: frozenset[str]) -> str:
    """What one design's files amount to. Mirrors `classify` in `src/catalog/aggregate.ts`.

    `both` is the pair the whole aggregation row exists for -- a base-integrated
    tile beside the base-less tile of the same design -- and `mixed` is any other
    combination. `mixed` is 0, which is what lets row A3 render one availability
    chip set per card; the table asserts it rather than assuming it.
    """
    if len(layers) == 1:
        (only,) = tuple(layers)
        return {
            "topper": "topper-only",
            "base": "base-only",
            "integral": "integrated-only",
            "insert": "insert-only",
        }[only]
    if layers == frozenset({"topper", "integral"}):
        return "both"
    return "mixed"


def design_key(row: dict, *, collapse: tuple[str, ...]) -> tuple:
    """A design is a tagset with the given namespaces collapsed away."""
    return tuple(
        sorted(t for t in tags_of(row) if not t.startswith(tuple(c + "|" for c in collapse)))
    )


def pct(n: int, total: int) -> str:
    return f"{100.0 * n / total:.1f}%"


def main() -> int:
    fixtures = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FIXTURES
    if not fixtures.is_dir():
        print(f"fixtures directory not found: {fixtures}", file=sys.stderr)
        return 2

    rows = load(fixtures)
    live = [r for r in rows if not r.get("deprecated")]
    n = len(live)
    failures: list[str] = []

    out: list[tuple[str, str, str]] = []  # (fact, value, definition)

    out.append(("total fixture rows", str(len(rows)), "every entry in blueprints/*.json"))
    out.append(("deprecated", str(len(rows) - n), "deprecated is truthy"))
    out.append(("live tiles", str(n), "the denominator for everything below"))

    # ---------------------------------------------------------------- footprints
    # Resolved once and carried: the W3 rows below slice the same partition five
    # ways, and re-deriving it each time tripled the script's runtime and pushed
    # catalog.test.ts's subprocess call past its timeout.
    kind_of = {id(r): footprint_kind(r) for r in live}
    kinds = Counter(kind_of.values())
    rect, wall, arc, none = kinds["rect"], kinds["wall"], kinds["arc"], kinds["none"]
    column, tri, diag = kinds["column"], kinds["tri"], kinds["diag"]
    if rect + wall + arc + column + tri + diag + none != n:
        failures.append("footprint kinds do not partition the live set")
    if set(kinds) - {"rect", "wall", "arc", "column", "tri", "diag", "none"}:
        failures.append(f"footprint_kind produced a case the schema has no union member for: {sorted(kinds)}")

    out.append(("footprint RECT", f"{rect} ({pct(rect, n)})", "numeric size|width AND size|depth, no radius and no part letter"))
    out.append(("footprint WALL_SEG", f"{wall} ({pct(wall, n)})", "numeric size|width only; depth is the 12.7 mm constant"))
    out.append(("footprint ARC", f"{arc} ({pct(arc, n)})", "has size|radius, and no tag reassigns it to a feature"))
    out.append(("footprint DIAG", f"{diag} ({pct(diag, n)})", "shape|angled|right with a diagonal_wall code — a 45-degree wall run, length from W2's table"))
    out.append(("footprint COLUMN", f"{column} ({pct(column, n)})", "size|column_shape with a measured letter — one 0.5 x 0.5 wall-thickness square"))
    out.append(("footprint TRI", f"{tri} ({pct(tri, n)})", "shape|angled|right with an equal width/depth pair — a right isosceles triangle"))
    out.append(("footprint NONE", f"{none} ({pct(none, n)})", "no derivable footprint (no size tags, a part letter whose pair names its design, or a code this build refuses) — never in the palette"))
    out.append(("coverage RECT only", pct(rect, n), "v1 lower bound"))
    out.append(("coverage RECT+WALL", pct(rect + wall, n), "v1 scope"))
    out.append(("coverage RECT+WALL+ARC", pct(rect + wall + arc, n), "the four cases W3 left"))

    # The band an arc's sector occupies is a PARAMETER, not a classification, and
    # this script deliberately holds only the classification: the offsets live in
    # `pipeline/tessellation.ts` and the code-to-band map in W2's table, so a
    # mirror here would give both two homes. `pipeline/catalog.test.ts` asserts the
    # band distribution and its provenance against the emitted index instead, which
    # is a stronger check than a reimplementation -- it reads what shipped.
    out.append(
        (
            "coverage all seven cases",
            pct(n - none, n),
            "everything but NONE — the figure rows W4 and W5 are accountable for, computed and not targeted",
        )
    )

    # --------------------------------------------------- W3: the classifier itself
    # The four counts above moved for one reason, and these rows are that reason
    # spelled out so it cannot drift back into a comment. Every figure the W3 row
    # of docs/v2-pr-series.md quotes is here.
    substring_curves = sum(1 for r in live if has_substring_curve_marker(r))
    segment_curves = sum(1 for r in live if has_curve_marker(r))
    substring_only = sum(1 for r in live if has_substring_curve_marker(r) and not has_curve_marker(r))
    hex_tiles = sum(1 for r in live if segments_of(r) & set(NON_CURVE_SEGMENTS))
    out.append(("curve-marked · segment scan", str(segment_curves), "a whole |-segment is curved/radial/concave/convex"))
    out.append(("curve-marked · substring scan", str(substring_curves), "the pre-W3 scan over the joined tag string"))
    out.append(
        (
            "curve marker false positives",
            f"{substring_only} ({hex_tiles} of them hex)",
            "flagged by the substring scan and not by the segment scan -- MUST be all hex",
        )
    )
    if substring_only != hex_tiles:
        failures.append(
            f"a non-hex substring-only curve marker appeared: {substring_only} flagged, {hex_tiles} hex"
        )

    curved_rects = [r for r in live if kind_of[id(r)] == "rect" and has_curve_marker(r)]
    curved_inverted = sum(1 for r in curved_rects if "inverted" in segments_of(r))
    out.append(
        (
            "RECT that is really a sector",
            f"{len(curved_rects)} ({pct(len(curved_rects), rect)} of RECT)",
            "curve-marked with a trusted width/depth pair -- the axis-aligned box is an over-approximation. W5 reshaped NONE of them: W1 fitted 402 and accepted 96, so 306 carry no measured sector and neither a radius nor a sweep to build one from, and a trusted over-approximation beats a fabricated sector. The count guards the set against drift",
        )
    )
    out.append(
        (
            "RECT curve-marked but NOT a sector",
            str(curved_inverted),
            "`inverted` plates: a square with a curved cut, so the box IS the outline. Measured exactly (3.000 x 3.000, 5.000 x 5.000) -- W5 must not reshape these",
        )
    )

    fragments = [r for r in live if is_design_fragment(r)]
    frag_arc = sum(1 for r in fragments if kind_of[id(r)] == "arc")
    frag_none = sum(1 for r in fragments if kind_of[id(r)] == "none")
    out.append(("size|segment fragments", str(len(fragments)), "one lettered piece of a larger design"))
    out.append(
        (
            "fragments · radius wins",
            str(frag_arc),
            "MUST be 0 -- W3 left 36 here because a radius outranked the fragment veto; all 36 are `curved+inverted`, whose radius W4 reads as a cut and not an outline",
        )
    )
    out.append(
        (
            "fragments · vetoed to NONE",
            str(frag_none),
            "the width/depth pair names the whole design, so there is nothing to place. `7x7+6r+a` is tagged 7x7 and measures 5.000 x 2.000",
        )
    )
    if frag_arc + frag_none != len(fragments):
        failures.append("size|segment fragments are neither arc nor none")
    if frag_arc != 0:
        failures.append(f"{frag_arc} size|segment fragments are still arcs -- radius_is_feature missed them")

    def has_component_letter(row: dict) -> bool:
        for tag in tags_of(row):
            last = tag.split("|")[-1]
            if tag.startswith(COMPONENT_PREFIX) and len(last) == 1 and last.isalpha():
                return True
        return False

    lettered = [r for r in live if is_lettered_curve_part(r)]
    lettered_only = [
        r for r in lettered if not is_design_fragment(r) and numeric(r, "size|radius") is None
    ]
    out.append(
        (
            "component|<letter> curve parts",
            f"{len(lettered)}: " + ", ".join(f"{v} {k}" for k, v in sorted(Counter(kind_of[id(r)] for r in lettered).items())),
            "a part letter in the component namespace on a curved design. 56 also carry size|segment and 78 also carry a radius -- and a radius still outranks a part letter, which is W3's order and unchanged",
        )
    )
    out.append(
        (
            "vetoed by the component letter alone",
            str(len(lettered_only)),
            "MUST be 20, all `shingles#roof,corner` and all RECT without this veto -- W1 measured all 20 md5 and the tagged pair is wrong on all 20 (min error 0.904 u, max 2.905)",
        )
    )
    if any(kind_of[id(r)] != "none" for r in lettered_only):
        failures.append("a tile the component letter is the only veto on kept a footprint")
    if len(lettered_only) != 20:
        failures.append(f"the component-letter veto reaches {len(lettered_only)} tiles, not the 20 W1 measured")

    lettered_elsewhere = Counter(
        kind_of[id(r)] for r in live if not has_curve_marker(r) and has_component_letter(r)
    )
    out.append(
        (
            "component|<letter>, no curve marker",
            f"{sum(lettered_elsewhere.values())}: "
            + ", ".join(f"{v} {k}" for k, v in sorted(lettered_elsewhere.items())),
            "keep their footprint: not one has been measured, so vetoing them would be the unevidenced move W3 refused",
        )
    )

    de_arced = [r for r in live if numeric(r, "size|radius") is not None and radius_is_feature(r)]
    out.append(
        (
            "radius reassigned to a feature",
            str(len(de_arced)),
            "MUST equal the 192 radius-carrying tiles W1 refused a sector fit on: 111 curved interfaces (84 walls, 27 floors), 60 inverted cuts, 21 lintel arches",
        )
    )
    for label, rows_in in (
        ("curved interfaces", [r for r in de_arced if CURVED_INTERFACE_TAG in tags_of(r)]),
        ("inverted plates", [r for r in de_arced if "inverted" in segments_of(r)]),
        ("lintel inserts", [r for r in de_arced if LINTEL_TAG in tags_of(r)]),
    ):
        landed = Counter(kind_of[id(r)] for r in rows_in)
        out.append(
            (
                f"de-arced · {label}",
                f"{len(rows_in)}: " + ", ".join(f"{v} {k}" for k, v in sorted(landed.items())),
                "where the 192 went once the radius stopped being read as an outline",
            )
        )
    if len(de_arced) != 192:
        failures.append(f"radius_is_feature covers {len(de_arced)} tiles, not W1's measured 192")
    if any(kind_of[id(r)] == "arc" for r in de_arced):
        failures.append("a tile whose radius is a feature is still an arc")

    # What is left in NONE, and why each part of it is there. Row W3 left 741, of
    # which 161 carried a code -- 133 columns and 28 `U`. W4 places 119 of the
    # columns and refuses the rest, so the coded remainder is 42 and every one of
    # them is a deliberate refusal rather than an unread tag.
    none_rows = [r for r in live if kind_of[id(r)] == "none"]
    none_coded = [r for r in none_rows if tag_value(r, "size|openlock") is not None]
    none_interface = [r for r in none_rows if CURVED_INTERFACE_TAG in tags_of(r)]
    none_sizeless = sum(
        1
        for r in none_rows
        if not is_design_fragment(r)
        and tag_value(r, "size|openlock") is None
        and CURVED_INTERFACE_TAG not in tags_of(r)
    )
    out.append(
        (
            "NONE · a refused tessellation code",
            f"{len(none_coded)}: "
            + ", ".join(f"{v}x {k}" for k, v in sorted(Counter(tag_value(r, 'size|openlock') for r in none_coded).items())),
            "U is ambiguous -- 4x4 floor OR the Y/YA/Z/ZA octagon segments, and these 28 are the segments; T is the one column letter nobody measured",
        )
    )
    out.append(("NONE · a fragment", str(frag_none), "the pair names the whole design; W1 measured 36 of them and the tag was wrong on all 36"))
    out.append(
        (
            "NONE · a curved interface, no code",
            str(len(none_interface)),
            "row W5's 27 ExG/RxG/SxG/UxG floors: the tagged width over-states the mesh by 0.300 or 1.513 units and their code is not in `size|openlock` at all, so nothing supplies the real one",
        )
    )
    out.append(("NONE · no code, no part letter", str(none_sizeless), "nothing in the tags to resolve from -- 56 hex corners, 21 lintel inserts, 20 barge-boards"))
    if len(none_coded) + frag_none + len(none_interface) + none_sizeless != none:
        failures.append("the NONE breakdown does not sum to the NONE bucket")
    if len(none_interface) != 27:
        failures.append(f"the curved-interface floors in NONE number {len(none_interface)}, not 27")

    # The columns, and the refusal. `col+T` is W2's one unmeasured column letter.
    columns = [r for r in live if tag_value(r, COLUMN_SHAPE_PREFIX) is not None]
    col_placed = Counter(tag_value(r, COLUMN_SHAPE_PREFIX) for r in columns if kind_of[id(r)] == "column")
    col_refused = Counter(tag_value(r, COLUMN_SHAPE_PREFIX) for r in columns if kind_of[id(r)] != "column")
    out.append(
        (
            "size|column_shape tiles",
            f"{len(columns)}: " + ", ".join(f"{v}x {k}" for k, v in sorted(Counter(tag_value(r, COLUMN_SHAPE_PREFIX) for r in columns).items())),
            "the unambiguous column gate; its letter equals the tile's size|openlock code on all of them",
        )
    )
    out.append(("columns placed", f"{sum(col_placed.values())}: " + ", ".join(f"{v}x {k}" for k, v in sorted(col_placed.items())), "measured at 12.70 x 12.70 mm"))
    out.append(("columns refused as unmeasured", f"{sum(col_refused.values())}: " + ", ".join(f"{v}x {k}" for k, v in sorted(col_refused.items())), "MUST be col+T only -- W2 marks that row unmeasured"))
    if set(col_refused) - {"T"}:
        failures.append(f"a measured column letter was refused: {sorted(col_refused)}")
    shape_columns = [r for r in live if "shape|column" in tags_of(r)]
    out.append(
        (
            "shape|column but no column_shape",
            str(len(shape_columns) - len(columns)),
            "MUST be 2 -- rough_stone#column+low.I (a 1x1 cell) and .O (a 2x2 right triangle): column-shaped subjects on a tile footprint, which is why shape|column is the wrong gate",
        )
    )

    # The diagonals. `shape|angled|right` is exactly the two families, and the split
    # inside it is total.
    diagonals = [r for r in live if DIAGONAL_TAG in tags_of(r)]
    out.append(
        (
            "shape|angled|right tiles",
            f"{len(diagonals)}: " + ", ".join(f"{v} {k}" for k, v in sorted(Counter(kind_of[id(r)] for r in diagonals).items())),
            "the 45-degree marker. MUST split cleanly into TRI and DIAG with nothing left over",
        )
    )
    out.append(
        (
            "TRI legs",
            ", ".join(f"{v}x leg {k}" for k, v in sorted(Counter(triangle_leg(r) for r in live if kind_of[id(r)] == "tri").items())),
            "from the tags, because size|openlock|O covers both sizes and W2's row can hold only one (it says 4x4)",
        )
    )
    out.append(
        (
            "DIAG codes",
            ", ".join(f"{v}x {k}" for k, v in sorted(Counter(tag_value(r, "size|openlock") for r in live if kind_of[id(r)] == "diag").items())),
            "runs from W2's table: P 3.536, PA 2.828, PB 2.835, PC 3.334, against a tagged size|width|2 on all 121",
        )
    )
    if set(kind_of[id(r)] for r in diagonals) - {"tri", "diag"}:
        failures.append("a shape|angled|right tile is neither TRI nor DIAG")
    if any(numeric(r, "size|angle") != 45 for r in diagonals):
        failures.append("a shape|angled|right tile is not tagged 45 degrees")

    # There is no longer any arc with a fabricated sweep. W3 had 165 of them and
    # `DEFAULT_ARC_SWEEP_DEG` invented 90 for every one; W1 refused a sector fit on
    # all 165 and W4 took them out of ARC entirely, so the constant is deleted
    # rather than left as a no-op. This row is what stops it coming back.
    arc_no_angle = sum(1 for r in live if kind_of[id(r)] == "arc" and numeric(r, "size|angle") is None)
    out.append(("ARC with no size|angle", str(arc_no_angle), "MUST be 0 -- no sweep is fabricated anywhere; W3's 165 all left ARC"))
    if arc_no_angle != 0:
        failures.append(f"{arc_no_angle} arc tiles carry no size|angle, so a sweep is being fabricated")

    # -------------------------------------------------- row W5: naming the band
    # A sector needs two radii and `size|radius` gives one, so the missing piece
    # is the BAND -- which side of that radius the material sits on. The offsets
    # are a parameter and stay in `pipeline/tessellation.ts`; what belongs here is
    # whether the CORPUS names a band at all, because that is a fact about tags
    # and it is the figure the plan quoted wrongly. Its draft said "292 of 1,391
    # arc tiles (21.0%) carry no band modifier", which is true of the tiles
    # carrying a radius and no longer true of the ARC bucket: W4 and W5 moved 183
    # of those 292 out of it.
    arcs = [r for r in live if kind_of[id(r)] == "arc"]
    named_band = {id(r) for r in live if segments_of(r) & set(BAND_MODIFIER_SEGMENTS)}
    arcs_named = sum(1 for r in arcs if id(r) in named_band)
    arcs_unnamed = len(arcs) - arcs_named
    out.append(
        (
            "ARC naming its own band",
            f"{arcs_named} ({pct(arcs_named, len(arcs))} of ARC)",
            "a concave/convex/radial tag SEGMENT -- the tile says which side of the interface radius it is on",
        )
    )
    out.append(
        (
            "ARC naming no band",
            str(arcs_unnamed),
            "resolved from W2's table where the code carries an arc row and from a written default otherwise. The 54/55 split needs the table and lives in pipeline/catalog.test.ts; this row is the population it partitions",
        )
    )

    radius_unnamed = [r for r in live if numeric(r, "size|radius") is not None and id(r) not in named_band]
    landed_unnamed = Counter(kind_of[id(r)] for r in radius_unnamed)
    out.append(
        (
            "radius, and no band named",
            f"{len(radius_unnamed)}: " + ", ".join(f"{v} {k}" for k, v in sorted(landed_unnamed.items())),
            "the plan's 292. Only the ARC share of it is still a band question -- the 84 xG walls, 24 inverted plates and 75 refused tiles stopped being sectors in W4 and W5",
        )
    )
    if set(landed_unnamed) - {"arc", "wall", "rect", "none"}:
        failures.append(
            f"a radius-carrying tile that names no band landed in {sorted(set(landed_unnamed) - {'arc', 'wall', 'rect', 'none'})}, "
            "which is a primitive W4 and W5 never sent one to -- the band question now reaches a case with no rule"
        )

    interface_named = sum(1 for r in live if CURVED_INTERFACE_TAG in tags_of(r) and id(r) in named_band)
    out.append(
        (
            "curved interfaces naming a band",
            str(interface_named),
            f"MUST be 0 -- not one of the 111 says which side its radius is on, which is why the 27 floors have nothing to place. {arcs_unnamed} + 27 = {arcs_unnamed + 27} is the count the arc bucket carried before W5 de-arced them",
        )
    )
    if interface_named != 0:
        failures.append(
            f"{interface_named} curved-interface tiles name a band, so W5's reason for refusing the 27 floors moved"
        )

    # ---------------------------------------------------------------- joinery
    no_conn = sum(1 for r in live if not any(t.startswith("connection|") for t in tags_of(r)))
    openforge = sum(1 for r in live if any(t.startswith("connection|openforge") for t in tags_of(r)))
    has_lock = sum(1 for r in live if connection_systems(r) & set(LOCK_SYSTEMS))
    out.append(("no connection tag at all", f"{no_conn} ({pct(no_conn, n)})", "zero connection| tags"))
    out.append(("carries connection|openforge", f"{openforge} ({pct(openforge, n)})", "delegates joinery to a separate base"))
    out.append(("carries a lock system", f"{has_lock} ({pct(has_lock, n)})", "openlock, dragonlock or magnetic"))

    multi_conn = sum(1 for r in live if len(connection_systems(r)) >= 2)
    out.append(
        ("2+ connection systems", f"{multi_conn} ({pct(multi_conn, n)})", "distinct systems, position segment skipped")
    )

    positional = sum(
        1 for r in live if any(t.startswith(f"connection|{p}|") for p in CONNECTION_POSITIONS for t in tags_of(r))
    )
    out.append(
        ("connection carries a position", f"{positional} ({pct(positional, n)})", "e.g. connection|side|openlock")
    )

    bare_position = sum(1 for r in live if any(t == f"connection|{p}" for p in CONNECTION_POSITIONS for t in tags_of(r)))
    out.append(
        (
            "connection is a bare position",
            f"{bare_position} ({pct(bare_position, n)})",
            "a face with no system on it, e.g. connection|side -- the system is on a sibling tag",
        )
    )

    all_systems = sorted(set().union(*(connection_systems(r) for r in live)))
    out.append(
        (
            "distinct connection systems",
            f"{len(all_systems)}: {', '.join(all_systems)}",
            "the conn facet's whole vocabulary; was 10 while positions leaked in as systems",
        )
    )

    phantom = sorted(set(all_systems) & set(CONNECTION_POSITIONS))
    phantom_rows = sum(1 for r in live if connection_systems(r) & set(CONNECTION_POSITIONS))
    out.append(
        (
            "systems named after a position",
            f"{len(phantom)} systems / {phantom_rows} rows",
            "MUST be 0/0 -- connection|bottom, |left and |right minted 3 systems over 8 records",
        )
    )
    if phantom:
        failures.append(f"position names leaking into the connection vocabulary: {phantom}")

    # -------------------------------------------------- joinery by position and layer
    # The correction the aggregate substrate needs. `record.conn` flattens position
    # away, and 0 of the 4,363 toppers carry a bottom lock -- the 1,283 that name a
    # lock name it on the SIDE, so a matcher reading the flat list would advertise
    # joinery those meshes physically do not have.
    bottom_lock = sum(1 for r in live if locks_at(r, OWN_POSITION))
    side_lock = sum(1 for r in live if locks_at(r, "side"))
    out.append(("tiles with a bottom lock", f"{bottom_lock} ({pct(bottom_lock, n)})", "lock system on the tile's own underside"))
    out.append(("tiles with a side lock", f"{side_lock} ({pct(side_lock, n)})", "lock system on connection|side|<sys> -- neighbour joinery"))

    layers = Counter(layer_of(r) for r in live)
    if sum(layers.values()) != n:
        failures.append("layers do not partition the live set")
    for layer in ("topper", "integral", "base", "insert"):
        rows_in = [r for r in live if layer_of(r) == layer]
        bottom = sum(1 for r in rows_in if locks_at(r, OWN_POSITION))
        side_only = sum(1 for r in rows_in if locks_at(r, "side") and not locks_at(r, OWN_POSITION))
        nolock = sum(1 for r in rows_in if not (locks_at(r, OWN_POSITION) | locks_at(r, "side")))
        if bottom + side_only + nolock != len(rows_in):
            failures.append(f"{layer}: bottom / side-only / no-lock do not partition the layer")
        out.append((f"layer {layer}", f"{len(rows_in)} ({pct(len(rows_in), n)})", "part| / shape|base / connection|openforge / else"))
        out.append((f"{layer} · bottom lock", f"{bottom} ({pct(bottom, len(rows_in))})", "lock on its own underside"))
        out.append((f"{layer} · side lock only", f"{side_only} ({pct(side_only, len(rows_in))})", "names a lock, but not underneath"))
        out.append((f"{layer} · no lock at all", f"{nolock} ({pct(nolock, len(rows_in))})", "neither face carries a lock"))

    if layers["topper"] and sum(1 for r in live if layer_of(r) == "topper" and locks_at(r, OWN_POSITION)):
        failures.append("a topper carries a bottom lock -- connection|openforge IS the underside")

    # The other side of the same fact, and the one nothing asserted: a base is
    # defined by having joinery underneath, so a base with no bottom lock is a
    # base nothing can be clipped to. All 1,963 carry one today. This fails if a
    # `shape|base` row is ever published without one -- at which point D1's
    # ranking has a candidate it cannot rank and A6's fallback has a base it
    # cannot honestly insert.
    base_rows = [r for r in live if layer_of(r) == "base"]
    topper_rows = [r for r in live if layer_of(r) == "topper"]
    lockless_bases = [r for r in base_rows if not locks_at(r, OWN_POSITION)]
    out.append(
        (
            "bases with no bottom lock",
            str(len(lockless_bases)),
            "MUST be 0 -- a base IS its underside joinery, and D1 ranks candidates on a lock it assumes is there",
        )
    )
    if lockless_bases:
        failures.append(f"{len(lockless_bases)} bases carry no lock on their own underside")

    # A DEFECT, reported rather than fixed, because it is the footnote on the row
    # above it. All three readers of the connection namespace --
    # `connections_by_position` here, `connectionsByPosition` in
    # pipeline/facets.ts and `project` in src/catalog/aggregate.ts -- take the
    # system from ONE segment and treat everything after it as a print modifier.
    # `connection|openforge|dragonlock` puts a second SYSTEM there, and all three
    # drop it; `printOption` in src/assembly/assemblyIndex.ts scans the same
    # slots for `topless`/`unsupported` and so is untroubled by it.
    #
    # So "0 of the 4,363 toppers carry a bottom lock" is 0 under the reading the
    # code has, and would be 5 under a reading that took the trailing segment:
    # all five tags are on `necro#wall.{A,BA,D,IA,Q}.openforge+dragonlock,side`
    # toppers, the filename agrees with the tag, and dragonlock appears nowhere
    # else on those five rows -- so the system is genuinely lost rather than
    # merely understated. Pinned to the measured population: a sixth tag fails
    # here, and so does a reader that starts honouring them, which is what makes
    # this row an invariant rather than a note.
    system_names = set(all_systems)
    lost: list[dict] = []
    lost_systems: set[str] = set()
    trailing: Counter[str] = Counter()
    trailing_rows: list[dict] = []
    for r in live:
        named: set[str] = set()
        for tag in tags_of(r):
            if not tag.startswith("connection|"):
                continue
            parts = tag.split("|")[1:]
            positioned = bool(parts) and parts[0] in CONNECTION_POSITIONS
            found = {s for s in (parts[2:] if positioned else parts[1:]) if s in system_names}
            if found:
                trailing[tag] += 1
                named |= found
        if named:
            trailing_rows.append(r)
            if named - connection_systems(r):
                lost_systems |= named - connection_systems(r)
                lost.append(r)
    out.append(
        (
            "a system named past the system segment",
            f"{sum(trailing.values())} tags / {len(trailing_rows)} records: "
            + ", ".join(f"{v}x {k}" for k, v in sorted(trailing.items())),
            "MUST be the 5 `connection|openforge|dragonlock` necro walls. Every reader takes segment one as the system and the rest as print modifiers, so the trailing system is discarded -- which is the asterisk on `topper . bottom lock` being 0. A sixth tag fails here; teaching THIS script to read them fails the row below; teaching only `pipeline/facets.ts` fails catalog.test.ts's per-face cross-check",
        )
    )
    out.append(
        (
            "records losing a system that way",
            f"{len(lost)} {'/'.join(sorted({layer_of(r) for r in lost})) or '-'}, losing {', '.join(sorted(lost_systems)) or '(nothing)'}",
            "the trailing system is on no other tag of the same row, so it is lost and not merely unpositioned. Contrast `connection|openlock|side` (3 tags), which spells a POSITION backwards and whose system IS on a sibling tag",
        )
    )
    if dict(trailing) != {"connection|openforge|dragonlock": 5} or len(lost) != 5:
        failures.append(
            f"the trailing-system population moved: {dict(trailing)}, {len(lost)} losing a system "
            "(measured: 5x connection|openforge|dragonlock, all 5 losing dragonlock). Either the corpus "
            "grew one or a reader started honouring them -- both change `topper . bottom lock`"
        )

    # ------------------------------------------------- row D4: the size code
    # `resolve.ts` keyed base to topper on `size|openlock` until row D4, on the
    # argument that a code covers tiles a width does not. The argument was sound
    # about WIDTHS and wrong about SHAPES, and these rows are the measurement that
    # says so. The key is now the resolved primitive; the code keeps a width, a
    # tie-break and one last-resort path.
    key_of = {id(r): footprint_key(r, kind_of[id(r)]) for r in live}
    code_of = {id(r): tag_value(r, "size|openlock") for r in live}
    codes = sorted({code_of[id(r)] for r in live if code_of[id(r)] is not None})
    spans: dict[str, Counter] = defaultdict(Counter)
    for r in live:
        code, key = code_of[id(r)], key_of[id(r)]
        if code is not None and key is not None:
            spans[code][key] += 1
    ambiguous = {code: tally for code, tally in spans.items() if len(tally) > 1}
    ambiguous_records = sum(sum(t.values()) for t in ambiguous.values())
    codeless = sorted(set(codes) - set(spans))
    out.append(
        (
            "size|openlock codes",
            f"{len(codes)}, {len(spans)} with a placeable record",
            f"the ones with none: {', '.join(codeless) or '(none)'} -- MUST be T alone, the column letter W2 marks unmeasured, whose 14 tiles are all NONE",
        )
    )
    out.append(
        (
            "codes spanning 2+ primitives",
            f"{len(ambiguous)} of {len(codes)}: {', '.join(sorted(ambiguous))}",
            "the whole of D4's premise. Kept parseable because `pipeline/catalog.test.ts` re-derives the same set from the EMITTED footprint, where the dimensions are real, and a disagreement between the two derivations is the thing worth failing on",
        )
    )
    out.append(
        (
            "ambiguous code spans",
            " · ".join(
                f"{code} = " + ", ".join(f"{v} {k}" for k, v in sorted(tally.items()))
                for code, tally in sorted(ambiguous.items())
            ),
            "`O` is the loudest: a code join can put a 0.5 x 0.5 pillar under a 4 x 4 triangle, and the old ranking compared the DISCRIMINANT (rect vs tri) rather than the dimensions, so it could not see the difference",
        )
    )
    out.append(
        (
            "records under an ambiguous code",
            f"{ambiguous_records} ({pct(ambiguous_records, n)})",
            "every record a code join could have mis-shaped",
        )
    )
    if codeless != ["T"]:
        failures.append(
            f"the codes with no placeable record are {codeless}, not T alone -- a whole code lost its footprint"
        )
    if not ambiguous:
        failures.append(
            "no size|openlock code spans two primitives any more, so D4's docstring and AMBIGUOUS_SIZE_CODES "
            "both describe a corpus that no longer exists"
        )

    # Why the defect was latent, in two independent measurements. Neither is a
    # rule about codes, and both are one published base away from ending -- which
    # is the argument for having moved the key rather than patched the ranking.
    base_codes: dict[str, list[dict]] = defaultdict(list)
    for r in base_rows:
        code = code_of[id(r)]
        if code is not None:
            base_codes[code].append(r)
    heterogeneous = sorted(
        code
        for code, group in base_codes.items()
        if len({key_of[id(x)] for x in group}) > 1 or any(key_of[id(x)] is None for x in group)
    )
    out.append(
        (
            "codes on the base side",
            f"{len(base_codes)}, {len(base_codes) - len(heterogeneous)} of them footprint determinants",
            "MUST be all of them. `resolve.ts`'s last-resort code path is gated on `sharedPrimitive`, so a code whose bases disagree makes it refuse rather than pick -- and 14 toppers lose their base line item",
        )
    )
    out.append(
        (
            "ambiguous codes a base carries",
            f"{len(set(base_codes) & set(ambiguous))} of {len(ambiguous)}: "
            + ", ".join(sorted(set(base_codes) & set(ambiguous))),
            f"O is absent, and that is reason two: {len(base_codes.get('O', []))} bases carry it, so the join it would have mis-shaped never ran",
        )
    )
    if heterogeneous:
        failures.append(f"a base-side size code spans two primitives: {heterogeneous}")
    if base_codes.get("O"):
        failures.append(
            f"{len(base_codes['O'])} bases now carry code O, which spans column/tri:2/tri:4 -- "
            "sizeCode.ts's latency argument is stale and the code path needs re-reading"
        )

    # Row D5's gap, split the way D4 left it. A topper whose code no base carries
    # is not the same thing as a topper no base fits: 43 of the 129 are congruent
    # to a base the archive does have and were reachable only once the key moved.
    base_keys = {key_of[id(r)] for r in base_rows if key_of[id(r)] is not None}
    gap = [r for r in topper_rows if code_of[id(r)] is not None and code_of[id(r)] not in base_codes]
    recovered = [r for r in gap if key_of[id(r)] in base_keys]
    starred = [r for r in recovered if key_of[id(r)] in PARAMETRIC_KEYS]
    out.append(
        (
            "toppers whose code no base carries",
            f"{len(gap)}: " + ", ".join(f"{v}x {k}" for k, v in sorted(Counter(code_of[id(r)] for r in gap).items())),
            "a fact about tags, and unchanged by D4",
        )
    )
    out.append(
        (
            "of those, congruent to a base that exists",
            f"{len(recovered)}: "
            + ", ".join(f"{v}x {k}" for k, v in sorted(Counter(code_of[id(r)] for r in recovered).items()))
            + " -> "
            + ", ".join(sorted({key_of[id(r)] or "?" for r in recovered})),
            "reachable under the primitive key and not under the code. MUST key on a dimensioned class, never a starred one -- a starred class would mean this count came from a parameter this script does not hold",
        )
    )
    out.append(
        (
            "of those, no base under either key",
            str(len(gap) - len(recovered)),
            "the real corpus gap: `notes.ts` warns on these. Row D5's docstring says 129 over nine codes, which was the whole gap before D4 recovered 43 of it",
        )
    )
    if starred:
        failures.append(
            f"{len(starred)} recoverable toppers key on a starred class {sorted({key_of[id(r)] for r in starred})}, "
            "so this split now depends on a parameter that lives in pipeline/tessellation.ts -- move the row to "
            "pipeline/catalog.test.ts rather than trusting it here"
        )

    # The base range, which is what bounds every one of those answers.
    base_kinds = Counter(kind_of[id(r)] for r in base_rows)
    keyed_bases = [r for r in base_rows if key_of[id(r)] is not None]
    absent = sorted({"tri", "diag", "column"} & set(base_kinds))
    out.append(
        (
            "base primitives",
            ", ".join(f"{v} {k}" for k, v in sorted(base_kinds.items())),
            "MUST hold no tri, diag or column. The corpus publishes no triangular, diagonal or pillar base at all, so the 130 angled-right tiles and the 119 columns can never be matched to one -- which is the shape of the gap D5 files upstream, not a resolver bug",
        )
    )
    out.append(
        (
            "base congruence classes",
            f"{len(keyed_bases)} keyed / {len({key_of[id(r)] for r in keyed_bases})} classes",
            "starred classes collapsed: every arc base counts once here, and every diag and xG wall base would. The dimensioned count is 44 and belongs to pipeline/catalog.test.ts, which reads the emitted index and has the bands",
        )
    )
    if absent:
        failures.append(
            f"the corpus now publishes {absent} bases, so D5's shape gap and D4's base range both moved"
        )

    # ------------------------------------------------ row D1: the print option
    # `byCost` sorted candidate bases on bytes ascending, so a topless base -- a
    # base with no top surface -- won every tie, and 79.1% of auto-inserted
    # openlock bases had no top. The ranking is D1's; the vocabulary it ranks over
    # is a corpus fact and belongs here.
    modifier_slots = Counter(s for r in live for s in modifier_slot_segments(r))
    option_tally = {s: c for s, c in modifier_slots.items() if s in PRINT_MODIFIERS}
    strays = {s: c for s, c in modifier_slots.items() if s not in PRINT_MODIFIERS}
    out.append(
        (
            "print-option vocabulary",
            f"{len(option_tally)}: " + ", ".join(f"{k} {v}" for k, v in sorted(option_tally.items(), key=lambda kv: -kv[1])),
            "segments in a modifier slot that really are modifiers. Four values, and the research's five were wrong twice over -- `pegs` and `filament` are SYSTEMS, and `flex` and `split` never rank a base",
        )
    )
    out.append(
        (
            "non-modifiers in a modifier slot",
            ", ".join(f"{k} {v}" for k, v in sorted(strays.items())) or "(none)",
            "MUST hold neither pegs nor filament. Both exist -- `connection|pegs` 147 tags, `connection|side|filament` 114 -- at the SYSTEM position, which is why they are connection systems below and not print options here",
        )
    )
    if {"pegs", "filament"} & set(strays):
        failures.append(
            f"{sorted({'pegs', 'filament'} & set(strays))} reached a modifier slot; they are systems everywhere else "
            "in the corpus, so either the fixture is wrong or the print-option vocabulary is five values now"
        )

    base_options = Counter(print_option(r) for r in base_rows)
    both_modifiers = [r for r in base_rows if len(print_options(r) & set(RANKED_PRINT_MODIFIERS)) > 1]
    out.append(
        (
            "bases by print option",
            ", ".join(f"{k} {v}" for k, v in sorted(base_options.items())),
            "the candidate pool D1 re-ranks. `plain` is the absence of both ranked modifiers, not a tag",
        )
    )
    out.append(
        (
            "bases carrying both modifiers",
            str(len(both_modifiers)),
            "MUST be 0 -- `printOption` folds to the worst anyway, so a base with both resolves to `topless` rather than to the flattering answer, but nothing live exercises that branch",
        )
    )
    if sum(base_options.values()) != len(base_rows):
        failures.append("bases by print option does not sum to the base count")
    if both_modifiers:
        failures.append(
            f"{len(both_modifiers)} bases now carry both topless and unsupported; D1's ranking asserts zero and "
            "assemblyIndex.ts's fold is what covers it"
        )

    flex_bases = {id(r) for r in base_rows if "flex" in print_options(r)}
    magnetic_bases = {id(r) for r in base_rows if "magnetic" in connection_systems(r)}
    split_bases = [r for r in base_rows if "split" in print_options(r)]
    out.append(
        (
            "bases carrying flex",
            f"{len(flex_bases)} / {len(magnetic_bases)} magnetic bases",
            "MUST be equal. `flex` is why it is not a ranked option: it describes the magnetic system rather than a choice inside it, so ranking on it would order bases by lock twice",
        )
    )
    out.append(
        (
            "bases carrying split",
            str(len(split_bases)),
            "MUST be 0 -- `split` is on one record corpus-wide and it is not a base, so it can never rank one",
        )
    )
    if flex_bases != magnetic_bases:
        failures.append(
            f"flex and magnetic no longer describe the same {len(magnetic_bases)} bases "
            f"({len(flex_bases - magnetic_bases)} flex without magnetic, {len(magnetic_bases - flex_bases)} the other way) "
            "-- assemblyIndex.ts excludes flex from PRINT_OPTIONS on exactly that identity"
        )
    if split_bases:
        failures.append(f"{len(split_bases)} bases now carry `split`, which PRINT_OPTIONS omits as unreachable")

    # -------------------------------------------- row A1: what a design amounts to
    # One catalog item per design, and the five shapes rows A2 through A7 are
    # scoped against. Derived here from the tags and the layer rule; A1's own
    # figures come from `buildAggregateIndex` over the emitted index, and
    # `pipeline/aggregate.test.ts` asserts those -- so these rows are a second,
    # independent derivation of the same numbers rather than a copy of them.
    by_design_rows: dict[tuple, list[dict]] = defaultdict(list)
    for r in live:
        by_design_rows[design_key(r, collapse=("connection",))].append(r)
    classes = Counter(
        aggregate_class(frozenset(layer_of(x) for x in group)) for group in by_design_rows.values()
    )
    out.append(
        (
            "aggregate classes",
            ", ".join(f"{k} {v}" for k, v in sorted(classes.items(), key=lambda kv: -kv[1])),
            "one design's files, by the layers they occupy. `both` is the pair the aggregation row exists for -- a base-integrated tile beside the base-less tile of the same design",
        )
    )
    signal_varies = sum(
        1
        for group in by_design_rows.values()
        if len({(any(t.startswith("part|") for t in tags_of(x)), any(t.startswith("shape|base") for t in tags_of(x))) for x in group}) > 1
    )
    out.append(
        (
            "aggregates mixing other layers",
            f"{classes['mixed']}, and 0 BY CONSTRUCTION",
            "not a corpus measurement. `layer_of` reads three namespaces and the design key collapses only one of them -- `connection|openforge` -- so `part|` and `shape|base` are constant inside a design and the only two layers that can meet are topper and integral. The row beside it is the checkable half",
        )
    )
    out.append(
        (
            "designs whose layer signal varies",
            str(signal_varies),
            "MUST be 0, and it is what `mixed` would need to be non-zero: a design holding both a `part|` row and a non-`part|` row. Widen `design_key`'s collapse list to a namespace `layer_of` reads and this fires -- which is the only way `AggregateClass.mixed` becomes reachable",
        )
    )
    out.append(
        (
            "aggregate spread",
            f"{sum(1 for g in by_design_rows.values() if len(g) == 1)} singletons, largest {max(len(g) for g in by_design_rows.values())}",
            "how much visible duplication the collapse removes",
        )
    )
    if sum(classes.values()) != len(by_design_rows):
        failures.append("aggregate classes do not partition the designs")
    if signal_varies or classes["mixed"]:
        failures.append(
            f"{signal_varies} designs hold two different `part|`/`shape|base` signals and {classes['mixed']} are "
            "`mixed`: the design key now collapses a namespace `layer_of` reads, so `AggregateClass.mixed` is "
            "reachable and A3's chips have no rendering for it"
        )

    # ------------------------------------------------- lock reachability by design
    # The real question the plan needs: if a user commits to ONE lock system, what
    # fraction of designs remains reachable?
    by_design: dict[tuple, set[str]] = defaultdict(set)
    for r in live:
        key = design_key(r, collapse=("connection",))
        by_design[key] |= connection_systems(r) & set(LOCK_SYSTEMS)
        by_design[key]  # ensure present even with no lock
    total_designs = len(by_design)
    for s in LOCK_SYSTEMS:
        reach = sum(1 for locks in by_design.values() if s in locks or not locks)
        out.append((f"designs reachable · {s}", f"{reach} ({pct(reach, total_designs)})", "design has this lock, or has none at all"))
    spread = max(
        pct_f := [
            100.0 * sum(1 for locks in by_design.values() if s in locks or not locks) / total_designs
            for s in LOCK_SYSTEMS
        ]
    ) - min(pct_f)
    out.append(("lock choice cost (spread)", f"{spread:.1f} pp", "best minus worst reachable share — the real cost of a global lock preference"))

    # ---------------------------------------------------------------- designs
    for label, collapse in (("connection only", ("connection",)), ("connection+texture", ("connection", "texture"))):
        keys = {design_key(r, collapse=collapse) for r in live}
        out.append((f"distinct designs ({label})", str(len(keys)), f"tagset ignoring {'+'.join(collapse)}"))
        out.append((f"files per design ({label})", f"{n / len(keys):.2f}", "live tiles / distinct designs"))

    # ---------------------------------------------------------------- rotation
    angles: Counter[str] = Counter()
    for r in live:
        for t in tags_of(r):
            if t.startswith("size|angle|"):
                angles[t.split("|")[2]] += 1
    non_90 = sum(
        1
        for r in live
        if any(
            t.startswith("size|angle|") and (float(t.split("|")[2]) % 90) != 0
            for t in tags_of(r)
            if t.count("|") >= 2
        )
    )
    not_exactly_90 = sum(
        1
        for r in live
        if any(t.startswith("size|angle|") and t.split("|")[2] != "90" for t in tags_of(r))
    )
    out.append(("angle not a multiple of 90", str(non_90), "needs a finer rotation step than 90 degrees"))
    out.append(("angle present and != 90", str(not_exactly_90), "includes the 270 corner sweeps"))

    # ---------------------------------------------------------------- identity
    md5s = Counter(
        (r.get("file_metadata") or {}).get("md5")
        for r in live
        if (r.get("file_metadata") or {}).get("md5")
    )
    shared_md5 = {m: c for m, c in md5s.items() if c > 1}
    out.append(("distinct md5", str(len(md5s)), "content addresses"))
    out.append(("md5 shared by 2+ rows", f"{len(shared_md5)} md5 / {sum(shared_md5.values())} rows", "same file, two catalog paths — md5 is not a primary key"))

    names = Counter(
        (r.get("file_metadata") or {}).get("file")
        for r in live
        if (r.get("file_metadata") or {}).get("file")
    )
    collide = {
        f
        for f, c in names.items()
        if c > 1
        and len({(r.get("file_metadata") or {}).get("md5") for r in live if (r.get("file_metadata") or {}).get("file") == f}) > 1
    }
    out.append(("filenames mapping to 2+ meshes", str(len(collide)), "zip entries would silently overwrite"))

    # ---------------------------------------------------------------- compositions
    with_config = [r for r in live if r.get("config")]
    slots = [p for r in with_config for p in (r["config"].get("parts") or [])]
    optional = sum(1 for p in slots if p.get("optional"))
    one_slot = sum(1 for r in with_config if len(r["config"].get("parts") or []) == 1)
    base_slots = [p for p in slots if p.get("name") == "base"]
    base_optional = sum(1 for p in base_slots if p.get("optional"))
    required_any = sum(
        1
        for r in with_config
        if any(not p.get("optional") for p in (r["config"].get("parts") or []))
    )
    out.append(("tiles with a config", f"{len(with_config)} ({pct(len(with_config), n)})", "declares accessory slots"))
    out.append(("configs with exactly one slot", f"{one_slot} ({pct(one_slot, len(with_config))} of configs)", ""))
    out.append(("slots total", str(len(slots)), ""))
    out.append(("slots optional", f"{optional} ({pct(optional, len(slots))})", ""))
    out.append(("base slots", f"{base_optional}/{len(base_slots)} optional", "NOT all — the exceptions are required"))
    out.append(("tiles with a REQUIRED slot", f"{required_any} ({pct(required_any, n)})", "the only tiles that are genuinely incomplete alone"))
    self_sufficient = n - required_any
    out.append(("self-sufficient tiles", f"{self_sufficient} ({pct(self_sufficient, n)})", "no required companion part"))

    # ------------------------------------------------------------ accessory mounts
    # The work list `npm run mounts` reads, re-derived from the fixtures rather
    # than from the index, so the two have to agree. The tool keys on md5 because
    # a measurement is a property of the MESH -- `pipeline/mounts/inventory.json`
    # is filed by blob, and the 1,005 host records collapse to 995 host meshes.
    # `tools/mounts/corpus.test.ts` asserts the same four numbers against the
    # measured artefact; this row is the corpus's own statement of them.
    host_rows = [
        r
        for r in with_config
        if any(p.get("name") != JOINERY_SLOT for p in (r["config"].get("parts") or []))
    ]
    host_blobs = {
        (r.get("file_metadata") or {}).get("md5")
        for r in host_rows
        if (r.get("file_metadata") or {}).get("md5")
    }
    insert_blobs = {
        (r.get("file_metadata") or {}).get("md5")
        for r in live
        if layer_of(r) == "insert" and (r.get("file_metadata") or {}).get("md5")
    }
    out.append(("accessory host records", str(len(host_rows)), "live rows declaring a config slot that is not `base` — the corpus's own statement that something gets fitted in"))
    out.append(("accessory host blobs", str(len(host_blobs)), "distinct md5 among those rows — what the measuring run actually reads, and what the inventory is keyed on"))
    out.append(("insert blobs", str(len(insert_blobs)), "distinct md5 among live rows whose layer is `insert` — the meshes that get an anchor"))

    accessory_slots = [
        p for r in host_rows for p in (r["config"].get("parts") or []) if p.get("name") != JOINERY_SLOT
    ]
    unknown_slots = sorted({p.get("name") for p in accessory_slots if p.get("name") not in SLOT_CLASSES})
    slot_classes = Counter(SLOT_CLASSES.get(p.get("name"), "?") for p in accessory_slots)
    out.append(
        (
            "accessory slot declarations by class",
            f"{sum(slot_classes.values())}: " + ", ".join(f"{v} {k}" for k, v in sorted(slot_classes.items())),
            "counted per RECORD; across the host blobs it is 1,230, because rows sharing a mesh union their slots",
        )
    )
    if unknown_slots:
        failures.append(
            f"slot names with no class in SLOT_CLASSES, so the measuring run would skip them: {unknown_slots}"
        )
    if sum(slot_classes.values()) != len(accessory_slots):
        failures.append("the slot-class histogram does not account for every accessory slot")
    if len(host_blobs) > len(host_rows):
        failures.append("more host meshes than host records -- md5 is missing on some rows")

    # ---------------------------------------------------------------- textures
    roots = Counter()
    for r in live:
        for t in tags_of(r):
            if t.startswith("texture|"):
                roots[t.split("|")[1]] += 1
    untextured = sum(1 for r in live if not any(t.startswith("texture|") for t in tags_of(r)))
    # Two different true numbers, and they were being conflated. The corpus holds
    # 38 spellings; the shipped index holds 37, because `pipeline/normalise.ts`
    # collapses `texture|foundations` (2 tiles) into `texture|foundation` (51).
    # This script reads raw fixtures and stays the authority on the corpus, so it
    # reports both rather than being taught to forget one.
    canonical = {root for root in roots if root not in TEXTURE_ROOT_ALIASES}
    canonical |= {TEXTURE_ROOT_ALIASES[root] for root in roots if root in TEXTURE_ROOT_ALIASES}
    out.append(("distinct texture roots", str(len(roots)), "spellings present in the fixtures"))
    out.append(
        (
            "distinct texture roots (normalised)",
            str(len(canonical)),
            "what the shipped index carries; the tint map must cover these",
        )
    )
    out.append(("tiles with no texture tag", f"{untextured} ({pct(untextured, n)})", "fall back to the unknown material"))

    # ---------------------------------------------------------------- build tags
    no_build = sum(1 for r in live if not any(t.startswith("build|") for t in tags_of(r)))
    out.append(("no build| tag", f"{no_build} ({pct(no_build, n)})", "the build facet needs a first-class 'unspecified'"))

    wall_on_tile = sum(1 for r in live if "build|wall on tile" in tags_of(r))
    bases = sum(1 for r in live if any(t.startswith("shape|base") for t in tags_of(r)))
    bases_wot = sum(
        1 for r in live if "build|wall on tile" in tags_of(r) and any(t.startswith("shape|base") for t in tags_of(r))
    )
    out.append(("build|wall on tile", str(wall_on_tile), ""))
    out.append(("shape|base tiles", f"{bases} ({pct(bases, n)})", ""))
    out.append(("bases tagged wall on tile", str(bases_wot), "if 0, never join bases to toppers on the build tag"))

    # ---------------------------------------------------------------- file sizes
    sizes = sorted((r.get("file_metadata") or {}).get("size", 0) for r in live)
    total_gb = sum(sizes) / 1e9
    median_mb = sizes[len(sizes) // 2] / 1e6
    p95_mb = sizes[int(len(sizes) * 0.95)] / 1e6
    out.append(("total corpus", f"{total_gb:.1f} GB", ""))
    out.append(("median file", f"{median_mb:.2f} MB", ""))
    out.append(("p95 file", f"{p95_mb:.2f} MB", ""))
    out.append(("largest file", f"{sizes[-1] / 1e6:.1f} MB", ""))

    # ---------------------------------------------------------------- report
    width = max(len(f) for f, _, _ in out)
    print(f"# Catalog facts — re-derived from {fixtures}\n")
    print(f"| {'Fact'.ljust(width)} | Value | Definition |")
    print(f"| {'-' * width} | --- | --- |")
    for fact, value, definition in out:
        print(f"| {fact.ljust(width)} | {value} | {definition} |")

    if failures:
        print("\n## INVARIANT FAILURES\n")
        for f in failures:
            print(f"- {f}")
        return 1
    print("\nAll internal invariants hold.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
