/**
 * The generator panel's public seam.
 *
 * **One value is exported here, and that is the rule rather than an oversight.**
 * `GeneratorPanel` is React, a `lazy()` and two type imports. Everything else in
 * this row is imported by path — `@/generator/panel/resolve`,
 * `@/generator/panel/recipe`, `@/generator/panel/footprint` — the way
 * `src/builder/three` reaches `@/three/gate`.
 *
 * The reason is an A/B build. This barrel originally re-exported the resolver,
 * the recipe and `usePreview`, and because `BuilderScreen` imports the panel
 * from here, that re-export dragged `usePreview.ts` into the entry chunk — and
 * with it `engine/index.ts`, whose dynamic imports then emitted the 298 kB
 * worker chunk, plus the sweep tables and 25 KB of pinned schema JSON. Measured:
 * **642,640 B** eager with no panel at all, **664,608 B** with the barrel as it
 * was and the drawer stubbed out, and **643,485 B** as it stands — one eager
 * chunk in all three cases, so the three are directly comparable. The
 * difference between a seam and a barrel here was 22 kB of entry bundle and
 * nothing failing. `boundary.test.ts` walks the static graph from this file and asserts
 * it reaches neither the engine nor the resolver.
 *
 * ## What row S5 is handed, and from where
 *
 * All of it by path, none of it from this file:
 *
 *   - `BaseRecipe` (`./recipe`) — `{ v: 1, entry, parameters }`, the whole of what a
 *     build document stores for a generated base. **Persist this, never the
 *     mesh**: it is ~200 bytes against 0.5–2.4 MB, and it survives an engine
 *     upgrade as a cache miss rather than a broken reference.
 *   - `canonicalise` and `recipeKey` (`./recipe`) — the canonical form and the
 *     string two recipes are equal by. Two parameter sets that differ only in
 *     which defaults they spell out are one recipe, and this is where that is
 *     decided. `recipeId` is the 8-character handle for a bill row or a
 *     download filename, and nothing branches on it.
 *   - `baseFootprint` (`./footprint`) — the footprint in **squares**, the same units the
 *     catalog's own `Footprint` uses, plus the height and basis in millimetres
 *     and a `tiles` flag that is false for the three non-inch bases. It is
 *     arithmetic, so it is available in the frame the parameter changed, before
 *     any geometry exists.
 *   - `buildBaseResolver` (`./resolve`) — recipe to archived base. When it returns an
 *     `ArchiveBase`, S5 should place the archived md5 and put an
 *     `archive` bill line on it, not a generated one: the file downloaded is
 *     Devon's published STL. When it returns `null`, the placement carries the
 *     recipe and the bill line waits for a mesh.
 *   - `triangleCount` (`./usePreview`) — a generated mesh with zero triangles is a failure
 *     whatever OpenSCAD's exit status said, and S5 must not put one in a
 *     download pack.
 *
 * And one thing S5 must not do: **do not describe a generated base as the
 * archive's file.** `resolve.ts` carries the measurement — the archived bases
 * are ASCII STL from an older revision of this geometry, and 184 renders across
 * a 1x1 square's whole connector space matched neither its md5 nor its facet
 * count — so a resolved recipe and a rendered mesh are two different files that
 * the same parameters name.
 */
export { GeneratorPanel } from './GeneratorPanel'
export type { GeneratorPanelProps } from './GeneratorPanel'

// Types only below this line. A type export is erased, so none of these reach
// the entry chunk — which is the whole point of the note above.
export type { BaseRecipe, RecipeValue } from './recipe'
export type { BaseFootprint } from './footprint'
export type { ArchiveBase, ArchiveBaseClass, BaseResolver, FilenameParts, ResolverCensus } from './resolve'
export type { PanelEntry } from './schemas'
export type { ConnectionRow, Sweep, SweptBase } from './sweep'
export type { Preview, PreviewState } from './usePreview'
