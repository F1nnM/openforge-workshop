/**
 * The two catalog derivations that decide *which meshes exist* — built once per
 * session, from the index the shell has already fetched.
 *
 * ## Why this module exists rather than a prop
 *
 * Row R1 stated the add-to-library contract as
 * `ensureAggregateMeshes(meshQueue(assets), aggregate, { lock })` and left the
 * wiring to another row. Wiring it turned out to need a third input R1 did not
 * name, and the corpus is emphatic about why: **the mesh an openforge topper
 * needs is not only its own.** 1,878 of 3,822 items resolve, under openlock, to
 * a topper plus an auto-inserted base — rule 1 in `@/assembly` — and that base is
 * a *different design* with a *different blob*. `planAggregateMeshes` covers an
 * aggregate's own lock-reachable variants and nothing else, so without the base
 * the 3D room draws a floating topper over a footprint plate, which is precisely
 * the picture row **R3** exists to remove.
 *
 * Answering "which base" is {@link AssemblyIndex}'s job, and an assembly index is
 * a pure function of the catalog file. So is an {@link AggregateIndex}. Both are
 * therefore memoised here at module scope — the same argument
 * `src/screens/catalog/catalogIndex.ts` makes for the search engine: a pure
 * function of a version-stamped build artefact cannot change under a running
 * session, so module scope is the *correct* lifetime rather than a cache with an
 * invalidation problem.
 *
 * Two consumers, and they are why this is a module and not a local `useMemo`:
 *
 *   - `warm.ts`, which runs outside React entirely — it is a store subscription,
 *     armed once in `src/App.tsx`, and there is no component to hang a memo on.
 *   - `src/builder/three/BuilderRoom.tsx`, which needs the *base record* to draw
 *     it and cannot be handed one: `Builder3DPanel.tsx` and `BuilderScreen.tsx`
 *     belong to row **R4**, which is deleting the plan view as this row lands, so
 *     a new prop would have to be threaded through two files this row must not
 *     touch. Reading the derivation here instead means **R4 has nothing to
 *     reconcile.**
 *
 * ## The cost, measured, and the seam it leaves
 *
 * `BuilderScreen` already builds an assembly index over the same file, so this
 * memo is a second copy of it for the life of the session. Measured over the
 * emitted index (8,702 records, 1,963 bases): `buildAggregateIndex` and
 * `buildAssemblyIndex` together are **43 ms and about 3 MB**, paid once, off the
 * first paint — the subscription resolves this only when the library is
 * non-empty and the room resolves it in an effect. The seam worth naming: when
 * R4 collapses `BuilderScreen` onto the 3D surface, the screen's own index can be
 * passed down and this memo becomes the fallback for the non-React caller alone.
 *
 * ## `loadCatalogIndex` is injectable, and no test ever reaches the network
 *
 * The default is `@/ui/shell/catalogStats`'s memoised fetch — imported by deep
 * path rather than through `@/ui/shell`, so this module does not pull `AppFrame`
 * and the header into whatever chunk it lands in. That is `queue.ts`'s own
 * pattern with `@/download/source`, and for the same reason. That loader's own
 * docblock says it belongs in `src/catalog/`; when it moves, this import moves
 * with it and nothing else changes.
 */
import type { AssemblyIndex, AssemblyPart } from '@/assembly'
import { buildAssemblyIndex, resolvePlacement } from '@/assembly'
import type { AggregateIndex, CatalogFile, DesignId } from '@/catalog'
import { buildAggregateIndex } from '@/catalog'
import type { LockSystem, Placement } from '@/store/schema'
import { loadCatalogIndex } from '@/ui/shell/catalogStats'

/** What a caller needs to know which mesh a saved item, and its base, resolve to. */
export interface MeshContext {
  readonly file: CatalogFile
  /** Design → aggregate. `ensureDesignMeshes` takes `byDesign` off this. */
  readonly aggregates: AggregateIndex
  /** Rule 1's index — what `resolvePlacement` needs to name a base. */
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

/* ------------------------------------------------------------------ rule 1 */

/**
 * The base rule 1 would auto-insert under this item, under this preference — or
 * `undefined` when it inserts none.
 *
 * **{@link resolvePlacement} and nothing else**, because that function is the
 * only place in the project where a base enters a parts list: its own docblock
 * says *"a base enters a bill through this module and nowhere else"*, and the
 * match arrives already made by rule 0 so nothing is ranked twice. Anything
 * cheaper here — `matchBase` behind a `layer === 'topper'` test, say — would be a
 * second implementation of rule 1, and the failure mode is a room that draws a
 * base the bill does not list, or lists a base the room does not draw. Both are
 * lies about what the user is going to print.
 *
 * The placement is fabricated at the origin and that is safe rather than
 * convenient: resolution is *"a function of the placed item and the lock
 * preference only"*, and `x`, `z` and `rotation` are documented as carried
 * through untouched and never read. This is why the two callers can share one
 * function at all — `warm.ts` has no placement, and the 3D room has a real one.
 *
 * Measured over the emitted index, per lock, at the **design** level:
 *
 * | preference | items given a base | distinct base blobs | print option |
 * | --- | ---: | ---: | --- |
 * | openlock | **1,878** | 84 | 1,878 `plain` |
 * | dragonlock | 2,761 | 111 | 2,761 `plain` |
 * | magnetic | 2,765 | 112 | 2,763 `plain`, **2 `topless`** |
 * | none | 1,878 | 84 | 1,878 `plain` |
 *
 * The openlock column reproduces the v3 plan's `with-base` count of 1,878
 * exactly, and the other two exceed the plan's by the `mismatched` verdicts (2
 * and 12), which also receive a base. **84 distinct base meshes for the whole
 * corpus under openlock** is the number that makes drawing them affordable: a
 * room reuses them, and the median base is 0.91 MB against the median tile's
 * 10.77 MB.
 */
export function autoInsertedBase(
  design: DesignId,
  assembly: AssemblyIndex,
  lock: LockSystem | undefined,
): AssemblyPart | undefined {
  const placement: Placement = { design, x: 0, z: 0, rotation: 0 }
  const resolved = resolvePlacement(placement, assembly, lock === undefined ? {} : { lock })
  return resolved.parts.find((part) => part.role === 'base')
}
