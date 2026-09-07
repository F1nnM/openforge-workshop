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
import {
  CURVED_INTERFACE_TAG,
  DEFAULT_ARC_BAND,
  arcBandOf,
  formatUnit,
  footprintKind,
  hasCurveMarker,
  isDesignFragment,
  isLetteredCurvePart,
  radiusIsFeature,
  resolveFootprint,
  sizeToken,
} from './footprint'
import { displayName, fallbackName } from './naming'
import { fileTokens, inferForm, inferRole, roleTags } from './role'
import { buildTagTable, hasTagPrefix, hasTagSegment, namespaceRoots, numericTagValue, tagValue } from './tags'
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

  it('matches a tag path on segment boundaries, which a prefix match does not', () => {
    // The two agree on every prefix the corpus is actually queried with — which
    // `catalog.test.ts` asserts over all 8,702 records — and disagree only where
    // a longer word starts with a shorter one. `role.ts` reads the tag tree at
    // eleven prefixes, and a rule that is right by luck at eleven places is a
    // rule waiting for a twelfth.
    expect(hasTagSegment(['shape|wall'], 'shape|wall')).toBe(true)
    expect(hasTagSegment(['shape|wall|low'], 'shape|wall')).toBe(true)
    expect(hasTagSegment(['part|door'], 'part')).toBe(true)
    expect(hasTagSegment(['shape|wallpaper'], 'shape|wall')).toBe(false)
    expect(hasTagPrefix(['shape|wallpaper'], 'shape|wall')).toBe(true)
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
    const tags = [
      'shape|base',
      'shape|curved',
      'size|width|5',
      'size|depth|5',
      'size|radius|4',
      'size|angle|90',
    ]
    // Row W5: the footprint is the band, not the radius. This tile names no
    // band, so it takes the written default — `radial`, `[R-2, R]` — and is
    // stamped `fallback` because the *assignment* is a default even though the
    // rule itself is one W1 confirmed 17 times.
    expect(resolveFootprint(tags)).toEqual({
      shape: 'arc',
      rIn: 2,
      rOut: 4,
      sweep: 90,
      band: 'radial',
      bandBasis: 'fallback',
    })
    // The token still says `4r90`: 4 is the tagged interface radius, recovered
    // from `rOut` because `radial` lies inside it.
    expect(sizeToken(resolveFootprint(tags))).toBe('4r90')
  })

  it('refuses a sector with no sweep rather than inventing one', () => {
    // W4 deleted `DEFAULT_ARC_SWEEP_DEG`. It fabricated 90 degrees for 165 arc
    // tiles, and W1 fitted an annular sector to every one of those 165 and
    // refused all 165 — so the sweep was not the only thing wrong with them.
    // `radiusIsFeature` takes all 165 out of ARC, which leaves this branch
    // unreachable on the live corpus (`ARC with no size|angle` is 0), and the
    // rule is written down anyway so nothing re-invents a sweep later.
    const noSweep = ['shape|base', 'shape|curved', 'size|width|5', 'size|depth|5', 'size|radius|4']
    expect(footprintKind(noSweep)).toBe('none')
    expect(resolveFootprint(noSweep)).toEqual({ shape: 'none' })
  })

  it('reads a column as one wall-thickness square, with no dimension of its own', () => {
    // 119 tiles. `size|column_shape` is the gate, not `shape|column`: that tag
    // sits on 135 tiles and the two extra are a 1 x 1 cell and a 2 x 2 right
    // triangle, which a 0.5 x 0.5 pillar would shrink fourfold.
    const tags = ['shape|column', 'size|column_shape|L', 'size|openlock|L']
    expect(footprintKind(tags)).toBe('column')
    const foot = resolveFootprint(tags)
    expect(foot).toEqual({ shape: 'column' })
    expect(foot).not.toHaveProperty('w')
    expect(sizeToken(foot)).toBe('0.5x0.5')
  })

  it('refuses the one column letter nobody measured', () => {
    // `col+T`, 14 tiles. W2 marks the row `unmeasured` because the only col+T
    // STL in the bucket is an 84-byte binary header declaring zero triangles.
    // The other 13 are real meshes that were never in a work list, so this is a
    // refusal to place an unmeasured row and not a claim about the files.
    expect(footprintKind(['shape|column', 'size|column_shape|T', 'size|openlock|T'])).toBe('none')
    // And an invented letter is not a column at all.
    expect(footprintKind(['shape|column', 'size|column_shape|Q'])).toBe('none')
  })

  it('reads the O pair as a right triangle, sized from the tags and not the code', () => {
    // 9 tiles, 5 of them 2 x 2 and 4 of them 4 x 4, all carrying the same
    // `size|openlock|O`. W2's row for O can hold only one size and holds 4 x 4,
    // so the leg comes from the tags — which is also why `O` is one of the four
    // codes W2 flags `ambiguous` and why row D4 must not key a join on it.
    const small = ['shape|angled', 'shape|angled|right', 'size|angle|45', 'size|width|2', 'size|depth|2', 'size|openlock|O']
    expect(footprintKind(small)).toBe('tri')
    expect(resolveFootprint(small)).toEqual({ shape: 'tri', leg: 2 })
    expect(sizeToken(resolveFootprint(small))).toBe('2x2')
    const large = small.map((tag) => tag.replace('|2', '|4'))
    expect(resolveFootprint(large)).toEqual({ shape: 'tri', leg: 4 })
  })

  it('reads the P family as a 45-degree run measured from W2 table, not from the tag', () => {
    // 121 tiles, every one tagged `size|width|2`, and not one of them 2 units
    // long: the tag names the cell the piece cuts across. `PA` is 2 sqrt 2.
    const tags = ['shape|angled', 'shape|angled|right', 'shape|wall', 'size|angle|45', 'size|width|2', 'size|openlock|PA']
    expect(footprintKind(tags)).toBe('diag')
    expect(resolveFootprint(tags)).toEqual({ shape: 'diag', run: 2.828 })
    // No token of its own: `naming.ts` falls back to the tagged `2x`, because
    // the corpus never writes 2.828 and the code letter is what tells P from PC.
    expect(sizeToken(resolveFootprint(tags))).toBeUndefined()
    // An angled-right tile whose code has no measured run is not a diagonal.
    expect(footprintKind(['shape|angled|right', 'size|angle|45', 'size|width|2'])).toBe('wall')
  })

  it('de-arcs an xG interface wall and takes its length from the measurement', () => {
    // The radius is the curved *interface* where a straight run meets a curve,
    // not the outline. `QxG` is tagged `size|width|4` and measures 3.000 —
    // wrong by a full unit, and an exact 76.20 mm multiple.
    const tags = [
      'shape|base',
      'shape|base|curved',
      'shape|curved',
      'shape|option|curved_interface',
      'shape|wall',
      'size|openlock|QxG',
      'size|radius|2.5',
      'size|width|4',
    ]
    expect(radiusIsFeature(tags)).toBe(true)
    expect(footprintKind(tags)).toBe('wall')
    expect(resolveFootprint(tags)).toEqual({ shape: 'wall', length: 3 })
    expect(resolveFootprint([...tags.slice(0, 5), 'size|openlock|AxG', 'size|radius|2.5', 'size|width|2'])).toEqual({
      shape: 'wall',
      length: 1.991,
    })
  })

  it('leaves the measured wall ladder alone, which is what makes that rule safe', () => {
    // The table's length wins for every measured `wall_run` row, not for the
    // three xG codes alone. On the other six the table and the tag are two
    // independent statements of the same dimension and they agree exactly, so
    // the rule is a no-op on 2,822 tiles and a correction on 84.
    for (const [code, length] of [
      ['A', 2],
      ['AS', 2],
      ['BA', 1.5],
      ['D', 3],
      ['IA', 1],
      ['Q', 4],
    ] as const) {
      expect(resolveFootprint(['shape|wall', `size|openlock|${code}`, `size|width|${String(length)}`])).toEqual({
        shape: 'wall',
        length,
      })
    }
    // A code with no `wall_run` row leaves the tagged width in place: 6 of the
    // 182 `S` tiles carry a width and no depth, and `S` is a rect code.
    expect(resolveFootprint(['shape|wall', 'size|openlock|S', 'size|width|2'])).toEqual({
      shape: 'wall',
      length: 2,
    })
  })

  it('reads an inverted plate as the square it is, and its lettered parts as nothing', () => {
    // An `inverted` tile is a square plate with a curved *cut* — the complement
    // of a sector — so the radius parameterises the cut and the outline is the
    // box. Measured: `plain#base+curved+inverted.3x3+2r` is 3.000 x 3.000 exactly.
    const plate = ['shape|base', 'shape|base|curved', 'shape|base|inverted', 'shape|curved', 'size|depth|3', 'size|radius|2', 'size|width|3']
    expect(radiusIsFeature(plate)).toBe(true)
    expect(footprintKind(plate)).toBe('rect')
    expect(resolveFootprint(plate)).toEqual({ shape: 'rect', w: 3, d: 3 })
    // The 36 lettered ones are a different matter: tagged 7 x 7, measured
    // 5.000 x 2.000. The fragment veto now reaches them, because the radius no
    // longer outranks it.
    const part = [...plate, 'size|segment|a']
    expect(footprintKind(part)).toBe('none')
  })

  it('reads a lintel as an arch it fits, and so as nothing to place', () => {
    // 21 inserts. The radius is the arch's, measured 1.31 x 0.48-0.63 against a
    // tagged 2r whose sector box would be 2 units. Their only `size|width` is
    // the non-numeric build marker, so de-arcing lands them in NONE unaided.
    const tags = ['part|lintel', 'shape|curved', 'shape|curved|concave', 'size|radius|2', 'size|width|sw']
    expect(radiusIsFeature(tags)).toBe(true)
    expect(footprintKind(tags)).toBe('none')
  })

  it('vetoes a lettered component part of a curve, and only where it is measured', () => {
    // 20 tiles, all `shingles#roof,corner`, all measured and all wrong: tagged
    // 3.5 x 3.5, measured 0.596 x 4.980. `component|` is the corpus's *part*
    // namespace and its minimum error over the 402 curve-marked RECT md5 is
    // 0.904 u — twice the maximum of any other letter namespace.
    const board = ['component|a', 'shape|curved', 'shape|curved|convex', 'shape|roof', 'size|width|3.5', 'size|depth|3.5']
    expect(isLetteredCurvePart(board)).toBe(true)
    expect(footprintKind(board)).toBe('none')

    // Not the letter — the namespace. `shape|curved|<letter>` measures 0.436 u
    // off, identical to its *unlettered* siblings in the same family, so W3 was
    // right that a single-letter suffix is not a fragment signal.
    const sibling = ['shape|curved', 'shape|curved|a', 'size|width|2', 'size|depth|2']
    expect(isLetteredCurvePart(sibling)).toBe(false)
    expect(footprintKind(sibling)).toBe('rect')

    // And not without the curve: 160 tiles carry `component|<letter>` with no
    // curve marker and not one has been measured, so vetoing them would be the
    // unevidenced move W3 refused.
    const uncurved = ['component|b', 'shape|floor', 'size|width|2', 'size|depth|2']
    expect(isLetteredCurvePart(uncurved)).toBe(false)
    expect(footprintKind(uncurved)).toBe('rect')
  })

  it('takes the arc sweep from size|angle when there is one', () => {
    expect(resolveFootprint(['size|radius|2', 'size|angle|22.5'])).toEqual({
      shape: 'arc',
      rIn: 0,
      rOut: 2,
      sweep: 22.5,
      band: 'radial',
      bandBasis: 'fallback',
    })
  })

  it('refuses a sweep the sector box formula cannot describe', () => {
    // `arcSectorExtent` is `rOut - rIn*cos(theta)` by `rOut*sin(theta)`, correct
    // only while the extreme point sits on a bounding radius — theta <= 90. No
    // live tile is excluded: a `size|radius` co-occurs with 11.25, 22.5, 45 and
    // 90 and with nothing else. 270 is one of the two `IL` corner markers and
    // 60/120/240/300 are hex-corner angles, all on tiles with no radius at all.
    for (const sweep of [11.25, 22.5, 45, 90]) {
      expect(footprintKind(['shape|curved', 'size|radius|4', `size|angle|${String(sweep)}`])).toBe('arc')
    }
    for (const sweep of [120, 240, 270, 300]) {
      expect(footprintKind(['shape|curved', 'size|radius|4', `size|angle|${String(sweep)}`])).toBe('none')
    }
  })

  it('resolves the band from a modifier, then a code, then the default', () => {
    const curve = (...extra: string[]) => resolveFootprint(['shape|curved', 'size|radius|4', 'size|angle|90', ...extra])

    // The modifier route, 1,090 of the 1,199 arc tiles. `concave` is the only
    // band whose material lies outside the tagged radius, so its pair straddles
    // 4 upwards where every other band's ends there.
    expect(curve('shape|wall|concave')).toMatchObject({ rIn: 4, rOut: 4.5, band: 'concave', bandBasis: 'measured' })
    expect(curve('shape|wall|convex')).toMatchObject({ rIn: 3.5, rOut: 4, band: 'convex', bandBasis: 'fallback' })
    expect(curve('shape|floor|radial')).toMatchObject({ rIn: 2, rOut: 4, band: 'radial', bandBasis: 'measured' })

    // `s2w` plus `radial` outranks `concave`, and 6 of the 10 s2w tiles carry
    // both. W2's research measured `[R-1.5, R]` on exactly those rows; reading
    // them as `concave` would put the material on the wrong side of the radius
    // and 1.5 units out.
    expect(curve('shape|floor|radial', 'shape|floor|s2w', 'shape|floor|concave')).toMatchObject({
      rIn: 2.5,
      rOut: 4,
      band: 's2w_radial',
      bandBasis: 'fallback',
    })

    // The code route, 54 tiles, and the only route that can name a `disc`: `V`
    // and `VxE` carry identical tags and are a quarter disc and an annular band.
    expect(curve('size|openlock|V')).toMatchObject({ rIn: 0, rOut: 4, band: 'disc', bandBasis: 'measured' })
    expect(curve('size|openlock|VxE')).toMatchObject({ rIn: 2, rOut: 4, band: 'radial', bandBasis: 'measured' })
    expect(curve('size|openlock|X')).toMatchObject({ rIn: 4, rOut: 4.5, band: 'concave', bandBasis: 'measured' })

    // A modifier outranks a code, because the modifier is on the tile and the
    // code is on the family.
    expect(curve('size|openlock|V', 'shape|wall|concave')).toMatchObject({ band: 'concave' })

    // W2 marks `G` unmeasured and `GA` inferred. Both hold a `concave` band no
    // mesh has confirmed, so the band survives and the stamp does not.
    expect(curve('size|openlock|G')).toMatchObject({ band: 'concave', bandBasis: 'fallback' })
    expect(curve('size|openlock|GA')).toMatchObject({ band: 'concave', bandBasis: 'fallback' })

    // `U` is ambiguous and its table row is a 4 x 4 rect, so it names no band
    // and the default applies. `arcBandOf` gates on `size.kind === 'arc'` rather
    // than on `ambiguous`, because `X`'s ambiguity is column-versus-curve and a
    // column cannot reach this case at all.
    expect(curve('size|openlock|U')).toMatchObject({ band: 'radial', bandBasis: 'fallback' })
    expect(arcBandOf(['size|openlock|U'])).toEqual({ band: DEFAULT_ARC_BAND, basis: 'fallback' })
  })

  it('de-arcs a curved interface, and only gives it a wall where the run is measured', () => {
    // Row W5's 27 tiles. `shape|option|curved_interface` sits on 111 tiles and
    // W1 refused a sector fit on every one: the radius is the curve the piece
    // *mates with*, cut into one face, so the tagged pair over-states the
    // outline. The 84 walls have a measured run in W2's table; the 27 floors have
    // nothing, and their code is not in `size|openlock` at all.
    const floor = [
      'shape|curved',
      'shape|curved|interface',
      'shape|floor',
      CURVED_INTERFACE_TAG,
      'size|angle|90',
      'size|depth|2',
      'size|radius|2.5',
      'size|width|2',
    ]
    expect(radiusIsFeature(floor)).toBe(true)
    // Measured 1.700 x 2.000 against the tagged 2 x 2 — 0.300 units of overlap
    // with the neighbour, which is why `rect` is not the answer either.
    expect(footprintKind(floor)).toBe('none')
    expect(resolveFootprint(floor)).toEqual({ shape: 'none' })

    // The 84 walls keep their footprint, from the table rather than the tag:
    // `QxG` is tagged `size|width|4` and measures 3.000.
    const wall = ['shape|wall', CURVED_INTERFACE_TAG, 'size|openlock|QxG', 'size|radius|2.5', 'size|width|4']
    expect(footprintKind(wall)).toBe('wall')
    expect(resolveFootprint(wall)).toEqual({ shape: 'wall', length: 3 })
  })

  it('gives a curved tile with a trusted pair the pair as its footprint', () => {
    // W3. A curve marker says the outline is a sector; it does not say the
    // width/depth pair is wrong. Where a curve carries no radius and no segment
    // letter the mesh measures the tagged pair exactly —
    // `cut-stone#floor+curved.4x4` is 4.000 × 4.000 units — so vetoing on the
    // marker stranded 403 placeable tiles in NONE. The box is an
    // over-approximation of the sector, which is W5's to refine, not a lie.
    expect(footprintKind(['shape|curved', 'size|width|6', 'size|depth|6'])).toBe('rect')
    expect(resolveFootprint(['shape|curved', 'size|width|6', 'size|depth|6'])).toEqual({
      shape: 'rect',
      w: 6,
      d: 6,
    })
    // The 62 `IL+corner` cells: `concave`/`convex` here is the *sense* of a right
    // angle, not curvature, and the cell measures 1.000 × 1.000.
    expect(footprintKind(['shape|corner|concave', 'size|openlock|IL', 'size|width|1', 'size|depth|1'])).toBe('rect')
  })

  it('refuses a design fragment, whose pair names the design and not the piece', () => {
    // 319 tiles. `dungeon_stone%block#floor+curved+concave.8x8+b` is tagged 8 × 8
    // and measures 4.000 × 4.000; the same `+b` on another design measures
    // 2.079 × 1.931, so there is no rule to derive and the pair must not be
    // believed. W1 measures them.
    const fragment = ['shape|curved', 'size|segment|b', 'size|width|8', 'size|depth|8']
    expect(isDesignFragment(fragment)).toBe(true)
    expect(footprintKind(fragment)).toBe('none')
    expect(resolveFootprint(fragment)).toEqual({ shape: 'none' })
    // A radius still wins where it is the piece's own parameter — which now
    // means a *sector* radius, with a sweep, and not one of the 165 W4 found
    // parameterising a feature. All 319 fragments that lacked one are NONE.
    expect(footprintKind([...fragment, 'size|radius|4', 'size|angle|45'])).toBe('arc')
  })

  it('matches curve markers on whole segments, and does not count hex as a curve', () => {
    expect(hasCurveMarker(['shape|curved|concave'])).toBe(true)
    expect(hasCurveMarker(['shape|base|radial'])).toBe(true)
    expect(hasCurveMarker(['shape|corner|convex'])).toBe(true)
    expect(hasCurveMarker(['shape|wall', 'size|width|2'])).toBe(false)

    // The false positive W2's NON_CURVE_TAG_SEGMENTS names: 56 live tiles. A hex
    // is a different geometry family, and calling it a curve places hex corners
    // as bogus arcs. They stay NONE, but because they carry no size tag at all —
    // their only tagged dimension is a 60/120/240/300 sweep that is not a sweep.
    expect(hasCurveMarker(['shape|base|hex', 'shape|hex'])).toBe(false)
    expect(footprintKind(['shape|base|hex', 'shape|corner', 'size|angle|120'])).toBe('none')

    // Segment-exact, so a segment that merely contains a marker does not hit.
    // The corpus's own near-miss is `shape|option|curved_interface`, harmless
    // only because those 111 tiles also carry a bare `shape|curved`.
    expect(hasCurveMarker(['texture|hexagonal'])).toBe(false)
    expect(hasCurveMarker(['shape|option|curved_interface'])).toBe(false)
    expect(hasCurveMarker(['shape|option|curved_interface', 'shape|curved'])).toBe(true)
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

/* ------------------------------------------------------------- role and form */

/** A classifier input, defaulted so a case names only what it is about. */
const input = (
  tags: readonly string[],
  over: Partial<Omit<Parameters<typeof inferRole>[0], 'tags'>> = {},
): Parameters<typeof inferRole>[0] => ({
  tags,
  foot: { shape: 'none' },
  family: 'tiles/plain',
  file: 'plain#thing.stl',
  ...over,
})

const role = (tags: readonly string[], over?: Parameters<typeof input>[1]): string =>
  inferRole(input(tags, over)).role

describe('role', () => {
  it('reads the shape roots that name a role outright', () => {
    expect(role(['shape|floor', 'shape|square'])).toBe('floor')
    expect(role(['shape|wall', 'shape|square'])).toBe('wall')
    expect(role(['shape|stairs', 'shape|stairs|high'])).toBe('stair')
    expect(role(['shape|column', 'shape|column|low'])).toBe('column')
    expect(role(['shape|riser', 'shape|base'])).toBe('riser')
  })

  it('reads shape|wall|low as a wall even though all 527 omit the parent', () => {
    // The single clearest case for a derived role: the child *is* the role tag,
    // and no record in the corpus spells it with the parent beside it.
    expect(role(['shape|wall|low', 'shape|square', 'size|width|2'])).toBe('wall')
  })

  it('resolves every one of the six real overlaps in the forced order', () => {
    // `stair > column > riser > floor > wall`. Every row is a live tag set, and
    // the order is the only one that survives all six.
    expect(role(['shape|floor', 'shape|wall', 'shape|square'])).toBe('floor')
    expect(role(['shape|base', 'shape|wall'])).toBe('wall')
    expect(role(['shape|column', 'shape|wall'])).toBe('column')
    expect(role(['shape|stairs', 'shape|wall'])).toBe('stair')
    expect(role(['shape|base', 'shape|riser'])).toBe('riser')
    expect(role(['shape|column', 'shape|floor', 'shape|wall'])).toBe('column')
  })

  it('gives a base the role of what it carries, not the role "base"', () => {
    // `role` is orthogonal to `layer`: a base *for* a wall is role wall, layer
    // base, which is what makes the fixtures' `shape|base|wall` slot expressible
    // as `layer === 'base' && role === <the topper's role>`.
    expect(role(['shape|base', 'shape|base|wall'])).toBe('wall')
    expect(role(['shape|base', 'shape|base|square'])).toBe('floor')
    expect(role(['shape|base', 'shape|base|stairs'])).toBe('stair')
    expect(role(['shape|base', 'shape|base|s2w'])).toBe('wall')
    expect(role(['shape|base', 'shape|base|hex'])).toBe('wall')
  })

  it('falls to the build system for the 40 bases that name no support, and says it is low', () => {
    const inferred = inferRole(
      input(['shape|base', 'size|width|1', 'size|depth|1'], { build: 'thick wall' }),
    )
    expect(inferred).toMatchObject({ role: 'wall', signal: 'build-tag', confidence: 'low' })
  })

  it('finds the 100 roof records, which no shape tag names at all', () => {
    // `shape|roof` has zero occurrences corpus-wide, so a learner trained on the
    // tag label cannot reach these — it predicts `insert` for 64 of them.
    expect(role(['component|roof', 'set|roofs'])).toBe('roof')
    expect(role(['component|gable'])).toBe('roof')
    expect(role(['component|eaves'])).toBe('roof')
    expect(role(['component|dormer'])).toBe('roof')
  })

  it('reads component| as a feature and never over a shape tag', () => {
    // 357 of 3,833 records disagree between the two, and every disagreement is
    // of this shape: a wall *with* a drain, a grate or a slope cut into it.
    expect(role(['shape|wall', 'component|drain'])).toBe('wall')
    expect(role(['shape|wall', 'component|slope'])).toBe('wall')
    expect(role(['shape|floor', 'component|wall'])).toBe('floor')
    // With no shape tag the same channel is all there is, and then it speaks.
    expect(role(['component|drain'], { build: 'separate wall' })).toBe('wall')
    expect(role(['component|manhole'])).toBe('floor')
    expect(role(['component|full_pillar'])).toBe('column')
  })

  it('calls a structural wall carrying a statue a wall, not scatter', () => {
    // One record — `dungeon_stone#wall,secret_door+tamoachan_statue.2x` — carries
    // `component|wall` and `scatter|statue` and no shape tag, so the order of
    // these two rungs is decided by exactly one file.
    expect(role(['component|wall', 'scatter|statue'])).toBe('wall')
    expect(role(['scatter|statue'])).toBe('decor')
  })

  it('does not read decoration| as decor while anything else speaks', () => {
    // 164 records carry a `decoration|`; 152 of them are reliefs carved into a
    // floor, a wall or an insert, and only 12 are decor.
    expect(role(['shape|floor', 'decoration|celtic'])).toBe('floor')
    expect(role(['decoration|celtic'])).toBe('decor')
  })

  it('calls a part| piece an insert, on the same signal as layer', () => {
    // A perfect bijection with `layer === 'insert'` and therefore no information
    // at all — emitted for totality, and no slot may predicate on it.
    expect(role(['part|door', 'interface|door|arched', 'size|width|sw'])).toBe('insert')
    expect(classifyLayer(['part|door', 'interface|door|arched'])).toBe('insert')
  })

  it('reads the path deepest-first, and steps over the joinery that sits below', () => {
    // `openlock`, `openforge` and their siblings live at depths 4-7, so a
    // deepest-wins rule reads them before it reads anything about the role.
    expect(role([], { family: 'tiles/cut-stone/separate_wall/stairs/openlock' })).toBe('stair')
    expect(role([], { family: 'tiles/cut-stone/separate_wall/primary_floors/openforge,side' })).toBe(
      'floor',
    )
    // And the build system at depth 2 is not a role: `separate_wall` sits on
    // 3,466 records of every role, so the path vocabulary names no build system.
    expect(role([], { family: 'tiles/cut-stone/separate_wall' })).toBe('unknown')
    expect(role([], { family: 'tiles/cut-stone/thick_wall' })).toBe('unknown')
  })

  it('falls to the filename last, and only then', () => {
    expect(
      inferRole(input([], { family: 'tiles/plain/misc', file: 'plain#riser+high.2x1.stl' })),
    ).toMatchObject({ role: 'riser', signal: 'filename', confidence: 'low' })
  })

  it('reads the filename shape section, not the joinery suffix', () => {
    expect(fileTokens('cut-stone#column+low.col+L.side.stl')).toEqual(['column', 'low'])
    expect(fileTokens('aztlan%bamboo#floor+s2w+wall.2x2.openlock.stl')).toEqual([
      'floor',
      's2w',
      'wall',
    ])
    expect(fileTokens('torch.stl')).toEqual(['torch'])
  })
})

describe('form', () => {
  const form = (tags: readonly string[], over?: Parameters<typeof input>[1]): string =>
    inferForm(input(tags, over))

  it('is straight by default, which is 5,707 of 8,702', () => {
    expect(form(['shape|wall', 'shape|square'])).toBe('straight')
  })

  it('puts internal_corner ahead of corner, including the two mis-tagged templates', () => {
    expect(form(['shape|internal_corner'])).toBe('internal_corner')
    expect(form(['shape|base|internal_corner'])).toBe('internal_corner')
    expect(form(['shape|corner|internal'])).toBe('internal_corner')
  })

  it('puts hex ahead of corner, because the 48 hex bases carry both', () => {
    expect(form(['shape|base', 'shape|base|hex', 'shape|corner', 'size|angle|120'])).toBe('hex')
  })

  it('takes diagonal and curve from the measured footprint', () => {
    // The only two cases where `foot` is independent evidence rather than a
    // restatement of the tags.
    expect(form(['shape|wall', 'size|width|2'], { foot: { shape: 'diag', run: 3.536 } })).toBe(
      'diagonal',
    )
    expect(form(['shape|floor'], { foot: { shape: 'arc', rIn: 2, rOut: 2.5, sweep: 90, band: 'radial', bandBasis: 'measured' } })).toBe('curve')
  })

  it('reads a trailing corner or curve segment, which is how 527 low walls spell it', () => {
    expect(form(['shape|wall|corner'])).toBe('corner')
    expect(form(['shape|wall|curved'])).toBe('curve')
    expect(form(['shape|angled|octagon'])).toBe('octagon')
  })
})

describe('the emitted axis tags', () => {
  it('is role then form, always two, so two runs cannot disagree', () => {
    expect(roleTags(inferRole(input(['shape|wall', 'shape|corner'])))).toEqual([
      'role|wall',
      'form|corner',
    ])
    expect(roleTags(inferRole(input(['part|door'])))).toEqual(['role|insert', 'form|straight'])
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
