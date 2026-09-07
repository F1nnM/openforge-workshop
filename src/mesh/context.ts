/**
 * The catalog derivations that decide *which meshes exist* — built once per
 * session, from the index the shell has already fetched.
 *
 * ## Why this module exists rather than a prop
 *
 * `tiers.ts` states its contract as `ensureSceneMeshes(queue, tiles,
 * aggregates)`, and the third argument is the reason this file exists: the
 * warmer is a **store subscription**, armed once in `src/App.tsx`, so there is
 * no component to hang a `useMemo` on and nowhere for a prop to arrive from.
 *
 * An {@link AggregateIndex} is a pure function of the catalog file, and so is an
 * {@link AssemblyIndex}. Both are therefore memoised here at module scope — the
 * same argument `src/screens/catalog/catalogIndex.ts` makes for the search
 * engine: a pure function of a version-stamped build artefact cannot change
 * under a running session, so module scope is the *correct* lifetime rather than
 * a cache with an invalidation problem.
 *
 * Two consumers, and they are why this is a module and not a local `useMemo`:
 *
 *   - `warm.ts`, which runs outside React entirely and reads
 *     {@link MeshContext.aggregates} — `byTile` to turn a fill's file into a
 *     blob, `byDesign` to reach the background tier's candidates.
 *   - `src/builder/three/BuilderRoom.tsx`, which resolves the same memo in an
 *     effect rather than taking a prop, because threading one would cross two
 *     files it does not own.
 *
 * ## Rule 1 is gone, and `autoInsertedBase` went with it
 *
 * This module used to export `autoInsertedBase(design, assembly, lock)`, which
 * asked `resolvePlacement` what base rule 1 would insert under a topper. Row A1
 * ended that question: **a template declares its base as an explicit slot**, so
 * the base is an ordinary key of `fills` naming an exact file, and it reaches
 * this directory through `warm.ts#sceneTiles` beside every other part. There is
 * no longer a base that has to be *inferred*, so inferring one would be a second
 * answer to a question the scene has already answered — the divergence class
 * where a room draws a base the bill does not list.
 *
 * It could not have survived in any case: it took a `Placement`, the
 * `{ design, x, z, rotation }` record A1 deleted, and there is nothing in a
 * `TemplateInstance` to build one from. Deleting it rather than repointing it is
 * contract **C-h** applied one file over — every reader becomes a compile error
 * instead of silently describing a fraction of a multi-part placement.
 *
 * ## The cost, measured, and the seam it leaves
 *
 * `BuilderScreen` already builds an assembly index over the same file, so this
 * memo is a second copy of it for the life of the session. Measured over the
 * emitted index (8,702 records, 1,963 bases): `buildAggregateIndex` and
 * `buildAssemblyIndex` together are **43 ms and about 3 MB**, paid once, off the
 * first paint — the subscription resolves this only when the scene names a file.
 * {@link MeshContext.assembly} is kept for the room's sake alone now that rule 1
 * is gone from this file; the row that owns `builder/three/` should drop the
 * field the day nothing there reads it.
 *
 * ## `loadCatalogIndex` is injectable, and no test ever reaches the network
 *
 * The default is `@/ui/shell/loadCatalog`'s memoised fetch — imported by deep
 * path rather than through `@/ui/shell`, so this module does not pull `AppFrame`
 * and the rail into whatever chunk it lands in. That is `queue.ts`'s own
 * pattern with `@/download/source`, and for the same reason. That loader's own
 * docblock says it belongs in `src/catalog/`; when it moves, this import moves
 * with it and nothing else changes.
 */
import type { AssemblyIndex } from '@/assembly'
import { buildAssemblyIndex } from '@/assembly'
import type { AggregateIndex, CatalogFile } from '@/catalog'
import { buildAggregateIndex } from '@/catalog'
import { loadCatalogIndex } from '@/ui/shell/loadCatalog'

/** What a caller needs to turn a scene's fills into meshes. */
export interface MeshContext {
  readonly file: CatalogFile
  /**
   * File → variant and design → aggregate. `planSceneMeshes` takes `byTile` off
   * this for the eager tier and `byDesign` for the background one.
   */
  readonly aggregates: AggregateIndex
  /** The resolver's index. Read by `builder/three/`, not by this directory. */
  readonly assembly: AssemblyIndex
}

/** How the file is obtained. Replaced in tests; never stubbed in production. */
export type CatalogLoader = () => Promise<CatalogFile>

let loader: CatalogLoader = loadCatalogIndex
let pending: Promise<MeshContext> | null = null

/**
 * The session's derivations, built at most once.
 *
 * A rejection is not memoised, for `loadCatalogSearchIndex`'s reason: a network
 * blip must not make every later caller fail for the rest of the session. The
 * next call retries.
 */
export function meshContext(): Promise<MeshContext> {
  pending ??= build()
  const attempt = pending
  attempt.catch(() => {
    if (pending === attempt) pending = null
  })
  return attempt
}

async function build(): Promise<MeshContext> {
  const file = await loader()
  return { file, aggregates: buildAggregateIndex(file), assembly: buildAssemblyIndex(file) }
}

/**
 * Point this module at a fixture, and drop whatever it had built.
 *
 * For tests, and it is the whole reason the loader is a module variable rather
 * than a parameter: the *point* of this module is that two unrelated callers see
 * one memo, and a parameter would give each of them its own.
 */
export function setCatalogLoader(next: CatalogLoader): void {
  loader = next
  pending = null
}

/** Drop the memo and restore the real loader. What a test's `afterEach` calls. */
export function resetMeshContext(): void {
  loader = loadCatalogIndex
  pending = null
}
