/**
 * The instanced 3D builder, as one import — and a *deliberately* small one.
 *
 * ```tsx
 * import { Builder3DPanel } from '@/builder/three'
 * …
 * <Builder3DPanel catalog={planCatalog} placements={placements} assets={index.file.assets} />
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
 * `src/three/boundary.test.ts` does for the detail viewer. That test reads the
 * source; the **bundle** can only be measured by a build, so it was — an A/B, the
 * directory present and then moved aside with the one call site removed,
 * comparing the entry chunk (`vite build`, this branch):
 *
 * | | entry JS raw | entry JS gzip | entry CSS raw | entry CSS gzip |
 * | --- | --- | --- | --- | --- |
 * | without `src/builder/three/` | 620.14 kB | 196.25 kB | 56.97 kB | 11.15 kB |
 * | with it | 623.56 kB | 197.57 kB | 58.73 kB | 11.44 kB |
 * | **this row's eager cost** | **3.42 kB** | **1.32 kB** | **1.76 kB** | **0.29 kB** |
 *
 * The two builds were run back to back on one tree, which is what makes the
 * *difference* trustworthy; the absolute figures drift by a few hundred bytes as
 * sibling rows land shared code, so re-measure the pair rather than comparing one
 * of these numbers against a later build.
 *
 * **1.61 kB gzipped, JS and CSS together.** The other side of the line:
 *
 * | chunk | raw | gzip |
 * | --- | --- | --- |
 * | `BuilderRoom` — three + r3f + drei + postprocessing + n8ao + `GLTFLoader` + meshopt | 1,267.53 kB | **411.11 kB** |
 *
 * So the cost of shipping this row to somebody who plans a room in 2D and never
 * asks for the 3D view is 1.61 kB gzipped, and the 411 kB is paid by the person
 * who pressed the button. Two things about that second table are worth stating
 * rather than leaving to be discovered:
 *
 *   - **Before this row three.js was not in the shipped bundle at all.** Build A
 *     emits one JS chunk and one stylesheet, full stop — `Tile3DPanel` is not yet
 *     mounted anywhere (row **X2** puts it in the drawer), so its 420 kB
 *     `Viewer` chunk has never been reachable from an entry. This is the first PR
 *     to put a three chunk in `dist/`.
 *   - **The two features will share it, because they share `Stage`.** 411 kB here
 *     against the 419.70 kB `src/three/index.ts` measured for `Viewer` in
 *     isolation: this chunk carries `GLTFLoader` and the meshopt decoder that one
 *     does not, and lacks the STL worker path and the viewer's own UI. When X2
 *     lands, the shared renderer should be one chunk both lazy imports pull, not
 *     two — which is a thing to check on that row rather than assume.
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

export type { FootprintDisagreement, LodGap, LodInstanceGroup, Room3D } from './instances'
export type { LodGeometry } from './loadLod'
export type { MeshBounds, RoomFit } from './place'
export type { LodStoreState } from './useLodStore'
