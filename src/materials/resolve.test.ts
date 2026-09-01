/**
 * The resolution rules, one at a time.
 *
 * `corpus.test.ts` proves the resolver covers the real catalog; this file
 * proves each *rule* in isolation, including the ones the corpus happens not to
 * exercise today — an unmapped root, a tag with no root at all, an empty tag
 * list. Those are the cases a retag upstream will produce first.
 */
import { describe, expect, it } from 'vitest'

import {
  MATERIALS,
  TEXTURE_ROOT_MATERIAL,
  applyWear,
  contourFor,
  isWearTag,
  materialFor,
  resolveMaterial,
  spriteArgsFor,
  tintFor,
} from './index'

describe('the ordered fallback', () => {
  it('1. takes an exact tag match first', () => {
    const resolved = resolveMaterial(['texture|cave', 'texture|cave|sandstone'])
    expect(resolved.material).toBe('sandstone')
    expect(resolved.via).toBe('exact-tag')
    expect(resolved.matchedTag).toBe('texture|cave|sandstone')
  })

  it('2. walks up to a mapped parent when the leaf is a cosmetic variant', () => {
    // `|2`, `|3`, `|fracture`, `|xenolith`, `|3-2_joint` are sculpt variants and
    // carry no colour implication, so they deliberately have no entries.
    for (const leaf of ['2', '3', 'fracture', 'xenolith', '3-2_joint']) {
      const resolved = resolveMaterial([
        'texture|cave',
        'texture|cave|sandstone',
        `texture|cave|sandstone|${leaf}`,
      ])
      expect(resolved.material).toBe('sandstone')
      expect(resolved.matchedTag).toBe('texture|cave|sandstone')
    }
  })

  it('2. reports parent-tag when the walk started deeper than the match', () => {
    const resolved = resolveMaterial(['texture|cave|sandstone|2'])
    expect(resolved.via).toBe('parent-tag')
    expect(resolved.material).toBe('sandstone')
  })

  it('3. falls back to the root for an unlisted sub-level', () => {
    const resolved = resolveMaterial(['texture|dungeon_stone', 'texture|dungeon_stone|block'])
    expect(resolved.material).toBe('dungeon_stone')
    expect(resolved.via).toBe('root')
    expect(resolved.matchedTag).toBe('texture|dungeon_stone')
  })

  it('4. reads the filename only when there is no texture tag at all', () => {
    // `part|torch` covers both the wooden torch and its iron plate, which is
    // why the hint runs before the part chain rather than after it.
    const iron = resolveMaterial(['part|torch'], 'dungeon_stone#torch_plate.stl')
    expect(iron.material).toBe('metal')
    expect(iron.via).toBe('filename-hint')

    const timber = resolveMaterial(['part|torch'], 'dungeon_stone#torch.stl')
    expect(timber.material).toBe('wood')
    expect(timber.via).toBe('part-fallback')

    // …and never when a texture tag is present, however suggestive the name.
    const tagged = resolveMaterial(['texture|dungeon_stone'], 'torch_plate.stl')
    expect(tagged.material).toBe('dungeon_stone')
    expect(tagged.via).toBe('root')
  })

  it('5. uses the part chain for the untextured insert population', () => {
    expect(resolveMaterial(['part|grate']).material).toBe('metal')
    expect(resolveMaterial(['part|grate|large']).material).toBe('metal')
    expect(resolveMaterial(['scatter|statue']).material).toBe('cut_stone')
    expect(resolveMaterial(['scatter|mine|beam']).material).toBe('wood')
    expect(resolveMaterial(['part|window_insert']).material).toBe('wood')
    // Prefix matching is on a tag boundary, not a substring: `part|grated_x` is
    // not a `part|grate`.
    expect(resolveMaterial(['part|grated_thing']).material).toBe('unknown')
  })

  it('6. lands on unknown for no tags, no useful tags, and an unmapped root', () => {
    for (const tags of [[], ['size|width|2'], ['interface|secret_door|broken_hole']]) {
      const resolved = resolveMaterial(tags)
      expect(resolved.material).toBe('unknown')
      expect(resolved.via).toBe('terminal-default')
      expect(resolved.matchedTag).toBeNull()
    }

    // A root nobody has mapped is a *different* failure from having no tag, and
    // it reports as one.
    const unmapped = resolveMaterial(['texture|obsidian'])
    expect(unmapped.material).toBe('unknown')
    expect(unmapped.via).toBe('unmapped-root')
    expect(unmapped.matchedTag).toBe('texture|obsidian')

    // A bare `texture` with no root cannot be resolved either, and must not throw.
    expect(resolveMaterial(['texture']).material).toBe('unknown')
  })

  it('reads unknown as unclassified rather than as a guess', () => {
    const resolved = resolveMaterial([])
    expect(resolved.family.contour).toBe('dashed')
    expect(resolved.family.oklch[1]).toBe(0)
    expect(resolved.confidence).toBe('low')
    expect(resolved.family.label).toBe('Unclassified')
  })
})

describe('several texture tags on one blueprint', () => {
  it('takes the deepest tag when one root is described at several depths', () => {
    const resolved = resolveMaterial([
      'texture|cave',
      'texture|cave|sandstone',
      'texture|cave|sandstone|2',
    ])
    expect(resolved.material).toBe('sandstone')
    expect(resolved.matchedTag).toBe('texture|cave|sandstone')
  })

  it('prefers the inset material when two roots disagree', () => {
    // All three multi-root pairs in the catalog. The rare material is the reason
    // the tile exists, so it takes the tile.
    expect(materialFor(['texture|dungeon_stone', 'texture|pool']).id).toBe('water')
    expect(materialFor(['texture|shingles', 'texture|stucco']).id).toBe('stucco')
    expect(materialFor(['texture|shingles', 'texture|stone_brick']).id).toBe('cut_stone')
  })

  it('is independent of tag order', () => {
    const tags = [
      'texture|dungeon_stone',
      'texture|dungeon_stone|eroded',
      'texture|pool',
      'part|grate',
    ]
    const forward = resolveMaterial(tags)
    const reversed = resolveMaterial(tags.slice().reverse())
    expect(reversed).toEqual(forward)
  })

  it('breaks a precedence tie alphabetically rather than by position', () => {
    // `stucco` and `stone_brick` both sit at 20. Whichever way the tags arrive,
    // the answer is the alphabetically first root.
    const tags = ['texture|stucco', 'texture|stone_brick']
    expect(materialFor(tags).id).toBe('cut_stone')
    expect(materialFor(tags.slice().reverse()).id).toBe('cut_stone')
    expect(TEXTURE_ROOT_MATERIAL['stone_brick']).toBe('cut_stone')
  })

  it('prefers a substance-bearing sibling over a wear qualifier at equal depth', () => {
    const resolved = resolveMaterial([
      'texture|dungeon_stone',
      'texture|dungeon_stone|block',
      'texture|dungeon_stone|ruined',
    ])
    expect(resolved.material).toBe('dungeon_stone')
    expect(resolved.worn).toBe(true)
  })

  it('scopes the wear flag to the root that actually won', () => {
    // The 24 pool tiles set into eroded dungeon stone: the pool renders, and the
    // surround's wear is not the pool's wear.
    const resolved = resolveMaterial([
      'texture|dungeon_stone',
      'texture|dungeon_stone|eroded',
      'texture|pool',
    ])
    expect(resolved.material).toBe('water')
    expect(resolved.worn).toBe(false)
  })
})

describe('wear', () => {
  it('detects the qualifier on any component below the root', () => {
    expect(isWearTag('texture|dungeon_stone|ruined')).toBe(true)
    expect(isWearTag('texture|dungeon_stone|eroded')).toBe(true)
    expect(isWearTag('texture|towne|broken_stucco-a')).toBe(true)
    expect(isWearTag('texture|towne|ruined_stucco|a')).toBe(true)
    expect(isWearTag('texture|dungeon_stone|block')).toBe(false)
    // The root itself is never a wear qualifier, even when it looks like one.
    expect(isWearTag('texture|ruined')).toBe(false)
  })

  it('changes roughness and grain and NEVER colour', () => {
    const base = resolveMaterial(['texture|cut-stone'])
    const worn = resolveMaterial(['texture|cut-stone', 'texture|cut-stone|ruined'])
    expect(worn.worn).toBe(true)
    // The one assertion this whole rule exists for: a worn tile is the same
    // family, in the same colour. Darkening it by any visible amount lands it
    // 4.06 ΔE00 from base `plain` — a different family.
    expect(worn.family.tint).toBe(base.family.tint)
    expect(worn.family.edge).toBe(base.family.edge)
    expect(worn.family.id).toBe(base.family.id)
    // …and the response does move.
    expect(worn.finish.roughness).toBeGreaterThan(base.finish.roughness)
    expect(worn.finish.grain?.amplitude ?? 0).toBeGreaterThan(base.finish.grain?.amplitude ?? 0)
    expect(worn.finish.grain?.scale).toBe(base.finish.grain?.scale)
    expect(worn.finish.mortar?.darken ?? 0).toBeGreaterThan(base.finish.mortar?.darken ?? 0)
  })

  it('clamps roughness, grain and mortar rather than running past their ranges', () => {
    const saturated = applyWear({
      roughness: 0.99,
      metalness: 0,
      transmission: 0,
      ior: 1.5,
      surface: 'noise+mortar',
      grain: { scale: 1, amplitude: 0.3 },
      mortar: { scale: 1, width: 0.05, darken: 0.48 },
    })
    expect(saturated.roughness).toBe(1)
    expect(saturated.grain?.amplitude).toBeLessThanOrEqual(0.35)
    expect(saturated.mortar?.darken).toBeLessThanOrEqual(0.5)
  })

  it('leaves a flat surface flat', () => {
    const worn = applyWear({
      roughness: 0.9,
      metalness: 0,
      transmission: 0,
      ior: 1.5,
      surface: 'flat',
      grain: null,
      mortar: null,
    })
    expect(worn.grain).toBeNull()
    expect(worn.mortar).toBeNull()
    expect(worn.surface).toBe('flat')
  })
})

describe('finish overrides', () => {
  it('changes the response without spending a colour', () => {
    const plain = resolveMaterial(['texture|cut-stone'])
    const dwarven = resolveMaterial(['texture|dwarven_halls'])
    expect(dwarven.material).toBe('cut_stone')
    expect(dwarven.family.tint).toBe(plain.family.tint)
    expect(dwarven.finish.roughness).toBe(0.55)
    expect(dwarven.finish.grain).toEqual({ scale: 3.6, amplitude: 0.035 })
  })

  it('adds mortar to stone_brick without changing its family', () => {
    const resolved = resolveMaterial(['texture|stone_brick'])
    expect(resolved.material).toBe('cut_stone')
    expect(resolved.finish.surface).toBe('noise+mortar')
    expect(resolved.finish.mortar).toEqual({ scale: 1.8, width: 0.07, darken: 0.26 })
  })

  it('never lets an override touch transmission or ior', () => {
    // Those two are optical properties of the substance, not of its finish.
    const resolved = resolveMaterial(['texture|mine'])
    expect(resolved.material).toBe('cave')
    expect(resolved.finish.transmission).toBe(MATERIALS.cave.transmission)
    expect(resolved.finish.ior).toBe(MATERIALS.cave.ior)
    expect(resolved.finish.roughness).toBe(0.99)
  })
})

describe('confidence', () => {
  it('is the weakest claim involved, not the family default', () => {
    expect(resolveMaterial(['texture|dungeon_stone']).confidence).toBe('high')
    // cut_stone is a 'high' family, but `texture|stone` is an orphan of the `%`
    // parse and the tag says so.
    expect(resolveMaterial(['texture|stone']).confidence).toBe('low')
    // Downgrades reach a sibling tag too, not just the matched one: the decision
    // here is taken on the parent, and the four-segment sibling is the reason to
    // distrust it.
    expect(
      resolveMaterial(['texture|towne', 'texture|towne|stone', 'texture|towne|stone|stucco'])
        .confidence,
    ).toBe('low')
  })

  it('downgrades whenever the path itself was a guess', () => {
    expect(resolveMaterial(['part|grate']).confidence).toBe('low')
    expect(resolveMaterial(['part|torch'], 'torch_plate.stl').confidence).toBe('low')
    expect(resolveMaterial(['texture|obsidian']).confidence).toBe('low')
    expect(resolveMaterial([]).confidence).toBe('low')
  })
})

describe('the variant key', () => {
  it('collapses the corpus onto one material per family-plus-finish', () => {
    expect(resolveMaterial(['texture|dungeon_stone']).variantKey).toBe('dungeon_stone')
    expect(resolveMaterial(['texture|dungeon_stone', 'texture|dungeon_stone|ruined']).variantKey)
      .toBe('dungeon_stone/worn')
    expect(resolveMaterial(['texture|dwarven_halls']).variantKey).toBe('cut_stone/dwarven_halls')
  })

  it('is order-independent when several overrides apply', () => {
    const tags = ['texture|mine', 'texture|shingles']
    const forward = resolveMaterial(tags).variantKey
    const reversed = resolveMaterial(tags.slice().reverse()).variantKey
    expect(reversed).toBe(forward)
  })

  it('distinguishes exactly the resolutions that differ in appearance', () => {
    const plain = resolveMaterial(['texture|cut-stone'])
    const dwarven = resolveMaterial(['texture|dwarven_halls'])
    expect(dwarven.variantKey).not.toBe(plain.variantKey)
    // Two tags that produce an identical appearance must share a key, or the
    // renderer builds two materials for one look.
    expect(resolveMaterial(['texture|catacombs']).variantKey).toBe(plain.variantKey)
  })
})

describe('the convenience readers', () => {
  it('agree with the full resolution', () => {
    const tags = ['texture|cave', 'texture|cave|sandstone']
    const resolved = resolveMaterial(tags)
    expect(materialFor(tags)).toBe(resolved.family)
    expect(tintFor(tags)).toBe(resolved.family.tint)
    expect(contourFor(tags)).toEqual({ color: resolved.family.edge, style: 'solid' })
    expect(contourFor([])).toEqual({ color: MATERIALS.unknown.edge, style: 'dashed' })
  })

  it('emits stl-thumb arguments with the hashes stripped', () => {
    expect(spriteArgsFor('dungeon_stone')).toEqual(['-m', '1b1c20', '99a3b7', '6b6357'])
  })
})
