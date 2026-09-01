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
  it('clears 9.0 ΔE00 under normal vision, at the measured 9.211', () => {
    const { distance, pair } = worstPair('normal')
    expect(pair).toBe('cut_stone/plain')
    expect(distance).toBeGreaterThanOrEqual(PALETTE_INVARIANTS.minPairwise)
    expect(distance).toBeCloseTo(9.211, 2)
  })

  it('holds its floor under all three dichromacies, at the measured minima', () => {
    // Pinned, not merely bounded — see this file's header. The deuteranopia row
    // is 0.136 short of the 9.0 design target; `palette.ts` records why that is
    // left standing rather than papered over or re-solved.
    const measured: Readonly<Record<string, readonly [number, string]>> = {
      protanopia: [9.041, 'stucco/water'],
      deuteranopia: [8.864, 'cut_stone/necro'],
      tritanopia: [9.043, 'rough_stone/sewer'],
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

  it('records the dichromacy shortfall honestly rather than claiming the target', () => {
    // If a future palette edit closes the gap, this test fails and the invariant
    // should be raised to the target. It exists so the gap cannot be forgotten.
    const worst = Math.min(
      ...VISION_MODELS.filter((model) => model !== 'normal').map((model) => worstPair(model).distance),
    )
    expect(PALETTE_INVARIANTS.minPairwiseUnderCvd).toBeLessThan(
      PALETTE_INVARIANTS.pairwiseTargetUnderCvd,
    )
    expect(worst).toBeLessThan(PALETTE_INVARIANTS.pairwiseTargetUnderCvd)
    expect(worst).toBeGreaterThanOrEqual(PALETTE_INVARIANTS.minPairwiseUnderCvd)
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

  it('measures 12.34 to the nearest ground and 12.22 to the nearest accent', () => {
    const toGround = Math.min(
      ...families.flatMap((family) => grounds.map((g) => deltaE2000Hex(family.tint, g))),
    )
    const toAccent = Math.min(
      ...families.flatMap((family) => accents.map((a) => deltaE2000Hex(family.tint, a))),
    )
    expect(toGround).toBeCloseTo(12.34, 2)
    expect(toAccent).toBeCloseTo(12.22, 2)
  })

  it('judges the palette against the real tokens, not a stale copy of them', () => {
    expect(grounds).toEqual([color.bg, color.bg2, color.bg3, color.chip])
    expect(accents).toEqual([color.acc, color.acc2])
    expect(well).toBe(color.bg3)
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
  it('derives every edge from its fill by the §9 rule, within a code point', () => {
    // `oklch(min(0.36, L × 0.72), C × 0.70, H)`. Ten of the sixteen reproduce
    // byte-exactly; the other six differ by 1/255 in one or two channels, which
    // is a rounding convention in the design pass, not a different rule. The
    // shipped literals are what the measured 7.14:1 minimum was taken on, so
    // they stay authoritative and this asserts the rule that produced them.
    for (const family of families) {
      const [lightness, chroma, hue] = family.oklch
      const derived = oklchToHex(...contourOklch(lightness, chroma, hue))
      const shipped = parseHex(family.edge).map((channel) => Math.round(channel * 255))
      const computed = parseHex(derived).map((channel) => Math.round(channel * 255))
      for (let channel = 0; channel < 3; channel += 1) {
        expect(Math.abs((shipped[channel] ?? 0) - (computed[channel] ?? 0))).toBeLessThanOrEqual(1)
      }
    }
  })

  it('makes every contour darker than its own fill', () => {
    for (const family of families) {
      expect(relativeLuminance(family.edge)).toBeLessThan(relativeLuminance(family.tint))
    }
  })

  it('clears WCAG 1.4.11 against every parchment ground, at 7.14:1 on the well', () => {
    let minimum = Number.POSITIVE_INFINITY
    for (const family of families) {
      for (const ground of grounds) {
        const measured = contrastRatio(family.edge, ground)
        expect(measured).toBeGreaterThanOrEqual(PALETTE_INVARIANTS.minEdgeContrast)
        minimum = Math.min(minimum, measured)
      }
    }
    // 7.14 is the figure against `--bg3`, the well a tile is normally seen on,
    // and it is the one §9 quotes. The darkest ground is `--chip`, where the
    // same contours measure 6.59 — still more than double the 3:1 obligation.
    const againstWell = Math.min(...families.map((family) => contrastRatio(family.edge, well)))
    expect(againstWell).toBeCloseTo(7.14, 2)
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
