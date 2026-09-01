# Test fixtures — where they came from

## `wall-8180da93.stl` — a real catalog mesh

The trap this row exists to avoid is a property of **real** STL geometry: a per-facet
normal, and no shared vertices. A synthetic mesh reproduces that (see `stl.ts`), but only
a real file proves the *corpus* has it — that Devon's exporter writes bitwise-identical
coordinates at shared corners, which is the sole reason `weld()` can merge anything at
all once the normals are dropped.

| | |
| --- | --- |
| Source object | `https://objects.openforge.tools/models/8180da/8180da93549154744c37f8370a82738f.stl` |
| Catalog tiles | `…/plain#base.IA.openlock+topless.stl`, manifest ordinals **1792** and **1802** (two rows, one mesh) |
| Design | `dacde5dc175c6` · texture `plain` |
| Bytes | 5,984 — binary STL, **118 facets** |
| md5 | `8180da93549154744c37f8370a82738f` (equals the object's ETag: single-part upload) |
| sha256 | `89b84650bbeccf4a7b30e7435abd5b2d6b8418d86303605f6341909cae729773` |
| Licence | CC BY-NC-SA 4.0 — OpenForge, Devon Jones. Used here as a test fixture only. |
| Rebuild | `tsx tools/lod/fixtures/mkfixture.ts` |

**Unmodified.** These are the bucket's bytes, byte for byte. At 5,984 bytes that is a
better trade than any derivative: it is smaller than the sprite-sheet fixture next door,
and shrinking a mesh would destroy the exact property being tested.

### Why this mesh and not a larger one

It is the **smallest mesh in the corpus that has any geometry** — the only smaller file is
84 bytes of valid binary header declaring zero facets, which is a separate test case and
needs no fixture. Two things follow, and the tests use both:

- Its 118 facets weld from 354 vertices to **59**, a ratio of 0.1667, which is within
  0.0003 of every other mesh measured across the corpus (71 K, 207 K, 359 K, 527 K and
  2.18 M triangles all land at 0.166–0.167). So a 6 KB fixture pins the same number a
  109 MB one would.
- It is far **below** the 20,000-triangle ceiling, so it is also the pass-through case:
  the pipeline must ship it undecimated rather than inflating it toward the 5,000-triangle
  floor.

The corpus's *interesting* meshes are 3.5–109 MB and cannot be checked in. Their figures
are recorded in the docblocks of `decimate.ts` and `mesh.ts`, measured against the live
bucket, and reproducible with `npm run lod -- --sample 36`.

## `stl.ts` — synthetic builders

No checked-in bytes. `icosphere(6)` is 81,920 triangles and 4.1 MB of STL, generated in
about 60 ms, which is the mesh the band tests need and is not something to commit. Every
builder writes a genuine per-facet normal into each 50-byte record, so
`facetNormals()` can read them back out and a test can construct the *wrong* document —
`POSITION` plus facet `NORMAL` — and assert that the weld guard fires on it.

## The 84-byte zero-facet object — reconstructed, not checked in

`models/489242/4892426c4728448564f2e13b048eea45.stl` is the corpus's smallest file: a
valid binary STL header declaring **zero facets**, written by Blender 4.0.1. Its 84 bytes
are entirely described by one header string and a zero, so `wall.ts` rebuilds it in five
lines and `wall.test.ts` hashes the result back to `4892426c4728448564f2e13b048eea45` —
which is the only proof a checked-in copy would have offered.

It is in the tests because it is the one file that must be **reported** rather than
crashed on or shipped. `src/three/gate.ts` already refuses 3D for a zero-byte record, and
an empty GLB filed under a real key would be worse than no object at all.

| | |
| --- | --- |
| Catalog tile | `tiles/aztlan/separate_walls/primary_walls/column/dragonlock/aztlan#column.col+T.side+dragonlock.stl` |
| Bytes | 84 — `80-byte header + uint32 0` |
| Header | `Exported from Blender-4.0.1` |
| md5 | `4892426c4728448564f2e13b048eea45` |
