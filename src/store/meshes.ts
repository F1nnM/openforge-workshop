/**
 * The generated meshes this session is holding — the bytes the persisted store
 * refuses to keep.
 *
 * Row S5 split a generated base in two and this is the half it left unowned:
 * `WorkshopState.generated` holds the **recipe and the position**, ~200 bytes of
 * JSON that survive an engine upgrade as a cache miss; the **STL** is 0.5–2.4 MB
 * that must never reach `localStorage`, and S5's record has no field one could
 * go in — asserted there by round-tripping a record carrying a mesh and checking
 * the field is gone. So the bytes live here, in a store with **no `persist`
 * middleware**, exactly the shape `schema.ts` names for state that must not come
 * back from last week's session and the shape row G5 used for the selection
 * channel.
 *
 * ## What a reload therefore does, stated rather than discovered
 *
 * The recipes come back and the meshes do not. Every generated base on a
 * reloaded plan is an **unrendered** one, and that is a state S5 already
 * designed for at all three sites: the outline is still exactly right, because
 * the footprint is arithmetic over the recipe and needs no geometry; the bill
 * row is `warn` and says the piece is on the plan and not in the download; and
 * the download **refuses** — `GeneratedMeshMissingError` — rather than shipping a
 * pack one file short. Re-opening the generator on that recipe fills this map
 * again.
 *
 * The alternative was persisting the bytes, and it is worse in three separate
 * ways: a fifty-base room is ~100 MB against a 5–10 MB `localStorage` quota, the
 * digest is only meaningful for the engine build that produced it (OpenSCAD is
 * not byte-deterministic across versions — §4.3), and a stale mesh under a
 * current recipe is the one failure this row's whole download path is arranged
 * against, because it opens cleanly and prints wrong.
 *
 * ## Keyed by base, not by placement
 *
 * A `GeneratedBaseId` **is** the canonical recipe key, so two placements of one
 * recipe share one hold and one pack entry — the same identity S5's bill groups
 * on and one level below the digest the pack dedupes on. Four copies of a 2×2
 * riser hold the mesh once.
 *
 * ## Why holds are released rather than accumulated
 *
 * A session that placed and removed twenty different bases would otherwise be
 * holding twenty meshes for nothing, which on this corpus is tens of megabytes
 * of resident memory with no reachable UI. {@link retainGeneratedMeshes} is the
 * write that fixes it, and `workshopStore.ts` calls it from the three actions
 * that can orphan a hold — remove, clear and reset — passing the bases the scene
 * still names. It is a *retain* set rather than a per-id release because
 * "nothing else references this base" is a question about the whole scene, and
 * asking it one id at a time is how a reference count goes wrong.
 *
 * The hold is **not** dropped when the drawer closes. A base placed in one
 * drawer session must still be in the next download, and the drawer's own
 * lifetime has nothing to do with the plan's.
 */
import { create } from 'zustand'

import { triangleCount } from '@/generator/panel/mesh'
import type { GeneratedMeshFacts } from '@/generator/placement/bill'
import type { GeneratedMeshHold, GeneratedMeshHoldings } from '@/generator/placement/pack'
import type { GeneratedBaseId } from '@/generator/placement/scene'

/**
 * The whole of the state: bytes by base.
 *
 * A plain object rather than a `Map`, so the store's value is replaced by a
 * spread and Zustand's `Object.is` comparison wakes exactly the subscribers
 * whose slice changed — the same reason `WorkshopState` keys its maps as
 * objects. {@link useGeneratedMeshes} is what turns it into the `ReadonlyMap`
 * S5's two seams take.
 */
export interface GeneratedMeshState {
  readonly holds: Readonly<Record<string, GeneratedMeshHold>>
}

export const useGeneratedMeshStore = create<GeneratedMeshState>()(() => ({ holds: {} }))

/**
 * Hold the bytes for one recipe.
 *
 * Called on the press that places a generated base, from the drawer that has the
 * mesh on screen — which is the only moment the bytes and the identity are both
 * in hand. Idempotent: re-placing the same recipe overwrites the hold with an
 * identical one, and the digest is what the download re-checks anyway.
 *
 * Nothing is validated here beyond identity. The four refusals live in
 * `pack.ts`, on the path where they matter, and they are re-run at plan time
 * *and* at the moment an entry is opened — checking here as well would give a
 * user an error at placement time for a mesh they can still see rendered.
 */
export function holdGeneratedMesh(base: GeneratedBaseId, hold: GeneratedMeshHold): void {
  useGeneratedMeshStore.setState((state) => ({ holds: { ...state.holds, [base]: hold } }))
}

/**
 * Drop every hold whose base the scene no longer names.
 *
 * A no-op returns the identical state object, so the common case — a removal
 * that orphans nothing, because another copy of the base is still placed — wakes
 * no subscriber.
 */
export function retainGeneratedMeshes(bases: Iterable<GeneratedBaseId>): void {
  const keep = new Set<string>(bases)
  useGeneratedMeshStore.setState((state) => {
    const surviving = Object.keys(state.holds).filter((base) => keep.has(base))
    if (surviving.length === Object.keys(state.holds).length) return state
    const holds: Record<string, GeneratedMeshHold> = {}
    for (const base of surviving) {
      const hold = state.holds[base]
      if (hold !== undefined) holds[base] = hold
    }
    return { holds }
  })
}

/** Drop every hold. The reset path, and what a test starts from. */
export function clearGeneratedMeshes(): void {
  useGeneratedMeshStore.setState({ holds: {} })
}

/**
 * The facts a bill row needs, derived from the held bytes.
 *
 * `triangles` is why `triangleCount` had to leave `usePreview.ts`: this runs in
 * the builder's eager chunk and that module value-imports the engine seam, whose
 * dynamic imports emit the 298 kB worker chunk. `@/generator/panel/mesh` has no
 * imports at all.
 *
 * A hold whose bytes are not a whole binary STL still produces a row here, with
 * whatever the header says — including zero. That is deliberate: refusing at
 * this layer would make the *bill* the thing that fails, and the bill's job is
 * to describe the plan. `pack.ts` is where a bad mesh stops the download, and it
 * stops it four different ways.
 */
export function meshFactsOf(hold: GeneratedMeshHold): GeneratedMeshFacts {
  return { md5: hold.md5, bytes: hold.bytes.byteLength, triangles: triangleCount(hold.bytes) }
}

/* --------------------------------------------------------------------- hooks */

/**
 * The holds, as the map S5's `buildGeneratedBill` takes.
 *
 * A new `Map` per call, so this is memoised on the state slice rather than
 * returned raw: an unmemoised derivation in a selector re-renders its component
 * on every store write, which for the bill panel would be every placement.
 */
export function useGeneratedMeshes(): ReadonlyMap<GeneratedBaseId, GeneratedMeshFacts> {
  const holds = useGeneratedMeshStore((state) => state.holds)
  return facts(holds)
}

/** The holds as `buildGeneratedPack` and `generatedBlobSource` take them. */
export function useGeneratedHoldings(): GeneratedMeshHoldings {
  const holds = useGeneratedMeshStore((state) => state.holds)
  return holdings(holds)
}

/**
 * Two module-scope memos, one per derived shape.
 *
 * The input is the store's own `holds` object, whose identity changes only when
 * a hold is added or dropped, so a one-entry cache is exact rather than
 * approximate: two components reading the same state get the same object, and a
 * write invalidates both. `useMemo` in each caller would give each component its
 * own copy and defeat the referential equality the download hook's
 * `useCallback` dependencies rest on.
 */
let lastFactsInput: Readonly<Record<string, GeneratedMeshHold>> | null = null
let lastFacts: ReadonlyMap<GeneratedBaseId, GeneratedMeshFacts> = new Map()

function facts(holds: Readonly<Record<string, GeneratedMeshHold>>): ReadonlyMap<GeneratedBaseId, GeneratedMeshFacts> {
  if (holds === lastFactsInput) return lastFacts
  lastFactsInput = holds
  lastFacts = new Map(
    Object.entries(holds).map(([base, hold]) => [base as GeneratedBaseId, meshFactsOf(hold)]),
  )
  return lastFacts
}

let lastHoldingsInput: Readonly<Record<string, GeneratedMeshHold>> | null = null
let lastHoldings: GeneratedMeshHoldings = new Map()

function holdings(holds: Readonly<Record<string, GeneratedMeshHold>>): GeneratedMeshHoldings {
  if (holds === lastHoldingsInput) return lastHoldings
  lastHoldingsInput = holds
  // The keys came out of `holdGeneratedMesh`, whose parameter is a
  // `GeneratedBaseId`, so re-branding them is a restatement rather than a claim.
  // `Object.entries` widens to `string` and there is no narrowing available: a
  // brand is a compile-time fiction with no run-time witness, which is the whole
  // point of it — the schema is where a string becomes one.
  lastHoldings = new Map(
    Object.entries(holds).map(([base, hold]) => [base as GeneratedBaseId, hold] as const),
  )
  return lastHoldings
}
