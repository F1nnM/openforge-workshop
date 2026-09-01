/**
 * The palette's numeric claims, re-derived from the shipped hex literals.
 *
 * Nothing here trusts a comment. Every scalar stated in `palette.ts` — the
 * OKLCH → hex projection, the CIELAB triple, the WCAG luminance, the contrast
 * and ΔE00 against the well, the contour derivation — is recomputed from the
 * `tint` and `edge` strings that actually ship, using the instrument
 * `color.test.ts` has already validated against published reference data.
 *
 * The four vision-condition minima are **pinned to their measured values**, not
 * merely bounded. A `≥ 9.0` inequality would let a hex edit move the palette
 * 40% of the way to a collision and still pass; pinning to ±0.02 fails on any
 * edit at all, and the failure message says which pair moved.
 *
 * The sprite Phong triples and the silhouette contours are re-derived too, from
 * the same `tint` and the rules stated in `palette.ts`. Every hex in that file
 * except the sixteen tints is now a computed value with a test behind it.
 *
 * Grounds and accents are asserted to be exactly the `@/tokens` values. Reading
 * them from the tokens module rather than `getComputedStyle` is deliberate: PR 2
 * measured that Lightning CSS rewrites the `rgba()` tokens to eight-digit hex,
 * which `THREE.Color.setStyle()` cannot parse, so the stylesheet is not a
 * readable source of colour for JavaScript.
 */
import { describe, expect, it } from 'vitest'

import { color } from '@/tokens/tokens'

import {
  VISION_MODELS,
  contourOklch,
  contrastRatio,
  deltaE2000Hex,
  deltaE2000UnderVision,
  hexToLab,
  oklchToHex,
  parseHex,
  relativeLuminance,
} from './color'
import type { VisionModel } from './color'
import { MATERIALS, MATERIAL_ORDER, PALETTE_INVARIANTS } from './palette'
import type { MaterialId } from './palette'

const ids = MATERIAL_ORDER
const families = ids.map((id) => MATERIALS[id])
const { grounds, accents, well } = PALETTE_INVARIANTS

/** Every unordered pair of families. 16 families → 120 pairs. */
const pairs: readonly (readonly [MaterialId, MaterialId])[] = ids.flatMap((a, index) =>
  ids.slice(index + 1).map((b) => [a, b] as const),
)

/** The closest pair under one vision model, and how close it is. */
function worstPair(model: VisionModel): { distance: number; pair: string } {
  let distance = Number.POSITIVE_INFINITY
  let pair = ''
  for (const [a, b] of pairs) {
    const measured = deltaE2000UnderVision(MATERIALS[a].tint, MATERIALS[b].tint, model)
    if (measured < distance) {
      distance = measured
      pair = `${a}/${b}`
    }
  }
  return { distance, pair }
}

describe('the table itself', () => {
  it('holds exactly the 16 families, each keyed by its own id', () => {
    expect(Object.keys(MATERIALS)).toHaveLength(16)
    expect(ids).toHaveLength(16)
    expect(new Set(ids).size).toBe(16)
    for (const id of ids) {
      expect(MATERIALS[id].id).toBe(id)
    }
    expect(new Set(Object.keys(MATERIALS))).toEqual(new Set(ids))
  })

  it('gives every family a distinct tint and a distinct label', () => {
    expect(new Set(families.map((family) => family.tint)).size).toBe(16)
    expect(new Set(families.map((family) => family.label)).size).toBe(16)
  })

  it('keeps every PBR scalar inside its physical range', () => {
    for (const family of families) {
      expect(family.roughness).toBeGreaterThanOrEqual(0)
      expect(family.roughness).toBeLessThanOrEqual(1)
      expect(family.metalness).toBeGreaterThanOrEqual(0)
      expect(family.metalness).toBeLessThanOrEqual(1)
      expect(family.transmission).toBeGreaterThanOrEqual(0)
      expect(family.transmission).toBeLessThanOrEqual(1)
      expect(family.ior).toBeGreaterThanOrEqual(1)
      expect(family.ior).toBeLessThanOrEqual(2.5)
    }
  })

  it('gives a mortar spec to exactly the families that declare mortar joints', () => {
    for (const family of families) {
      expect(family.mortar !== null).toBe(family.surface === 'noise+mortar')
      expect(family.grain !== null).toBe(family.surface !== 'flat')
    }
  })

  it('dashes the contour of exactly one family — the one that makes no claim', () => {
    const dashed = families.filter((family) => family.contour === 'dashed')
    expect(dashed.map((family) => family.id)).toEqual(['unknown'])
    // The same family is the only chroma-zero entry. Absence of colour and
    // absence of a claim are the same statement, made twice.
    expect(families.filter((family) => family.oklch[1] === 0).map((family) => family.id)).toEqual([
      'unknown',
    ])
  })
})

describe('derived scalars re-derive', () => {
  it('projects every OKLCH triple onto its own shipped tint, exactly', () => {
    // The oklch triple is the authoring value and the hex is its projection.
    // All 16 agree to the byte, which is what makes the OKLCH column editable.
    for (const family of families) {
      const [lightness, chroma, hue] = family.oklch
      expect(oklchToHex(lightness, chroma, hue)).toBe(family.tint)
    }
  })

  it('reproduces every stated CIELAB triple', () => {
    for (const family of families) {
      const [lightness, a, b] = hexToLab(family.tint)
      const [statedL, statedC, statedH] = family.cielab
      expect(lightness).toBeCloseTo(statedL, 1)
      expect(Math.hypot(a, b)).toBeCloseTo(statedC, 1)
      // Hue is meaningless at zero chroma, and `unknown` is the one such entry.
      if (statedC > 0) {
        const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
        expect(hue).toBeCloseTo(statedH, 0)
      }
    }
  })

  it('reproduces every stated luminance, well contrast and well ΔE00', () => {
    for (const family of families) {
      expect(relativeLuminance(family.tint)).toBeCloseTo(family.luminance, 4)
      expect(contrastRatio(family.tint, well)).toBeCloseTo(family.contrastVsWell, 2)
      expect(deltaE2000Hex(family.tint, well)).toBeCloseTo(family.deltaEVsWell, 1)
    }
  })
})

describe('separation between families', () => {
  it('clears 9.0 ΔE00 under normal vision, at the measured 9.934', () => {
    const { distance, pair } = worstPair('normal')
    expect(pair).toBe('plain/rough_stone')
    expect(distance).toBeGreaterThanOrEqual(PALETTE_INVARIANTS.minPairwise)
    expect(distance).toBeCloseTo(9.934, 2)
  })

  it('holds its floor under all three dichromacies, at the measured minima', () => {
    // Pinned, not merely bounded — see this file's header. All three clear the
    // 9.0 design target; the pre-P2 palette measured 8.864 under deuteranopia,
    // and `palette.ts` records the re-solve that closed it.
    const measured: Readonly<Record<string, readonly [number, string]>> = {
      protanopia: [9.787, 'rough_stone/brick'],
      deuteranopia: [9.807, 'plain/rough_stone'],
      tritanopia: [9.9, 'rough_stone/sewer'],
    }
    for (const model of VISION_MODELS) {
      if (model === 'normal') continue
      const expected = measured[model]
      expect(expected).toBeDefined()
      const { distance, pair } = worstPair(model)
      expect(pair).toBe(expected?.[1])
      expect(distance).toBeCloseTo(expected?.[0] ?? 0, 2)
      expect(distance).toBeGreaterThanOrEqual(PALETTE_INVARIANTS.minPairwiseUnderCvd)
    }
  })

  it('meets the 9.0 dichromacy target the design pass aimed for', () => {
    // The invariant IS the target now: the palette used to record an 8.8 floor
    // and a 9.0 target it missed by 0.136, and P2 re-solved rather than leaving
    // a documented exception in place. The floor and the target being one number
    // is the whole point — a target stated separately from what is enforced is a
    // target nothing defends.
    const worst = Math.min(
      ...VISION_MODELS.filter((model) => model !== 'normal').map((model) => worstPair(model).distance),
    )
    expect(PALETTE_INVARIANTS.minPairwiseUnderCvd).toBe(9.0)
    expect(worst).toBeGreaterThanOrEqual(PALETTE_INVARIANTS.minPairwiseUnderCvd)
    // And it is met with room, not on the boundary, so an 8-bit rounding
    // difference somewhere downstream cannot quietly reopen the gap.
    expect(worst).toBeGreaterThan(9.7)
  })

  it('keeps every family clear of the parchment grounds and the UI accents', () => {
    for (const family of families) {
      for (const ground of grounds) {
        expect(deltaE2000Hex(family.tint, ground)).toBeGreaterThanOrEqual(
          PALETTE_INVARIANTS.minToGround,
        )
      }
      for (const accent of accents) {
        expect(deltaE2000Hex(family.tint, accent)).toBeGreaterThanOrEqual(
          PALETTE_INVARIANTS.minToAccent,
        )
      }
    }
  })

  it('measures 12.06 to the nearest ground and 11.16 to the nearest accent', () => {
    const toGround = Math.min(
      ...families.flatMap((family) => grounds.map((g) => deltaE2000Hex(family.tint, g))),
    )
    const toAccent = Math.min(
      ...families.flatMap((family) => accents.map((a) => deltaE2000Hex(family.tint, a))),
    )
    expect(toGround).toBeCloseTo(12.064, 2)
    expect(toAccent).toBeCloseTo(11.159, 2)
  })

  it('judges the palette against the real tokens, not a stale copy of them', () => {
    expect(grounds).toEqual([color.bg, color.bg2, color.bg3, color.chip])
    expect(accents).toEqual([color.acc, color.acc2])
    expect(well).toBe(color.bg3)
  })
})

/**
 * The sixteen tints `docs/texture-materials.draft.ts` shipped, before the P2
 * re-solve. They are stated here — not imported from the draft, which is a
 * design artefact and not part of the build — so the two claims the re-solve
 * rests on are checkable: that no family's albedo moved by a perceptible
 * amount, and that the semantic hue anchors held.
 */
const DRAFT_TINTS: Readonly<Record<MaterialId, string>> = {
  dungeon_stone: '#6b7280',
  cut_stone: '#8f8c81',
  plain: '#76746c',
  rough_stone: '#665d4e',
  wood: '#593931',
  stucco: '#8b9ba1',
  aztlan: '#a97f62',
  sandstone: '#b5a36d',
  cave: '#4a526e',
  brick: '#7c442b',
  sewer: '#7f743c',
  necro: '#a3a890',
  water: '#518ea4',
  metal: '#2f2f35',
  ice: '#a3d0e3',
  unknown: '#505050',
}

/** CIELAB hue, or null for a colour too achromatic for hue to mean anything. */
function labHue(hex: string): number | null {
  const [, a, b] = hexToLab(hex)
  if (Math.hypot(a, b) < 5) return null
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
}

describe('the re-solve stayed inside the design artefact', () => {
  it('moves no family further than 1.5 ΔE00 from the draft it re-solved', () => {
    // 1.5 is the low end of the 1.5–9 ΔE00 spread `palette.ts` measures between
    // real stone albedos and calls sub-JND for a 25 px mark. Every family is
    // inside it, so the palette gained 0.9 ΔE00 of separation under dichromacy
    // without any family visibly changing colour.
    for (const family of families) {
      expect(deltaE2000Hex(family.tint, DRAFT_TINTS[family.id])).toBeLessThanOrEqual(1.5)
    }
    // And three are untouched, `dungeon_stone` because it is pinned: 3,082 live
    // blueprints and `src/three/material.test.ts` asserts its hex.
    expect(families.filter((f) => f.tint === DRAFT_TINTS[f.id]).map((f) => f.id)).toEqual([
      'dungeon_stone',
      'cave',
      'ice',
    ])
  })

  it('holds every semantic hue anchor, to within a third of a Munsell step', () => {
    // Hue is the one axis taken from measurement rather than optimised, so the
    // solve carried a hue window and this is it, measured. A Munsell hue family
    // spans 36°; every chromatic family moved at most 3.2°.
    for (const family of families) {
      const before = labHue(DRAFT_TINTS[family.id])
      const after = labHue(family.tint)
      if (before === null || after === null) continue
      let rotation = Math.abs(after - before)
      if (rotation > 180) rotation = 360 - rotation
      expect(rotation).toBeLessThanOrEqual(3.3)
    }
    // The three families excluded above are excluded because they have no hue
    // to preserve: `plain` asserts nothing, `metal` is near-black, `unknown` is
    // chroma-zero by construction. `plain` is the one that used its freedom,
    // rotating 9.3° at C* 3.7.
    expect(families.filter((f) => labHue(f.tint) === null).map((f) => f.id)).toEqual([
      'plain',
      'metal',
      'unknown',
    ])
  })

  it('keeps the value order the notes describe', () => {
    const lightness = (id: MaterialId) => hexToLab(MATERIALS[id].tint)[0]
    // `ice` is the only fill above L* 70 — it survives up there on hue distance
    // from the parchment, not on value, and nothing else may follow it.
    expect(families.filter((family) => lightness(family.id) > 70).map((family) => family.id)).toEqual(
      ['ice'],
    )
    // `cave` is the darkest rock. (`brick` is fired clay, `wood` timber, `metal`
    // iron, `unknown` no claim at all — none of them is stone.)
    const rock: readonly MaterialId[] = [
      'dungeon_stone',
      'cut_stone',
      'plain',
      'rough_stone',
      'stucco',
      'aztlan',
      'sandstone',
      'sewer',
      'necro',
      'ice',
    ]
    for (const id of rock) {
      expect(lightness('cave')).toBeLessThan(lightness(id))
    }
  })
})

describe('chroma and hue constraints', () => {
  it('never out-saturates the accent', () => {
    for (const family of families) {
      expect(family.oklch[1]).toBeLessThanOrEqual(PALETTE_INVARIANTS.maxChroma)
    }
    // The stated cap is the palette's own maximum, so it cannot drift upward
    // unnoticed by being generous.
    expect(Math.max(...families.map((family) => family.oklch[1]))).toBeCloseTo(
      PALETTE_INVARIANTS.maxChroma,
      6,
    )
  })

  it('leaves the verdigris hue band to the secondary accent', () => {
    const [low, high] = PALETTE_INVARIANTS.reservedHue
    for (const family of families) {
      const [, chroma, hue] = family.oklch
      if (chroma > 0.02) {
        expect(hue < low || hue > high).toBe(true)
      }
    }
  })
})

describe('the silhouette contour', () => {
  it('derives every edge from its fill by the §9 rule, to the byte', () => {
    // `oklch(min(0.36, L × 0.72), C × 0.70, H)`. The draft's contours were
    // rounded by hand and six of the sixteen sat 1/255 off the rule; the P2
    // re-solve regenerated all sixteen from the rule itself, so this is now an
    // exact equality and the `edge` column has no authored digits left in it.
    for (const family of families) {
      const [lightness, chroma, hue] = family.oklch
      expect(oklchToHex(...contourOklch(lightness, chroma, hue))).toBe(family.edge)
    }
  })

  it('makes every contour darker than its own fill', () => {
    for (const family of families) {
      expect(relativeLuminance(family.edge)).toBeLessThan(relativeLuminance(family.tint))
    }
  })

  it('clears WCAG 1.4.11 against every parchment ground, at 7.13:1 on the well', () => {
    let minimum = Number.POSITIVE_INFINITY
    for (const family of families) {
      for (const ground of grounds) {
        const measured = contrastRatio(family.edge, ground)
        expect(measured).toBeGreaterThanOrEqual(PALETTE_INVARIANTS.minEdgeContrast)
        minimum = Math.min(minimum, measured)
      }
    }
    // 7.13 is the figure against `--bg3`, the well a tile is normally seen on,
    // and it is the one §9 quotes. The darkest ground is `--chip`, where the
    // same contours measure 6.59 — still more than double the 3:1 obligation.
    const againstWell = Math.min(...families.map((family) => contrastRatio(family.edge, well)))
    expect(againstWell).toBeCloseTo(7.133, 2)
    expect(minimum).toBeCloseTo(6.59, 2)
  })

  it('would halo the darkest family if the 0.36 clamp were a flat 0.36', () => {
    // This is why `contourOklch` uses `min()`. Without it, `metal` — whose own
    // fill sits at L 0.308 — gets a contour LIGHTER than its fill, and the
    // silhouette becomes a glow. Asserted so the clamp cannot be simplified
    // away as defensive coding.
    const metal = MATERIALS.metal
    expect(metal.oklch[0]).toBeLessThan(0.36)
    const flat = oklchToHex(0.36, metal.oklch[1] * 0.7, metal.oklch[2])
    expect(relativeLuminance(flat)).toBeGreaterThan(relativeLuminance(metal.tint))
    // And exactly one family is below the clamp, so it is a real case, not a
    // hypothetical one.
    expect(families.filter((family) => family.oklch[0] < 0.36).map((family) => family.id)).toEqual([
      'metal',
    ])
  })
})

describe('the sprite triples', () => {
  it('solves ambient + 0.525 × diffuse back to the family’s own albedo', () => {
    // The relation `palette.ts` documents, inverted: diffuse carries the lit
    // term at 0.75 of the albedo, ambient carries the rest. Both are stated as
    // 8-bit hex, so the sum is exact only to within the rounding of two
    // channels — hence ±1/255 rather than equality. `sandstone` and `ice` clip
    // the diffuse term at 255 and are the reason ambient is defined as the
    // remainder rather than a fixed fraction of the tint.
    const GAIN = 0.75 / 0.525
    for (const family of families) {
      const tint = parseHex(family.tint).map((channel) => Math.round(channel * 255))
      const diffuse = parseHex(family.sprite.diffuse).map((channel) => Math.round(channel * 255))
      const ambient = parseHex(family.sprite.ambient).map((channel) => Math.round(channel * 255))
      for (let channel = 0; channel < 3; channel += 1) {
        const value = tint[channel] ?? 0
        expect(diffuse[channel]).toBe(Math.round(Math.min(255, value * GAIN)))
        expect(ambient[channel]).toBe(Math.round(value - 0.525 * (diffuse[channel] ?? 0)))
        const rebuilt = (ambient[channel] ?? 0) + 0.525 * (diffuse[channel] ?? 0)
        expect(Math.abs(rebuilt - value)).toBeLessThanOrEqual(1)
      }
    }
    // Two families clip, and they are the two lightest fills. Asserted so the
    // clipping branch above stays a real case rather than dead defence.
    expect(
      families
        .filter((family) => parseHex(family.sprite.diffuse).some((channel) => channel === 1))
        .map((family) => family.id),
    ).toEqual(['sandstone', 'ice'])
  })

  it('gives every family a parseable Phong triple with one shared specular', () => {
    for (const family of families) {
      expect(() => parseHex(family.sprite.ambient)).not.toThrow()
      expect(() => parseHex(family.sprite.diffuse)).not.toThrow()
      expect(() => parseHex(family.sprite.specular)).not.toThrow()
      // Ambient is the shadow term and must be darker than the lit diffuse.
      expect(relativeLuminance(family.sprite.ambient)).toBeLessThan(
        relativeLuminance(family.sprite.diffuse),
      )
    }
    expect(new Set(families.map((family) => family.sprite.specular)).size).toBe(1)
  })
})
