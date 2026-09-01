/**
 * The target sets, as predicates rather than as remembered counts.
 *
 * The counts against the real index live in the CLI's plan output and in the
 * sidecar's `coverage`; what is asserted here is that each set means what
 * `pipeline/footprint.ts` and `openlock-tessellation.md` §4 say it means, and
 * that the work list is md5-deduped rather than path-keyed.
 */
import { describe, expect, it } from 'vitest'

import {
  BAND_MODIFIERS,
  CURVE_SEGMENTS,
  XG_CODES,
  hasAngleTag,
  hasBandModifier,
  hasCurveSegment,
  measureTargets,
  modelUrl,
  setsFor,
} from './catalog'
import { blobOf, testCatalog } from './fixtures/catalog'

describe('hasBandModifier', () => {
  it('is the three modifiers openlock-tessellation.md §4 gives a band for', () => {
    // `curved` and `hex` say a tile is not a rectangle without saying where its
    // material lies — which is exactly why the 292 are unresolved.
    expect([...BAND_MODIFIERS]).toEqual(['radial', 'concave', 'convex'])
    expect(hasBandModifier(['shape|base|radial'])).toBe(true)
    expect(hasBandModifier(['shape|curved|concave'])).toBe(true)
    expect(hasBandModifier(['shape|wall|convex'])).toBe(true)
    expect(hasBandModifier(['shape|curved'])).toBe(false)
    expect(hasBandModifier(['shape|hex'])).toBe(false)
    expect(hasBandModifier(['shape|option|curved_interface'])).toBe(false)
    expect(hasBandModifier(['shape|base|inverted'])).toBe(false)
  })

  it('is a substring scan over the joined tags, as hasCurveMarker is', () => {
    // Parity with the plan's 21.0% matters more than tidiness: it was computed
    // this way. On this corpus a segment-exact scan gives the same 292.
    expect(hasBandModifier(['whatever|radially-symmetric'])).toBe(true)
  })
})

describe('hasAngleTag', () => {
  it('is present only for a real size|angle segment', () => {
    expect(hasAngleTag(['size|angle|45'])).toBe(true)
    expect(hasAngleTag(['size|radius|2.5'])).toBe(false)
    expect(hasAngleTag(['size|angled|45'])).toBe(false)
  })
})

describe('setsFor', () => {
  const record = (foot: 'arc' | 'none' | 'rect', sizeCode?: string) =>
    ({
      foot: foot === 'arc' ? { shape: 'arc' as const, radius: 2, angle: 90 } : foot === 'rect' ? { shape: 'rect' as const, w: 1, d: 1 } : { shape: 'none' as const },
      ...(sizeCode === undefined ? {} : { sizeCode }),
    }) as Parameters<typeof setsFor>[0]

  it('puts an arc with no band modifier in arcNoBand', () => {
    expect(setsFor(record('arc'), ['shape|curved', 'size|radius|2', 'size|angle|90'])).toEqual([
      'arcNoBand',
    ])
  })

  it('puts an arc with no size|angle in arcNoAngle', () => {
    expect(setsFor(record('arc'), ['shape|base|radial', 'size|radius|6'])).toEqual(['arcNoAngle'])
  })

  it('puts a tile in both when it has neither', () => {
    expect(setsFor(record('arc'), ['shape|curved', 'size|radius|2.5'])).toEqual([
      'arcNoBand',
      'arcNoAngle',
    ])
  })

  it('puts each xG code in xg', () => {
    for (const code of XG_CODES) {
      expect(setsFor(record('arc', code), ['size|radius|2.5', `size|openlock|${code}`])).toContain('xg')
    }
  })

  it('puts a code-less none tile in noneNoCode, and a coded one in nothing', () => {
    expect(setsFor(record('none'), ['shape|hex'])).toEqual(['noneNoCode'])
    // A fifth of the NONE tiles carry a code; W4 resolves those from the code
    // rather than from a mesh, so they are not this row's work.
    expect(setsFor(record('none', 'O'), ['shape|hex'])).toEqual([])
  })

  it('leaves a plain rectangle out of every set', () => {
    expect(setsFor(record('rect'), ['size|width|2', 'size|depth|2'])).toEqual([])
  })

  it('puts a curve-marked rectangle in rectCurved', () => {
    // W3 moved 403 tiles from NONE to RECT and its own docblock calls the pair
    // it now trusts "an axis-aligned over-approximation of an annular sector",
    // with 26 of them measurably wrong. That is what this set exists to settle.
    expect(setsFor(record('rect'), ['shape|floor|curved', 'size|width|4', 'size|depth|4'])).toEqual([
      'rectCurved',
    ])
    expect(setsFor(record('rect'), ['shape|base|radial', 'size|width|4', 'size|depth|4'])).toEqual([
      'rectCurved',
    ])
    // Segment-exact, so a hex is not a curve — calling it one places hex corners
    // as bogus arcs.
    expect(setsFor(record('rect'), ['shape|hex', 'size|width|1', 'size|depth|1'])).toEqual([])
    expect(setsFor(record('rect'), ['shape|option|curved_interface', 'size|width|1', 'size|depth|1'])).toEqual(
      [],
    )
  })
})

describe('hasCurveSegment', () => {
  it('is segment-exact and excludes hex, matching W3', () => {
    expect(hasCurveSegment(['shape|curved'])).toBe(true)
    expect(hasCurveSegment(['shape|curved|concave'])).toBe(true)
    expect(hasCurveSegment(['shape|base|radial'])).toBe(true)
    expect(hasCurveSegment(['shape|hex'])).toBe(false)
    expect(hasCurveSegment(['shape|option|curved_interface'])).toBe(false)
    expect([...CURVE_SEGMENTS]).toEqual(['curved', 'radial', 'concave', 'convex'])
  })
})

describe('measureTargets', () => {
  it('dedupes by md5, keeps every id, and unions the sets', () => {
    // 171 md5 values are shared by 520 catalog rows. Keying the work list on
    // `id` would read those objects twice for no new geometry.
    const shared = blobOf('aaaa')
    const file = testCatalog([
      {
        id: 'tiles/a/one.stl',
        ord: 0,
        blob: shared,
        bytes: 100,
        foot: { shape: 'arc', radius: 2, angle: 90 },
        tags: ['shape|curved', 'size|radius|2', 'size|angle|90'],
      },
      {
        id: 'tiles/b/two.stl',
        ord: 1,
        blob: shared,
        bytes: 100,
        foot: { shape: 'arc', radius: 2, angle: 90 },
        tags: ['shape|base|radial', 'size|radius|2'],
      },
      {
        id: 'tiles/c/three.stl',
        ord: 2,
        blob: blobOf('bbbb'),
        bytes: 200,
        foot: { shape: 'none' },
        tags: ['shape|hex'],
      },
    ])

    const list = measureTargets(file)
    expect(list.records).toBe(3)
    expect(list.targets).toHaveLength(2)
    expect(list.deduped).toBe(1)
    expect(list.bytes).toBe(300)

    const first = list.targets[0]
    expect(first?.blob).toBe(shared)
    expect(first?.ids).toEqual(['tiles/a/one.stl', 'tiles/b/two.stl'])
    expect(first?.sets).toEqual(['arcNoBand', 'arcNoAngle'])

    // Per-set counts are stated both ways, because 1,284 rows are 1,163 md5.
    expect(list.counts.arcNoBand).toEqual({ records: 1, blobs: 1 })
    expect(list.counts.arcNoAngle).toEqual({ records: 1, blobs: 1 })
    expect(list.counts.noneNoCode).toEqual({ records: 1, blobs: 1 })
    expect(list.counts.xg).toEqual({ records: 0, blobs: 0 })
  })

  it('is sorted by manifest ordinal, which is display order', () => {
    const file = testCatalog([
      { id: 'tiles/z.stl', ord: 9, blob: blobOf('c'), foot: { shape: 'none' }, tags: ['shape|hex'] },
      { id: 'tiles/a.stl', ord: 1, blob: blobOf('d'), foot: { shape: 'none' }, tags: ['shape|hex'] },
    ])
    expect(measureTargets(file).targets.map((target) => target.ord)).toEqual([1, 9])
  })

  it('excludes rows in no set at all', () => {
    const file = testCatalog([
      {
        id: 'tiles/rect.stl',
        ord: 0,
        blob: blobOf('e'),
        foot: { shape: 'rect', w: 2, d: 2 },
        tags: ['size|width|2', 'size|depth|2'],
      },
    ])
    expect(measureTargets(file).targets).toHaveLength(0)
    expect(measureTargets(file).records).toBe(0)
  })
})

describe('modelUrl', () => {
  it('is {models}/{md5[0:6]}/{md5}.stl, the convention verified across all 8,702 rows', () => {
    const blob = blobOf('abcdef12')
    const file = testCatalog([
      { id: 'tiles/a.stl', ord: 0, blob, foot: { shape: 'none' }, tags: ['shape|hex'] },
    ])
    expect(modelUrl(file, blob as never)).toBe(
      `https://objects.example.test/models/${blob.slice(0, 6)}/${blob}.stl`,
    )
  })
})
