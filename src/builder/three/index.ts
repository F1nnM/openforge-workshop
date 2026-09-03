/**
 * The instanced 3D builder, as one import — and a *deliberately* small one.
 *
 * ```tsx
 * import { Builder3DPanel } from '@/builder/three'
 * …
 * <Builder3DPanel catalog={planCatalog} scene={scene} tools={tools} assets={index.file.assets} />
 * ```
 *
 * ## This barrel must never re-export the renderer
 *
 * `BuilderRoom`, `InstancedTiles`, `loadLod.ts`, `place.ts`, `instances.ts` and
 * `useLodStore.ts` all import three.js, and a barrel that re-exported any of
 * them would put the whole 3D stack into the entry chunk of every module that
 * touched `@/builder/three` — including `BuilderScreen`, whose visitors may never
 * press the button. Vite would not warn; the bundle would simply grow. So the
 * rule is structural: **only `Builder3DPanel` and `lod.ts` are exported here**,
 * `Builder3DPanel` imports nothing heavy, and everything behind
 * `lazy(() => import('./BuilderRoom'))` is reached by deep import from tests and
 * from that one `lazy` call, never from here.
 *
 * `boundary.test.ts` asserts it by parsing this file's own imports, exactly as
 * `src/three/boundary.test.ts` does for the detail viewer — and since row R2 it
 * does so through `tools/boundary/closure.ts` rather than through a private
 * fifth copy of the same walker. That test reads the source; the **bundle** can
 * only be measured by a build, so it was — an A/B, the directory present and
 * then moved aside with the one call site in `BuilderScreen.tsx` removed
 * (`npx vite build`, this branch, re-measured on row R2):
 *
 * | chunk | without `src/builder/three/` | with it | this row's cost |
 * | --- | ---: | ---: | ---: |
 * | entry JS `index-*.js` | 506,098 / **162,314** | 506,225 / **162,399** | +127 / **+85 B** |
 * | entry CSS `index-*.css` | 44,870 / **9,337** | 45,082 / **9,354** | +212 / **+17 B** |
 * | `/builder` route JS | 96,129 / **30,715** | 98,442 / **31,537** | +2,313 / **+822 B** |
 * | `/builder` route CSS | 31,495 / **6,147** | 34,221 / **6,511** | +2,726 / **+364 B** |
 *
 * Raw / gzip, bytes. The two builds were run back to back on one tree, which is
 * what makes the *difference* trustworthy; the absolute figures drift as sibling
 * rows land shared code, so re-measure the pair rather than comparing one of
 * these numbers against a later build. `npx vite build` rather than
 * `npm run build`, because `tsc -b` fails on the deleted module — the bundle is
 * the measurement and vite does not typecheck.
 *
 * **102 B gzipped in the entry chunk and 1.19 kB in the `/builder` route
 * chunk**, for a row that added a whole interaction layer. Two things about that
 * table are worth stating rather than leaving to be discovered:
 *
 *   - **`/builder` is itself a lazy route**, which is why the entry cost is
 *     102 B and not the 1.6 kB the row before this one measured: that
 *     measurement predates the route split, so the "entry chunk" it named is now
 *     two chunks. The number that matters for a catalog visitor is the entry
 *     row; the number that matters for a builder visitor is the route row.
 *   - **The eager cost is mostly CSS.** `builder3d.css` grew 2.7 kB raw for the
 *     plates, the stacking order and the canvas focus ring, against 2.3 kB of JS
 *     for the panel and its types. Every kilobyte of the interaction layer
 *     proper is behind `lazy`.
 *
 * ## The other side of the line, and the shared-chunk question, answered
 *
 * | chunk | raw | gzip |
 * | --- | ---: | ---: |
 * | `material-*.js` — three + r3f + drei + `postprocessing` + n8ao, shared | 1,187,824 | **385,092** |
 * | `BuilderRoom-*.js` — this row's 3D code + `GLTFLoader` + meshopt | 108,359 | **33,981** |
 * | `Viewer-*.js` — the detail viewer's own shim over the shared chunk | 5,911 | 2,580 |
 *
 * **The row before this one left an open question and this A/B settles it.** It
 * predicted that *"when X2 lands, the shared renderer should be one chunk both
 * lazy imports pull, not two — which is a thing to check on that row rather than
 * assume"*. Checked here, and it already is: with this directory removed the
 * whole renderer collapses back into the detail viewer's chunk
 * (`Viewer-*.js`, **1,192,995 / 387,129**), and with it present rolldown hoists
 * the shared part into `material-*.js` and leaves each feature a small chunk of
 * its own. The renderer is therefore paid for **once** across both 3D surfaces,
 * and this row's own 3D code is the 33.98 kB gzipped in `BuilderRoom`.
 *
 * **Row R2 changed who pays it, and it is now everybody who opens `/builder`.**
 * The surface is open on arrival, because the owner asked for the 3D view to
 * *be* the builder rather than a panel behind a gate, so there is no press left
 * to withhold the chunk behind: arriving at `/builder` requests 31.54 kB
 * (route) + 33.98 kB (`BuilderRoom`) + 385.09 kB (shared renderer) gzipped. The
 * `lazy` boundary is still the right structure and `Builder3DPanel.tsx` says
 * why: the same bytes in the entry chunk would block first paint on **every**
 * screen, the catalog included, where behind `lazy` they are a parallel request
 * that resolves while the 5.6 MB catalog index this screen already waits on is
 * in flight. Blocker **B7** is what would make the *mesh* half of that arrival
 * cheap; this half is code, and is `immutable`-cached at the edge.
 *
 * ## Type-only exports are safe and are used
 *
 * `export type { … }` is erased at build time, so the room and instance types
 * are re-exported from here even though their modules import three. The boundary
 * test's import walker skips type-only specifiers for the same reason the bundler
 * does.
 */
export { Builder3DPanel } from './Builder3DPanel'
export type { Builder3DPanelProps } from './Builder3DPanel'

export {
  LOD_ABSENT_IS_EXPECTED,
  LOD_ATTRIBUTES,
  LOD_EXTENSIONS_REQUIRED,
  LOD_GLB_URL,
  LOD_LEVELS,
  LOD_MAX_TRIANGLES,
  LOD_MIN_TRIANGLES,
  LOD_NODE_TRANSFORM,
  LOD_PROJECTED_BYTES,
  LOD_PROJECTED_OBJECTS,
  LOD_ROOM_BUDGET_BYTES,
  LOD_UP_AXIS,
  LOD_VERTICES_PER_TRIANGLE,
  LodUrlError,
  MESHOPT_DECODER_IMPORT,
  POSTPROCESSING_THREE_RANGE,
  VERIFIED_THREE_VERSION,
  lodBudgetRefusal,
  lodGeometryBytes,
  lodGlbUrl,
  lodObjectBudget,
} from './lod'

export type { SurfaceEdit, SurfaceStatus } from './edits'
export type { FootprintDisagreement, LodGap, LodInstanceGroup, Room3D } from './instances'
export type { RoomSurfaceProps } from './RoomSurface'
export type { Ndc, SurfaceFit, SurfacePick } from './surface'
export type { LodGeometry } from './loadLod'
export type { MeshBounds, RoomFit } from './place'
export type { LodStoreState } from './useLodStore'
