/**
 * Formatter tests.
 *
 * Node environment — these are pure functions over the catalog contract. What is
 * worth asserting here is not that `toFixed` works but the four decisions the
 * formatters encode: the size chip mirrors the importer's own size token, the
 * `none` footprint has a visible fallback rather than an empty chip, file sizes
 * are decimal, and the sentinel facet values (`!other`, `!none`) get prose
 * labels rather than leaking a `!` into the sidebar.
 */
import { describe, expect, it } from 'vitest'

import { Footprint } from '@/catalog'
import { BUILD_UNSPECIFIED, KIND_OTHER } from '@/search'

import { buildLabel, connLabel, countLabel, fileSizeLabel, humaniseSegment, kindLabel, sizeLabel } from './format'

const foot = (value: unknown): Footprint => Footprint.parse(value)

describe('sizeLabel', () => {
  it('renders a rectangle as width × depth', () => {
    expect(sizeLabel(foot({ shape: 'rect', w: 2, d: 2 }))).toBe('2×2')
    expect(sizeLabel(foot({ shape: 'rect', w: 1, d: 3 }))).toBe('1×3')
  })

  it('renders a wall as its length only, because its depth is not data', () => {
    // 3,079 tiles carry a numeric `size|width` and no `size|depth` at all; the
    // depth is the measured 12.7 mm constant, so a chip that showed one would be
    // inventing it.
    expect(sizeLabel(foot({ shape: 'wall', length: 4 }))).toBe('4×')
    expect(sizeLabel(foot({ shape: 'wall', length: 1.5 }))).toBe('1.5×')
  })

  it('renders an arc as its tagged interface radius and sweep, not its band pair', () => {
    // Deliberately the tagged radius even after row W5 turned the footprint into
    // a band: `4r22.5` is the token the filenames use, so it is the one a user
    // types, and §6 is explicit that matching what a user types is why the
    // synthesised token exists at all. A `concave` band recovers its 4 from `rIn`
    // and a `convex` one from `rOut`, so both chips read `4r22.5` — which is
    // correct, because the corpus gives both tiles the same radius tag.
    const concave = { shape: 'arc', rIn: 4, rOut: 4.5, sweep: 22.5, band: 'concave', bandBasis: 'measured' }
    const convex = { shape: 'arc', rIn: 3.5, rOut: 4, sweep: 22.5, band: 'convex', bandBasis: 'fallback' }
    expect(sizeLabel(foot(concave))).toBe('4r22.5')
    expect(sizeLabel(foot(convex))).toBe('4r22.5')
  })

  it('marks the two 45-degree cases so neither reads as an axis-aligned one', () => {
    // A `diag` is a wall run, and a chip of `2.83×` alone would say it is a
    // straight 2.83-unit wall. A `tri` fills half the cell its legs name, and a
    // chip of `2×2` alone would say it fills all of it. Both carry a mark.
    expect(sizeLabel(foot({ shape: 'diag', run: 2.828 }))).toBe('2.828×∡')
    expect(sizeLabel(foot({ shape: 'tri', leg: 2 }))).toBe('2×2◺')
  })

  it('renders a column as the measured pillar, the same for all 119', () => {
    // A column carries no dimension of its own — the footprint case has no
    // fields — so the chip states the constant rather than reading a field.
    expect(sizeLabel(foot({ shape: 'column' }))).toBe('0.5×0.5')
  })

  it('falls back to the openlock size code when no footprint is derivable', () => {
    expect(sizeLabel(foot({ shape: 'none' }), 'IL')).toBe('IL')
  })

  it('renders an em dash rather than nothing, so the card keeps its height', () => {
    // The chip is never absent: `VirtuosoGrid` extrapolates from one item, so a
    // card that dropped a row would drift the scroll position.
    expect(sizeLabel(foot({ shape: 'none' }))).toBe('—')
  })

  it('drops trailing zeros the way the filenames do', () => {
    expect(sizeLabel(foot({ shape: 'rect', w: 1, d: 1 }))).toBe('1×1')
    expect(
      sizeLabel(foot({ shape: 'arc', rIn: 0, rOut: 2, sweep: 90, band: 'radial', bandBasis: 'measured' })),
    ).toBe('2r90')
  })
})

describe('fileSizeLabel', () => {
  it('is decimal, to agree with the archive and the OS', () => {
    expect(fileSizeLabel(10_360_000)).toBe('10.4 MB')
    expect(fileSizeLabel(1_000_000)).toBe('1.0 MB')
  })

  it('uses kilobytes below a megabyte', () => {
    expect(fileSizeLabel(838_214)).toBe('838 KB')
    expect(fileSizeLabel(45_284)).toBe('45 KB')
  })

  it('handles the extremes of the corpus', () => {
    expect(fileSizeLabel(0)).toBe('0 B')
    // The largest live file.
    expect(fileSizeLabel(108_900_000)).toBe('108.9 MB')
  })
})

describe('countLabel', () => {
  it('separates thousands', () => {
    expect(countLabel(8702)).toBe('8,702')
    expect(countLabel(0)).toBe('0')
  })
})

describe('labels', () => {
  it('humanises both tag separators', () => {
    expect(humaniseSegment('dungeon_stone')).toBe('Dungeon stone')
    expect(humaniseSegment('cut-stone')).toBe('Cut stone')
    expect(humaniseSegment('mortar_and_stone')).toBe('Mortar and stone')
  })

  it('never leaks a sentinel into the sidebar', () => {
    expect(kindLabel(KIND_OTHER)).toBe('Other')
    expect(buildLabel(BUILD_UNSPECIFIED)).toBe('Unspecified')
  })

  it('spells the connection systems the way their makers do', () => {
    expect(connLabel('openforge')).toBe('OpenForge')
    expect(connLabel('openlock')).toBe('OpenLOCK')
    expect(connLabel('dragonlock')).toBe('DragonLock')
  })

  it('falls back to humanised prose for a value it has never seen', () => {
    expect(kindLabel('trapdoor')).toBe('Trapdoor')
    expect(connLabel('new_system')).toBe('New system')
    expect(buildLabel('half wall')).toBe('Half wall')
  })
})
