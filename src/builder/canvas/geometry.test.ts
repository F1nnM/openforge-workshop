/**
 * Geometry and camera tests. Headless — no DOM, no React.
 *
 * The properties asserted here are the ones a wrong answer would make *look*
 * right: a snap that lands a quarter unit off is invisible at a glance and
 * unbuildable in resin, and a rotation that drifts by 6e-17 makes two tiles look
 * flush and compare unequal.
 */
import { describe, expect, it } from 'vitest'

import { GRID_UNIT_MM, WALL_THICKNESS_UNITS } from '@/catalog'

import { fixtureCatalogFile } from './fixture'
import {
  DIAGONAL_ANGLE_DEG,
  SNAP_STEP,
  anchorFor,
  anchorForShape,
  boxCentre,
  describeCell,
  describeFootprint,
  footprintExtent,
  footprintShape,
  isAxisAligned,
  isPlaceable,
  isQuarterTurn,
  nextRotation,
  partsContain,
  placementCaveat,
  placementRefusal,
  planBox,
  planGeometry,
  planParts,
  planQuad,
  quadContains,
  rotatedExtent,
  rotationStepFor,
  snapTo,
  unitsToMm,
} from './geometry'
import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  clampScale,
  defaultViewport,
  ensureVisible,
  fitBoxes,
  panByPixels,
  toWorld,
  usableSize,
  viewBox,
  zoomAt,
} from './viewport'

const catalog = fixtureCatalogFile()
const record = (id: string) => {
  const found = catalog.records.find((candidate) => candidate.id === id)
  if (found === undefined) throw new Error(`no fixture record ${id}`)
  return found
}

describe('snapping', () => {
  it('offers only 0.5 and 1 — never 0.25', () => {
    expect(Object.values(SNAP_STEP)).toEqual([0.5, 1])
    expect(Object.values(SNAP_STEP)).not.toContain(0.25)
  })

  it('lands every value on a 0.5 boundary in fine mode', () => {
    for (let raw = -12; raw <= 12; raw += 0.037) {
      const snapped = snapTo(raw, SNAP_STEP.fine)
      expect(Number.isInteger(snapped * 2)).toBe(true)
      expect(Math.abs(snapped - raw)).toBeLessThanOrEqual(SNAP_STEP.fine / 2 + 1e-9)
    }
  })

  it('lands every value on a whole unit in coarse mode', () => {
    for (let raw = -12; raw <= 12; raw += 0.037) {
      expect(Number.isInteger(snapTo(raw, SNAP_STEP.coarse))).toBe(true)
    }
  })

  it('normalises negative zero, which JSON round-trips would lose', () => {
    expect(Object.is(snapTo(-0.2, 0.5), 0)).toBe(true)
  })

  it('anchors a piece so its faces, not its centre, land on the lattice', () => {
    // A 2-unit wall is 0.5 deep, so its centre sits a quarter unit off the cell
    // edge. Snapping the centre would put that face at 0.25 and make the wall
    // unable to sit flush against a floor tile.
    const wall = footprintExtent({ shape: 'wall', length: 2 })
    if (wall === undefined) throw new Error('wall has an extent')
    const [x, z] = anchorFor(wall, 0, 3.1, 2.2, SNAP_STEP.fine)
    expect(Number.isInteger(x * 2)).toBe(true)
    expect(Number.isInteger(z * 2)).toBe(true)
    // …and so does the far face.
    expect(Number.isInteger((x + wall.w) * 2)).toBe(true)
    expect(Number.isInteger((z + wall.d) * 2)).toBe(true)
  })
})

describe('footprints', () => {
  it('reads a rect straight off the record', () => {
    expect(footprintExtent({ shape: 'rect', w: 2, d: 1 })).toEqual({ w: 2, d: 1 })
  })

  it('supplies a wall depth from the measured constant, since the data has none', () => {
    expect(footprintExtent({ shape: 'wall', length: 4 })).toEqual({ w: 4, d: WALL_THICKNESS_UNITS })
    expect(WALL_THICKNESS_UNITS).toBe(0.5)
  })

  it('gives a column the measured wall-thickness square, with no dimension in the data', () => {
    expect(footprintExtent({ shape: 'column' })).toEqual({ w: 0.5, d: 0.5 })
  })

  it('gives a triangle its tagged leg on both axes and a three-point outline', () => {
    const shape = footprintShape({ shape: 'tri', leg: 2 })
    expect(shape?.extent).toEqual({ w: 2, d: 2 })
    expect(shape?.parts).toEqual([
      [
        [0, 0],
        [2, 0],
        [0, 2],
      ],
    ])
    expect(shape?.cover).toBe('exact')
  })

  it('gives a diagonal wall its run by the thickness, and carries the 45 as an intrinsic angle', () => {
    // Not the axis-aligned box: the piece IS a 2.828 x 0.5 strip, and where it
    // points is the shape's own business rather than the extent's.
    const shape = footprintShape({ shape: 'diag', run: 2.828 })
    expect(shape?.extent).toEqual({ w: 2.828, d: 0.5 })
    expect(shape?.angle).toBe(DIAGONAL_ANGLE_DEG)
    expect(DIAGONAL_ANGLE_DEG).toBe(45)
  })

  it('gives an arc the sector box, and parts that are an outward bound rather than the shape', () => {
    const shape = footprintShape({ shape: 'arc', rIn: 0, rOut: 2, sweep: 90, band: 'radial', bandBasis: 'measured' })
    expect(shape?.extent).toEqual({ w: 2, d: 2 })
    expect(shape?.cover).toBe('outward')
    expect(shape?.slack).toBeGreaterThan(0)
    expect(shape?.parts.length).toBeGreaterThan(1)
  })

  it('has no extent for none, and that is the only case left', () => {
    expect(footprintExtent({ shape: 'none' })).toBeUndefined()
    for (const foot of [
      { shape: 'rect', w: 1, d: 1 },
      { shape: 'wall', length: 2 },
      { shape: 'column' },
      { shape: 'tri', leg: 4 },
      { shape: 'diag', run: 3.536 },
      { shape: 'arc', rIn: 4, rOut: 4.5, sweep: 22.5, band: 'concave', bandBasis: 'measured' },
    ] as const) {
      expect(footprintExtent(foot)).toBeDefined()
    }
  })

  it('converts to millimetres at the measured grid unit', () => {
    expect(unitsToMm(2)).toBeCloseTo(2 * GRID_UNIT_MM, 10)
    expect(GRID_UNIT_MM).toBe(25.4)
  })
})

describe('rotation', () => {
  it('swaps a rect exactly on an odd quarter turn', () => {
    expect(rotatedExtent({ w: 2, d: 1 }, 90)).toEqual({ w: 1, d: 2 })
    expect(rotatedExtent({ w: 2, d: 1 }, 270)).toEqual({ w: 1, d: 2 })
    expect(rotatedExtent({ w: 2, d: 1 }, 180)).toEqual({ w: 2, d: 1 })
    expect(rotatedExtent({ w: 2, d: 1 }, 0)).toEqual({ w: 2, d: 1 })
  })

  it('swaps a wall length and its thickness', () => {
    const wall = footprintExtent({ shape: 'wall', length: 3 })
    if (wall === undefined) throw new Error('wall has an extent')
    expect(rotatedExtent(wall, 90)).toEqual({ w: WALL_THICKNESS_UNITS, d: 3 })
  })

  it('keeps a quarter turn on the lattice — no trigonometric residue', () => {
    const turned = rotatedExtent({ w: 2, d: 0.5 }, 90)
    expect(Number.isInteger(turned.w * 2)).toBe(true)
    expect(Number.isInteger(turned.d * 2)).toBe(true)
  })

  it('bounds a non-axis-aligned tile by its turned box', () => {
    const turned = rotatedExtent({ w: 2, d: 1 }, 45)
    const expected = (2 + 1) / Math.SQRT2
    expect(turned.w).toBeCloseTo(expected, 10)
    expect(turned.d).toBeCloseTo(expected, 10)
  })

  it('classifies angles', () => {
    expect(isQuarterTurn(90)).toBe(true)
    expect(isQuarterTurn(270)).toBe(true)
    expect(isQuarterTurn(180)).toBe(false)
    expect(isAxisAligned(180)).toBe(true)
    expect(isAxisAligned(45)).toBe(false)
  })

  it('takes the step from the tile, not from a global default', () => {
    expect(rotationStepFor(record('tiles/wood/floor/2x1,45.openlock.stl'))).toBe(45)
    expect(rotationStepFor(record('tiles/dungeon_stone/floor/1x1.openlock.stl'))).toBe(90)
  })

  it('turns a 45° tile through its own eight positions and back to zero', () => {
    let rotation = 0
    const angles: number[] = []
    for (let i = 0; i < 8; i += 1) {
      rotation = nextRotation(rotation, 45)
      angles.push(rotation)
    }
    expect(angles).toEqual([45, 90, 135, 180, 225, 270, 315, 0])
  })

  it('folds a reverse turn into [0, 360)', () => {
    expect(nextRotation(0, 90, -1)).toBe(270)
  })

  it('preserves the anchor corner, keeping the piece on the lattice', () => {
    const before = planBox({ w: 2, d: 0.5 }, 0, 3, 2)
    const after = planBox({ w: 2, d: 0.5 }, 90, 3, 2)
    expect([after.x, after.z]).toEqual([before.x, before.z])
    expect([after.w, after.d]).toEqual([0.5, 2])
  })
})

describe('quads', () => {
  it('reduces to the box for an axis-aligned piece', () => {
    const quad = planQuad({ w: 2, d: 1 }, 0, 1, 1)
    expect(quad.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100])).toEqual([
      [1, 1],
      [3, 1],
      [3, 2],
      [1, 2],
    ])
  })

  it('turns about the box centre, so a 45° piece stays inside its box', () => {
    const box = planBox({ w: 2, d: 1 }, 45, 0, 0)
    const centre = boxCentre(box)
    for (const [x, z] of planQuad({ w: 2, d: 1 }, 45, 0, 0)) {
      expect(x).toBeGreaterThanOrEqual(box.x - 1e-9)
      expect(x).toBeLessThanOrEqual(box.x + box.w + 1e-9)
      expect(z).toBeGreaterThanOrEqual(box.z - 1e-9)
      expect(z).toBeLessThanOrEqual(box.z + box.d + 1e-9)
    }
    expect(centre.x).toBeCloseTo(box.x + box.w / 2, 10)
  })

  it('hit-tests a point inside and outside', () => {
    const quad = planQuad({ w: 2, d: 1 }, 0, 0, 0)
    expect(quadContains(quad, [1, 0.5])).toBe(true)
    expect(quadContains(quad, [2.5, 0.5])).toBe(false)
    // A corner of a 45° tile's bounding box is outside the tile itself.
    const turned = planQuad({ w: 2, d: 2 }, 45, 0, 0)
    const box = planBox({ w: 2, d: 2 }, 45, 0, 0)
    expect(quadContains(turned, [box.x + 0.05, box.z + 0.05])).toBe(false)
  })
})

describe('placed shapes', () => {
  it('folds a diagonal wall s intrinsic angle into the box and the parts', () => {
    const shape = footprintShape({ shape: 'diag', run: 2.828 })
    if (shape === undefined) throw new Error('a diag has a shape')
    const placed = planGeometry(shape, 0, 1, 1)
    expect(placed.rotation).toBe(0)
    expect(placed.angle).toBe(45)
    expect(placed.axisAligned).toBe(false)
    const side = (2.828 + 0.5) / Math.SQRT2
    expect(placed.box.w).toBeCloseTo(side, 10)
    // Every corner of the strip is inside the box it reserved.
    for (const [x, z] of placed.parts[0] ?? []) {
      expect(x).toBeGreaterThanOrEqual(placed.box.x - 1e-9)
      expect(x).toBeLessThanOrEqual(placed.box.x + placed.box.w + 1e-9)
      expect(z).toBeGreaterThanOrEqual(placed.box.z - 1e-9)
      expect(z).toBeLessThanOrEqual(placed.box.z + placed.box.d + 1e-9)
    }
  })

  it('anchors a shape on its drawn angle, not on its placement rotation', () => {
    const shape = footprintShape({ shape: 'diag', run: 2.828 })
    if (shape === undefined) throw new Error('a diag has a shape')
    // `anchorFor` on the raw extent would centre a 2.828 x 0.5 rectangle;
    // `anchorForShape` centres the 2.354-square box the piece really occupies.
    expect(anchorForShape(shape, 0, 3, 3, SNAP_STEP.fine)).not.toEqual(
      anchorFor(shape.extent, 0, 3, 3, SNAP_STEP.fine),
    )
    expect(anchorForShape(shape, 0, 3, 3, SNAP_STEP.fine)).toEqual(
      anchorFor(shape.extent, 45, 3, 3, SNAP_STEP.fine),
    )
  })

  it('reduces to planQuad for a straight axis-aligned piece', () => {
    const shape = footprintShape({ shape: 'rect', w: 2, d: 1 })
    if (shape === undefined) throw new Error('a rect has a shape')
    expect(planParts(shape, 0, 1, 1)).toEqual([planQuad({ w: 2, d: 1 }, 0, 1, 1)])
  })

  it('hit-tests across every part of a curved piece', () => {
    const shape = footprintShape({ shape: 'arc', rIn: 0, rOut: 2, sweep: 90, band: 'radial', bandBasis: 'measured' })
    if (shape === undefined) throw new Error('an arc has a shape')
    const parts = planParts(shape, 0, 0, 0)
    // Inside the disc, near the middle of the sweep — a point no single part of
    // the eight contains on its own account of the whole shape.
    expect(partsContain(parts, [0.7, 0.7])).toBe(true)
    // The far corner of the bounding box is outside the disc.
    expect(partsContain(parts, [1.99, 1.99])).toBe(false)
  })
})

describe('refusal', () => {
  it('accepts all six drawable primitives', () => {
    for (const id of [
      'tiles/dungeon_stone/floor/2x2.openlock.stl',
      'tiles/cut_stone/wall/2.openlock.stl',
      'tiles/cave/curve/r2.openlock.stl',
      'tiles/dungeon_stone/column/col+I.openlock.stl',
      'tiles/wood/angled/tri2.openlock.stl',
      'tiles/cut_stone/angled/diagPA.openlock.stl',
    ]) {
      expect(placementRefusal(record(id))).toBeUndefined()
      expect(isPlaceable(record(id))).toBe(true)
    }
  })

  it('refuses a shapeless tile with a reason, rather than drawing it as a box', () => {
    const refusal = placementRefusal(record('tiles/cave/hex/hex.stl'))
    expect(refusal?.code).toBe('no-footprint')
    expect(refusal?.message).toContain('no derivable footprint')
    expect(refusal?.message).toContain('Cave hex platform')
    expect(isPlaceable(record('tiles/cave/hex/hex.stl'))).toBe(false)
  })

  it('never greys a tile without a reason — the two answers read one gate', () => {
    // The regression this row closed. `column`, `tri` and `diag` were greyed out
    // by `isPlaceable` while `placementRefusal` returned undefined for all 249,
    // so `PalettePanel.tsx`'s `?? ''` rendered an empty explanation. Asserted
    // over the whole fixture rather than over the three cases, so the next
    // union member cannot reintroduce it.
    for (const candidate of catalog.records) {
      expect(isPlaceable(candidate)).toBe(placementRefusal(candidate) === undefined)
      if (!isPlaceable(candidate)) expect(placementRefusal(candidate)?.message).not.toBe('')
    }
  })
})

describe('caveats', () => {
  it('discloses a fallback band rather than refusing it', () => {
    const fallback = record('tiles/cut_stone/curve/4r45.convex.openlock.stl')
    expect(isPlaceable(fallback)).toBe(true)
    const caveat = placementCaveat(fallback)
    expect(caveat?.code).toBe('unmeasured-band')
    expect(caveat?.message).toContain('convex')
    expect(caveat?.message).toContain('half a unit')
  })

  it('leaves a measured band uncaveated, and every straight footprint too', () => {
    expect(placementCaveat(record('tiles/cave/curve/r2.openlock.stl'))).toBeUndefined()
    expect(placementCaveat(record('tiles/cut_stone/wall/2.openlock.stl'))).toBeUndefined()
    expect(placementCaveat(record('tiles/cave/hex/hex.stl'))).toBeUndefined()
  })
})

describe('describing a footprint', () => {
  it('reads a straight piece out as its extent', () => {
    expect(describeFootprint({ shape: 'rect', w: 2, d: 1 }, { w: 2, d: 1 })).toBe('2 × 1 units')
    expect(describeFootprint({ shape: 'column' }, { w: 0.5, d: 0.5 })).toBe('0.5 × 0.5 units')
  })

  it('reads a curve out as its radii and sweep, never as its box', () => {
    const foot = { shape: 'arc', rIn: 4, rOut: 4.5, sweep: 22.5, band: 'concave', bandBasis: 'measured' } as const
    const spoken = describeFootprint(foot, { w: 0.34, d: 1.72 })
    expect(spoken).toContain('radius 4 to 4.5 units')
    expect(spoken).toContain('22.5° sweep')
    expect(spoken).not.toContain('1.72')
  })

  it('names the two angled cases as what they are', () => {
    expect(describeFootprint({ shape: 'tri', leg: 4 }, { w: 4, d: 4 })).toContain('right triangle')
    expect(describeFootprint({ shape: 'diag', run: 2.828 }, { w: 2.354, d: 2.354 })).toContain('diagonal wall run')
  })
})

describe('readouts', () => {
  it('spells a coordinate without trailing zeros', () => {
    expect(describeCell(3.5, 2)).toBe('x 3.5, z 2')
    expect(describeCell(-0.5, 0)).toBe('x -0.5, z 0')
  })
})

describe('camera', () => {
  const size = { width: 800, height: 600 }

  it('clamps the scale and falls back on a non-finite one', () => {
    expect(clampScale(1)).toBe(MIN_SCALE)
    expect(clampScale(10_000)).toBe(MAX_SCALE)
    expect(clampScale(Number.NaN)).toBe(DEFAULT_SCALE)
  })

  it('substitutes a usable size for an element that has not been laid out', () => {
    expect(usableSize(null).width).toBeGreaterThan(0)
    expect(usableSize({ width: 0, height: 0 }).width).toBeGreaterThan(0)
    expect(usableSize(size)).toEqual(size)
  })

  it('maps pixels to grid units through the viewBox', () => {
    const view = { x: 2, z: 3, scale: 40 }
    expect(toWorld(view, 0, 0)).toEqual([2, 3])
    expect(toWorld(view, 40, 80)).toEqual([3, 5])
    const frame = viewBox(view, size)
    expect(frame).toEqual({ x: 2, z: 3, w: 20, d: 15 })
  })

  it('keeps the world point under the cursor fixed while zooming', () => {
    const view = { x: 0, z: 0, scale: 40 }
    const before = toWorld(view, 300, 200)
    const zoomed = zoomAt(view, 2, 300, 200)
    const after = toWorld(zoomed, 300, 200)
    expect(after[0]).toBeCloseTo(before[0], 10)
    expect(after[1]).toBeCloseTo(before[1], 10)
    expect(zoomed.scale).toBe(80)
  })

  it('refuses to drift when the zoom is already at its limit', () => {
    const view = { x: 1, z: 1, scale: MAX_SCALE }
    expect(zoomAt(view, 2, 100, 100)).toBe(view)
  })

  it('pans in pixels regardless of scale', () => {
    expect(panByPixels({ x: 0, z: 0, scale: 50 }, 100, -50)).toEqual({ x: 2, z: -1, scale: 50 })
  })

  it('scrolls only as far as it must to reveal a box', () => {
    const view = { x: 0, z: 0, scale: 40 }
    expect(ensureVisible(view, size, { x: 5, z: 5, w: 1, d: 1 })).toBe(view)
    // The box sits left of the frame and hard against its top edge, so both
    // axes move — the margin is clear space, not a tolerance.
    const scrolled = ensureVisible(view, size, { x: -3, z: 0, w: 1, d: 1 }, 1)
    expect(scrolled.x).toBe(-4)
    expect(scrolled.z).toBe(-1)
  })

  it('frames every box when fitting, and falls back to the default view for none', () => {
    const fitted = fitBoxes([{ x: 0, z: 0, w: 10, d: 10 }], size)
    const frame = viewBox(fitted, size)
    expect(frame.x).toBeLessThan(0)
    expect(frame.x + frame.w).toBeGreaterThan(10)
    expect(fitBoxes([], size)).toEqual(defaultViewport())
  })
})
