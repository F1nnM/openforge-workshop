#!/usr/bin/env python3
"""Re-derive every load-bearing number in architecture-plan.md from the catalog fixtures.

Run:  python3 docs/verify-catalog-facts.py [path-to-fixtures-dir]

Prints a markdown table. Exits non-zero if an internal invariant fails (counts that
must sum to the live total, percentages that must agree with their counts). The plan
quotes these numbers; CI should run this and fail the build when they drift.

Every definition used here is stated explicitly, because the first draft of the plan
quoted figures whose definitions were never written down and which turned out to be
irreproducible.
"""

from __future__ import annotations

import json
import pathlib
import sys
from collections import Counter, defaultdict

DEFAULT_FIXTURES = pathlib.Path(
    "/home/finn/Repos/openforge-catalog/openforge/db/fixtures/blueprints"
)

# Tags whose presence means a width/depth pair does NOT describe an axis-aligned
# rectangle. Derived from the shape vocabulary actually present in the corpus.
NON_RECT_MARKERS = ("curved", "radial", "concave", "convex", "hex")

LOCK_SYSTEMS = ("openlock", "dragonlock", "magnetic")

# `connection|side|openlock` puts a POSITION in the second segment, not a system.
# Reading segment 1 blindly invents a "side" connection system on the 2,081 tiles
# carrying any connection|side tag. Found by the PR 3 schema work.
CONNECTION_POSITIONS = ("side",)


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


def connection_systems(row: dict) -> set[str]:
    """The joinery systems a tile offers, ignoring position and variant segments.

    `connection|side|openlock` is openlock mounted on the side, not a "side"
    system. `connection|openlock|topless` is still openlock.
    """
    systems: set[str] = set()
    for tag in tags_of(row):
        if not tag.startswith("connection|"):
            continue
        parts = tag.split("|")[1:]
        if parts and parts[0] in CONNECTION_POSITIONS:
            parts = parts[1:]
        if parts:
            systems.add(parts[0])
    return systems


def is_non_rect(row: dict) -> bool:
    joined = " ".join(tags_of(row))
    return any(marker in joined for marker in NON_RECT_MARKERS)


def footprint_kind(row: dict) -> str:
    """The single primitive the Builder would use to place this tile.

    Order matters: a tile with width+depth that is also marked curved is an arc,
    not a rectangle, because the width/depth tags name its design family rather
    than its mesh extent.
    """
    width = numeric(row, "size|width")
    depth = numeric(row, "size|depth")
    radius = numeric(row, "size|radius")

    if radius is not None:
        return "arc"
    if is_non_rect(row):
        return "none"
    if width is not None and depth is not None:
        return "rect"
    if width is not None:
        return "wall"
    return "none"


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
    kinds = Counter(footprint_kind(r) for r in live)
    rect, wall, arc, none = kinds["rect"], kinds["wall"], kinds["arc"], kinds["none"]
    if rect + wall + arc + none != n:
        failures.append("footprint kinds do not partition the live set")

    out.append(("footprint RECT", f"{rect} ({pct(rect, n)})", "numeric size|width AND size|depth, no curve marker"))
    out.append(("footprint WALL_SEG", f"{wall} ({pct(wall, n)})", "numeric size|width only; depth is the 12.7 mm constant"))
    out.append(("footprint ARC", f"{arc} ({pct(arc, n)})", "has size|radius"))
    out.append(("footprint NONE", f"{none} ({pct(none, n)})", "no derivable footprint — never in the palette"))
    out.append(("coverage RECT only", pct(rect, n), "v1 lower bound"))
    out.append(("coverage RECT+WALL", pct(rect + wall, n), "v1 scope"))
    out.append(("coverage RECT+WALL+ARC", pct(rect + wall + arc, n), "v1.1 scope"))

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

    # ---------------------------------------------------------------- textures
    roots = Counter()
    for r in live:
        for t in tags_of(r):
            if t.startswith("texture|"):
                roots[t.split("|")[1]] += 1
    untextured = sum(1 for r in live if not any(t.startswith("texture|") for t in tags_of(r)))
    out.append(("distinct texture roots", str(len(roots)), "the tint map must cover all of these"))
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
