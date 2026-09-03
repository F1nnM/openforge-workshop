# Test fixtures — where they came from

Row **G2**'s dependency on row **G1** is a *contract* dependency: the two share no files, so
nothing in either row's file list can catch a disagreement, and G2 "renders nothing if the shape
differs". Prose in a docblock cannot close that gap. These two GLBs can, because they were
produced by **G1's own pipeline** from **G1's own real-mesh fixture**, and `../contract.test.ts`
loads them through the exact `GLTFLoader` + `MeshoptDecoder` path the app uses.

## `wall-8180da93.glb` — the compressed case

| | |
| --- | --- |
| Source mesh | `tools/lod/fixtures/wall-8180da93.stl` — see that directory's `PROVENANCE.md` |
| Source object | `https://objects.openforge.tools/models/8180da/8180da93549154744c37f8370a82738f.stl` |
| Catalog tiles | `…/plain#base.IA.openlock+topless.stl`, manifest ordinals **1792** and **1802** |
| Bytes | 2,052 |
| sha256 | `48b007f3af97ecffd7910556b89a1064c60ddc9992e94266bb14266f64ff9aff` |
| Triangles / vertices | 118 / 59 — `passThrough: true`, below G1's 5,000 floor |
| Weld | 354 → 59 vertices, ratio 0.1667 |
| Compression | `EXT_meshopt_compression` (with `KHR_mesh_quantization`) |
| Licence | CC BY-NC-SA 4.0 — OpenForge, Devon Jones. A test fixture only. |

**This is the footgun, in 2 kB.** Loaded through `GLTFLoader` with the meshopt decoder:

| | |
| --- | --- |
| `geometry.boundingBox` size | 2.000 × 1.000153 × 0.472427 |
| `node.matrixWorld` scale | 12.7, uniform |
| `node.matrixWorld` translation | (0, 0, 3) |
| **world bounding box** | **25.400 × 12.702 × 6.000 mm** |
| world `min` | (−12.700, −6.351, 0.0001) |
| attributes | `position` only — no `normal` |
| `material.flatShading` | `true`, set by nobody |

So `geometry` alone is a 2-unit mesh and only `matrixWorld` is in millimetres — a 12.7× error that
no test on the plan side and no type in either row would have caught. G1 measured the same shape on
the corpus's largest mesh (a boss door): geometry box 2.000 × 0.251 × 1.813, scale 50.8132, world
box 101.626 × 12.741 × 92.123 mm.

Note the world `min` as well as the size: `min.z` is 0 and the 6 mm dimension is the **height**.
The store carries the STL's own axes, so it is **Z-up**, and glTF's container convention is Y-up.
`place.ts` rotates −90° about X, which is the same rotation `src/three/StlModel.tsx` measured for
the raw-STL viewer.

## `wall-8180da93.plain.glb` — the uncompressed case

The same mesh through `decimate(stl, { meshopt: false })`. 3,144 bytes, sha256
`3b0140cb35c5593732d70739e296daf77a2881b9ea36f706b885ef4e7eb1f111`, identity node transform, and
its geometry is **already** 25.400 × 12.700 × 6.000 mm.

It is here because it is the case that makes the compressed one's failure mode legible: the same
consumer code must produce the same millimetres from both, and only one of them needs the decoder.
It also pins the claim that G1's `--no-meshopt` path yields `nodeTransform: 'identity'`.

## Rebuilding them

Both are derived, so neither needs to be trusted. From the repository root:

```sh
npx tsx -e "
import { writeFileSync } from 'node:fs'
import { decimate } from './tools/lod/decimate'
import { fixtureStl, FIXTURE_BLOB } from './tools/lod/fixtures/wall'
void (async () => {
  const stl = new Uint8Array(fixtureStl())
  const stem = 'src/builder/three/fixtures/wall-' + FIXTURE_BLOB.slice(0, 8)
  writeFileSync(stem + '.glb', (await decimate(stl, { meshopt: true })).glb)
  writeFileSync(stem + '.plain.glb', (await decimate(stl, { meshopt: false })).glb)
})()
"
```

(The async wrapper is not decoration: `tsx -e` transforms to CJS, where a top-level `await` is a
build error rather than a runtime one.)

Verified reproducible — a second run produces both sha256s above, bit for bit.

They are checked in rather than generated in the test, and the reason is the boundary this row is
built around: `src/**` may not import `tools/**`. `tsconfig.app.json` includes `src` only, so an
import of `tools/lod/decimate` from a test in this directory is a TS6307, and `decimate` pulls
`node:crypto`, `@gltf-transform/*` and `meshoptimizer` — three dev-time dependencies that have no
business in the app project's graph. Four kilobytes of committed bytes is the cheaper answer.

If a G1 change alters these bytes, regenerate them **and read the diff in
`../contract.test.ts`'s numbers**: that is the contract moving, and it is exactly the event the
fixture exists to make visible.
