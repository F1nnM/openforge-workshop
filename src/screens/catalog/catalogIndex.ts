/**
 * The catalog screen's data dependency: one index, one engine, once per session.
 *
 * ## Why this is a module and not three lines in the screen
 *
 * The screen needs three things that all derive from the same document, and two
 * of them are expensive:
 *
 *   - the validated {@link CatalogFile} (5.6 MB of JSON; **88 ms** to fetch-parse
 *     and Zod-validate, measured over the emitted index);
 *   - a {@link SearchEngine} over it (**45 ms** to build the bitset facet index
 *     and the CSR text index);
 *   - de-interned tag lists, for the material a card's swatch reads from, and
 *     since row P3 the resolved material itself — four of the five subtrees
 *     that render `@/ui/thumb` need it and only one of them wanted the tags.
 *
 * All three are pure functions of a build artefact with a version stamp, so they
 * cannot change under a running session. Memoising them at module scope is
 * therefore not a cache with an invalidation problem; it is the correct
 * lifetime. The alternative — building the engine inside the component — rebuilds
 * it on every remount, which is every navigation away from `/catalog` and back.
 *
 * The fetch itself is **not** repeated: `loadCatalogIndex()` from `@/ui/shell` is
 * already memoised, so the landing screen's stats and this screen's engine share
 * one request and one parse. This module adds the engine layer on top of it.
 *
 * ## Why there is no loader on the route
 *
 * `src/routes/**` is PR 6's, and a route loader would put a data dependency in a
 * file this PR only swaps a `component:` reference in. The cost of doing it here
 * instead is one render with `status: 'loading'`, which the screen has to handle
 * regardless — a cold visitor waits for 364 KB brotli over the network either
 * way, and a route loader would spend that time on a blank frame rather than on
 * a skeleton.
 */
import { useEffect, useState } from 'react'

import type { CatalogFile, CatalogRecord } from '@/catalog'
import { resolveTags } from '@/catalog'
import type { MaterialId } from '@/materials'
import { resolveMaterial } from '@/materials'
import type { SearchEngine } from '@/search'
import { createSearchEngine } from '@/search'
import { loadCatalogIndex, resetCatalogIndexCache } from '@/ui/shell'

/** The validated index, an engine over it, and de-interned tags on demand. */
export interface CatalogIndex {
  readonly file: CatalogFile
  readonly engine: SearchEngine
  /**
   * A record's tags as strings.
   *
   * Memoised per record, because the caller is a card that re-renders on every
   * store change and `resolveMaterial` wants strings. 8,702 arrays of ~10 short
   * strings is the worst case and only reached by scrolling the whole catalog.
   */
  tagsFor(record: CatalogRecord): readonly string[]
  /**
   * The material family a record's thumbnail and 3D view are tinted as.
   *
   * `resolveMaterial(tagsFor(record), record.file).material`, memoised on the
   * same map, so the four subtrees that render `@/ui/thumb` from an index — the
   * catalog grid, the library, the builder's palette and its bill — all agree
   * and none of them pays twice. Row P3 added it because `TileThumb.material` is
   * required and those callers had a `CatalogRecord` in hand and no tags.
   *
   * **Not `TEXTURE_ROOT_MATERIAL[record.texture]`, which is the shortcut every
   * one of those callers already had.** Measured over all 8,702 records the two
   * disagree on **691** (7.9%): `texture` is the root of a tile's *first*
   * texture tag, so 252 `cave` tiles are really `sandstone`, 257 `towne` tiles
   * split between `cut_stone` and `wood`, and 85 tiles with no `texture` at all
   * still resolve through a filename hint or a part fallback. The full tag list
   * is the input, and this is the one place that has to know it.
   *
   * Declared as a **property** and not a method, deliberately: three screens
   * pass it down as a value (`materialOf={index.materialOf}`), and a method
   * shorthand there is `@typescript-eslint/unbound-method` — correctly, since a
   * detached method would lose `this`. It closes over the index instead, so
   * detaching it is safe and the type says so.
   */
  readonly materialOf: (record: CatalogRecord) => MaterialId
}

function buildIndex(file: CatalogFile): CatalogIndex {
  const engine = createSearchEngine(file)
  const tags = new Map<string, readonly string[]>()
  const materials = new Map<string, MaterialId>()
  const index: CatalogIndex = {
    file,
    engine,
    tagsFor(record) {
      let resolved = tags.get(record.id)
      if (resolved === undefined) {
        resolved = resolveTags(file, record)
        tags.set(record.id, resolved)
      }
      return resolved
    },
    materialOf: (record) => {
      let resolved = materials.get(record.id)
      if (resolved === undefined) {
        resolved = resolveMaterial(index.tagsFor(record), record.file).material
        materials.set(record.id, resolved)
      }
      return resolved
    },
  }
  return index
}

let pending: Promise<CatalogIndex> | null = null

/**
 * The index and its engine, built at most once per session.
 *
 * Exported as a promise rather than as a hook so the builder palette (PR 18) and
 * the library screen (PR 14) can await the same work without mounting this
 * screen.
 */
export function loadCatalogSearchIndex(): Promise<CatalogIndex> {
  pending ??= loadCatalogIndex().then(buildIndex)
  const attempt = pending
  // A rejected promise must not be the memoised answer for the rest of the
  // session, or the screen's retry button is decoration. Both caches are
  // dropped, because the shell's fetch memo holds the same rejection and a
  // retry that only cleared this one would resolve to it again.
  attempt.catch(() => {
    if (pending === attempt) {
      pending = null
      resetCatalogIndexCache()
    }
  })
  return attempt
}

/**
 * Discard the memoised engine.
 *
 * For tests only, and it does **not** reset the shell's fetch cache — call
 * `resetCatalogIndexCache()` from `@/ui/shell` as well. Two caches, two resets,
 * on purpose: a test that stubs `fetch` needs to clear both, and a single
 * combined reset would hide from the caller that a second module is involved.
 */
export function resetCatalogSearchIndex(): void {
  pending = null
}

/** What {@link useCatalogIndex} reports. */
export type CatalogIndexState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly index: CatalogIndex }
  | { readonly status: 'error'; readonly error: Error; readonly retry: () => void }

/**
 * The index, as render state.
 *
 * A failed load is a first-class state rather than a thrown error: the route's
 * `errorComponent` would replace the whole screen with a message, and a network
 * blip on someone's shared filter link deserves a retry affordance inside the
 * catalog instead.
 */
export function useCatalogIndex(): CatalogIndexState {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CatalogIndexState>({ status: 'loading' })

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    loadCatalogSearchIndex().then(
      (index) => {
        if (alive) setState({ status: 'ready', index })
      },
      (error: unknown) => {
        if (alive) {
          setState({
            status: 'error',
            error: asError(error),
            retry: () => {
              setAttempt((value) => value + 1)
            },
          })
        }
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  return state
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
