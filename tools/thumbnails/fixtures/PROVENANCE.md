# Test fixture — where it came from

`sheet-4896685b.mini.webp` is **derived from a real sprite sheet in the OpenForge
bucket**, not synthesised. It exists because the one thing this tool must not get wrong is
which frame it crops, and a synthetic checkerboard cannot prove that: it would agree with a
column-major reading of the grid just as happily as with the correct row-major one.

| | |
| --- | --- |
| Source object | `https://objects.openforge.tools/sprites/489668/4896685b1a1d9855ccd33999a303c195.png` |
| Catalog tile | `tiles/aztlan/s2w/corner/door#corner+s2w/aztlan#corner,door.2x.openforge,side+dragonlock.stl` (manifest ordinal 32) |
| Source | 2560×1024 RGBA PNG, 874877 bytes, sha256 `b226b2504e8103cd9edd6226386269185a1978b2ad2fdf8441bc9a02eef29178` |
| Fixture | 640×256 lossless WebP, 82578 bytes, sha256 `fef5ae0ed95bffcfdb4b60e42ca3a4b1c79ff620198a74700dc8290df410cfaa` |
| Licence | CC BY-NC-SA 4.0 — OpenForge, Devon Jones. Used here as a test fixture only. |
| Rebuild | `tsx tools/thumbnails/fixtures/mkfixture.ts` |

## What was done to it

Each of the ten 512 px frames was cropped from the source at its native size and
downscaled independently to 128 px with Lanczos-3, then reassembled into the same
**row-major 2×5** grid. So every frame is real render content of a real camera angle, and
the grid the tests exercise is the real grid. Lossless WebP, so the fixture's pixels are
exactly what the assertions compare against.

Frame size is not baked into this tool — it is read from `CatalogFile.sprite` — which is
why shrinking the frames costs the tests nothing. `geometry.test.ts` separately asserts the
tool's arithmetic against the real 512 px `MEASURED_SPRITE_SHEET`.

## Why this sheet and not the first one in display order

It is **strongly asymmetric**. `src/screens/detail/spriteFrames.ts` measured its frames by
mean absolute per-channel difference and found the pairs upstream's `camera_pos` metadata
wrongly reports as identical differ by 27.0, 27.0 and 12.6.

The obvious alternative — `87076088…`, the 1×1 Aztlan floor at ordinal 0 — is four-fold
symmetric, and its eight ring frames collapse into two clusters of four at MAD ≤ 2.3.
Against that sheet a "the crop is frame 0, not frame 3" assertion would pass while the tool
cropped the wrong frame.
