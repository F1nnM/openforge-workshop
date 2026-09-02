/**
 * Formatter tests.
 *
 * Node environment — these are pure functions over the catalog contract. What is
 * worth asserting here is not that `toFixed` works but the six decisions the
 * formatters encode: the size chip mirrors the importer's own size token, the
 * `none` footprint has a visible fallback rather than an empty chip, file sizes
 * are decimal, the sentinel facet values (`!other`, `!none`) get prose labels
 * rather than leaking a `!` into the sidebar, an item's byte figure is a range
 * only where the data supports one, and the filename token skips the connection
 * segment so it names a design rather than one of its files.
 */
import { describe, expect, it } from 'vitest'

import { Footprint } from '@/catalog'
import { BUILD_UNSPECIFIED, KIND_OTHER } from '@/search'

import {
  buildLabel,
  bytesRangeLabel,
  connLabel,
  countLabel,
  fileSizeLabel,
  fileTokenLabel,
  humaniseSegment,
  kindLabel,
  sizeLabel,
  variantTokenLabel,
} from './format'

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

describe('bytesRangeLabel', () => {
  it('collapses to one figure when both ends round the same way', () => {
    // 2,193 of the 3,822 live items read this way — every singleton, plus the
    // multi-variant ones whose spread hides inside one decimal place.
    expect(bytesRangeLabel([10_360_000, 10_360_000])).toBe('10.4 MB')
    expect(bytesRangeLabel([10_360_000, 10_361_000])).toBe('10.4 MB')
  })

  it('states a range where there is one, with the unit once', () => {
    // A1 measured the max/min ratio at 1.13 median and 3.46 at p90, so one
    // number on an item holding a 4 MB topper and a 16 MB integrated print would
    // be an assertion the data does not support.
    expect(bytesRangeLabel([4_512_900, 15_853_634])).toBe('4.5–15.9 MB')
  })

  it('keeps both units when the range crosses a boundary', () => {
    // `838 KB–1.2 MB`, not `838–1.2 MB`, which would read as 838 megabytes.
    expect(bytesRangeLabel([838_214, 1_200_000])).toBe('838 KB–1.2 MB')
  })

  it('uses an en dash, so the figures do not read as arithmetic', () => {
    expect(bytesRangeLabel([4_512_900, 15_853_634])).toContain('\u2013')
    expect(bytesRangeLabel([4_512_900, 15_853_634])).not.toContain('-')
  })
})

describe('fileTokenLabel', () => {
  it('takes the variant token after the display-name half of the filename', () => {
    expect(fileTokenLabel('wood#dormer,window_insert.2x.stl')).toBe('2x')
    expect(fileTokenLabel('portcullis.very_narrow.stl')).toBe('very_narrow')
    expect(fileTokenLabel('dungeon_stone%base+square.1x3.openlock.stl')).toBe('1x3')
  })

  it('skips a segment that is nothing but connection vocabulary', () => {
    // The whole point: an aggregate collapses across the connection axis, so a
    // token containing it would be one variant's private string on an item's
    // card. Measured, taking the tail whole disagrees between the variants of
    // 1,210 of 3,822 items; skipping these takes it to 22.
    expect(fileTokenLabel('mine#wall+low.2x.openforge,side+dragonlock.stl')).toBe('2x')
    expect(fileTokenLabel('base+square.4x2.openlock+unsupported,magnetic+flex.stl')).toBe('4x2')
    expect(fileTokenLabel('corner+wall.2x.openforge.stl')).toBe('2x')
  })

  it('keeps a segment that merely contains a connection word', () => {
    // `every`, not `some`: `col+L` is a real variant token and `magnetic_post` is
    // not in the vocabulary at all, so neither segment is skipped.
    expect(fileTokenLabel('aztlan#col.col+L.openforge.stl')).toBe('col+L')
    expect(fileTokenLabel('mine#wall+b.1x1.openforge,magnetic_post.stl')).toBe('1x1')
  })

  it('is empty when the filename carries no variant to name', () => {
    // 40 live items. Rendered as nothing rather than as an em dash: the filename
    // simply has no variant, which is not a missing measurement.
    expect(fileTokenLabel('dungeon_stone%2x2#floor.openlock.stl')).toBe('')
    expect(fileTokenLabel('support_block.stl')).toBe('')
    expect(fileTokenLabel('tudor%rectangular#door.stl')).toBe('')
  })

  it('reads the basename, so a folder in the path never reaches the card', () => {
    expect(fileTokenLabel('tiles/dungeon_stone/floors/floor.2x2.openlock.stl')).toBe('2x2')
  })

  it('is case-insensitive about the extension', () => {
    expect(fileTokenLabel('support_block.1x.STL')).toBe('1x')
  })
})

describe('variantTokenLabel', () => {
  it('keeps the connection segments, which is what names a file', () => {
    // The complement of `fileTokenLabel`: two variants of one design differ in
    // exactly these segments, so stripping them would label both rows of a
    // library card `2x` and tell the user nothing about which is which.
    expect(variantTokenLabel('cave%arrow_slit.2x.openlock.stl')).toBe('2x.openlock')
    expect(variantTokenLabel('cave%arrow_slit.2x.openforge.stl')).toBe('2x.openforge')
    expect(fileTokenLabel('cave%arrow_slit.2x.openlock.stl')).toBe(
      fileTokenLabel('cave%arrow_slit.2x.openforge.stl'),
    )
  })

  it('drops the display-name half and the extension, like its sibling', () => {
    expect(variantTokenLabel('base+square.4x2.openlock+unsupported,magnetic+flex.stl')).toBe(
      '4x2.openlock+unsupported,magnetic+flex',
    )
    expect(variantTokenLabel('tiles/cave/fixture/cave%fixture-0.2x.STL')).toBe('2x')
  })

  it('is empty when there is no dot to split on', () => {
    expect(variantTokenLabel('support_block.stl')).toBe('')
  })
})
