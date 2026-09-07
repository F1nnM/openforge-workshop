/**
 * The design comparison, as render state.
 *
 * One job: memoise {@link deriveDesignReach} on the three things that can change
 * its answer, so 29 rows of measured figures cost one derivation per builder
 * session rather than one per render.
 *
 * ## Why it is a `useMemo` and not `useLockBuild`'s module-level promise
 *
 * `useLockBuild` fetches the emitted index itself and caches the derivation in a
 * module variable, because it is 185 ms of work over a build artefact carrying a
 * version stamp — it cannot change under a running session, and the header, the
 * landing stats and the builder all want the same answer.
 *
 * This derivation takes **indexes the caller already holds** and a template
 * list, and its cost is 139 candidate resolutions — measured at **12–15 ms** over
 * the live archive, an eighth of the lock comparison. A module cache would need
 * those three objects in its key, and two of them are large index objects with
 * no identity a string can carry; keying on them by reference is exactly what
 * `useMemo`'s dependency list is. `BuilderScreen` memoises all three, so the
 * dependency list is stable for the life of the screen and the derivation runs
 * once.
 *
 * ## `null` before the indexes exist
 *
 * The builder cannot render without a catalog, so in the app the authorities are
 * always in hand — but a test, and a future host that mounts the toggle beside a
 * loading catalog, can pass none. `null` is what `DesignPicker` renders as *no
 * figures*, which is the same state `LockPicker` renders for the same reason:
 * the choice must not stop working because the figures are unknown.
 */
import { useMemo } from 'react'

import type { AssemblyIndex, AssemblyTemplate } from '@/assembly'
import type { CompositionIndex } from '@/composition'

import type { DesignReach } from './reach'
import { deriveDesignReach } from './reach'

/**
 * What the reach derivation needs, as one prop.
 *
 * Flat and not nested, for `three/fills.ts#FillAuthorities`' React reason: a
 * component that memoises on these has to key on things a caller can hold
 * stable, and three memoised leaves are three stable references where a nested
 * object built in the JSX is a new one on every render.
 */
export interface DesignAuthorities {
  /** Every template a caller can place — C1's `PLACEABLE_TEMPLATES` in the app. */
  readonly recipes: readonly AssemblyTemplate[] | undefined
  readonly index: AssemblyIndex | undefined
  readonly composition: CompositionIndex | undefined
}

/** The comparison, or `null` when the indexes are not in hand. */
export function useDesignReach({ recipes, index, composition }: DesignAuthorities): DesignReach | null {
  return useMemo(
    () =>
      recipes === undefined || index === undefined || composition === undefined
        ? null
        : deriveDesignReach(recipes, index, composition),
    [recipes, index, composition],
  )
}
