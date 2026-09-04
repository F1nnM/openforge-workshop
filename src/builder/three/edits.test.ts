/**
 * What a gesture on the surface means — the half of this row a test can prove.
 *
 * `edits.ts` exists so that "clicking there places that" is a value rather than
 * a side effect inside a `useCallback`, and this file is what that buys: every
 * placement, removal, drop and turn the 3D surface can produce is asserted here
 * without React, without a canvas and without a GPU.
 *
 * ## Row A4b: the four placement refusals are **deleted**, and that is the test
 *
 * Row A1 made the armed thing a **template family**, so the four refusals row R2
 * asserted here — a `none` footprint, an identical file at an identical corner
 * and angle, an overlap that commits, an unmeasured band rule — are all facts
 * about a *footprint* that an armed family does not have until row **C2**'s fill
 * solver runs. `edits.ts` sets out why inventing one would be worse than
 * refusing to guess.
 *
 * So the tests for them are deleted with them rather than weakened into
 * assertions about a marker, and what replaces them is the pair of properties
 * that *are* still true and are load-bearing: a click places an instance with **no
 * fills** — contract **C-g** — and the anchor it places at is the anchor the
 * marker was drawn at, from one call. The refusals that remain are `move.ts`'s,
 * and every one of those is checked against the reason it exists.
 */
import { describe, expect, it } from 'vitest'

import type { PlanPoint } from '@/builder/canvas'
import { beginMove, describeTemplate, dragMoveTo, planCatalogFromFile } from '@/builder/canvas'
import { FIXTURE_IDS, FIXTURE_TEMPLATE, OTHER_FIXTURE_TEMPLATE, fixtureCatalogFile } from '@/builder/canvas/fixture'
import { filledSlots } from '@/store'

import {
  ARMED_TURN_STEP_DEG,
  describeAbandon,
  describeSurface,
  describeSurfaceHint,
  planDrop,
  planGrab,
  planPlacement,
  planRemoval,
  planTurn,
  removalOf,
  templateGhost,
} from './edits'
import { sceneOf } from './fixture'

const CATALOG = planCatalogFromFile(fixtureCatalogFile())
const FINE = 0.5

/* -------------------------------------------------------------------- placing */

describe('placing', () => {
  it('places the armed family at the marker’s own anchor', () => {
    const edit = planPlacement(FIXTURE_TEMPLATE, 0, [2.2, 3.1], FINE)
    expect(edit.kind).toBe('place')
    if (edit.kind !== 'place') return
    // Snapped, and the cursor is the point the marker is *centred* on, so a
    // one-cell marker at (2.2, 3.1) anchors at (1.5, 2.5) —
    // `snapTo(cursor - 0.5)`, not `snapTo(cursor)`.
    expect(edit.anchor).toEqual([1.5, 2.5])
    expect(edit.template).toBe(FIXTURE_TEMPLATE)
    expect(edit.rotation).toBe(0)
    expect(edit.message).toContain('Placed')
  })

  it('places with no fills at all, which is contract C-g rather than a stub', () => {
    // §3.2 places a template with no candidate for a part *"anyway"*, and the
    // store accepts it — `placeTemplate` has deliberately no completeness
    // argument. Until row C2's solver exists this is the state **every**
    // placement lands in, so it has to be a placement and not a refusal.
    const edit = planPlacement(FIXTURE_TEMPLATE, 0, [0, 0], FINE)
    expect(edit.kind).toBe('place')
    if (edit.kind !== 'place') return
    expect(filledSlots(edit.fills)).toEqual([])
  })

  it('says so in the message, because an empty cell otherwise looks broken', () => {
    // The one thing the surface owes a user who has just clicked and seen
    // nothing appear. Load-bearing rather than polite: without it a correct
    // placement is indistinguishable from a dead canvas.
    const edit = planPlacement(FIXTURE_TEMPLATE, 0, [0, 0], FINE)
    expect(edit.message).toMatch(/no parts chosen/i)
    expect(edit.message).toMatch(/slots/i)
  })

  it('names the family the way a readout does, not by its slug', () => {
    const edit = planPlacement(FIXTURE_TEMPLATE, 0, [0, 0], FINE)
    expect(edit.message).toContain(describeTemplate(FIXTURE_TEMPLATE))
    expect(edit.message).not.toContain(FIXTURE_TEMPLATE)
  })

  it('carries the family through rather than collapsing two of them', () => {
    const one = planPlacement(FIXTURE_TEMPLATE, 0, [0, 0], FINE)
    const other = planPlacement(OTHER_FIXTURE_TEMPLATE, 0, [0, 0], FINE)
    expect(one.kind).toBe('place')
    expect(other.kind).toBe('place')
    if (one.kind !== 'place' || other.kind !== 'place') return
    expect(one.template).not.toBe(other.template)
  })

  it('says so when nothing is armed rather than doing nothing', () => {
    const edit = planPlacement(null, 0, [0, 0], FINE)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/No template is armed/)
  })

  it('places on top of what is already there, because a conflict informs', () => {
    // `overlap.ts` is emphatic: overlapping while arranging is normal, and it
    // was never the *placement* that refused. What changed this row is that
    // there is no footprint to predict the overlap from, so the verdict cannot
    // announce it — the conflict sweep on the placed scene still reports it, and
    // `scene.conflicts` is what the readout counts.
    const edit = planPlacement(FIXTURE_TEMPLATE, 0, [0.5, 0.5], FINE)
    expect(edit.kind).toBe('place')
  })
})

/* -------------------------------------------------------------------- erasing */

describe('erasing', () => {
  it('takes the topmost piece under the point and names it', () => {
    const scene = sceneOf(CATALOG, [
      { tile: FIXTURE_IDS.floor2, x: 0, z: 0 },
      { tile: FIXTURE_IDS.wall2, x: 0, z: 0 },
    ])
    const edit = planRemoval(scene, [0.2, 0.2])
    expect(edit.kind).toBe('remove')
    if (edit.kind !== 'remove') return
    // Last in **insertion** order wins, and row A4a is why that is now the whole
    // rule: the old sort was edges over areas, a template has no single band, and
    // `scenePaintOrder` says the pieces list is in insertion order. So the piece
    // taken is the one placed last, which is the one the user just put there.
    const last = scene.pieces[scene.pieces.length - 1]
    expect(edit.id).toBe(last?.id)
    expect(edit.generated).toBe(false)
  })

  it('says nothing is there rather than returning a silent no-op', () => {
    const edit = planRemoval(sceneOf(CATALOG, [{ tile: FIXTURE_IDS.floor1, x: 0, z: 0 }]), [40, 40])
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/Nothing to remove/)
  })

  it('names the store map, because a generated removal frees a mesh too', () => {
    const scene = sceneOf(CATALOG, [{ tile: FIXTURE_IDS.floor1, x: 0, z: 0 }])
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
    { tile: FIXTURE_IDS.floor1, x: 0, z: 0 },
    { tile: FIXTURE_IDS.floor1, x: 4, z: 0 },
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
    // instances at the same coordinates are invisible on the plan and would
    // double their lines in the bill. **Lines**, plural, since row A1 — a
    // template is one placement and up to five bill rows, so the sentence the
    // user reads changed with the arity even though the rule did not.
    const grabbed = planGrab(scene, [0.5, 0.5], [0.5, 0.5])
    const dragged = dragMoveTo(grabbed.drag as NonNullable<typeof grabbed.drag>, [4.5, 0.5], FINE)
    const edit = planDrop(dragged, scene)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/double its lines in the bill/)
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
  const scene = sceneOf(CATALOG, [{ tile: FIXTURE_IDS.angled, x: 0, z: 0 }])
  const piece = scene.pieces[0]

  it('turns the piece under the pointer by its parts’ own common step', () => {
    expect(piece).toBeDefined()
    const edit = planTurn(scene, null, piece, null, 0)
    expect(edit.kind).toBe('turn')
    if (edit.kind !== 'turn') return
    // The fixture's 45° tile, reached through `pieceRotationStep` — the least
    // common multiple of the parts' steps. 893 corpus tiles carry an angle that
    // is not a multiple of 90, so a hardcoded 90 would never let them tile.
    expect(edit.rotation).toBe(45)
    expect(edit.rotation).not.toBe(90)
  })

  it('takes the coarsest step every part of a template can mate at', () => {
    // Two slots whose files disagree: a 45° angled floor and a 90° wall. The
    // instance can only be turned by a multiple both accept, and
    // `pieceRotationStep`'s least common multiple is what says so. A step read
    // off one part — the single-primitive assumption A1 broke — would propose 45°
    // and put the wall off its own lattice.
    const mixed = sceneOf(CATALOG, [
      { fills: [['floor', FIXTURE_IDS.angled], ['wall', FIXTURE_IDS.wall2]], x: 0, z: 0 },
    ])
    const instance = mixed.pieces[0]
    expect(instance).toBeDefined()
    expect((instance as NonNullable<typeof instance>).parts).toHaveLength(2)
    const edit = planTurn(mixed, null, instance, null, 0)
    expect(edit.kind).toBe('turn')
    if (edit.kind !== 'turn') return
    expect(edit.rotation % 45).toBe(0)
    expect(edit.rotation).toBeGreaterThan(0)
  })

  it('prefers the sticky target over whatever is under the pointer now', () => {
    // Turning a piece can move it out from under the point that was clicked, so
    // the second press must keep meaning the same thing.
    const wide = sceneOf(CATALOG, [
      { tile: FIXTURE_IDS.wall2, x: 0, z: 0 },
      { tile: FIXTURE_IDS.floor2, x: 8, z: 8 },
    ])
    const [wall, floor] = wide.pieces
    expect(wall).toBeDefined()
    const edit = planTurn(wide, (wall as NonNullable<typeof wall>).id, floor, null, 0)
    expect(edit.kind).toBe('turn')
    if (edit.kind !== 'turn') return
    expect(edit.id).toBe((wall as NonNullable<typeof wall>).id)
  })

  it('turns the armed family by the corpus default when nothing is under the pointer', () => {
    // A family's step is a fact about the files in its parts and row C2 has not
    // chosen them, so this is `DEFAULT_ROTATION_STEP_DEG` by name — the one place
    // the default is written down — rather than a literal in this file.
    const edit = planTurn(sceneOf(CATALOG, []), null, undefined, FIXTURE_TEMPLATE, 0)
    expect(edit.kind).toBe('arm')
    if (edit.kind !== 'arm') return
    expect(edit.step).toBe(ARMED_TURN_STEP_DEG)
    expect(edit.direction).toBe(1)
    expect(edit.message).toContain(describeTemplate(FIXTURE_TEMPLATE))
  })

  it('turns backwards on request', () => {
    const edit = planTurn(sceneOf(CATALOG, []), null, undefined, FIXTURE_TEMPLATE, 0, -1)
    expect(edit.kind).toBe('arm')
    if (edit.kind !== 'arm') return
    expect(edit.direction).toBe(-1)
  })

  it('says there is nothing to turn rather than turning nothing', () => {
    const edit = planTurn(sceneOf(CATALOG, []), null, undefined, null, 0)
    expect(edit.kind).toBe('none')
    expect(edit.message).toMatch(/Nothing to turn/)
  })
})

/* ------------------------------------------------------------------- the hints */

describe('the contextual line', () => {
  const scene = sceneOf(CATALOG, [{ tile: FIXTURE_IDS.floor1, x: 0, z: 0 }])
  const base = { under: undefined, moving: undefined, onPlan: true, waiting: 0, unfilled: 0 } as const

  it('teaches the orbit when the pointer is off the plan', () => {
    const hint = describeSurfaceHint({ ...base, tool: 'place', armed: FIXTURE_TEMPLATE, onPlan: false })
    expect(hint).toMatch(/Drag to orbit/)
  })

  it('asks for a template before it asks for a click', () => {
    expect(describeSurfaceHint({ ...base, tool: 'place', armed: null })).toMatch(
      /Choose a template in the palette/,
    )
  })

  it('names the piece the erase gesture would take', () => {
    const piece = scene.pieces[0]
    const hint = describeSurfaceHint({ ...base, tool: 'erase', armed: null, under: piece })
    expect(hint).toContain('click to remove')
  })

  it('counts outlined parts rather than outlined placements', () => {
    // Parts, because a plate is drawn per part: a three-part template with one
    // converted file is two outlines, and a count of placements would say "1"
    // about two things on screen.
    const waiting = describeSurfaceHint({ ...base, tool: 'place', armed: FIXTURE_TEMPLATE, waiting: 2 })
    expect(waiting).toMatch(/2 placed parts have no mesh yet/)
  })

  it('puts the instances with nothing chosen above the ones awaiting a mesh', () => {
    // Ordered by what the user can act on: filling a slot is something they can
    // do, and a conversion only needs waiting for. Both are true at once on a
    // fresh room, so the precedence is a real choice rather than a fallthrough.
    const hint = describeSurfaceHint({
      ...base,
      tool: 'place',
      armed: FIXTURE_TEMPLATE,
      waiting: 2,
      unfilled: 1,
    })
    expect(hint).toMatch(/no parts chosen/i)
    expect(hint).not.toMatch(/no mesh yet/)
  })

  it('quotes the armed family’s own rotation step in the plain case', () => {
    const hint = describeSurfaceHint({ ...base, tool: 'place', armed: FIXTURE_TEMPLATE })
    expect(hint).toContain('Click to place')
    expect(hint).toContain(describeTemplate(FIXTURE_TEMPLATE))
    expect(hint).toContain(String(ARMED_TURN_STEP_DEG))
  })
})

describe('the canvas’s accessible name', () => {
  it('invites a first placement into an empty plan', () => {
    expect(describeSurface(sceneOf(CATALOG, []), 0)).toMatch(/empty plan in 3D/)
  })

  it('summarises rather than inventories, and counts what is not drawn', () => {
    const scene = sceneOf(CATALOG, [
      { tile: FIXTURE_IDS.floor1, x: 0, z: 0 },
      { tile: FIXTURE_IDS.floor2, x: 0, z: 0 },
    ])
    const label = describeSurface(scene, 1)
    expect(label).toContain('2 placed templates')
    expect(label).toContain('overlapping')
    expect(label).toContain('1 part awaiting a mesh')
    // A summary: no tile name and no coordinate in it.
    expect(label).not.toContain('x 0')
  })

  it('counts an instance with nothing chosen as placed, and says which', () => {
    // A room of five templates and no fills is not an empty room. `scene.pieces`
    // alone would call it one, because an instance with no drawable part is not a
    // `PlanPiece` at all — it is in `PlanScene.unfilled`.
    const scene = sceneOf(CATALOG, [{ x: 0, z: 0 }, { tile: FIXTURE_IDS.floor1, x: 4, z: 4 }])
    expect(scene.pieces).toHaveLength(1)
    expect(scene.unfilled).toHaveLength(1)
    const label = describeSurface(scene, 0)
    expect(label).toContain('2 placed templates')
    expect(label).toContain('1 with no parts chosen')
  })
})

/* --------------------------------------------------------------- the anchor rule */

describe('the marker and the placement are one call, not two', () => {
  it('places at the anchor the marker at the same cursor was drawn at', () => {
    // The property `ghost.ts` was made pure for, at the size row A4b left it:
    // `planPlacement` is the only thing between a click and the store, so a
    // second anchor derivation inside it would be the bug — the marker would
    // sit half a unit from where the instance lands.
    for (const cursor of [[0, 0], [1.24, -3.76], [7.5, 7.5]] as PlanPoint[]) {
      const edit = planPlacement(FIXTURE_TEMPLATE, 90, cursor, FINE)
      expect(edit.kind).toBe('place')
      if (edit.kind !== 'place') continue
      expect(edit.anchor).toEqual(templateGhost(FIXTURE_TEMPLATE, 90, cursor, FINE).anchor)
      // On the lattice, both axes, whatever the cursor was.
      expect(edit.anchor[0] * 2).toBeCloseTo(Math.round(edit.anchor[0] * 2), 9)
      expect(edit.anchor[1] * 2).toBeCloseTo(Math.round(edit.anchor[1] * 2), 9)
    }
  })

  it('leaves the marker unturned while carrying the angle to the store', () => {
    // The anchor is the minimum corner the store receives, and `slotAnchor`
    // keeps that invariant under rotation — so a marker that turned could only
    // slide away from the point the placement lands on. The angle is still stored: §1 places and
    // rotates a template as one unit.
    const unturned = templateGhost(FIXTURE_TEMPLATE, 0, [2, 2], FINE)
    const turned = templateGhost(FIXTURE_TEMPLATE, 90, [2, 2], FINE)
    expect(turned.box).toEqual(unturned.box)
    expect(turned.polygons).toEqual(unturned.polygons)
    expect(turned.rotation).toBe(90)
    expect(planPlacement(FIXTURE_TEMPLATE, 90, [2, 2], FINE)).toMatchObject({ rotation: 90 })
  })
})

