/**
 * A generated base on the plan: drawn, collided, hit-tested, moved and erased.
 *
 * Row S5 finished the geometry — *"Collision, box, label and material are
 * done"* — and shipped it unreachable, because `PlanPiece` requires a
 * `CatalogRecord` and a generated base has none. This file is the proof that the
 * second list closed that, and it is written against the three claims a second
 * list could plausibly get wrong:
 *
 *   1. **One conflict sweep, not two.** A generated base and a catalogued tile
 *      must conflict with each other. Two independent sweeps would find neither,
 *      and the symptom would be a base drawn cleanly on top of a floor.
 *   2. **One `PlacementId` space.** `pieceAt`, `previewMove` and `beginMove` take
 *      the union, and they are safe doing so only because row S5 proved a
 *      `GeneratedBaseId` can never be a `TileId`.
 *   3. **One paint order.** `scenePaintOrder` and whatever draws the scene have
 *      to be the same statement, or `pieceAt` returns a piece the user cannot
 *      see. The renderer that had to agree with it was `PlanCanvas`, whose DOM
 *      order was the paint order; row **R4** deleted it and `three/edits.ts` is
 *      the consumer now — the 3D surface resolves a pick through the same
 *      function, so the claim is unchanged and its second party is not.
 *
 * ## What these tests cannot prove
 *
 * **Nothing here renders and nothing is measured.** These are polygon
 * coordinates, string contents and store writes. jsdom rasterises nothing and
 * measures no layout, so no test in this file — or in row S5's, which says the
 * same thing — says anything about how a generated base *looks*. That gap got
 * wider in row **R4**: the drawing this file's coordinates were written for was
 * an SVG one whose fills, contour weights and dashed off-grid strokes at least
 * had a rendered test beside them in `canvas.test.tsx`, and R4 deleted both. The
 * geometry is now consumed by a GPU renderer that no test in this repository can
 * rasterise at all, so **everything visual about a generated base is verified in
 * a browser or not verified.**
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_ROTATION_STEP_DEG } from '@/catalog'
import { baseFootprint } from '@/generator/panel/footprint'
import { PANEL_ENTRIES, panelSchema } from '@/generator/panel/schemas'
import { GENERATED_ROTATION_STEP_DEG } from '@/generator/placement/placement'
import type { PlacementId, WorkshopState } from '@/store'
import { aGeneratedBase } from '@/store/fixture'

import { createStyleResolver, planCatalogFromFile } from './catalog'
import {
  FIXTURE_IDS,
  FIXTURE_SLOTS,
  FIXTURE_TEMPLATE,
  fixtureCatalogFile,
  fixtureFills,
  fixtureInstance,
  fixtureSlotLayout,
} from './fixture'
import { beginMove, previewMove } from './move'
import {
  buildPlanScene,
  describeTemplate,
  navigationOrder,
  pieceAt,
  pieceName,
  pieceRotationStep,
  scenePaintOrder,
} from './scene'
import { VACANCY_STEP, freeCellFor } from './vacancy'

const file = fixtureCatalogFile()
const catalog = planCatalogFromFile(file, fixtureSlotLayout)
const styleOf = createStyleResolver(catalog)

/**
 * Catalog placements from `[key, tileId, x, z, rotation]` tuples.
 *
 * One-part template instances, filling the **`base`** slot — whose fixture
 * layout is `(0, 0)` unturned at `elevationMm: 0`, so the geometry is exactly
 * what a pre-A1 placement of the same file had and every cross-population
 * assertion below carries over.
 *
 * **It was the `floor` slot until row A7, and the slot is now load bearing.**
 * `subjectsConflict` reads a vertical interval, the fixture rule lifts `floor` by
 * 6.35 mm, and a generated base is 6 mm tall — so a base under a floor-slot part
 * passes *under* it and is no longer a conflict, which is the whole point of the
 * row and is asserted on its own below. Every test here that is about the
 * *sweep* rather than about the vertical axis needs the two populations on one
 * level to have anything to find, and the ground is where the shipped layout
 * rule puts them anyway.
 */
function tiles(rows: readonly [string, string, number, number, number][]): WorkshopState['placements'] {
  const placements: Record<string, WorkshopState['placements'][PlacementId]> = {}
  for (const [key, tileId, x, z, rotation] of rows) {
    placements[key] = fixtureInstance(key, fixtureFills([[FIXTURE_SLOTS.base, tileId]]), { x, z, rotation })
  }
  return placements
}

/** Generated placements from `[key, x, z, rotation?, parameters?]` tuples. */
function bases(
  rows: readonly [string, number, number, number?, Readonly<Record<string, unknown>>?][],
): WorkshopState['generated'] {
  const generated: Record<string, ReturnType<typeof aGeneratedBase>> = {}
  for (const [key, x, z, rotation, parameters] of rows) {
    generated[key] = aGeneratedBase({
      x,
      z,
      ...(rotation === undefined ? {} : { rotation }),
      ...(parameters === undefined ? {} : { parameters: parameters as never }),
    })
  }
  return generated
}

const sceneOf = (
  placements: WorkshopState['placements'] = {},
  generated: WorkshopState['generated'] = {},
) => buildPlanScene(placements, catalog, styleOf, generated)

/* ------------------------------------------------------------------ drawing */

describe('the second list', () => {
  it('is empty for every caller that passes no generated map', () => {
    // The landing hero, row G2's 3D room and every fixture call this way. The
    // optional argument is what kept their signatures unchanged.
    const scene = buildPlanScene(tiles([['a', FIXTURE_IDS.floor2, 0, 0, 0]]), catalog, styleOf)
    expect(scene.generated).toEqual([])
    expect(scene.pieces).toHaveLength(1)
  })

  it('resolves a generated base into a drawable piece with PlanPiece’s own field names', () => {
    const scene = sceneOf({}, bases([['g1', 0, 0]]))
    const piece = scene.generated[0]

    expect(piece?.kind).toBe('generated')
    expect(piece?.id).toBe('g1')
    // The 2x2 opening tuple, on the inch grid: two squares each way, which is
    // also two grid units because `SQUARE_BASIS` is the grid's.
    expect(piece?.box).toEqual({ x: 0, z: 0, w: 2, d: 2 })
    expect(piece?.band).toBe('area')
    expect(piece?.tiles).toBe(true)
    expect(piece?.caveat).toBeNull()
    // `polygons`, not `parts`: `PlanPiece.parts` means its filled slots since row
    // A1, and a generated base has none — it is one primitive, so `polygons`
    // holds its single convex outline and the shared field name still lets one
    // renderer draw both populations.
    expect(piece?.polygons).toHaveLength(1)
    expect(piece?.name).toBe('Generated square base')
    expect(piece?.label).toContain('Generated square base')
  })

  it('asks the material registry rather than choosing, so it matches a plain base', () => {
    // Row S5's `corpus.test.ts` asserts the same thing against the real index.
    // What this adds is that the *scene* carries the answer through, rather than
    // a style resolver keyed on a record it has not got.
    const piece = sceneOf({}, bases([['g1', 0, 0]])).generated[0]
    expect(piece?.style.material).toBe('plain')
    expect(piece?.style.tint).toMatch(/^#|^rgb|^oklch|^color/)
  })

  it('draws a non-inch base at its real size, and marks it as one that will not tile', () => {
    // S4 flagged this and left it open; S5 closed it. A `wyloch` 2x2 is 63.5 mm
    // across, which is 2.5 grid squares — drawing it at 2 would understate a real
    // object by 25%, in the module whose job is refusing overlaps.
    const scene = sceneOf({}, bases([['g1', 0, 0, 0, { x: 2, y: 2, SQUARE_BASIS: 'wyloch' }]]))
    const piece = scene.generated[0]

    expect(piece?.box.w).toBeCloseTo(2.5, 6)
    expect(piece?.box.d).toBeCloseTo(2.5, 6)
    expect(piece?.tiles).toBe(false)
    expect(piece?.label).toContain('will not tile')
  })
})

/* ---------------------------------------------------------------- collision */

describe('one conflict sweep over both populations', () => {
  it('reports a generated base and a catalogued floor on the same cells as a conflict', () => {
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor2, 0, 0, 0]]), bases([['g1', 0, 0]]))

    // Both ids, from one sweep. This is the assertion two separate sweeps fail.
    expect([...scene.conflicts.keys()].sort()).toEqual(['g1', 't1'])
    expect(scene.pieces[0]?.conflict).toBe(true)
    expect(scene.generated[0]?.conflict).toBe(true)
  })

  it('does not report abutting neighbours, so a base beside a floor is legal', () => {
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor2, 2, 0, 0]]), bases([['g1', 0, 0]]))
    expect(scene.conflicts.size).toBe(0)
  })

  it('does not report a 6 mm generated base under a part the layout rule lifted', () => {
    /*
      **Row A7's own case, across the two populations.** The same cells as the
      test above, and the only difference is which slot the catalog part fills:
      `floor` carries `elevationMm: 6.35` under `fixtureSlotLayout` and a
      generated base is `HEIGHT` mm tall, 6 by default. So the base's interval is
      [0, 6] and the part is the level 6.35 — disjoint, and a base under a floor
      is what an OpenForge build *is*.

      Before this row the two were both `area`-band pieces on one square and the
      sweep reported both. Note what is doing the work: the band is identical on
      both sides here, so this conflict can only be removed by the elevation.
    */
    const lifted = {
      ['t1' as PlacementId]: fixtureInstance('t1', fixtureFills([[FIXTURE_SLOTS.floor, FIXTURE_IDS.floor2]]), {
        x: 0,
        z: 0,
      }),
    }
    const scene = sceneOf(lifted, bases([['g1', 0, 0]]))
    expect(scene.pieces[0]?.parts[0]?.band).toBe('area')
    expect(scene.generated[0]?.band).toBe('area')
    expect(scene.pieces[0]?.parts[0]?.layout.elevationMm).toBe(6.35)
    expect(scene.generated[0]?.foot.heightMm).toBe(6)
    expect(scene.conflicts.size).toBe(0)

    // And a riser tall enough to reach that level is a conflict again, which is
    // why the subject carries an interval and not a bare level: the height comes
    // off the recipe's own parameters.
    const tall = sceneOf(lifted, bases([['g1', 0, 0, 0, { x: 2, y: 2, HEIGHT: 12 }]]))
    expect(tall.generated[0]?.foot.heightMm).toBe(12)
    expect([...tall.conflicts.keys()].sort()).toEqual(['g1', 't1'])
  })

  it('reports two generated bases on the same cells', () => {
    const scene = sceneOf({}, bases([['g1', 0, 0], ['g2', 1, 1]]))
    expect([...scene.conflicts.keys()].sort()).toEqual(['g1', 'g2'])
  })

  it('includes generated bases in the scene bounds, so an all-generated room has a viewport', () => {
    const empty = sceneOf()
    expect(empty.bounds).toBeNull()

    const scene = sceneOf({}, bases([['g1', 0, 0], ['g2', 4, 0]]))
    expect(scene.bounds).toEqual({ x: 0, z: 0, w: 6, d: 2 })
  })
})

/* ------------------------------------------------------- order and identity */

describe('paint order and hit testing', () => {
  it('paints generated bases under the catalog’s pieces, which is what a base is', () => {
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor1, 0, 0, 0]]), bases([['g1', 0, 0]]))
    expect(scenePaintOrder(scene).map((piece) => piece.id)).toEqual(['g1', 't1'])
  })

  it('returns the piece the user can see, which is the catalog tile over the base', () => {
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor1, 0, 0, 0]]), bases([['g1', 0, 0]]))
    // Inside both: the 1x1 floor at the origin sits on the base's first cell.
    expect(pieceAt(scene, [0.5, 0.5])?.id).toBe('t1')
    // Inside the base only.
    expect(pieceAt(scene, [1.5, 1.5])?.id).toBe('g1')
    expect(pieceAt(scene, [9, 9])).toBeUndefined()
  })

  it('steps the cursor through both populations in reading order', () => {
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor1, 0, 4, 0]]), bases([['g1', 0, 0]]))
    expect(navigationOrder(scene).map((piece) => piece.id)).toEqual(['g1', 't1'])
  })

  it('names either population, so one readout serves the erase gesture and the bill', () => {
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor1, 0, 4, 0]]), bases([['g1', 0, 0]]))
    // The catalog arm names the **family** since row A1, not a file: an instance
    // is up to five files and `record.name` had no single answer. A caller that
    // wants a file's name wants a part.
    expect(pieceName(scene.pieces[0]!)).toBe(describeTemplate(FIXTURE_TEMPLATE))
    expect(pieceName(scene.pieces[0]!)).toBe('Fixture corner')
    expect(pieceName(scene.generated[0]!)).toBe('Generated square base')
  })

  it('turns a generated base by row S5’s own step, restated rather than imported', () => {
    // The restatement is deliberate — importing `GENERATED_ROTATION_STEP_DEG`
    // from `placement.ts` would drag 25 KB of pinned parameter JSON into the
    // canvas's chunk — so this is the assertion that stops it drifting. A test
    // file may import the heavy module; `src/**` may not.
    expect(GENERATED_ROTATION_STEP_DEG).toBe(DEFAULT_ROTATION_STEP_DEG)

    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.angled, 0, 4, 0]]), bases([['g1', 0, 0]]))
    expect(pieceRotationStep(scene.generated[0]!)).toBe(GENERATED_ROTATION_STEP_DEG)
    // And the step is still the tile's own where there is one: 45, one of the 893.
    expect(pieceRotationStep(scene.pieces[0]!)).toBe(45)
  })
})

/* ---------------------------------------------------------------- totality */

describe('the projection cannot throw on a schema-valid record', () => {
  it('because every shape the panel offers has a rect footprint, at every offered size', () => {
    // `generatedPiece` throws if `footprintShape` refuses the footprint, and this
    // is the chain that makes that unreachable: the persisted schema constrains
    // the entry to these five, and `baseFootprint` returns a `rect` for all of
    // them at every `x`/`y` the pinned schema offers. If S4 ever adds a shape
    // whose footprint is not a rect, this fails here rather than throwing inside
    // a render.
    for (const entry of PANEL_ENTRIES) {
      const schema = panelSchema(entry)
      const declared = schema.parameters.find((parameter) => parameter.name === 'x')?.options ?? []
      const xs = declared
        .map((option) => Number(option.value))
        .filter((option) => Number.isFinite(option) && option > 0)
      // Every one of the five offers `x` as a dropdown of numbers. If one ever
      // stops, this fails loudly rather than passing over an empty loop — which
      // is the whole difference between this guard and a vacuous one.
      expect(xs.length, `${entry} declares no numeric x options`).toBeGreaterThan(0)
      for (const x of xs) {
        const foot = baseFootprint(entry, { x, y: x })
        expect(foot.footprint.shape, `${entry} at x=${String(x)}`).toBe('rect')
      }
    }
  })
})

/* -------------------------------------------------------------------- move */

describe('moving a generated base', () => {
  it('picks one up and previews it against both populations', () => {
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor2, 4, 0, 0]]), bases([['g1', 0, 0]]))
    const drag = beginMove(scene.generated[0]!, null)
    const preview = previewMove({ ...drag, anchor: [4, 0] }, scene)

    expect(preview?.piece.kind).toBe('generated')
    // Dropped onto the catalogued floor at the same level: refused, which is
    // what makes this the sharper demonstration of the claim under test. The
    // preview had to consult the *other* population to know, and a generated
    // base is the most certain piece either population holds — exact rect
    // geometry, a real height interval from the recipe, and a band this package
    // owns — so nothing here is a guess and the refusal is sound.
    expect(preview?.overlaps.map((piece) => piece.id)).toEqual(['t1'])
    expect(preview?.blocking.map((piece) => piece.id)).toEqual(['t1'])
    expect(preview?.conflict).toBe(true)
    expect(preview?.refusal?.code).toBe('overlap')
    expect(preview?.committable).toBe(false)
  })

  it('refuses a move that would make an identical twin, exactly as for a tile', () => {
    // Row G4's one refusal. It works here because a generated base's identity is
    // its canonical recipe key, so "the same base" is a decidable question.
    const scene = sceneOf({}, bases([['g1', 0, 0], ['g2', 8, 0]]))
    const drag = beginMove(scene.generated.find((piece) => piece.id === 'g2')!, null)
    const preview = previewMove({ ...drag, anchor: [0, 0] }, scene)

    expect(preview?.refusal?.code).toBe('duplicate')
    expect(preview?.committable).toBe(false)
    expect(preview?.refusal?.message).toContain('Generated square base')
  })

  it('does not confuse a generated base with a catalogued tile when refusing', () => {
    // X9's false twin: a refused move with no visible cause. `move.ts#identityOf`
    // compares the two populations, so the two identities must never collide.
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor2, 0, 0, 0]]), bases([['g1', 8, 0]]))
    const drag = beginMove(scene.generated[0]!, null)
    const preview = previewMove({ ...drag, anchor: [0, 0] }, scene)

    // Not `duplicate` — which is the whole claim — but `overlap`, because the
    // two do land on each other. The identity rule stayed out of it, and that is
    // what a false twin would have broken.
    expect(preview?.refusal?.code).toBe('overlap')
    expect(preview?.conflict).toBe(true)
  })

  it('does not confuse them even when the template id *is* the generated base id', () => {
    /*
      **The case row V4 made reachable, kept pointed at row A1's identity.**

      S5 proved the two spaces disjoint lexically: a `GeneratedBaseId` starts
      `gen:` and therefore fails `TileId`'s `^tiles/…` pattern. V4 put a
      `DesignId` in the catalog slot and `DesignId` carries no pattern, so
      nothing in the schemas stopped a design id from being the exact string a
      generated base uses. **A1 moved the slot again**: the catalog arm of
      `identityOf` is now the *family* plus its fills, so the string that could
      collide is a `TemplateId` — and `src/store/schema.ts` states outright that
      `TemplateId` and `DesignId` are not lexically disjoint, so the lexical
      proof is gone for good rather than merely weakened.

      `move.ts#identityOf` qualifies the id with its population instead, so no
      measurement is load bearing. Here the instance's family *is* the generated
      base's id and the move must still not be refused.

      Verified capable of failing: with the `'catalog'` / `'generated'` prefixes
      removed from `identityOf`, this test refuses the move as a `duplicate` and
      the previous one still passes. That is exactly X9's symptom — the user
      drags a piece onto a free cell and the builder refuses, for a reason
      nothing on screen can express.
    */
    const collidingBase = aGeneratedBase({ x: 8, z: 0 })
    const scene = buildPlanScene(
      {
        ['t1' as PlacementId]: fixtureInstance(
          't1',
          fixtureFills([[FIXTURE_SLOTS.base, FIXTURE_IDS.floor2]]),
          { template: collidingBase.base },
        ),
      },
      catalog,
      styleOf,
      { ['g1' as PlacementId]: collidingBase },
    )
    // Both populations drew, so the identities really are in play together.
    expect(scene.pieces).toHaveLength(1)
    expect(scene.generated).toHaveLength(1)
    // And the two identity strings really are the same bare string, which is
    // what makes this a test rather than a coincidence.
    expect(scene.pieces[0]?.placement.template).toBe(scene.generated[0]?.placement.base)

    // Dropped onto the instance's own cell at its own angle, which is the only
    // place a false twin can appear: `duplicateRefusal` needs the identity, the
    // rotation *and* the anchor to agree.
    const drag = beginMove(scene.generated[0]!, null)
    const preview = previewMove({ ...drag, anchor: [0, 0] }, scene)
    // **`overlap`, never `duplicate`** — and the distinction is the whole test.
    // The move is refused either way now, so a reader could mistake a
    // regression for a pass if the code were only checked for *some* refusal.
    // The false twin X9 is about would report `duplicate`, which is a claim
    // about identity that nothing on screen can express; `overlap` is a claim
    // about geometry the user can see. Removing `identityOf`'s population
    // prefixes still flips this assertion, so the test keeps the failure mode
    // its comment above describes.
    expect(preview?.refusal?.code).toBe('overlap')
    expect(preview?.conflict).toBe(true)
    expect(preview?.committable).toBe(false)
  })

  it('carries no concentric note, because a rect has no centre offset', () => {
    const scene = sceneOf({}, bases([['g1', 0, 0]]))
    const drag = beginMove(scene.generated[0]!, null)
    expect(previewMove({ ...drag, anchor: [4, 0] }, scene)?.note).toBeNull()
  })
})

/* ------------------------------------------------------------------ vacancy */

describe('choosing where a base with no cursor goes', () => {
  it('centres the piece on an empty plan', () => {
    // The anchor is the footprint's top-left, so a 2x2 centred on the origin
    // anchors at -1, -1. Without the offset a large base would sit down and right
    // of everything and look arbitrary.
    expect(freeCellFor(sceneOf(), { shape: 'rect', w: 2, d: 2 })).toEqual([-1, -1])
    expect(freeCellFor(sceneOf(), { shape: 'rect', w: 4, d: 4 })).toEqual([-2, -2])
  })

  it('never returns a cell that the scene would then mark in conflict', () => {
    // The property, rather than a coordinate: `freeCellFor` and `buildPlanScene`
    // share one collision predicate, so the two cannot disagree. Asserted by
    // actually placing the base the function chose.
    const placed = tiles([
      ['t1', FIXTURE_IDS.floor2, 0, 0, 0],
      ['t2', FIXTURE_IDS.floor2, 2, 0, 0],
      ['t3', FIXTURE_IDS.floor2, 0, 2, 0],
      ['t4', FIXTURE_IDS.floor2, 2, 2, 0],
    ])
    const scene = sceneOf(placed)
    // The recipe's own height, as `BuilderScreen` passes it: the search and the
    // sweep have to test the same vertical interval or the promise is empty.
    const [x, z] = freeCellFor(scene, { shape: 'rect', w: 2, d: 2 }, 6)

    const after = sceneOf(placed, bases([['g1', x, z]]))
    expect(after.conflicts.size).toBe(0)
  })

  it('lands on the lattice with no negative zero, whatever the plan', () => {
    // A tile at 0.5, 1.5 at 45 degrees: nothing about the plan is on the integer
    // lattice, and the chosen cell still is. `Number.isInteger` rather than
    // `x % VACANCY_STEP === 0`, because `-1 % 1` is `-0` in JavaScript and that
    // would have made this assert the wrong thing about the right answer.
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.angled, 0.5, 1.5, 45]]))
    const [x, z] = freeCellFor(scene, { shape: 'rect', w: 2, d: 2 })
    expect(Number.isInteger(x / VACANCY_STEP)).toBe(true)
    expect(Number.isInteger(z / VACANCY_STEP)).toBe(true)
    // `-0` survives in memory but not through `JSON.stringify`, so a chooser that
    // returned one would hand the store a scene that stops comparing equal to
    // itself after an export and re-import.
    expect(Object.is(x, -0)).toBe(false)
    expect(Object.is(z, -0)).toBe(false)
  })

  it('falls back to a cell clear of everything for a footprint it cannot draw', () => {
    // `none` is the one footprint the plan view refuses. No generated base has
    // one — every shape the panel offers is a rect — so this is the branch that
    // keeps a placement action from throwing on a shape the bill would have
    // listed happily, and it is reachable only by calling it directly.
    const scene = sceneOf(tiles([['t1', FIXTURE_IDS.floor2, 0, 0, 0]]))
    expect(freeCellFor(scene, { shape: 'none' })).toEqual([3, 0])
  })
})
