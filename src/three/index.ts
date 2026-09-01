/**
 * The gated 3D viewer, as one import — and it is a *deliberately* small one.
 *
 * ```tsx
 * import { Tile3DPanel } from '@/three'
 * …
 * <Tile3DPanel record={record} tags={tags} assets={catalog.assets} />
 * ```
 *
 * ## This barrel must never re-export the renderer
 *
 * `Stage`, `Viewer`, `StlModel`, `useStlModel`, `geometry.ts` and `material.ts`
 * all import three.js, and a barrel that re-exported any of them would put the
 * whole 3D stack in the entry chunk of every module that touched `@/three` —
 * including the catalog screen, whose visitors may never open a tile. Vite would
 * not warn; the bundle would simply grow by ~1 MB. So the rule is structural:
 * **only `Tile3DPanel` and `gate.ts` are exported here**, `Tile3DPanel` imports
 * nothing heavy, and everything behind `lazy(() => import('./Viewer'))` is
 * reached by deep import from the dev harness and from tests, never from here.
 *
 * `boundary.test.ts` asserts it, by parsing this file's own imports.
 *
 * Measured, with a build whose only entry is `createRoot().render(<Tile3DPanel/>)`:
 *
 * | chunk | raw | gzip |
 * | --- | --- | --- |
 * | entry, **with** the panel | 193.84 kB | 61.42 kB |
 * | entry, React alone (baseline) | 190.32 kB | 59.92 kB |
 * | **the panel's eager cost** | **3.52 kB** | **1.50 kB** |
 * | `Viewer` — three + r3f + drei + postprocessing + n8ao | 1,296.72 kB | **419.70 kB** |
 * | the parse worker | 2.99 kB | — |
 * | `three.css` | 1.87 kB | 0.72 kB |
 *
 * So the cost of shipping this feature to a catalog-only visitor is 1.5 kB
 * gzipped, and the 420 kB is paid by the person who asked to see a mesh. Within
 * the viewer chunk, measured by removing one dependency at a time:
 * three + r3f + drei is 270.41 kB gz, `postprocessing` + n8ao adds 89.4 kB, and
 * `SMAAEffect` alone adds **59.9 kB** (its search and area lookup textures are
 * base64 in the bundle). drei's `OrbitControls` is 3.7 kB of it — the dedupe
 * works and `stats-gl`'s nested `three@0.170` never enters the graph.
 *
 * ## What disposal covers, and what it does not
 *
 * r3f disposes what it constructed from JSX and the `WebGLRenderer` it created
 * when `<Canvas>` unmounts. Everything else in this feature is created
 * imperatively, and each has a named owner:
 *
 * | Resource | Released by | When |
 * | --- | --- | --- |
 * | `BufferGeometry` from the worker payload | `useStlModel` effect cleanup | unmount, or the record changing |
 * | `MeshStandardMaterial` | `releaseMaterial`, by refcount | when the last holder lets go |
 * | `EffectComposer` + `RenderPass`/N8AO/SMAA render targets | `PostStack` effect cleanup | `<Canvas>` unmount |
 * | Parse worker | `StlParser.terminate()` | unmount, or an abort |
 * | In-flight fetch | `AbortController` | unmount |
 * | `WebGLRenderer`, its context, the JSX lights | r3f | `<Canvas>` unmount |
 *
 * What is **not** covered, stated rather than implied:
 *
 * - **The `WebGLRenderingContext` itself is not guaranteed to go away.** r3f
 *   calls `renderer.dispose()`, which releases three's own resources, but
 *   reclaiming the GPU context is the browser's decision. Browsers cap live
 *   contexts (~16 in Chrome) and drop the oldest, so a page that mounted and
 *   unmounted dozens of canvases can lose the *earliest* one. One drawer at a
 *   time is well inside that, and this is a note for whoever builds a grid of
 *   live previews: they need one shared canvas, not one per card.
 * - **The material cache survives unmount by design.** Refcounted entries drop to
 *   zero and dispose; the `Map` itself stays. `clearMaterialCache()` exists for a
 *   full teardown and nothing in the app calls it.
 * - **Nothing here disposes the transferred `ArrayBuffer`s**, because there is
 *   nothing to dispose: the fetched buffer is detached by the transfer into the
 *   worker, and the positions buffer becomes the geometry's attribute and dies
 *   with it.
 *
 * ## The download path is elsewhere and stays elsewhere
 *
 * §10 obligation 3 — a preview mesh must never reach someone's printer. This
 * viewer cannot deliver one: it fetches through PR 11's `BlobSource`, which takes
 * a content address rather than a URL, and the only thing that crosses back from
 * the parse worker is a `Float32Array` of positions. There is no code path from a
 * mounted viewer to bytes the archive would recognise, and no second URL builder.
 */
export type { Tile3DPanelProps } from './Tile3DPanel'
export { Tile3DPanel } from './Tile3DPanel'

export type { GateDecision, ViewerMode } from './gate'
export {
  STL_BINARY_FACET_BYTES,
  STL_BINARY_HEADER_BYTES,
  STL_GATE_BYTES,
  estimateBinaryTriangles,
  estimateGeometryBytes,
  formatMegabytes,
  stlGate,
} from './gate'
