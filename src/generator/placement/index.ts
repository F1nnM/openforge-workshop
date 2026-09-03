/**
 * A generated base as a first-class placement — the public seam.
 *
 * ```ts
 * // in the drawer, where the resolver already lives
 * const placed = placeRecipe(recipe, resolution, { x, z, rotation })
 * if (placed.kind === 'archived') placeTile(placed.placement)
 * else scene[nextId()] = placed.placement
 *
 * // in the plan view
 * const candidates = [...planScene.pieces, ...generatedIds.map((id) =>
 *   generatedOverlapCandidate(id, scene[id]))]
 * const conflicts = findConflicts(candidates)
 *
 * // in the bill panel
 * const bill = buildGeneratedBill(scene, { meshes, ambiguous })
 *
 * // in the download path
 * const section = buildGeneratedPack(bill, holdings)
 * const plan = buildArchivePlan(catalogBill, { assets, generated: section })
 * const zip = openArchiveStream(plan, { source: generatedBlobSource(holdings, r2BlobSource(assets)) })
 * ```
 *
 * ## What this barrel deliberately does not do
 *
 * It does not re-export {@link placeRecipe}'s module as a shortcut into the rest.
 * S4's `panel/index.ts` learned this the expensive way: re-exporting the
 * resolver and `usePreview` for *this row's* benefit dragged `engine/index.ts`
 * into the entry chunk and took it from 642,640 B to 664,608 B, with nothing
 * failing. The same hazard applies one level down here, so the graph is split by
 * weight and the split is asserted in `boundary.test.ts`:
 *
 * | module | reaches | who imports it |
 * | --- | --- | --- |
 * | `scene.ts` | `zod` | the store, the canvas, everything |
 * | `provenance.ts` | nothing at all | every describing site |
 * | `geometry.ts` | W6's geometry, `@/materials` | the canvas |
 * | `bill.ts` | the above, and nothing more | the bill panel |
 * | `placement.ts` | `panel/recipe`, `panel/resolve`, `panel/schemas` | the drawer only |
 * | `pack.ts` | `engine/md5`, and `./notice` **dynamically** | the download path only |
 * | `notice.ts` | 11 KB of Apache-2.0 licence, as `?raw` | nothing statically |
 *
 * The two rows at the bottom are the weight. `placement.ts` needs `recipeKey`,
 * which needs 25 KB of pinned parameter JSON; `pack.ts` carries 11 KB of
 * Apache-2.0 licence text, which has to ride with a generated mesh and must not
 * ride with a bill row. Both are exported from here **by name** so a caller can
 * still write one import, and neither is reached by the light modules — but a
 * caller that only draws or only lists should import `./geometry` or `./bill` by
 * path, the way `src/builder/three` reaches `@/three/gate`.
 *
 * The measurement that fixed the table: wiring the bill from `BuilderScreen`
 * with `bill.ts` importing `recipeId` from `panel/recipe.ts` took the entry
 * chunk from **644,915 B to 665,083 B** and emptied S4's lazy drawer chunk of
 * the pinned schemas — the 664,608 B regression S4's `boundary.test.ts` exists
 * to prevent, arrived at from the other side. `scene.ts`'s
 * {@link recipeHandle} is the answer, with an equivalence test instead of an
 * import; the one-line fix that would make it an import again is reported to S4.
 *
 * And the measurements for whoever wires this up, all A/B builds of the same
 * tree at `SOURCE_DATE_EPOCH`, entry chunk raw / gzipped:
 *
 * | wiring | entry chunk | drawer chunk |
 * | --- | ---: | ---: |
 * | this row as merged, nothing importing it | 644,915 / 201,345 | 45,679 |
 * | `./scene` + `./geometry` + `./bill` by path from `BuilderScreen` | 648,981 / 203,024 | 45,271 |
 * | plus `./pack` from the download hook | **654,241 / 205,125** | 45,350 |
 * | **this barrel** from `BuilderScreen` instead | 687,964 / 213,984 | 29,151 |
 *
 * Read the last row: importing the barrel from the eager screen costs
 * **+43,049 B raw / +12,639 B gzipped** and *empties* S4's lazy drawer chunk,
 * because the barrel names `placement.ts` (the pinned schemas) and the screen is
 * itself eager. So reach for `./scene`, `./geometry` and `./bill` **by path**
 * from the screen; call `placeRecipe` from *inside* the drawer, which already
 * holds the schemas; and reach `./pack` only from the download hook. The 11 KB
 * of Apache licence is a fourth chunk either way — see `notice.ts`.
 */
export type {
  GeneratedBaseId,
  GeneratedPlacement,
  GeneratedRecipe,
  GeneratedScene,
} from './scene'
export {
  GENERATED_ENTRIES,
  GENERATED_ID_PREFIX,
  GENERATED_SHAPES,
  GeneratedBaseId as GeneratedBaseIdSchema,
  GeneratedPlacement as GeneratedPlacementSchema,
  GeneratedRecipe as GeneratedRecipeSchema,
  generatedBaseId,
  generatedPlacementKey,
  isGeneratedBaseId,
  recipeHandle,
  recipeKeyOf,
} from './scene'

export {
  ABSENT_NOTE,
  ARCHIVE_PROVENANCE,
  SCAD_PIN,
  SCAD_UPSTREAM,
  SELF_ADDRESSED_PHRASE,
  UNRENDERED_NOTE,
  ambiguousNote,
  generatedProvenance,
  selfAddressedNote,
} from './provenance'

export type { GeneratedFootprint, GeneratedPiece } from './geometry'
export {
  GENERATED_TEXTURE_TAG,
  GeneratedGeometryError,
  describeGeneratedPiece,
  generatedFootprint,
  generatedOverlapCandidate,
  generatedPiece,
  generatedStyle,
} from './geometry'

export type {
  GeneratedBill,
  GeneratedBillLine,
  GeneratedBillOptions,
  GeneratedMeshFacts,
  GeneratedMeshes,
} from './bill'
export { buildGeneratedBill } from './bill'

export type { ArchivedPlacement, GeneratedBasePlacement, PlaceAt, RecipePlacement } from './placement'
export { GENERATED_ROTATION_STEP_DEG, GeneratedPlacementError, placeRecipe } from './placement'

export type { GeneratedMeshHold, GeneratedMeshHoldings } from './pack'
export {
  GENERATED_NOTICE_NAME,
  GeneratedMeshMissingError,
  GeneratedMeshRefusedError,
  buildGeneratedPack,
  generatedBlobSource,
  loadGeneratedNotice,
  urlListShortfall,
  verifyGeneratedMesh,
} from './pack'

// `./notice` is **not** re-exported, statically or otherwise. It holds 11 KB of
// Apache-2.0 licence text, and a named re-export here would put that text in the
// static graph of everything that imports this barrel — which is the 20,834 B
// its own docblock measured. Reach it through `loadGeneratedNotice()`.
