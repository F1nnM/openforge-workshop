/**
 * The derivation rules, unit by unit.
 *
 * Every case here is a tag set copied out of the live corpus, not invented, and
 * the ones that look strange are the ones that have already been got wrong:
 * `connection|side|openlock`, `size|width|wot`, a curved tile with a width and a
 * depth. Corpus-wide counts live in `catalog.test.ts`; this file pins the
 * behaviour that produces them.
 */
import { describe, expect, it } from 'vitest'

import { designId, designKey } from './design'
import {
  CONNECTION_POSITIONS,
  buildSystem,
  classifyLayer,
  connectionSystems,
  connectionsByPosition,
  isLockSystem,
  kindBuckets,
  openlockSizeCode,
  rotationStep,
  textureRoot,
} from './facets'
import { formatUnit, footprintKind, hasCurveMarker, resolveFootprint, sizeToken } from './footprint'
import { displayName, fallbackName } from './naming'
import { buildTagTable, namespaceRoots, numericTagValue, tagValue } from './tags'
import { buildTimestamp } from './version'

describe('tag accessors', () => {
  it('takes the segment after the prefix, from the first matching tag', () => {
    expect(tagValue(['texture|towne', 'texture|towne|stone'], 'texture')).toBe('towne')
    expect(tagValue(['shape|wall'], 'texture')).toBeUndefined()
  })

  it('refuses the width markers that are not widths', () => {
    // `size|width|sw` (33 tiles) and `size|width|wot` (50) are build markers
    // wearing a width tag. Read as widths they move 83 tiles into `wall`.
    expect(numericTagValue(['size|width|wot'], 'size|width')).toBeUndefined()
    expect(numericTagValue(['size|width|sw'], 'size|width')).toBeUndefined()
    expect(numericTagValue(['size|width|1.5'], 'size|width')).toBe(1.5)
  })

  it('lists namespace roots once each, in first-seen order', () => {
    expect(namespaceRoots(['shape|wall', 'shape|wall|low', 'shape|corner'], 'shape')).toEqual(['wall', 'corner'])
  })
})

describe('tag interning', () => {
  it('gives the most frequent tag the smallest id', () => {
    const { table, idOf } = buildTagTable([
      ['rare', 'common'],
      ['common'],
      ['common', 'middling'],
      ['middling'],
    ])
    expect(table[0]).toBe('common')
    expect(idOf.get('common')).toBe(0)
    expect(table).toHaveLength(3)
  })

  it('breaks frequency ties on the tag string, so the table is a pure function of the corpus', () => {
    const forwards = buildTagTable([['b'], ['a']])
    const backwards = buildTagTable([['a'], ['b']])
    expect(backwards.table).toEqual(forwards.table)
    expect(forwards.table).toEqual(['a', 'b'])
  })
})

describe('footprint', () => {
  it('reads a plain rectangle', () => {
    const tags = ['shape|floor', 'shape|square', 'size|width|4', 'size|depth|4']
    expect(resolveFootprint(tags)).toEqual({ shape: 'rect', w: 4, d: 4 })
    expect(sizeToken(resolveFootprint(tags))).toBe('4x4')
  })

  it('reads a wall from a width with no depth, and gives it no depth field', () => {
    const foot = resolveFootprint(['shape|wall', 'size|width|2', 'size|openlock|A'])
    expect(foot).toEqual({ shape: 'wall', length: 2 })
    expect(foot).not.toHaveProperty('d')
    expect(sizeToken(foot)).toBe('2x')
  })

  it('lets a radius win over a tagged width and depth', () => {
    // The size tags are design-family labels; on a curve they name the family
    // the fragment came from and diverge from the mesh by a median 96 mm.
    const tags = ['shape|base', 'shape|curved', 'size|width|5', 'size|depth|5', 'size|radius|4']
    expect(resolveFootprint(tags)).toEqual({ shape: 'arc', radius: 4, angle: 90 })
    expect(sizeToken(resolveFootprint(tags))).toBe('4r90')
  })

  it('takes the arc sweep from size|angle when there is one', () => {
    expect(resolveFootprint(['size|radius|2', 'size|angle|22.5'])).toEqual({
      shape: 'arc',
      radius: 2,
      angle: 22.5,
    })
  })

  it('refuses to call a curved tile a rectangle', () => {
    // 1,144 tiles are hex, concave or convex without a radius. Placing one as a
    // rectangle would be wrong rather than approximate.
    expect(footprintKind(['shape|curved', 'size|width|6', 'size|depth|6'])).toBe('none')
    expect(footprintKind(['shape|base|hex', 'size|width|2', 'size|depth|2'])).toBe('none')
    expect(resolveFootprint(['shape|curved', 'size|width|6', 'size|depth|6'])).toEqual({ shape: 'none' })
  })

  it('scans for curve markers as substrings, exactly as the verify script does', () => {
    expect(hasCurveMarker(['shape|curved|concave'])).toBe(true)
    expect(hasCurveMarker(['shape|base|radial'])).toBe(true)
    expect(hasCurveMarker(['shape|wall', 'size|width|2'])).toBe(false)
  })

  it('formats units the way the filenames do', () => {
    expect(formatUnit(1)).toBe('1')
    expect(formatUnit(1.5)).toBe('1.5')
    expect(formatUnit(22.5)).toBe('22.5')
  })
})

describe('connection systems', () => {
  it('reads a position segment as a position, not as a system', () => {
    // The bug this test exists for: `side` becoming a phantom system on 2,079
    // tiles while openlock goes missing from every one of them.
    expect(connectionSystems(['connection|side', 'connection|side|openlock'])).toEqual(['openlock'])
    expect(connectionSystems(['connection|side|dragonlock'])).toEqual(['dragonlock'])
  })

  it('folds variant segments into their parent system', () => {
    expect(connectionSystems(['connection|openlock', 'connection|openlock|topless'])).toEqual(['openlock'])
    expect(connectionSystems(['connection|openlock|unsupported'])).toEqual(['openlock'])
    expect(connectionSystems(['connection|magnetic', 'connection|magnetic|flex'])).toEqual(['magnetic'])
    expect(connectionSystems(['connection|openforge|split'])).toEqual(['openforge'])
  })

  it('keeps filament, which is the system when it side-mounts alone', () => {
    expect(connectionSystems(['connection|side', 'connection|side|filament'])).toEqual(['filament'])
  })

  it('reports every distinct system a tile offers', () => {
    expect(
      connectionSystems([
        'connection|magnetic',
        'connection|magnetic|flex',
        'connection|openlock',
        'connection|openlock|unsupported',
      ]),
    ).toEqual(['magnetic', 'openlock'])
  })

  it('returns nothing for the 349 tiles with no connection tag', () => {
    expect(connectionSystems(['shape|floor'])).toEqual([])
  })

  it('reads bottom, left and right as positions too', () => {
    // The eight records this row is about. Every one of them is a bare position
    // tag beside the tag that names the system, so the position contributes no
    // system of its own — it used to contribute one named after the face.
    expect(CONNECTION_POSITIONS).toEqual(['side', 'bottom', 'left', 'right'])
    expect(connectionSystems(['connection|bottom', 'connection|openforge'])).toEqual(['openforge'])
    expect(connectionSystems(['connection|left', 'connection|openforge'])).toEqual(['openforge'])
    expect(connectionSystems(['connection|right', 'connection|openforge'])).toEqual(['openforge'])
    expect(
      connectionSystems([
        'connection|bottom',
        'connection|openforge',
        'connection|side',
        'connection|side|dragonlock',
      ]),
    ).toEqual(['dragonlock', 'openforge'])
  })
})

describe('connections by position', () => {
  it('is total, so an unmounted face is an empty list rather than undefined', () => {
    expect(connectionsByPosition(['shape|floor'])).toEqual({ bottom: [], side: [], left: [], right: [] })
  })

  it('files an unpositioned tag on the tile own underside', () => {
    // `connection|openlock` is openlock underneath. This is the reading a base
    // matcher needs, and the one the flattened list cannot express.
    expect(connectionsByPosition(['connection|openlock', 'connection|openlock|topless'])).toEqual({
      bottom: ['openlock'],
      side: [],
      left: [],
      right: [],
    })
  })

  it('keeps a side lock off the underside', () => {
    // The topper shape: openforge underneath (so it needs a base) and dragonlock
    // to the neighbour. 1,283 corpus records look like this, and reading them off
    // `conn` alone says they offer dragonlock as table joinery. They do not.
    const topper = ['connection|openforge', 'connection|side', 'connection|side|dragonlock']
    expect(connectionsByPosition(topper)).toEqual({
      bottom: ['openforge'],
      side: ['dragonlock'],
      left: [],
      right: [],
    })
    expect(connectionsByPosition(topper).bottom.filter(isLockSystem)).toEqual([])
    expect(connectionsByPosition(topper).side.filter(isLockSystem)).toEqual(['dragonlock'])
    // …while the flattened projection still answers the question it is for.
    expect(connectionSystems(topper)).toEqual(['dragonlock', 'openforge'])
  })

  it('folds the explicit bottom spelling into the unstated one', () => {
    // `connection|bottom` names the same face an unpositioned tag names, so the
    // two land in one key rather than leaving every caller to union them. The
    // corpus never puts a system after it, which is why the fold is free.
    expect(connectionsByPosition(['connection|bottom', 'connection|openlock']).bottom).toEqual(['openlock'])
    expect(connectionsByPosition(['connection|bottom|openlock']).bottom).toEqual(['openlock'])
  })

  it('gives left and right their own faces even though the corpus never fills them', () => {
    expect(connectionsByPosition(['connection|left', 'connection|openforge'])).toEqual({
      bottom: ['openforge'],
      side: [],
      left: [],
      right: [],
    })
    expect(connectionsByPosition(['connection|right|magnetic']).right).toEqual(['magnetic'])
  })

  it('reads a trailing position segment as a variant, not as a face', () => {
    // `connection|openlock|side` (3 tags) spells "openlock on the side" the other
    // way round and is deliberately NOT folded: the verify script defines a side
    // lock as segment two of `connection|side|…` and the plan's 23.9% is measured
    // against that. All 3 tiles also carry a bare `connection|openlock`, so the
    // system survives; only its position is understated. Pinned so a future change
    // to that definition is a decision rather than an accident.
    expect(connectionsByPosition(['connection|openlock', 'connection|openlock|side'])).toEqual({
      bottom: ['openlock'],
      side: [],
      left: [],
      right: [],
    })
  })

  it('is the single source the flattened projection is derived from', () => {
    const tags = [
      'connection|bottom',
      'connection|magnetic',
      'connection|magnetic|flex',
      'connection|side',
      'connection|side|openlock',
    ]
    const byPosition = connectionsByPosition(tags)
    const union = [...new Set([...byPosition.bottom, ...byPosition.side, ...byPosition.left, ...byPosition.right])].sort()
    expect(connectionSystems(tags)).toEqual(union)
    expect(connectionSystems(tags)).toEqual(['magnetic', 'openlock'])
  })

  it('names the lock systems and nothing else', () => {
    expect(['openlock', 'dragonlock', 'magnetic'].every(isLockSystem)).toBe(true)
    expect(['openforge', 'dual', 'pegs', 'filament', 'side'].some(isLockSystem)).toBe(false)
  })
})

describe('kind buckets', () => {
  it('is multi-valued', () => {
    expect(kindBuckets(['shape|base', 'shape|riser', 'shape|riser|high'])).toEqual(['base', 'riser'])
  })

  it('is legitimately empty for 11.9% of the corpus', () => {
    expect(kindBuckets(['shape|curved', 'shape|curved|concave'])).toEqual([])
  })

  it('has no door bucket, because shape|door has zero occurrences', () => {
    expect(kindBuckets(['component|door', 'shape|wall'])).toEqual(['wall'])
  })
})

describe('layer', () => {
  it('calls a shape|base piece a base', () => {
    expect(classifyLayer(['shape|base', 'shape|base|square'])).toBe('base')
  })

  it('calls a connection|openforge piece a topper', () => {
    expect(classifyLayer(['shape|wall', 'connection|openforge'])).toBe('topper')
  })

  it('calls a part| piece an insert', () => {
    expect(classifyLayer(['part|door', 'interface|door|arched'])).toBe('insert')
  })

  it('calls a piece carrying its own lock integral', () => {
    expect(classifyLayer(['shape|wall', 'connection|openlock'])).toBe('integral')
    expect(classifyLayer(['shape|floor'])).toBe('integral')
  })
})

describe('other facets', () => {
  it('takes the texture root from the first texture tag', () => {
    expect(textureRoot(['texture|dungeon_stone', 'texture|dungeon_stone|eroded'])).toBe('dungeon_stone')
    expect(textureRoot(['texture|aztlan', 'texture|bamboo'])).toBe('aztlan')
    expect(textureRoot(['shape|wall'])).toBeUndefined()
  })

  it('leaves the build system undefined for the 34.2% that carry none', () => {
    expect(buildSystem(['build|wall on tile'])).toBe('wall on tile')
    expect(buildSystem(['shape|wall'])).toBeUndefined()
  })

  it('hoists the openlock size code', () => {
    expect(openlockSizeCode(['size|openlock|BAxG'])).toBe('BAxG')
    expect(openlockSizeCode(['size|width|2'])).toBeUndefined()
  })

  it('reports a rotation step only when one is tagged', () => {
    expect(rotationStep(['size|angle|22.5'])).toBe(22.5)
    expect(rotationStep(['size|angle|270'])).toBe(270)
    expect(rotationStep(['shape|wall'])).toBeUndefined()
  })
})

describe('design identity', () => {
  it('collapses connection variants and nothing else', () => {
    const openlock = ['shape|wall', 'size|width|2', 'connection|openlock']
    const dragonlock = ['shape|wall', 'size|width|2', 'connection|side|dragonlock']
    const wider = ['shape|wall', 'size|width|4', 'connection|openlock']

    expect(designKey(openlock)).toBe(designKey(dragonlock))
    expect(designId(openlock)).toBe(designId(dragonlock))
    expect(designId(openlock)).not.toBe(designId(wider))
  })

  it('does not depend on tag order', () => {
    expect(designId(['b|1', 'a|2'])).toBe(designId(['a|2', 'b|1']))
  })
})

describe('display name', () => {
  const name = (tags: string[], file = 'x.stl'): string =>
    displayName(tags, resolveFootprint(tags), file)

  it('reads as a title, not as a filename', () => {
    expect(
      name([
        'connection|openforge',
        'shape|floor',
        'shape|square',
        'size|depth|1',
        'size|width|1',
        'texture|aztlan',
      ]),
    ).toBe('Aztlan Floor 1x1')
  })

  it('carries the size token that appears in zero tags', () => {
    // §6: the literal string `4x4` is in no tag, so without this the most
    // obvious query a user types matches nothing.
    expect(name(['shape|floor', 'size|width|4', 'size|depth|4'])).toContain('4x4')
    expect(name(['shape|base', 'size|radius|2', 'size|angle|90'])).toContain('2r90')
    expect(name(['shape|wall', 'size|width|2'])).toContain('2x')
  })

  it('puts the component in front of the shape noun', () => {
    expect(
      name([
        'build|separate wall',
        'component|torch',
        'component|torch|low',
        'connection|openlock',
        'connection|side|openlock',
        'shape|square',
        'shape|wall',
        'size|openlock|A',
        'size|width|2',
        'texture|cut-stone',
      ]),
    ).toBe('Cut Stone Low Torch Wall 2x A')
  })

  it('keeps a component qualifier whose root the shape phrase already used', () => {
    // 33 ruined walls are otherwise identical; `component|wall|full-low` is the
    // only thing separating them, and its root duplicates `shape|wall`.
    expect(
      name([
        'component|wall|full-low',
        'connection|openforge',
        'shape|wall',
        'size|openlock|A',
        'size|width|2',
        'texture|rough_stone',
        'texture|rough_stone|ruined',
      ]),
    ).toBe('Rough Stone Ruined Full Low Wall 2x A')
  })

  it('labels a tile whose footprint is none with the size it is tagged with', () => {
    expect(
      name(['shape|base', 'shape|base|curved', 'shape|curved', 'size|width|6', 'size|depth|6', 'texture|plain']),
    ).toBe('Plain Curved Base 6x6')
  })

  it('separates the segments of one curve family', () => {
    const a = name(['shape|base', 'shape|curved', 'size|width|6', 'size|depth|6', 'size|segment|a'])
    const b = name(['shape|base', 'shape|curved', 'size|width|6', 'size|depth|6', 'size|segment|b'])
    expect(a).not.toBe(b)
    expect(a.endsWith(' A')).toBe(true)
  })

  it('never emits filename punctuation', () => {
    expect(name(['texture|cut-stone', 'shape|wall', 'size|width|2'])).not.toMatch(/[#%+,|]/)
  })

  it('falls back to a cleaned filename when a tile has nothing nameable', () => {
    expect(displayName([], { shape: 'none' }, 'torch_plate.stl')).toBe('Torch Plate')
    expect(fallbackName('cave%aggregate+2#corner.IL+corner,90.openlock.stl')).not.toMatch(/[#%+,]/)
  })
})

describe('buildTimestamp', () => {
  it('honours SOURCE_DATE_EPOCH, which is what makes a build reproducible', () => {
    const previous = process.env.SOURCE_DATE_EPOCH
    process.env.SOURCE_DATE_EPOCH = '1700000000'
    try {
      expect(buildTimestamp()).toBe('2023-11-14T22:13:20.000Z')
    } finally {
      if (previous === undefined) delete process.env.SOURCE_DATE_EPOCH
      else process.env.SOURCE_DATE_EPOCH = previous
    }
  })

  it('falls back to the clock', () => {
    const previous = process.env.SOURCE_DATE_EPOCH
    delete process.env.SOURCE_DATE_EPOCH
    try {
      expect(buildTimestamp(() => 0)).toBe('1970-01-01T00:00:00.000Z')
    } finally {
      if (previous !== undefined) process.env.SOURCE_DATE_EPOCH = previous
    }
  })
})
