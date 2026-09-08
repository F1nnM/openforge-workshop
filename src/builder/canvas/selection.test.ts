// @vitest-environment jsdom
/**
 * What a press means, and what a selection is.
 *
 * **What these tests prove:** the whole four-way press table — that a ray which
 * missed the plan is a camera press whatever the palette holds, that an armed
 * palette places on bare ground and on an occupied cell alike, that an unarmed
 * press picks the piece under it in either population, and that bare ground
 * clears the selection instead of doing nothing. Then the selection rules: that
 * an id is resolved against the scene rather than trusted, so a stale one reads
 * as no selection; that `[` and `]` walk `navigationOrder` and wrap at both ends;
 * and that the target guard claims the canvas and nothing else in its host.
 *
 * **Why they can exist at all:** because none of this lives in a listener. jsdom
 * has no WebGL context, so no test in this repository can mount the 3D surface —
 * `move.test.ts` and `generatedScene.test.ts` both say so — and a press
 * classified inside `RoomSurface.tsx`'s `pointerdown` handler would be verified
 * in a browser or not at all. The verdicts are the substance and they are here.
 *
 * **What they cannot prove:** anything about the gesture that delivers them.
 * There is no raycast here, so nothing checks that a click at a screen pixel
 * resolves to the plan point these functions are handed; there is no store, so
 * nothing checks that a `select` verdict reaches `select()`; and nothing
 * rasterises, so the ring around the selected piece and the bar above it are
 * browser work. `jsdom` is asked for here only so that {@link claimsPress} can be
 * given two real elements rather than two stand-ins — the identity comparison is
 * the entire function, and comparing invented objects would prove nothing about
 * it.
 */
import { describe, expect, it } from 'vitest'

import type { PlacementId, WorkshopState } from '@/store'
import { aGeneratedBase } from '@/store/fixture'

import { createStyleResolver, planCatalogFromFile } from './catalog'
import {
  FIXTURE_IDS,
  FIXTURE_SLOTS,
  fixtureCatalogFile,
  fixtureFills,
  fixtureInstance,
  fixtureSlotLayout,
} from './fixture'
import type { PlanPoint } from './geometry'
import { buildPlanScene, navigationOrder } from './scene'
import type { PlanScene } from './scene'
import { claimsPress, pressMeaning, resolveSelection, stepSelection } from './selection'

const file = fixtureCatalogFile()
const catalog = planCatalogFromFile(file, fixtureSlotLayout)
const styleOf = createStyleResolver(catalog)

/**
 * A scene from catalog rows `[key, tileId, x, z]` and generated rows
 * `[key, x, z]`.
 *
 * The catalog rows fill the **`base`** slot, whose fixture layout is `(0, 0)`
 * unturned at `elevationMm: 0` — so a piece occupies exactly its own anchor cell
 * and every coordinate below can be read off the tuple. That is
 * `generatedScene.test.ts`'s choice for the same reason: the slot rule lifts a
 * `floor`-slot part, and a test about *where* things are should not have to
 * subtract an elevation to say so.
 */
function sceneOf(
  tiles: readonly (readonly [string, string, number, number])[],
  bases: readonly (readonly [string, number, number])[] = [],
): PlanScene {
  const placements: Record<string, WorkshopState['placements'][PlacementId]> = {}
  for (const [key, tileId, x, z] of tiles) {
    placements[key] = fixtureInstance(key, fixtureFills([[FIXTURE_SLOTS.base, tileId]]), { x, z })
  }
  const generated: Record<string, ReturnType<typeof aGeneratedBase>> = {}
  for (const [key, x, z] of bases) generated[key] = aGeneratedBase({ x, z })
  return buildPlanScene(placements, catalog, styleOf, generated)
}

/**
 * A 2 × 2 floor at the origin, a 1 × 1 floor away from it, and a generated base
 * between them in reading order.
 *
 * Three pieces across both populations, at coordinates chosen so that no two
 * boxes touch: an overlap would put a conflict in the scene and make every
 * `pieceAt` assertion below a question about paint order instead of about the
 * press.
 */
const scene = sceneOf(
  [
    ['a', FIXTURE_IDS.floor2, 0, 0],
    ['b', FIXTURE_IDS.floor1, 5, 5],
  ],
  [['g1', 0, 5]],
)

/** Inside the 2 × 2 floor at the origin. */
const ON_A: PlanPoint = [1, 1]
/** Inside the generated base at `(0, 5)`, which is 2 × 2 on the inch grid. */
const ON_G1: PlanPoint = [1, 6]
/** Well clear of all three boxes. */
const BARE: PlanPoint = [20, 20]

const id = (key: string) => key as PlacementId

describe('what a press means', () => {
  it('is a camera press when the ray missed the plan, whatever is armed', () => {
    // Nowhere to place and nothing to select: the press has to go on to
    // OrbitControls unclaimed, or the horizon stops orbiting the camera.
    expect(pressMeaning(scene, null, false)).toEqual({ kind: 'camera' })
    expect(pressMeaning(scene, null, true)).toEqual({ kind: 'camera' })
  })

  it('places when the palette is armed, whatever is under the pointer', () => {
    expect(pressMeaning(scene, BARE, true)).toEqual({ kind: 'place' })
    // The ghost is at the snapped cursor regardless of what is beneath it, and a
    // piece is never selected while armed — the two states are exclusive.
    expect(pressMeaning(scene, ON_A, true)).toEqual({ kind: 'place' })
    expect(pressMeaning(scene, ON_G1, true)).toEqual({ kind: 'place' })
  })

  it('selects the piece under the pointer when nothing is armed', () => {
    expect(pressMeaning(scene, ON_A, false)).toEqual({ kind: 'select', id: id('a') })
  })

  it('selects a generated base by the same press, because the id space is one', () => {
    expect(pressMeaning(scene, ON_G1, false)).toEqual({ kind: 'select', id: id('g1') })
  })

  it('deselects on bare ground when nothing is armed', () => {
    expect(pressMeaning(scene, BARE, false)).toEqual({ kind: 'deselect' })
  })
})

describe('a selection is resolved against the scene, never trusted', () => {
  it('is null for no selection at all', () => {
    expect(resolveSelection(scene, null)).toBeNull()
  })

  it('resolves a catalogued instance', () => {
    expect(resolveSelection(scene, id('a'))?.kind).toBe('catalog')
    expect(resolveSelection(scene, id('a'))?.id).toBe('a')
  })

  it('resolves a generated base out of the second list', () => {
    const found = resolveSelection(scene, id('g1'))
    expect(found?.kind).toBe('generated')
    expect(found?.id).toBe('g1')
  })

  it('is null for an id the scene no longer holds', () => {
    // The stale case, and the whole reason this is a resolve rather than a
    // cache: after a Clear, an undo or a rehydration the id survives and the
    // piece does not, and both selection invariants are this one line.
    expect(resolveSelection(scene, id('gone'))).toBeNull()
  })

  it('is null for every id once the scene is emptied', () => {
    expect(resolveSelection(sceneOf([]), id('a'))).toBeNull()
  })
})

describe('stepping the selection', () => {
  /** Reading order down the plan then across: `a` at z 1, `b` at z 5.5, `g1` at z 6. */
  const order = navigationOrder(scene).map((piece) => piece.id)

  it('walks navigation order rather than insertion order', () => {
    expect(order).toEqual(['a', 'b', 'g1'])
  })

  it('starts at the first piece forward and the last piece backward', () => {
    expect(stepSelection(scene, null, 1)).toBe(order[0])
    expect(stepSelection(scene, null, -1)).toBe(order[order.length - 1])
  })

  it('steps forward and wraps past the end', () => {
    expect(stepSelection(scene, id('a'), 1)).toBe('b')
    expect(stepSelection(scene, id('b'), 1)).toBe('g1')
    expect(stepSelection(scene, id('g1'), 1)).toBe('a')
  })

  it('steps backward and wraps past the beginning', () => {
    expect(stepSelection(scene, id('g1'), -1)).toBe('b')
    expect(stepSelection(scene, id('b'), -1)).toBe('a')
    expect(stepSelection(scene, id('a'), -1)).toBe('g1')
  })

  it('treats an id the order does not hold as no selection', () => {
    // A stale selection is no selection here too, so the key lands somewhere
    // instead of reading as broken.
    expect(stepSelection(scene, id('gone'), 1)).toBe(order[0])
    expect(stepSelection(scene, id('gone'), -1)).toBe(order[order.length - 1])
  })

  it('is null in an empty scene, from a selection or from none', () => {
    const empty = sceneOf([])
    expect(stepSelection(empty, null, 1)).toBeNull()
    expect(stepSelection(empty, null, -1)).toBeNull()
    expect(stepSelection(empty, id('a'), 1)).toBeNull()
  })
})

describe('whose press it is', () => {
  it('claims a press on the canvas and refuses one on an overlay in the same host', () => {
    // The host listener is on the canvas's parent, in the capture phase, and
    // that parent is what an in-canvas overlay is portalled into. Without the
    // guard the press is stopped before the overlay's own button sees it.
    const host = document.createElement('div')
    const canvas = document.createElement('canvas')
    const overlay = document.createElement('button')
    host.append(canvas, overlay)

    expect(claimsPress(canvas, canvas)).toBe(true)
    expect(claimsPress(overlay, canvas)).toBe(false)
    // The host itself is not the canvas either: strictly the canvas, never
    // merely inside it.
    expect(claimsPress(host, canvas)).toBe(false)
    expect(claimsPress(null, canvas)).toBe(false)
  })
})
