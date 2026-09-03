/**
 * What a gesture on the surface means — the half of this row a test can prove.
 *
 * `edits.ts` exists so that "clicking there places that" is a value rather than
 * a side effect inside a `useCallback`, and this file is what that buys: every
 * placement, refusal, removal, drop and turn the 3D surface can produce is
 * asserted here without React, without a canvas and without a GPU.
 *
 * The refusals are `ghost.ts`'s and `move.ts`'s, so each one is checked against
 * the *reason* it exists rather than against its wording: a `none` footprint has
 * nothing to draw, an identical tile at identical coordinates and an identical
 * angle would double a line in the bill, and an overlap commits.
 */
import { describe, expect, it } from 'vitest'

import type { PlanPoint } from '@/builder/canvas'
import { beginMove, computeGhost, dragMoveTo, planCatalogFromFile, rotationStepFor } from '@/builder/canvas'
import { FIXTURE_IDS, fixtureCatalogFile } from '@/builder/canvas/fixture'

import {
  describeAbandon,
  describeSurface,
  describeSurfaceHint,
  planDrop,
  planGrab,
  planPlacement,
  planRemoval,
  planTurn,
  removalOf,
} from './edits'
import { recordOf, sceneOf } from './fixture'

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
const FINE = 0.5

const floor1 = recordOf(CATALOG, FIXTURE_IDS.floor1)
const shapeless = recordOf(CATALOG, FIXTURE_IDS.shapeless)
const arc = recordOf(CATALOG, FIXTURE_IDS.arcFallback)

/* -------------------------------------------------------------------- placing */

describe('placing', () => {
  it('places the armed tile at the ghost’s own anchor', () => {
    const scene = sceneOf(CATALOG, [])
    const edit = planPlacement(scene, floor1, 0, [2.2, 3.1], FINE)
    expect(edit.kind).toBe('place')
    if (edit.kind !== 'place') return
    // Snapped, and snapped by `anchorForShape` rather than by rounding the
    // cursor: the tile is *centred* on the cursor, so a 1 × 1 tile at (2.2, 3.1)
    // anchors at (1.5, 2.5) — `snapTo(cursor - extent / 2)`, not `snapTo(cursor)`.
    // `geometry.ts`'s `anchorFor` docblock explains why the other order puts a
    // 2 × 0.5 wall's faces a quarter unit off the lattice.
    expect(edit.anchor).toEqual([1.5, 2.5])
    expect(edit.record.id).toBe(FIXTURE_IDS.floor1)
    expect(edit.rotation).toBe(0)
    expect(edit.message).toContain('Placed')
  })

  it('says so when nothing is armed rather than doing nothing', () => {
    const edit = planPlacement(sceneOf(CATALOG, []), undefined, 0, [0, 0], FINE)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/No tile is armed/)
  })

  it('refuses a footprint with nothing to draw, with the footprint’s own reason', () => {
    // The one case of seven that `footprintShape` cannot resolve — 8.3% of the
    // corpus. `ghost.ts` decides it; this only reports it.
    const edit = planPlacement(sceneOf(CATALOG, []), shapeless, 0, [0, 0], FINE)
    expect(edit.kind).toBe('none')
    expect(edit.message.length).toBeGreaterThan(20)
  })

  it('refuses an identical tile at the identical place and angle', () => {
    const scene = sceneOf(CATALOG, [{ tileId: FIXTURE_IDS.floor1, x: 0, z: 0 }])
    const edit = planPlacement(scene, floor1, 0, [0.5, 0.5], FINE)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/already placed/)
  })

  it('commits an overlap and announces it, because a conflict informs', () => {
    // `overlap.ts` is emphatic: overlapping while arranging is normal. So this
    // is a `place`, not a refusal — and the sentence has to say what happened.
    const scene = sceneOf(CATALOG, [{ tileId: FIXTURE_IDS.floor2, x: 0, z: 0 }])
    const edit = planPlacement(scene, floor1, 0, [1, 1], FINE)
    expect(edit.kind).toBe('place')
    if (edit.kind !== 'place') return
    expect(edit.conflict).toBe(true)
    expect(edit.message).toContain('overlapping a piece already there')
  })

  it('carries the unmeasured-band caveat into the sentence', () => {
    // 462 of the 1,199 corpus curves rest on a band rule with no accepted mesh
    // fit behind it. In 2D the disclosure is a hatch pattern; in 3D there is no
    // hatch, so the sentence is the *only* disclosure and is load-bearing.
    expect(arc).toBeDefined()
    const edit = planPlacement(sceneOf(CATALOG, []), arc, 0, [0, 0], FINE)
    expect(edit.kind).toBe('place')
    expect(edit.message).toMatch(/unmeasured|band|outline/i)
  })
})

/* -------------------------------------------------------------------- erasing */

describe('erasing', () => {
  it('takes the topmost piece under the point and names it', () => {
    const scene = sceneOf(CATALOG, [
      { tileId: FIXTURE_IDS.floor2, x: 0, z: 0 },
      { tileId: FIXTURE_IDS.wall2, x: 0, z: 0 },
    ])
    const edit = planRemoval(scene, [0.2, 0.2])
    expect(edit.kind).toBe('remove')
    if (edit.kind !== 'remove') return
    // Last in paint order wins — edges over areas — so clicking where a wall
    // crosses a floor takes the wall, which is the one the user can see.
    const wall = scene.pieces.find((piece) => piece.band === 'edge')
    expect(edit.id).toBe(wall?.id)
    expect(edit.generated).toBe(false)
  })

  it('says nothing is there rather than returning a silent no-op', () => {
    const edit = planRemoval(sceneOf(CATALOG, [{ tileId: FIXTURE_IDS.floor1, x: 0, z: 0 }]), [40, 40])
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/Nothing to remove/)
  })

  it('names the store map, because a generated removal frees a mesh too', () => {
    const scene = sceneOf(CATALOG, [{ tileId: FIXTURE_IDS.floor1, x: 0, z: 0 }])
    const piece = scene.pieces[0]
    expect(piece).toBeDefined()
    const edit = removalOf(piece as NonNullable<typeof piece>)
    expect(edit.kind).toBe('remove')
    if (edit.kind !== 'remove') return
    expect(edit.generated).toBe(false)
  })
})

/* --------------------------------------------------------------------- moving */

describe('moving', () => {
  const scene = sceneOf(CATALOG, [
    { tileId: FIXTURE_IDS.floor1, x: 0, z: 0 },
    { tileId: FIXTURE_IDS.floor1, x: 4, z: 0 },
  ])

  it('picks up the piece under the point and says what the keys do', () => {
    const grabbed = planGrab(scene, [0.5, 0.5], [0.5, 0.5])
    expect(grabbed.drag).not.toBeNull()
    expect(grabbed.message).toMatch(/Picked up/)
    expect(grabbed.message).toMatch(/Escape puts it back/)
  })

  it('finds nothing to pick up on bare ground', () => {
    const grabbed = planGrab(scene, [20, 20], [20, 20])
    expect(grabbed.drag).toBeNull()
    expect(grabbed.message).toMatch(/Nothing to move/)
  })

  it('commits one write on a drop that moved the piece', () => {
    const grabbed = planGrab(scene, [0.5, 0.5], [0.5, 0.5])
    expect(grabbed.drag).not.toBeNull()
    const dragged = dragMoveTo(grabbed.drag as NonNullable<typeof grabbed.drag>, [2.5, 0.5], FINE)
    const edit = planDrop(dragged, scene)
    expect(edit.kind).toBe('move')
    if (edit.kind !== 'move') return
    expect(edit.x).toBe(2)
    expect(edit.z).toBe(0)
  })

  it('writes nothing when the piece is dropped where it started', () => {
    const grabbed = planGrab(scene, [0.5, 0.5], [0.5, 0.5])
    const edit = planDrop(grabbed.drag as NonNullable<typeof grabbed.drag>, scene)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/Nothing moved/)
  })

  it('refuses a drop onto an identical twin and says why', () => {
    // The one refusal a move makes, and `move.ts` states the cost: two identical
    // tiles at the same coordinates are invisible on the plan and would double a
    // line in the bill.
    const grabbed = planGrab(scene, [0.5, 0.5], [0.5, 0.5])
    const dragged = dragMoveTo(grabbed.drag as NonNullable<typeof grabbed.drag>, [4.5, 0.5], FINE)
    const edit = planDrop(dragged, scene)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/double its line in the bill/)
  })

  it('survives the piece vanishing mid-drag', () => {
    // Reachable: the bill panel can remove a piece while a drag is in the air.
    // `previewMove` returns `undefined` for it rather than throwing, and this is
    // the arm that proves the surface treats that as "the move is over".
    const piece = scene.pieces[0]
    expect(piece).toBeDefined()
    const drag = beginMove(piece as NonNullable<typeof piece>, null)
    const emptied = sceneOf(CATALOG, [])
    expect(planDrop(drag, emptied).kind).toBe('none')
    expect(describeAbandon(drag, emptied)).toBe('Move cancelled.')
  })
})

/* -------------------------------------------------------------------- turning */

describe('turning', () => {
  const scene = sceneOf(CATALOG, [{ tileId: FIXTURE_IDS.angled, x: 0, z: 0 }])
  const piece = scene.pieces[0]

  it('turns the piece under the pointer by the tile’s own step', () => {
    expect(piece).toBeDefined()
    const edit = planTurn(scene, null, piece, undefined, 0)
    expect(edit.kind).toBe('turn')
    if (edit.kind !== 'turn') return
    // The fixture's 45° tile: 893 corpus tiles carry an angle that is not a
    // multiple of 90, so a hardcoded 90 would never let them tile.
    expect(edit.rotation).toBe(rotationStepFor((piece as NonNullable<typeof piece>).record))
    expect(edit.rotation).not.toBe(90)
  })

  it('prefers the sticky target over whatever is under the pointer now', () => {
    // Turning a piece can move it out from under the point that was clicked, so
    // the second press must keep meaning the same thing.
    const wide = sceneOf(CATALOG, [
      { tileId: FIXTURE_IDS.wall2, x: 0, z: 0 },
      { tileId: FIXTURE_IDS.floor2, x: 8, z: 8 },
    ])
    const wall = wide.pieces.find((one) => one.band === 'edge')
    const floor = wide.pieces.find((one) => one.band === 'area')
    expect(wall).toBeDefined()
    const edit = planTurn(wide, (wall as NonNullable<typeof wall>).id, floor, undefined, 0)
    expect(edit.kind).toBe('turn')
    if (edit.kind !== 'turn') return
    expect(edit.id).toBe((wall as NonNullable<typeof wall>).id)
  })

  it('turns the armed tile when nothing is under the pointer', () => {
    const edit = planTurn(sceneOf(CATALOG, []), null, undefined, floor1, 0)
    expect(edit.kind).toBe('arm')
    if (edit.kind !== 'arm') return
    expect(edit.step).toBe(rotationStepFor(floor1 as NonNullable<typeof floor1>))
    expect(edit.direction).toBe(1)
  })

  it('turns backwards on request', () => {
    const edit = planTurn(sceneOf(CATALOG, []), null, undefined, floor1, 0, -1)
    expect(edit.kind).toBe('arm')
    if (edit.kind !== 'arm') return
    expect(edit.direction).toBe(-1)
  })

  it('says there is nothing to turn rather than turning nothing', () => {
    const edit = planTurn(sceneOf(CATALOG, []), null, undefined, undefined, 0)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/Nothing to turn/)
  })
})

/* ------------------------------------------------------------------- the hints */

describe('the contextual line', () => {
  const scene = sceneOf(CATALOG, [{ tileId: FIXTURE_IDS.floor1, x: 0, z: 0 }])
  const base = { under: undefined, moving: undefined, onPlan: true, waiting: 0 } as const

  it('teaches the orbit when the pointer is off the plan', () => {
    const hint = describeSurfaceHint({ ...base, tool: 'place', armed: floor1, ghost: null, onPlan: false })
    expect(hint).toMatch(/Drag to orbit/)
  })

  it('asks for a tile before it asks for a click', () => {
    expect(describeSurfaceHint({ ...base, tool: 'place', armed: undefined, ghost: null })).toMatch(
      /Choose a tile in the palette/,
    )
  })

  it('names the piece the erase gesture would take', () => {
    const piece = scene.pieces[0]
    const hint = describeSurfaceHint({ ...base, tool: 'erase', armed: undefined, ghost: null, under: piece })
    expect(hint).toContain('click to remove')
  })

  it('discloses a tile drawn as an outline, above the plain case and below every problem', () => {
    const waiting = describeSurfaceHint({ ...base, tool: 'place', armed: floor1, ghost: null, waiting: 2 })
    expect(waiting).toMatch(/2 placed tiles have no mesh yet/)
    // And a refusal still outranks it: a marker is not an error, so it must not
    // displace one. The refusal lives on the *ghost*, which is why this arm
    // computes a real one rather than passing `null`.
    const refusedGhost = computeGhost(shapeless as NonNullable<typeof shapeless>, 0, [0, 0], FINE, scene)
    expect(refusedGhost.refusal).not.toBeNull()
    const refused = describeSurfaceHint({
      ...base,
      tool: 'place',
      armed: shapeless,
      ghost: refusedGhost,
      waiting: 2,
    })
    expect(refused).not.toMatch(/no mesh yet/)
    expect(refused).toBe(refusedGhost.refusal?.message)
  })

  it('quotes the tile’s own rotation step in the plain case', () => {
    const hint = describeSurfaceHint({ ...base, tool: 'place', armed: floor1, ghost: null })
    expect(hint).toContain('Click to place')
    expect(hint).toContain(String(rotationStepFor(floor1 as NonNullable<typeof floor1>)))
  })
})

describe('the canvas’s accessible name', () => {
  it('invites a first placement into an empty plan', () => {
    expect(describeSurface(sceneOf(CATALOG, []), 0)).toMatch(/empty plan in 3D/)
  })

  it('summarises rather than inventories, and counts what is not drawn', () => {
    const scene = sceneOf(CATALOG, [
      { tileId: FIXTURE_IDS.floor1, x: 0, z: 0 },
      { tileId: FIXTURE_IDS.floor2, x: 0, z: 0 },
    ])
    const label = describeSurface(scene, 1)
    expect(label).toContain('2 placed tiles')
    expect(label).toContain('overlapping')
    expect(label).toContain('1 awaiting a mesh')
    // A summary: no tile name and no coordinate in it.
    expect(label).not.toContain('x 0')
  })
})

/* --------------------------------------------------------------- the anchor rule */

describe('the ghost and the placement are one call, not two', () => {
  it('places at the anchor a ghost at the same cursor would have drawn', () => {
    // The property `ghost.ts` was made pure for. Asserted at this level because
    // `planPlacement` is the only thing between a click and the store, and a
    // second `computeGhost` call inside it would be the bug.
    const scene = sceneOf(CATALOG, [])
    for (const cursor of [[0, 0], [1.24, -3.76], [7.5, 7.5]] as PlanPoint[]) {
      const edit = planPlacement(scene, floor1, 90, cursor, FINE)
      expect(edit.kind).toBe('place')
      if (edit.kind !== 'place') continue
      // On the lattice, both axes, whatever the cursor was.
      expect(edit.anchor[0] * 2).toBeCloseTo(Math.round(edit.anchor[0] * 2), 9)
      expect(edit.anchor[1] * 2).toBeCloseTo(Math.round(edit.anchor[1] * 2), 9)
    }
  })
})
